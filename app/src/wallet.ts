import { createPublicClient, createWalletClient, custom, decodeEventLog, defineChain, getAddress, http, type Address, type EIP1193Provider, type Hex } from 'viem';
import { parseSiweMessage } from 'viem/siwe';
import { checkoutAbi } from '../shared/abi.js';
import type { AuthChallenge, MarketConfig, ServiceQuote, WalletSession } from '../shared/marketplace.js';

export type PaymentReceipt = { status: 'success' | 'reverted'; logs: readonly { address: Address; data: Hex; topics: readonly Hex[] }[] };
export type InjectedProvider = EIP1193Provider & {
  on?: (event: string, listener: (...args: unknown[]) => void) => void;
  removeListener?: (event: string, listener: (...args: unknown[]) => void) => void;
};
export type ConnectedWallet = { address: Address; provider: InjectedProvider };
export type PendingOrder = { serviceId: string; title: string; buyer: string; chainId: number; checkoutAddress: string; orderId: Hex; quote: ServiceQuote; hash?: Hex; status: 'pending' | 'paid' };
export function recoveryCheckoutMatches(config: Pick<MarketConfig, 'checkoutAddress' | 'previousCheckoutAddress'>, address: string): boolean {
  return [config.checkoutAddress, config.previousCheckoutAddress].some(known => known?.toLowerCase() === address.toLowerCase());
}
export function pendingOrdersForWallet(orders: Record<string, PendingOrder>, config: Pick<MarketConfig, 'chainId' | 'checkoutAddress' | 'previousCheckoutAddress'>, address: string): [string, PendingOrder][] {
  return Object.entries(orders).filter(([, order]) => order.buyer.toLowerCase() === address.toLowerCase() && order.chainId === config.chainId && recoveryCheckoutMatches(config, order.checkoutAddress));
}
export function assertChallenge(challenge: AuthChallenge, address: Address, chainId: number, origin: { host: string; origin: string }, now = Date.now()): void {
  const message = parseSiweMessage(challenge.message), expiry = Date.parse(challenge.expiresAt);
  if (message.address?.toLowerCase() !== address.toLowerCase() || message.chainId !== chainId || message.domain !== origin.host || message.uri !== origin.origin || !message.nonce || !message.issuedAt || !message.expirationTime || !Number.isFinite(expiry) || expiry <= now || expiry > now + 6 * 60 * 1000 || message.expirationTime.getTime() !== expiry || message.issuedAt.getTime() > now + 30000) throw new Error('The sign-in message does not match your wallet, network, this site, or its validity window. Nothing was signed.');
}

