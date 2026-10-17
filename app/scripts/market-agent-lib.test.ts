import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { AgentJournal, agentDataDirectory, assertAffordable, expectedServiceSku, parseMaxSpend, parsePublishService } from './market-agent-lib.js';

describe('agent spending authorization', () => {
  it('parses human wBSC without floating point rounding', () => {
    expect(parseMaxSpend('0.06')).toBe(60000n);
    expect(parseMaxSpend('1.000001')).toBe(1000001n);
    expect(parseMaxSpend('9007199254740993.123456')).toBe(9007199254740993123456n);
  });

  it('rejects missing, zero, negative, scientific and overprecision budgets', () => {
    for (const value of [undefined, '', '0', '-1', '1e6', '0.0000001', ' 0.06', '+1', '.06', 'Infinity']) {
      expect(() => parseMaxSpend(value)).toThrow();
    }
  });

  it('refuses one unit above the budget before approving a token allowance', () => {
    expect(() => assertAffordable('60001', 60000n)).toThrow();
    expect(assertAffordable('60000', 60000n)).toBe(60000n);
    expect(() => assertAffordable('-1', 60000n)).toThrow();
  });
});

describe('seller payload', () => {
  const valid = {
    id: 'agent-weather', title: 'Weather response', description: 'A hosted JSON response',
    category: 'data', basePrice: '50000', spendThreshold: '100000', discountBps: 2000,
    response: '{"forecast":"sunny"}',
  };
  it('requires explicit hosted content and six-decimal integer contract terms', () => {
    expect(parsePublishService(valid)).toEqual(valid);
    for (const invalid of [
      { ...valid, response: '' }, { ...valid, basePrice: '0.05' },
      { ...valid, discountBps: 2001 }, { ...valid, seller: '0x1' },
      { ...valid, id: '../escape' }, { ...valid, spendThreshold: '0' },
    ]) expect(() => parsePublishService(invalid)).toThrow();
  });
});

describe('catalog identity', () => {
  it('uses legacy record SKU only for the eight declared builder fixtures', () => {
    expect(expectedServiceSku({ id: 'fixture-a-bnb-budget', kind: 'fixture' })).toBe('0x48d87264df8e004e5c25073385165c06fc39a4a7267e2455b0efda8b62e1ad68');
    expect(expectedServiceSku({ id: 'fixture-b-bnb-budget', kind: 'fixture' })).toBe('0x48d87264df8e004e5c25073385165c06fc39a4a7267e2455b0efda8b62e1ad68');
    expect(() => expectedServiceSku({ id: 'fixture-unknown', kind: 'fixture' })).toThrow();
    expect(expectedServiceSku({ id: 'fixture-a-bnb-budget', kind: 'hosted' })).not.toBe('0x48d87264df8e004e5c25073385165c06fc39a4a7267e2455b0efda8b62e1ad68');
  });
});

describe('durable agent intent recovery', () => {
  const scope = { chainId: 31337, checkout: '0x1111111111111111111111111111111111111111', buyer: '0x2222222222222222222222222222222222222222' } as const;
  const intent = {
    event: 'intent', intentId: 'intent-1', serviceId: 'weather', orderId: `0x${'ab'.repeat(32)}`,
    seller: '0x3333333333333333333333333333333333333333', sku: `0x${'cd'.repeat(32)}`,
    amount: '50000', maxSpend: '60000', offerVersion: '1', deadline: '1900000000',
  } as const;

  it('recovers an uncertain checkout after reconnect and blocks a fresh payment', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'repeat-agent-'));
    try {
      const journal = new AgentJournal(directory, scope);
      await journal.append(intent);
      await journal.append({ event: 'tx-prepared', action: 'checkout', intentId: 'intent-1', hash: `0x${'ef'.repeat(32)}` });
      const reconnected = new AgentJournal(directory, scope);
      const restored = await reconnected.findIntent('intent-1');
      expect(restored?.intent.orderId).toBe(`0x${'ab'.repeat(32)}`);
      expect(restored?.checkoutHash).toBe(`0x${'ef'.repeat(32)}`);
      await expect(reconnected.assertNewIntentAllowed('weather', 'different-intent')).rejects.toThrow();
      await reconnected.append({ event: 'paid', intentId: 'intent-1' });
      await expect(reconnected.assertNewIntentAllowed('weather', 'different-intent')).rejects.toThrow();
      await reconnected.append({ event: 'delivered', intentId: 'intent-1' });
      await expect(reconnected.assertNewIntentAllowed('weather', 'different-intent')).resolves.toBeUndefined();
      await expect(reconnected.assertNewIntentAllowed('weather', 'intent-1')).rejects.toThrow();
      expect((await readFile(journal.file, 'utf8')).split('\n').filter(Boolean)).toHaveLength(4);
    } finally { await rm(directory, { recursive: true, force: true }); }
  });

  it('does not silently discard a damaged journal that may describe a payment', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'repeat-agent-'));
    try {
      const journal = new AgentJournal(directory, scope);
      await journal.append(intent);
      const { appendFile } = await import('node:fs/promises');
      await appendFile(journal.file, '{"event":"tx-prepared"');
      await expect(journal.findIntent('intent-1')).rejects.toThrow();
    } finally { await rm(directory, { recursive: true, force: true }); }
  });

  it('keeps different deployments isolated and refuses a second concurrent signer', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'repeat-agent-'));
    try {
      const journal = new AgentJournal(directory, scope);
      await journal.append(intent);
      const different = new AgentJournal(directory, { ...scope, checkout: '0x4444444444444444444444444444444444444444' });
      expect(await different.findIntent('intent-1')).toBeUndefined();
      await journal.withLock(async () => {
        await expect(new AgentJournal(directory, scope).withLock(async () => undefined)).rejects.toThrow();
      });
      await expect(journal.withLock(async () => undefined)).resolves.toBeUndefined();
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
});

describe('portable agent state location', () => {
  it('keeps a downloaded client journal in the working directory and retains repository recovery paths', () => {
    expect(agentDataDirectory('file:///tmp/download/repeat-agent.mjs', '/tmp/working')).toBe('/tmp/working/.repeat-agent');
    expect(agentDataDirectory('file:///opt/repeat/app/scripts/market-agent.ts', '/tmp/working')).toBe('/opt/repeat/app/data');
    expect(agentDataDirectory('file:///tmp/download/repeat-agent.mjs', '/tmp/working', './saved-orders')).toBe('/tmp/working/saved-orders');
  });
});
