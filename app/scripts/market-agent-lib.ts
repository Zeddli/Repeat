import { mkdir, open, readFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { keccak256, stringToHex } from 'viem';
import type { PublishService, ServiceListing } from '../shared/marketplace.js';
import type { Address, Hex } from '../shared/types.js';

export class AgentError extends Error {}

export function expectedServiceSku(service: Pick<ServiceListing, 'id' | 'kind'>): Hex {
  if (service.kind === 'fixture') {
    const match = /^fixture-[ab]-(bnb-(?:agents|identity|commerce|budget))$/.exec(service.id);
    if (!match) throw new AgentError('Unknown builder fixture identity.');
    return keccak256(stringToHex(match[1]));
  }
  return keccak256(stringToHex(service.id));
}
const maxUint256 = (1n << 256n) - 1n;
const units = z.string().regex(/^[1-9][0-9]*$/).refine(value => BigInt(value) <= maxUint256);
const publishSchema = z.strictObject({
  id: z.string().min(1).max(80).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  title: z.string().trim().min(1).max(160),
  description: z.string().trim().min(1).max(2000),
  category: z.enum(['research', 'data', 'automation', 'other']),
  basePrice: units,
  spendThreshold: units,
  discountBps: z.number().int().min(0).max(2000),
  response: z.string().min(1).max(50000),
});

export function parsePublishService(value: unknown): PublishService {
  const parsed = publishSchema.safeParse(value);
  if (!parsed.success) throw new AgentError('Invalid publish JSON. Use the exact PublishService fields and positive integer token units.');
  return parsed.data;
}

/** Human token amounts are parsed without Number or rounding. */
export function parseMaxSpend(value: string | undefined): bigint {
  if (!value || !/^(0|[1-9][0-9]*)(\.[0-9]{1,6})?$/.test(value)) {
    throw new AgentError('Provide --max-spend in human wBSC, with at most six decimals (for example 0.06).');
  }
  const [whole, fraction = ''] = value.split('.');
  const result = BigInt(whole) * 1000000n + BigInt(fraction.padEnd(6, '0'));
  if (result <= 0n || result > maxUint256) throw new AgentError('The spending cap must be positive and fit uint256.');
  return result;
}

export function assertAffordable(amount: string, maximum: bigint): bigint {
  if (!/^[1-9][0-9]*$/.test(amount)) throw new AgentError('The quote has an invalid amount.');
  const parsed = BigInt(amount);
  if (parsed > maxUint256 || parsed > maximum) throw new AgentError('Quote exceeds --max-spend; no payment was submitted.');
  return parsed;
}

export type AgentIntent = {
  event: 'intent'; intentId: string; serviceId: string; orderId: Hex; seller: Address; sku: Hex;
  amount: string; maxSpend: string; offerVersion: string; deadline: string;
};
export type AgentEntry = AgentIntent
  | { event: 'tx-prepared'; action: 'approve' | 'checkout' | 'offer'; intentId?: string; hash: Hex }
  | { event: 'paid' | 'delivered' | 'aborted' | 'reverted'; intentId: string };
export type RestoredIntent = {
  intent: AgentIntent; checkoutHash?: Hex; paid: boolean; delivered: boolean; closed: boolean;
};
type JournalScope = { chainId: number; checkout: Address; buyer: Address };

/** Every prepared transaction hash is synced before broadcast. A damaged journal fails closed. */
export class AgentJournal {
  readonly file: string;
  private readonly lockFile: string;
  private readonly directory: string;
  constructor(directory: string, scope: JournalScope) {
    this.directory = directory;
    const name = `${scope.chainId}-${scope.checkout.toLowerCase()}-${scope.buyer.toLowerCase()}`;
    this.file = path.join(directory, `journal-agent-${name}.jsonl`);
    this.lockFile = path.join(directory, 'runtime', `agent-${name}.lock`);
  }

  async append(entry: AgentEntry): Promise<void> {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const file = await open(this.file, 'a', 0o600);
    try { await file.writeFile(JSON.stringify({ ...entry, at: new Date().toISOString() }) + '\n'); await file.sync(); }
    finally { await file.close(); }
  }

  async intents(): Promise<RestoredIntent[]> {
    let contents: string;
    try { contents = await readFile(this.file, 'utf8'); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw new AgentError('Cannot read the payment journal; preserve it and resolve filesystem access before buying.');
    }
    const result = new Map<string, RestoredIntent>();
    try {
      if (contents && !contents.endsWith('\n')) throw new Error('Incomplete journal');
      for (const line of contents.split('\n').filter(Boolean)) {
        const entry = JSON.parse(line) as AgentEntry;
        if (entry.event === 'intent') {
          if (!entry.intentId || result.has(entry.intentId) || !entry.serviceId || !/^0x[0-9a-fA-F]{64}$/.test(entry.orderId)) throw new Error('Invalid intent');
          result.set(entry.intentId, { intent: entry, paid: false, delivered: false, closed: false });
        } else if (entry.event === 'tx-prepared' && !entry.intentId) {
          if (!/^0x[0-9a-fA-F]{64}$/.test(entry.hash)) throw new Error('Invalid transaction');
        } else {
          const intent = entry.intentId ? result.get(entry.intentId) : undefined;
          if (!intent) throw new Error('Unknown intent');
          if (entry.event === 'tx-prepared') {
            if (!/^0x[0-9a-fA-F]{64}$/.test(entry.hash)) throw new Error('Invalid transaction');
            if (entry.action === 'checkout') intent.checkoutHash = entry.hash;
          } else if (entry.event === 'paid') intent.paid = true;
          else if (entry.event === 'delivered') { intent.paid = true; intent.delivered = true; intent.closed = true; }
          else if (entry.event === 'aborted' || entry.event === 'reverted') intent.closed = true;
          else throw new Error('Unknown event');
        }
      }
    } catch { throw new AgentError('Payment journal is damaged; preserve it and inspect chain orders before another purchase.'); }
    return [...result.values()];
  }

  async findIntent(intentId: string): Promise<RestoredIntent | undefined> {
    return (await this.intents()).find(entry => entry.intent.intentId === intentId);
  }

  async assertNewIntentAllowed(serviceId: string, intentId: string): Promise<void> {
    const intents = await this.intents();
    if (intents.some(entry => entry.intent.intentId === intentId)) throw new AgentError('This intent already exists. Reuse it to recover delivery; choose a new intent only for an authorized new purchase.');
    const unresolved = intents.find(entry => entry.intent.serviceId === serviceId && !entry.closed);
    if (unresolved) throw new AgentError(`Unresolved purchase ${unresolved.intent.intentId}, order ${unresolved.intent.orderId}. Run buy with --intent ${unresolved.intent.intentId} or deliver with that order; no new payment was submitted.`);
  }

  async withLock<T>(operation: () => Promise<T>): Promise<T> {
    await mkdir(path.dirname(this.lockFile), { recursive: true, mode: 0o700 });
    let lock;
    try { lock = await open(this.lockFile, 'wx', 0o600); }
    catch { throw new AgentError('A signer lock exists for this deployment and wallet. Stop the other CLI process before proceeding. A stale lock may be removed from app/data/runtime only after confirming no signer is running.'); }
    try { await lock.writeFile(String(process.pid)); await lock.sync(); return await operation(); }
    finally { await lock.close(); await unlink(this.lockFile); }
  }
}

/** Repository execution preserves old journals; the downloaded client owns state in its working folder. */
export function agentDataDirectory(moduleUrl: string, cwd: string, override?: string): string {
  if (override) return path.resolve(cwd, override);
  const script = fileURLToPath(moduleUrl);
  return path.extname(script) === '.ts'
    ? path.resolve(path.dirname(script), '..', 'data')
    : path.resolve(cwd, '.repeat-agent');
}