export function parseTokenAmount(value: string): string | null {
  const match = value.trim().match(/^(\d+)(?:\.(\d{1,6}))?$/);
  if (!match) return null;
  const units = BigInt(match[1]) * 1000000n + BigInt((match[2] || '').padEnd(6, '0'));
  return units > 0n ? units.toString() : null;
}
export function tokenAmount(value: string | undefined, decimals = 6): string {
  if (!value || !/^\d+$/.test(value)) return '—';
  const units = BigInt(value), divisor = 10n ** BigInt(decimals);
  const fraction = (units % divisor).toString().padStart(decimals, '0').replace(/0+$/, '');
  return `${units / divisor}${fraction ? `.${fraction}` : ''}`;
}
export function shortAddress(value: string) { return `${value.slice(0, 6)}…${value.slice(-4)}`; }
export function marketChain(config: MarketConfig) {
  if (config.chainId !== 31337 && config.chainId !== 97) throw new Error('This marketplace supports local chain 31337 or BSC testnet 97.');
  return defineChain({ id: config.chainId, name: config.chainName, nativeCurrency: { name: config.nativeSymbol, symbol: config.nativeSymbol, decimals: 18 }, rpcUrls: { default: { http: [config.rpcUrl] } }, ...(config.explorerUrl ? { blockExplorers: { default: { name: 'Explorer', url: config.explorerUrl } } } : {}) });
}
export function marketClients(config: MarketConfig, wallet: ConnectedWallet) {
  const chain = marketChain(config);
  return { publicClient: createPublicClient({ chain, transport: http(config.rpcUrl) }), walletClient: createWalletClient({ account: wallet.address, chain, transport: custom(wallet.provider) }) };
}
export function injectedProvider(): InjectedProvider | undefined {
  return (globalThis as typeof globalThis & { ethereum?: InjectedProvider }).ethereum;
}
export function walletError(error: unknown): string {
  if (isUserRejection(error)) return 'Request declined in your wallet. Nothing will be retried automatically.';
  if (error instanceof Error) return error.message.split('\n')[0];
  return 'The request could not finish. Please try again.';
}
export function isUserRejection(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const item = error as { code?: number; name?: string; cause?: unknown };
  return item.code === 4001 || item.name === 'UserRejectedRequestError' || (!!item.cause && item.cause !== error && isUserRejection(item.cause));
}
export class MarketApiError extends Error {
  constructor(message: string, public status: number) { super(message); this.name = 'MarketApiError'; }
}
export async function marketApi<T>(path: string, options: RequestInit = {}, token?: string): Promise<T> {
  const response = await fetch(path, { ...options, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...options.headers } });
  const payload = await response.json().catch(() => null) as { message?: string; error?: string } | null;
  if (!response.ok) throw new MarketApiError(payload?.message || payload?.error || `Request failed (${response.status}).`, response.status);
  if (!payload) throw new Error('The marketplace API returned an empty response.');
  return payload as T;
}
export async function assertWallet(config: MarketConfig, wallet: ConnectedWallet): Promise<void> {
  const [accounts, chainId] = await Promise.all([wallet.provider.request({ method: 'eth_accounts' }), wallet.provider.request({ method: 'eth_chainId' })]);
  if (!accounts[0] || accounts[0].toLowerCase() !== wallet.address.toLowerCase()) throw new Error('Your wallet account changed. Connect and sign in again.');
  if (Number(BigInt(chainId)) !== config.chainId) throw new Error('Your wallet network changed. Connect and sign in again.');
}
export async function connectWallet(config: MarketConfig): Promise<ConnectedWallet> {
  const provider = injectedProvider();
  if (!provider) throw new Error('No browser wallet found. Install an EIP-1193 wallet such as MetaMask or Rabby, unlock it, and return here to connect.');
  const chain = marketChain(config);
  const accounts = await provider.request({ method: 'eth_requestAccounts' });
  if (!accounts[0]) throw new Error('Your wallet did not share an account. Unlock it and connect an account.');
  const chainId = `0x${config.chainId.toString(16)}` as Hex;
  if (Number(BigInt(await provider.request({ method: 'eth_chainId' }))) !== config.chainId) {
    try { await provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId }] }); }
    catch (error) {
      const code = (error as { code?: number; cause?: { code?: number } })?.code ?? (error as { cause?: { code?: number } })?.cause?.code;
      if (code !== 4902) throw error;
      await provider.request({ method: 'wallet_addEthereumChain', params: [{ chainId, chainName: chain.name, nativeCurrency: chain.nativeCurrency, rpcUrls: [config.rpcUrl], ...(config.explorerUrl ? { blockExplorerUrls: [config.explorerUrl] } : {}) }] });
      await provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId }] });
    }
  }
  const wallet = { address: getAddress(accounts[0]), provider };
  await assertWallet(config, wallet);
  return wallet;
}
export async function signInWallet(config: MarketConfig, wallet: ConnectedWallet): Promise<WalletSession> {
  await assertWallet(config, wallet);
  const challenge = await marketApi<AuthChallenge>('/api/auth/challenge', { method: 'POST', body: JSON.stringify({ address: wallet.address, chainId: config.chainId }) });
  const origin = (globalThis as typeof globalThis & { location?: { host: string; origin: string } }).location;
  if (!origin) throw new Error('Wallet sign-in requires a browser page.');
  assertChallenge(challenge, wallet.address, config.chainId, origin);
  const { walletClient } = marketClients(config, wallet);
  const signature = await walletClient.signMessage({ message: challenge.message });
  await assertWallet(config, wallet);
  const session = await marketApi<WalletSession>('/api/auth/verify', { method: 'POST', body: JSON.stringify({ challengeId: challenge.challengeId, signature }) });
  if (session.address.toLowerCase() !== wallet.address.toLowerCase() || session.chainId !== config.chainId || !session.token || !(Date.parse(session.expiresAt) > Date.now())) throw new Error('The signed session does not match your wallet or is expired. Connect again.');
  return session;
}
export function verifyOrderReceipt(receipt: PaymentReceipt, config: Pick<MarketConfig, 'checkoutAddress'>, quote: ServiceQuote, orderId: Hex): bigint {
  if (receipt.status !== 'success') throw new Error('Checkout reverted. This order was not paid.');
  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== config.checkoutAddress.toLowerCase()) continue;
    try {
      const event = decodeEventLog({ abi: checkoutAbi, eventName: 'OrderPaid', data: log.data, topics: log.topics as [Hex, ...Hex[]] });
      const args = event.args;
      if (args.buyer.toLowerCase() === quote.buyer.toLowerCase() && args.merchant.toLowerCase() === quote.seller.toLowerCase() && args.orderId === orderId && args.sku === quote.sku && args.offerVersion === BigInt(quote.offerVersion) && args.amount > 0n && args.amount <= BigInt(quote.amount)) return args.amount;
    } catch { /* Unrelated contract logs do not prove payment. */ }
  }
  throw new Error('The receipt does not prove this order within your approved price. Keep the order ID and retry retrieval; do not pay again.');
}
