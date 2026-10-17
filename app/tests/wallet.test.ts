import { describe, expect, it } from 'vitest';
import { encodeAbiParameters, encodeEventTopics, type Address, type Hex } from 'viem';
import { createSiweMessage } from 'viem/siwe';
import { checkoutAbi } from '../shared/abi.js';
import type { ServiceQuote } from '../shared/marketplace.js';
import { assertChallenge, assertWallet, parseTokenAmount, pendingOrdersForWallet, verifyOrderReceipt, type InjectedProvider, type PendingOrder } from '../src/wallet.js';

const buyer = '0x0000000000000000000000000000000000000001' as const;
const seller = '0x0000000000000000000000000000000000000002' as const;
const checkoutAddress = '0x0000000000000000000000000000000000000003' as const;
const sku = `0x${'11'.repeat(32)}` as Hex;
const orderId = `0x${'22'.repeat(32)}` as Hex;
const quote: ServiceQuote = { serviceId: 'test', buyer, seller, sku, amount: '40000', basePrice: '50000', appliedBps: 2000, priorPaid: '150000', purchaseCount: '3', offerVersion: '1', blockNumber: '1' };
function receipt(amount = 40000n, paidBuyer: Address = buyer, paidOrder = orderId, address: Address = checkoutAddress) {
  return { status: 'success' as const, logs: [{ address, topics: encodeEventTopics({ abi: checkoutAbi, eventName: 'OrderPaid', args: { buyer: paidBuyer, merchant: seller, orderId: paidOrder } }) as Hex[], data: encodeAbiParameters([{ type: 'bytes32' }, { type: 'uint256' }, { type: 'uint256' }, { type: 'uint16' }, { type: 'uint256' }, { type: 'uint256' }, { type: 'uint64' }], [sku, 50000n, amount, 2000, 150000n, 190000n, 1n]) }] };
}

describe('browser wallet payment boundaries', () => {
  it('retains orders from the verified predecessor checkout after a service-loyalty upgrade', () => {
    const old: PendingOrder = { serviceId: 'old-service', title: 'Old service', buyer, chainId: 31337, checkoutAddress: seller, orderId, quote, status: 'paid' };
    const config = { chainId: 31337, checkoutAddress, previousCheckoutAddress: seller };
    expect(pendingOrdersForWallet({ old }, config, buyer).map(([key]) => key)).toEqual(['old']);
    expect(pendingOrdersForWallet({ old: { ...old, buyer: seller } }, config, buyer)).toEqual([]);
  });

  it('preserves six-decimal precision and rejects rounded or nonpositive prices', () => {
    expect(parseTokenAmount('0.040001')).toBe('40001');
    for (const value of ['0', '-1', '0.0000001', '1e3', 'NaN', '']) expect(parseTokenAmount(value)).toBeNull();
  });
  it('accepts the confirmed order and a lower amount within the signed maximum', () => {
    expect(verifyOrderReceipt(receipt(), { checkoutAddress }, quote, orderId)).toBe(40000n);
    expect(verifyOrderReceipt(receipt(39000n), { checkoutAddress }, quote, orderId)).toBe(39000n);
  });
  it('rejects reverted, foreign, unrelated and excessive payment events', () => {
    expect(() => verifyOrderReceipt({ ...receipt(), status: 'reverted' }, { checkoutAddress }, quote, orderId)).toThrow();
    expect(() => verifyOrderReceipt(receipt(40001n), { checkoutAddress }, quote, orderId)).toThrow();
    expect(() => verifyOrderReceipt(receipt(40000n, buyer, sku), { checkoutAddress }, quote, orderId)).toThrow();
    expect(() => verifyOrderReceipt(receipt(40000n, buyer, orderId, buyer), { checkoutAddress }, quote, orderId)).toThrow();
    expect(() => verifyOrderReceipt({ status: 'success', logs: [] }, { checkoutAddress }, quote, orderId)).toThrow();
    expect(() => verifyOrderReceipt(receipt(40000n, seller), { checkoutAddress }, quote, orderId)).toThrow();
  });
  it('rejects a challenge for a different wallet, chain, origin or validity window before signing', () => {
    const now = Date.parse('2026-10-17T00:00:00Z');
    const challenge = { challengeId: 'challenge', expiresAt: '2026-10-17T00:05:00.000Z', message: createSiweMessage({ domain: 'localhost:5173', address: buyer, uri: 'http://localhost:5173', version: '1', chainId: 31337, nonce: 'abcdefgh', issuedAt: new Date(now), expirationTime: new Date(now + 300000) }) };
    const origin = { host: 'localhost:5173', origin: 'http://localhost:5173' };
    expect(() => assertChallenge(challenge, buyer, 31337, origin, now)).not.toThrow();
    expect(() => assertChallenge(challenge, seller, 31337, origin, now)).toThrow();
    expect(() => assertChallenge(challenge, buyer, 97, origin, now)).toThrow();
    expect(() => assertChallenge(challenge, buyer, 31337, { host: 'wrong.example', origin: 'https://wrong.example' }, now)).toThrow();
    expect(() => assertChallenge(challenge, buyer, 31337, origin, now + 300000)).toThrow();
  });
  it('blocks signing when the selected provider account or chain changes', async () => {
    function provider(accounts: readonly Address[], chain: Hex) { return { request: async ({ method }: { method: string }) => method === 'eth_accounts' ? accounts : chain } as unknown as InjectedProvider; }
    const config = { chainId: 31337 } as Parameters<typeof assertWallet>[0];
    await expect(assertWallet(config, { address: buyer, provider: provider([buyer], '0x7a69') })).resolves.toBeUndefined();
    await expect(assertWallet(config, { address: buyer, provider: provider([seller], '0x7a69') })).rejects.toThrow('account changed');
    await expect(assertWallet(config, { address: buyer, provider: provider([buyer], '0x61') })).rejects.toThrow('network changed');
  });
  it('recovers an unavailable service order by wallet and deployment without a catalog listing or quote', () => {
    const paid: PendingOrder = { serviceId: 'retired-service', title: 'Retired service', buyer, chainId: 31337, checkoutAddress, orderId, quote, status: 'paid' };
    const orders = { retired: paid, otherWallet: { ...paid, buyer: seller }, otherChain: { ...paid, chainId: 97 }, otherDeployment: { ...paid, checkoutAddress: seller } };
    const result = pendingOrdersForWallet(orders, { chainId: 31337, checkoutAddress }, buyer);
    expect(result.map(([key, item]) => [key, item.serviceId, item.orderId])).toEqual([['retired', 'retired-service', orderId]]);
    expect(pendingOrdersForWallet(orders, { chainId: 31337, checkoutAddress }, '0x0000000000000000000000000000000000000004')).toEqual([]);
  });
});
