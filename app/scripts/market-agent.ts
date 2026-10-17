import { readFile } from 'node:fs/promises';
import { randomBytes, randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createPublicClient, createWalletClient, encodeFunctionData, formatUnits, getAddress,
  http, isAddress, keccak256, parseEventLogs, stringToHex, zeroAddress,
  type Address, type Chain, type Hex, type TransactionReceipt,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { bscTestnet, foundry } from 'viem/chains';
import { parseSiweMessage } from 'viem/siwe';
import { z } from 'zod';
import { checkoutAbi, tokenAbi } from '../shared/abi.js';
import type { AuthChallenge, MarketConfig, MarketDelivery, MarketWallet, ServiceListing, ServiceQuote, WalletSession } from '../shared/marketplace.js';
import { AgentError, AgentJournal, agentDataDirectory, assertAffordable, expectedServiceSku, parseMaxSpend, parsePublishService, type AgentIntent, type RestoredIntent } from './market-agent-lib.js';
import { testnetSigningKey } from './deployment-safety.js';

const help = `Repeat wallet marketplace agent

Usage: node repeat-agent.mjs COMMAND [OPTIONS]
Repository alternative: npm run market:agent -- COMMAND (from app/).
  discover | search [--query TEXT] [--category research|data|automation|other]
  quote   --service ID --buyer ADDRESS
  wallet
  faucet                                     Local chain 31337 only
  publish --file PATH                        Explicit PublishService JSON
  buy     --service ID --max-spend 0.06 [--intent UNIQUE_ID]
  deliver --service ID --order 0xBYTES32

Common: --api URL (or MARKET_API_URL; default http://127.0.0.1:3001).
Only signed commands read MARKET_AGENT_PRIVATE_KEY. No server wallet is used.
--max-spend is human wBSC and bounds tokens; native gas is additional.
Retry an interrupted buy with its same --intent, or deliver its same --order.
An uncertain payment never triggers an automatic replacement checkout.
Downloaded client state: ./.repeat-agent. Keep this folder to recover paid orders.
Set MARKET_AGENT_DATA_DIR to an absolute directory to share state across working folders.
`;

const address = z.string().refine(isAddress).transform(value => getAddress(value));
const bytes32 = z.string().regex(/^0x[0-9a-fA-F]{64}$/).transform(value => value as Hex);
const integer = z.string().regex(/^(0|[1-9][0-9]*)$/);
const configSchema = z.object({
  ready: z.boolean(), chainId: z.union([z.literal(31337), z.literal(97)]), chainName: z.string(),
  rpcUrl: z.url(), nativeSymbol: z.string(), tokenAddress: address, checkoutAddress: address,
  explorerUrl: z.string(), localFaucet: z.boolean(), tokenSymbol: z.literal('wBSC'), tokenDecimals: z.literal(6), previousCheckoutAddress: address.optional(),
});
const listingSchema = z.object({
  id: z.string().min(1).max(80), seller: address, sku: bytes32, title: z.string(), description: z.string(),
  category: z.enum(['research', 'data', 'automation', 'other']), basePrice: integer, spendThreshold: integer,
  discountBps: z.number().int().min(0).max(2000), offerVersion: integer,
  kind: z.enum(['hosted', 'fixture']), createdAt: z.string(),
});
const quoteSchema = z.object({
  serviceId: z.string(), buyer: address, seller: address, sku: bytes32,
  amount: integer, basePrice: integer, appliedBps: z.number().int().min(0).max(2000),
  priorPaid: integer, purchaseCount: integer, offerVersion: integer, blockNumber: integer,
});

function decode<T>(schema: z.ZodType<T>, input: unknown, label: string): T {
  const result = schema.safeParse(input);
  if (!result.success) throw new AgentError(`Invalid ${label} from marketplace API.`);
  return result.data;
}

class MarketApi {
  private token?: string;
  constructor(readonly base: string) {}
  async call<T>(url: string, body?: unknown): Promise<T> {
    let response: Response;
    try {
      response = await fetch(this.base + url, {
        method: body === undefined ? 'GET' : 'POST', redirect: 'error', signal: AbortSignal.timeout(20000),
        headers: { 'Content-Type': 'application/json', ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}) },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch { throw new AgentError('Marketplace API is unavailable. Check --api and retry read-only discovery.'); }
    let data: unknown;
    try { data = await response.json(); } catch { throw new AgentError('Marketplace API returned invalid JSON.'); }
    if (!response.ok) {
      const code = typeof data === 'object' && data && 'error' in data && typeof data.error === 'string' && /^[A-Z_a-z0-9-]{1,80}$/.test(data.error) ? ` ${data.error}` : '';
      throw new AgentError(`Marketplace API ${response.status}${code}.`);
    }
    return data as T;
  }
  async authenticate(account: ReturnType<typeof privateKeyToAccount>, chainId: number): Promise<void> {
    const challenge = decode(z.object({ challengeId: z.string(), message: z.string(), expiresAt: z.string() }),
      await this.call<AuthChallenge>('/api/auth/challenge', { address: account.address, chainId }), 'authentication challenge');
    const message = parseSiweMessage(challenge.message);
    const expiry = Date.parse(challenge.expiresAt);
    if (message.address?.toLowerCase() !== account.address.toLowerCase() || message.chainId !== chainId
      || message.domain !== 'localhost:3001' || message.uri !== 'http://localhost:3001' || message.scheme !== 'http' || message.version !== '1'
      || !message.nonce || !message.issuedAt || !message.expirationTime
      || !Number.isFinite(expiry) || expiry <= Date.now() || expiry > Date.now() + 6 * 60 * 1000
      || message.expirationTime.getTime() !== expiry || message.issuedAt.getTime() > Date.now() + 30000) {
      throw new AgentError('Authentication challenge does not match this wallet, chain, or marketplace domain.');
    }
    const signature = await account.signMessage({ message: challenge.message });
    const session = decode(z.object({ token: z.string().min(1), address, chainId: z.number(), expiresAt: z.string() }),
      await this.call<WalletSession>('/api/auth/verify', { challengeId: challenge.challengeId, signature }), 'wallet session');
    if (session.address.toLowerCase() !== account.address.toLowerCase() || session.chainId !== chainId || !Number.isFinite(Date.parse(session.expiresAt)) || Date.parse(session.expiresAt) <= Date.now()) {
      throw new AgentError('Marketplace returned a session for the wrong wallet or chain.');
    }
    this.token = session.token;
  }
}

function options(argv: string[]): { command: string; flags: Map<string, string> } {
  const command = argv[0] || 'help';
  const allowed: Record<string, string[]> = {
    discover: ['query', 'category'], search: ['query', 'category'], quote: ['service', 'buyer'],
    wallet: [], faucet: [], publish: ['file'], buy: ['service', 'max-spend', 'intent'], deliver: ['service', 'order'],
  };
  if (['help', '--help', '-h'].includes(command)) return { command: 'help', flags: new Map() };
  if (!allowed[command]) throw new AgentError('Unknown command. Run market-agent.ts help.');
  const flags = new Map<string, string>();
  for (let index = 1; index < argv.length; index += 2) {
    const name = argv[index]?.replace(/^--/, '');
    const value = argv[index + 1];
    if (!argv[index]?.startsWith('--') || !name || ![...allowed[command], 'api'].includes(name) || !value || value.startsWith('--') || flags.has(name)) {
      throw new AgentError('Unknown, missing, or duplicate command option. Run market-agent.ts help.');
    }
    flags.set(name, value);
  }
  return { command, flags };
}

function required(flags: Map<string, string>, name: string): string {
  const value = flags.get(name);
  if (!value) throw new AgentError(`Provide --${name}.`);
  return value;
}
function serviceId(flags: Map<string, string>): string {
  const id = required(flags, 'service');
  if (!/^[a-z0-9][a-z0-9-]{0,79}$/.test(id)) throw new AgentError('Invalid service ID.');
  return id;
}
function signingAccount(config: MarketConfig) {
  const key = process.env.MARKET_AGENT_PRIVATE_KEY;
  if (!key || !/^0x[0-9a-fA-F]{64}$/.test(key)) throw new AgentError('Set MARKET_AGENT_PRIVATE_KEY to your disposable wallet key for this signed command.');
  try {
    if (config.chainId === 97) testnetSigningKey(key, 'MARKET_AGENT_PRIVATE_KEY');
    return privateKeyToAccount(key as Hex);
  } catch { throw new AgentError('Invalid wallet key, or a public development key was selected for BSC testnet.'); }
}

async function context(api: MarketApi) {
  const config = decode(configSchema, await api.call<MarketConfig>('/api/market/config'), 'market configuration');
  if (!config.ready) throw new AgentError('Marketplace is not configured.');
  if (!['http:', 'https:'].includes(new URL(config.rpcUrl).protocol)) throw new AgentError('Unsupported RPC URL.');
  const chain: Chain = config.chainId === 31337 ? foundry : bscTestnet;
  const publicClient = createPublicClient({ chain, transport: http(config.rpcUrl, { retryCount: 0, timeout: 20000 }) });
  if (await publicClient.getChainId() !== config.chainId) throw new AgentError('RPC chain does not match marketplace configuration.');
  const [tokenCode, checkoutCode, paymentToken, decimals] = await Promise.all([
    publicClient.getCode({ address: config.tokenAddress }), publicClient.getCode({ address: config.checkoutAddress }),
    publicClient.readContract({ address: config.checkoutAddress, abi: checkoutAbi, functionName: 'paymentToken' }),
    publicClient.readContract({ address: config.tokenAddress, abi: tokenAbi, functionName: 'decimals' }),
  ]);
  if (!tokenCode || tokenCode === '0x' || !checkoutCode || checkoutCode === '0x'
    || paymentToken.toLowerCase() !== config.tokenAddress.toLowerCase() || decimals !== 6) {
    throw new AgentError('Configured contracts or payment token decimals do not match the marketplace.');
  }
  if (config.previousCheckoutAddress) {
    const previousAbi = [{type:'function',name:'previousCheckout',stateMutability:'view',inputs:[],outputs:[{type:'address'}]}] as const;
    const previous = await publicClient.readContract({ address: config.checkoutAddress, abi: previousAbi, functionName: 'previousCheckout' });
    if (previous.toLowerCase() !== config.previousCheckoutAddress.toLowerCase()) throw new AgentError('Configured predecessor is not the on-chain migration source.');
  }
  return { config, chain, publicClient };
}
type Context = Awaited<ReturnType<typeof context>>;

async function listing(api: MarketApi, id: string): Promise<ServiceListing> {
  const result = decode(listingSchema, await api.call(`/api/market/services/${encodeURIComponent(id)}`), 'service');
  if (result.id !== id || result.sku.toLowerCase() !== expectedServiceSku(result).toLowerCase()) throw new AgentError('Service identity or SKU does not match its requested ID.');
  return result;
}

async function quote(api: MarketApi, ctx: Context, service: ServiceListing, buyer: Address): Promise<ServiceQuote> {
  const result = decode(quoteSchema, await api.call(`/api/market/services/${encodeURIComponent(service.id)}/quote?buyer=${buyer}`), 'quote');
  if (result.serviceId !== service.id || result.buyer.toLowerCase() !== buyer.toLowerCase()
    || result.seller.toLowerCase() !== service.seller.toLowerCase() || result.sku.toLowerCase() !== service.sku.toLowerCase()) throw new AgentError('Quote identity does not match the selected service and wallet.');
  const [amount, bps, paid, count, version] = await ctx.publicClient.readContract({
    address: ctx.config.checkoutAddress, abi: checkoutAbi, functionName: 'preview', args: [buyer, service.seller, service.sku], blockNumber: BigInt(result.blockNumber),
  });
  if (amount.toString() !== result.amount || bps !== result.appliedBps || paid.toString() !== result.priorPaid
    || count.toString() !== result.purchaseCount || version.toString() !== result.offerVersion) throw new AgentError('API quote does not match confirmed contract state.');
  return result;
}

function validateReceipt(receipt: TransactionReceipt, buyer: Address, contract: Address): void {
  if (receipt.status !== 'success' || receipt.from.toLowerCase() !== buyer.toLowerCase() || receipt.to?.toLowerCase() !== contract.toLowerCase()) {
    throw new AgentError('Transaction failed or receipt identity did not match. Inspect the journal before retrying.');
  }
}

async function checkOrder(ctx: Context, buyer: Address, service: Pick<ServiceListing, 'seller' | 'sku'>, orderId: Hex, maximum?: bigint) {
  const order = await ctx.publicClient.readContract({ address: ctx.config.checkoutAddress, abi: checkoutAbi, functionName: 'orders', args: [buyer, orderId] });
  if (order.merchant.toLowerCase() === zeroAddress) return undefined;
  if (order.merchant.toLowerCase() !== service.seller.toLowerCase() || order.sku.toLowerCase() !== service.sku.toLowerCase() || order.amount <= 0n || (maximum !== undefined && order.amount > maximum)) {
    throw new AgentError('Confirmed order does not match this service or spending cap.');
  }
  return order;
}

async function delivery(api: MarketApi, ctx: Context, serviceId: string, buyer: Address, orderId: Hex): Promise<MarketDelivery> {
  // Historical entitlements survive a disabled offer. Do not request a current listing or quote here.
  const order = await ctx.publicClient.readContract({ address: ctx.config.checkoutAddress, abi: checkoutAbi, functionName: 'orders', args: [buyer, orderId] });
  const expectedSku = expectedServiceSku({ id: serviceId, kind: serviceId.startsWith('fixture-') ? 'fixture' : 'hosted' });
  if (order.merchant.toLowerCase() === zeroAddress || order.amount <= 0n || order.sku.toLowerCase() !== expectedSku.toLowerCase()) {
    throw new AgentError('No confirmed payment exists for this wallet, service and order. Delivery cannot create a payment.');
  }
  const result = decode(z.object({ serviceId: z.string(), orderId: bytes32, buyer: address, seller: address, amount: integer, response: z.string(), deliveredAt: z.string() }),
    await api.call(`/api/market/services/${encodeURIComponent(serviceId)}/deliver`, { orderId }), 'delivery');
  if (result.serviceId !== serviceId || result.orderId.toLowerCase() !== orderId.toLowerCase() || result.buyer.toLowerCase() !== buyer.toLowerCase()
    || result.seller.toLowerCase() !== order.merchant.toLowerCase() || result.amount !== order.amount.toString()) throw new AgentError('Delivery identity does not match the confirmed order.');
  return result;
}

async function recover(api: MarketApi, ctx: Context, journal: AgentJournal, previous: RestoredIntent, serviceId: string, buyer: Address, maximum: bigint) {
  const intent = previous.intent;
  if (intent.serviceId !== serviceId || intent.maxSpend !== maximum.toString()) throw new AgentError('Existing intent has different service or budget. Reuse its original arguments.');
  const order = await checkOrder(ctx, buyer, intent, intent.orderId, maximum);
  if (!order) {
    if (!previous.checkoutHash) {
      if (!previous.closed) await journal.append({ event: 'aborted', intentId: intent.intentId });
      throw new AgentError('Previous intent never prepared a checkout. No payment exists; a new explicitly authorized buy may use a new intent.');
    }
    const receipt = await ctx.publicClient.getTransactionReceipt({ hash: previous.checkoutHash }).catch(() => undefined);
    if (receipt?.status === 'reverted') {
      if (!previous.closed) await journal.append({ event: 'reverted', intentId: intent.intentId });
      throw new AgentError('Previous checkout reverted. No replacement payment was submitted; an authorized new buy requires a new intent.');
    }
    throw new AgentError(`Checkout remains uncertain. Preserve intent ${intent.intentId} and order ${intent.orderId}; inspect its transaction before attempting another purchase.`);
  }
  if (previous.checkoutHash) {
    const receipt = await ctx.publicClient.getTransactionReceipt({ hash: previous.checkoutHash });
    const destination = receipt.to?.toLowerCase() === ctx.config.previousCheckoutAddress?.toLowerCase() ? ctx.config.previousCheckoutAddress! : ctx.config.checkoutAddress;
    validateReceipt(receipt, buyer, destination);
  }
  if (!previous.paid) await journal.append({ event: 'paid', intentId: intent.intentId });
  const result = await delivery(api, ctx, serviceId, buyer, intent.orderId);
  if (!previous.delivered) await journal.append({ event: 'delivered', intentId: intent.intentId });
  return { intentId: intent.intentId, recovered: true, transactionHash: previous.checkoutHash, delivery: result };
}

async function main() {
  const { command, flags } = options(process.argv.slice(2));
  if (command === 'help') { console.log(help); return; }
  let apiUrl: URL;
  try { apiUrl = new URL(flags.get('api') || process.env.MARKET_API_URL || 'http://127.0.0.1:3001'); }
  catch { throw new AgentError('Invalid --api URL.'); }
  if (!['http:', 'https:'].includes(apiUrl.protocol) || apiUrl.username || apiUrl.password || apiUrl.search || apiUrl.hash || apiUrl.pathname !== '/') throw new AgentError('--api must be an HTTP origin without credentials or a path.');
  const api = new MarketApi(apiUrl.origin);
  const ctx = await context(api);
  if (command === 'discover' || command === 'search') {
    const query = new URLSearchParams();
    if (flags.has('query')) query.set('q', flags.get('query')!);
    if (flags.has('category')) {
      const category = flags.get('category')!;
      if (!['research', 'data', 'automation', 'other'].includes(category)) throw new AgentError('Unknown service category.');
      query.set('category', category);
    }
    const result = decode(z.object({ services: z.array(listingSchema) }), await api.call(`/api/market/services?${query}`), 'service discovery');
    console.log(JSON.stringify({ chainId: ctx.config.chainId, ...result }, null, 2));
    return;
  }
  if (command === 'quote') {
    const buyer = decode(address, required(flags, 'buyer'), 'buyer address');
    const result = await quote(api, ctx, await listing(api, serviceId(flags)), buyer);
    console.log(JSON.stringify({ ...result, humanAmount: formatUnits(BigInt(result.amount), 6), symbol: 'wBSC' }, null, 2));
    return;
  }
  const maximum = command === 'buy' ? parseMaxSpend(flags.get('max-spend')) : undefined;
  if (command === 'faucet' && (ctx.config.chainId !== 31337 || !ctx.config.localFaucet)) throw new AgentError('Funding is available only for the configured local chain 31337. BSC testnet needs your own tBNB.');
  const account = signingAccount(ctx.config);
  await api.authenticate(account, ctx.config.chainId);
  if (command === 'wallet') {
    const result = decode(z.object({ address, tokenBalance: integer, gasBalance: integer }), await api.call<MarketWallet>('/api/market/wallet'), 'wallet');
    if (result.address.toLowerCase() !== account.address.toLowerCase()) throw new AgentError('Wallet response identity mismatch.');
    console.log(JSON.stringify({ chainId: ctx.config.chainId, ...result }, null, 2)); return;
  }
  if (command === 'faucet') { console.log(JSON.stringify(await api.call('/api/market/faucet', {}), null, 2)); return; }
  const journal = new AgentJournal(agentDataDirectory(import.meta.url, process.cwd(), process.env.MARKET_AGENT_DATA_DIR), {
    chainId: ctx.config.chainId, checkout: ctx.config.checkoutAddress, buyer: account.address,
  });
  const wallet = createWalletClient({ account, chain: ctx.chain, transport: http(ctx.config.rpcUrl, { retryCount: 0, timeout: 20000 }) });
  await journal.withLock(async () => {
    async function send(to: Address, data: Hex, action: 'approve' | 'checkout' | 'offer', intentId?: string): Promise<TransactionReceipt> {
      const request = await wallet.prepareTransactionRequest({ account, to, data });
      const serializedTransaction = await wallet.signTransaction(request);
      const hash = keccak256(serializedTransaction);
      await journal.append({ event: 'tx-prepared', action, intentId, hash });
      console.error(JSON.stringify({ event: 'prepared', action, intentId, transactionHash: hash }));
      try {
        const submitted = await ctx.publicClient.sendRawTransaction({ serializedTransaction });
        if (submitted.toLowerCase() !== hash.toLowerCase()) throw new AgentError('RPC returned an unexpected transaction hash.');
        const receipt = await ctx.publicClient.waitForTransactionReceipt({ hash, timeout: 120000, confirmations: ctx.config.chainId === 97 ? 2 : 1 });
        validateReceipt(receipt, account.address, to);
        return receipt;
      } catch { throw new AgentError(`Transaction ${hash} was prepared; submission or confirmation is uncertain. Preserve the journal and recover the same intent or order. No replacement transaction was sent.`); }
    }
    if (command === 'publish') {
      let input: unknown;
      try { input = JSON.parse(await readFile(required(flags, 'file'), 'utf8')); }
      catch { throw new AgentError('Cannot read publish JSON file.'); }
      const payload = parsePublishService(input);
      if (payload.id.startsWith('fixture-')) throw new AgentError('fixture-* IDs are reserved for builder fixtures.');
      const sku = keccak256(stringToHex(payload.id));
      await ctx.publicClient.simulateContract({ account, address: ctx.config.checkoutAddress, abi: checkoutAbi, functionName: 'setOffer',
        args: [sku, BigInt(payload.basePrice), BigInt(payload.spendThreshold), payload.discountBps, true] });
      const receipt = await send(ctx.config.checkoutAddress, encodeFunctionData({ abi: checkoutAbi, functionName: 'setOffer',
        args: [sku, BigInt(payload.basePrice), BigInt(payload.spendThreshold), payload.discountBps, true] }), 'offer');
      const result = decode(listingSchema, await api.call('/api/market/services', payload), 'published service');
      if (result.seller.toLowerCase() !== account.address.toLowerCase() || result.id !== payload.id || result.sku !== sku) throw new AgentError('Published service identity mismatch.');
      console.log(JSON.stringify({ transactionHash: receipt.transactionHash, service: result }, null, 2)); return;
    }
    const requestedId = serviceId(flags);
    if (command === 'deliver') {
      const orderId = decode(bytes32, required(flags, 'order'), 'order ID');
      const result = await delivery(api, ctx, requestedId, account.address, orderId);
      const previous = (await journal.intents()).find(item => item.intent.orderId.toLowerCase() === orderId.toLowerCase());
      if (previous && !previous.delivered) await journal.append({ event: 'delivered', intentId: previous.intent.intentId });
      console.log(JSON.stringify(result, null, 2)); return;
    }
    const intentId = flags.get('intent') || randomUUID();
    if (!/^[a-zA-Z0-9_-]{1,100}$/.test(intentId)) throw new AgentError('Intent IDs must use letters, digits, underscore or hyphen (max 100).');
    const previous = await journal.findIntent(intentId);
    if (previous) { console.log(JSON.stringify(await recover(api, ctx, journal, previous, requestedId, account.address, maximum!), null, 2)); return; }
    await journal.assertNewIntentAllowed(requestedId, intentId);
    const service = await listing(api, requestedId);
    const terms = await quote(api, ctx, service, account.address);
    const amount = assertAffordable(terms.amount, maximum!);
    const block = await ctx.publicClient.getBlock();
    const intent: AgentIntent = {
      event: 'intent', intentId, serviceId: service.id, orderId: `0x${randomBytes(32).toString('hex')}`,
      seller: service.seller, sku: service.sku, amount: amount.toString(), maxSpend: maximum!.toString(),
      offerVersion: terms.offerVersion, deadline: (block.timestamp + 120n).toString(),
    };
    await journal.append(intent);
    console.error(JSON.stringify({ event: 'intent', intentId, orderId: intent.orderId, serviceId: service.id, amount: intent.amount, maxSpend: intent.maxSpend }));
    try {
      // Always replace any previous allowance with exactly this quote; never approve the whole wallet or an unlimited amount.
      await send(ctx.config.tokenAddress, encodeFunctionData({ abi: tokenAbi, functionName: 'approve', args: [ctx.config.checkoutAddress, amount] }), 'approve', intentId);
      const args = [service.seller, service.sku, intent.orderId, amount, BigInt(terms.offerVersion), BigInt(intent.deadline)] as const;
      await ctx.publicClient.simulateContract({ account, address: ctx.config.checkoutAddress, abi: checkoutAbi, functionName: 'checkout', args });
      const receipt = await send(ctx.config.checkoutAddress, encodeFunctionData({ abi: checkoutAbi, functionName: 'checkout', args }), 'checkout', intentId);
      const events = parseEventLogs({ abi: checkoutAbi, logs: receipt.logs, eventName: 'OrderPaid', strict: true });
      const paid = events.find(event => event.address.toLowerCase() === ctx.config.checkoutAddress.toLowerCase()
        && event.args.buyer.toLowerCase() === account.address.toLowerCase() && event.args.merchant.toLowerCase() === service.seller.toLowerCase()
        && event.args.sku.toLowerCase() === service.sku.toLowerCase() && event.args.orderId.toLowerCase() === intent.orderId.toLowerCase());
      if (!paid || paid.args.amount > amount || paid.args.offerVersion.toString() !== terms.offerVersion || !await checkOrder(ctx, account.address, service, intent.orderId, maximum)) throw new AgentError('Checkout receipt or confirmed order did not match the authorized purchase.');
      await journal.append({ event: 'paid', intentId });
      const result = await delivery(api, ctx, service.id, account.address, intent.orderId);
      await journal.append({ event: 'delivered', intentId });
      console.log(JSON.stringify({ intentId, transactionHash: receipt.transactionHash, delivery: result }, null, 2));
    } catch (error) {
      const state = await journal.findIntent(intentId);
      if (state && !state.checkoutHash) await journal.append({ event: 'aborted', intentId });
      if (error instanceof AgentError) throw error;
      throw new AgentError(`Purchase stopped. Preserve intent ${intentId} and order ${intent.orderId}; recover the same intent or deliver the same order before buying again.`);
    }
  });
}

main().catch(error => {
  // Never print raw RPC, signing, filesystem or JSON errors: they may embed secrets or hosted content.
  console.error(JSON.stringify({ error: 'MARKET_AGENT_ERROR', message: error instanceof AgentError ? error.message : 'Marketplace operation failed. Check the configured network and preserve any payment journal before retrying.' }));
  process.exitCode = 1;
});
