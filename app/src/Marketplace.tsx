import { useCallback, useEffect, useRef, useState } from 'react';
import { bytesToHex, keccak256, toBytes, type Hex } from 'viem';
import { checkoutAbi, tokenAbi } from '../shared/abi';
import type { FaucetResult, MarketConfig, MarketDelivery, MarketWallet, PublishService, ServiceCategory, ServiceListing, ServiceQuote, WalletSession } from '../shared/marketplace';
import { assertWallet, connectWallet, injectedProvider, isUserRejection, MarketApiError, marketApi, marketClients, parseTokenAmount, pendingOrdersForWallet, recoveryCheckoutMatches, shortAddress, signInWallet, tokenAmount, verifyOrderReceipt, walletError, type ConnectedWallet, type PendingOrder } from './wallet';
import './marketplace.css';

const CATEGORIES: { value: '' | ServiceCategory; label: string }[] = [{ value: '', label: 'All services' }, { value: 'research', label: 'Research' }, { value: 'data', label: 'Data' }, { value: 'automation', label: 'Automation' }, { value: 'other', label: 'Other' }];
type MarketView = 'browse' | 'publish' | 'agents';
type PublishIntent = { payload: PublishService; seller: string; chainId: number; checkoutAddress: string; hash?: Hex };
const ORDER_STORAGE = 'repeat.market.orders.v1';
function readOrders(): Record<string, PendingOrder> {
  try {
    const value: unknown = JSON.parse(sessionStorage.getItem(ORDER_STORAGE) || '{}');
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    return Object.fromEntries(Object.entries(value).filter(([, item]) => item && typeof item === 'object' && /^0x[\da-f]{64}$/i.test(item.orderId) && typeof item.serviceId === 'string' && typeof item.buyer === 'string' && typeof item.checkoutAddress === 'string' && item.quote && /^\d+$/.test(item.quote.amount) && ['pending', 'paid'].includes(item.status)));
  } catch { return {}; }
}
function keyFor(config: MarketConfig, buyer: string, serviceId: string) { return `${config.chainId}:${config.checkoutAddress.toLowerCase()}:${buyer.toLowerCase()}:${serviceId}`; }
function Mark() { return <svg width="32" height="34" viewBox="0 0 34 36" fill="none" aria-hidden="true"><path d="M6 14V8h18l5 6-5 6h-7M28 22v6H10l-5-6 5-6h7" stroke="currentColor" strokeWidth="3.2" /></svg>; }
function Arrow({ diagonal = false }: { diagonal?: boolean }) { return <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">{diagonal ? <path d="M5 19 19 5M5 5h14v14" /> : <path d="M4 12h15m-6-6 6 6-6 6" />}</svg>; }
function ChainLink({ config, value, kind = 'address', label }: { config: MarketConfig | null; value: string; kind?: 'address' | 'tx'; label?: string }) {
  return config?.explorerUrl ? <a href={`${config.explorerUrl.replace(/\/$/, '')}/${kind}/${value}`} title={value} target="_blank" rel="noreferrer">{label || shortAddress(value)} ↗</a> : <span title={value}>{label || shortAddress(value)}</span>;
}

export default function Marketplace({ onOpenDemoLab }: { onOpenDemoLab: () => void }) {
  const [view, setView] = useState<MarketView>('browse');
  const [config, setConfig] = useState<MarketConfig | null>(null);
  const [services, setServices] = useState<ServiceListing[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<'' | ServiceCategory>('');
  const [loading, setLoading] = useState(true);
  const [configError, setConfigError] = useState('');
  const [catalogError, setCatalogError] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState('');
  const [wallet, setWallet] = useState<ConnectedWallet | null>(null);
  const [session, setSession] = useState<WalletSession | null>(null);
  const [balance, setBalance] = useState<MarketWallet | null>(null);
  const [quote, setQuote] = useState<ServiceQuote | null>(null);
  const [quoteError, setQuoteError] = useState('');
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [orders, setOrders] = useState<Record<string, PendingOrder>>(readOrders);
  const [deliveries, setDeliveries] = useState<Record<string, MarketDelivery>>({});
  const [publishIntent, setPublishIntent] = useState<PublishIntent | null>(null);
  const [catalogRevision, setCatalogRevision] = useState(0);
  const epoch = useRef(0);
  const action = useRef(false);
  const ordersRef = useRef(orders);
  const detailRef = useRef<HTMLElement>(null);
  const selected = services.find(service => service.id === selectedId) || null;
  const ready = !!config?.ready && !configError;
  const currentKey = config && wallet && selected ? keyFor(config, wallet.address, selected.id) : '';
  const pending = currentKey ? orders[currentKey] : undefined;
  const delivery = currentKey ? deliveries[currentKey] : undefined;
  const ownServices = wallet ? services.filter(item => item.seller.toLowerCase() === wallet.address.toLowerCase()).length : 0;
  const savedOrders = wallet && session && config ? pendingOrdersForWallet(orders, config, wallet.address) : [];

  function rememberOrder(key: string, order?: PendingOrder) {
    const next = { ...ordersRef.current };
    if (order) next[key] = order; else delete next[key];
    ordersRef.current = next;
    try { sessionStorage.setItem(ORDER_STORAGE, JSON.stringify(next)); } catch { /* In-memory recovery remains available when storage is disabled. */ }
    setOrders(next);
  }
  const clearSession = useCallback((message = '') => {
    epoch.current += 1;
    setSession(null); setWallet(null); setBalance(null); setQuote(null); setDeliveries({}); setQuoteError(''); setQuoteLoading(false);
    if (message) setNotice(message);
  }, []);
  function begin(label: string) {
    if (action.current) return false;
    action.current = true; setBusy(label); setError(''); setNotice(''); return true;
  }
  function finish() { action.current = false; setBusy(''); }
  function report(error: unknown) {
    if (error instanceof MarketApiError && error.status === 401) clearSession('Your sign-in expired. Connect your wallet again to continue.');
    setError(walletError(error));
  }
  const loadConfig = useCallback(async () => {
    try { const next = await marketApi<MarketConfig>('/api/market/config'); setConfig(next); setConfigError(''); }
    catch (error) { setConfigError(walletError(error)); }
  }, []);
  useEffect(() => { void loadConfig(); }, [loadConfig]);
  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setLoading(true);
      try {
        const params = new URLSearchParams(); if (query.trim()) params.set('q', query.trim()); if (category) params.set('category', category);
        const next = await marketApi<{ services: ServiceListing[] }>(`/api/market/services?${params}`, { signal: controller.signal });
        if (cancelled) return;
        setServices(next.services); setCatalogError('');
        setSelectedId(current => next.services.some(item => item.id === current) ? current : next.services[0]?.id || '');
      } catch (error) { if (!cancelled) setCatalogError(walletError(error)); }
      finally { if (!cancelled) setLoading(false); }
    }, 180);
    return () => { cancelled = true; window.clearTimeout(timer); controller.abort(); };
  }, [query, category, catalogRevision]);
  useEffect(() => {
    if (!wallet) return;
    const changed = () => clearSession('Wallet account or network changed. Connect again to sign in with the current wallet.');
    wallet.provider.on?.('accountsChanged', changed); wallet.provider.on?.('chainChanged', changed); wallet.provider.on?.('disconnect', changed);
    return () => { wallet.provider.removeListener?.('accountsChanged', changed); wallet.provider.removeListener?.('chainChanged', changed); wallet.provider.removeListener?.('disconnect', changed); };
  }, [wallet, clearSession]);
  useEffect(() => {
    if (!session) return;
    const timer = window.setTimeout(() => clearSession('Your sign-in expired. Connect again to continue.'), Math.max(0, Date.parse(session.expiresAt) - Date.now()));
    return () => window.clearTimeout(timer);
  }, [session, clearSession]);
  const refreshBalance = useCallback(async (token: string, expectedEpoch: number) => {
    const next = await marketApi<MarketWallet>('/api/market/wallet', {}, token);
    if (epoch.current === expectedEpoch) setBalance(next);
  }, []);
  useEffect(() => {
    if (!session) return;
    void refreshBalance(session.token, epoch.current).catch(report);
  }, [session, refreshBalance]);
  useEffect(() => {
    setQuote(null); setQuoteError('');
    if (!selectedId || !wallet) return;
    let cancelled = false;
    setQuoteLoading(true);
    marketApi<ServiceQuote>(`/api/market/services/${encodeURIComponent(selectedId)}/quote?buyer=${wallet.address}`).then(next => { if (!cancelled) setQuote(next); }).catch(error => { if (!cancelled) setQuoteError(walletError(error)); }).finally(() => { if (!cancelled) setQuoteLoading(false); });
    return () => { cancelled = true; };
  }, [selectedId, wallet, catalogRevision]);

  async function context() {
    if (!config || !config.ready || !wallet || !session || Date.parse(session.expiresAt) <= Date.now()) throw new Error('Connect your wallet and sign in to continue.');
    const result = { config, wallet, session, epoch: epoch.current };
    await assertWallet(config, wallet);
    if (epoch.current !== result.epoch) throw new Error('Wallet changed. Connect again before continuing.');
    return result;
  }
  async function checkContext(value: Awaited<ReturnType<typeof context>>) {
    if (epoch.current !== value.epoch) throw new Error('Wallet or sign-in changed. Connect again to continue.');
    await assertWallet(value.config, value.wallet);
    if (epoch.current !== value.epoch) throw new Error('Wallet changed. Connect again to continue.');
  }
  async function connect() {
    if (!config || !ready || !begin('Connect in your wallet')) return;
    const startingEpoch = epoch.current;
    try {
      const connected = await connectWallet(config);
      if (epoch.current !== startingEpoch) throw new Error('Wallet changed during connection. Connect again.');
      setWallet(connected); setBusy('Sign the sign-in message');
      const signed = await signInWallet(config, connected);
      if (epoch.current !== startingEpoch) throw new Error('Wallet changed during sign-in. Connect again.');
      setSession(signed); setNotice('Wallet connected. Your sign-in is a message signature; purchases need separate transaction approvals.');
    } catch (error) { clearSession(); report(error); }
    finally { finish(); }
  }
  async function logout() {
    const token = session?.token;
    clearSession('Signed out. Your paid orders are retained for this browser tab.');
    if (token) await marketApi('/api/auth/logout', { method: 'POST', body: '{}' }, token).catch(() => {});
  }
  async function faucet() {
    if (!begin('Funding your local wallet')) return;
    try {
      const ctx = await context();
      if (ctx.config.chainId !== 31337 || !ctx.config.localFaucet) throw new Error('The free faucet is available only on local chain 31337.');
      const result = await marketApi<FaucetResult>('/api/market/faucet', { method: 'POST', body: '{}' }, ctx.session.token);
      await checkContext(ctx); setBalance(result.wallet); setNotice('Local test funds ready. wBSC and local gas have no monetary value.');
    } catch (error) { report(error); }
    finally { finish(); }
  }
  async function deliverOrder(ctx: Awaited<ReturnType<typeof context>>, order: PendingOrder, orderKey: string) {
    if (order.buyer.toLowerCase() !== ctx.wallet.address.toLowerCase() || order.chainId !== ctx.config.chainId || !recoveryCheckoutMatches(ctx.config, order.checkoutAddress)) throw new Error('Connect the wallet and deployment that owns this order to retrieve it.');
    setBusy('Retrieving your paid response');
    const result = await marketApi<MarketDelivery>(`/api/market/services/${encodeURIComponent(order.serviceId)}/deliver`, { method: 'POST', body: JSON.stringify({ orderId: order.orderId }) }, ctx.session.token);
    await checkContext(ctx);
    if (result.serviceId !== order.serviceId || result.orderId.toLowerCase() !== order.orderId.toLowerCase() || result.buyer.toLowerCase() !== ctx.wallet.address.toLowerCase()) throw new Error('The response does not match this wallet and order. Keep the order ID and retry retrieval.');
    rememberOrder(orderKey, { ...order, status: 'paid' });
    setDeliveries(current => ({ ...current, [orderKey]: result }));
    setNotice('Payment verified. Your service response is ready.');
    setCatalogRevision(value => value + 1);
    await refreshBalance(ctx.session.token, ctx.epoch);
  }
  async function retrieve(order = pending, orderKey = currentKey) {
    if (!order || !orderKey || !begin('Checking your paid order')) return;
    try { const ctx = await context(); await deliverOrder(ctx, order, orderKey); }
    catch (error) { report(error); }
    finally { finish(); }
  }
  async function purchase() {
    if (!selected || !quote || !begin('Refreshing your wallet price')) return;
    let order: PendingOrder | undefined, orderKey = '';
    try {
      const ctx = await context();
      orderKey = keyFor(ctx.config, ctx.wallet.address, selected.id);
      if (pendingOrdersForWallet(ordersRef.current, ctx.config, ctx.wallet.address).some(([key, value]) => value.serviceId === selected.id && !deliveries[key])) throw new Error('This service already has a pending order. Retrieve that response before making another payment.');
      const fresh = await marketApi<ServiceQuote>(`/api/market/services/${encodeURIComponent(selected.id)}/quote?buyer=${ctx.wallet.address}`);
      await checkContext(ctx);
      if (fresh.buyer.toLowerCase() !== ctx.wallet.address.toLowerCase() || fresh.seller.toLowerCase() !== selected.seller.toLowerCase() || fresh.sku !== selected.sku) throw new Error('The quote does not match this wallet and service. Refresh the marketplace.');
      setQuote(fresh);
      if (fresh.offerVersion !== quote.offerVersion || BigInt(fresh.amount) > BigInt(quote.amount)) throw new Error('The seller’s offer changed. Your new price is shown; review it before buying.');
      const { publicClient, walletClient } = marketClients(ctx.config, ctx.wallet);
      setBusy(`Approve exactly ${tokenAmount(fresh.amount)} wBSC`);
      const approval = await walletClient.writeContract({ address: ctx.config.tokenAddress, abi: tokenAbi, functionName: 'approve', args: [ctx.config.checkoutAddress, BigInt(fresh.amount)] });
      setBusy('Confirming your token approval');
      const approved = await publicClient.waitForTransactionReceipt({ hash: approval });
      if (approved.status !== 'success') throw new Error('Token approval reverted. No checkout payment was submitted.');
      await checkContext(ctx);
      const allowance = await publicClient.readContract({ address: ctx.config.tokenAddress, abi: tokenAbi, functionName: 'allowance', args: [ctx.wallet.address, ctx.config.checkoutAddress] });
      if (allowance !== BigInt(fresh.amount)) throw new Error('The token allowance differs from the exact approved price. No checkout payment was submitted.');
      const block = await publicClient.getBlock();
      await checkContext(ctx);
      const orderId = bytesToHex(crypto.getRandomValues(new Uint8Array(32)));
      order = { serviceId: selected.id, title: selected.title, buyer: ctx.wallet.address, chainId: ctx.config.chainId, checkoutAddress: ctx.config.checkoutAddress, orderId, quote: fresh, status: 'pending' };
      rememberOrder(orderKey, order);
      setDeliveries(current => { const next = { ...current }; delete next[orderKey]; return next; });
      setBusy(`Confirm payment up to ${tokenAmount(fresh.amount)} wBSC`);
      const hash = await walletClient.writeContract({ address: ctx.config.checkoutAddress, abi: checkoutAbi, functionName: 'checkout', args: [fresh.seller, fresh.sku, orderId, BigInt(fresh.amount), BigInt(fresh.offerVersion), block.timestamp + 120n] });
      order = { ...order, hash }; rememberOrder(orderKey, order);
      setBusy('Waiting for payment confirmation');
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      if (receipt.status !== 'success') { rememberOrder(orderKey); order = undefined; throw new Error('Checkout reverted. This order was not paid. Refresh the quote before a new attempt.'); }
      verifyOrderReceipt(receipt, ctx.config, fresh, orderId);
      order = { ...order, status: 'paid' }; rememberOrder(orderKey, order);
      await checkContext(ctx);
      await deliverOrder(ctx, order, orderKey);
    } catch (error) {
      if (order && isUserRejection(error) && !order.hash) rememberOrder(orderKey);
      report(error);
    } finally { finish(); }
  }
  async function publish(payload: PublishService) {
    if (!begin(publishIntent ? 'Checking your published offer' : 'Confirm the seller offer in your wallet')) return;
    let intent = publishIntent;
    try {
      const ctx = await context();
      const { publicClient, walletClient } = marketClients(ctx.config, ctx.wallet);
      if (intent && (intent.seller.toLowerCase() !== ctx.wallet.address.toLowerCase() || intent.chainId !== ctx.config.chainId || intent.checkoutAddress.toLowerCase() !== ctx.config.checkoutAddress.toLowerCase())) throw new Error('Reconnect the seller wallet and network that began this publication to resume it.');
      if (!intent) {
        intent = { payload, seller: ctx.wallet.address, chainId: ctx.config.chainId, checkoutAddress: ctx.config.checkoutAddress };
        setPublishIntent(intent);
        const hash = await walletClient.writeContract({ address: ctx.config.checkoutAddress, abi: checkoutAbi, functionName: 'setOffer', args: [keccak256(toBytes(payload.id)), BigInt(payload.basePrice), BigInt(payload.spendThreshold), payload.discountBps, true] });
        intent = { ...intent, hash }; setPublishIntent(intent); setBusy('Confirming the seller offer');
        const receipt = await publicClient.waitForTransactionReceipt({ hash });
        if (receipt.status !== 'success') { setPublishIntent(null); intent = null; throw new Error('The seller offer reverted. Your service was not published.'); }
      }
      await checkContext(ctx);
      const offer = await publicClient.readContract({ address: ctx.config.checkoutAddress, abi: checkoutAbi, functionName: 'offer', args: [ctx.wallet.address, keccak256(toBytes(intent.payload.id))] });
      if (!offer.enabled || offer.basePrice !== BigInt(intent.payload.basePrice) || offer.spendThreshold !== BigInt(intent.payload.spendThreshold) || offer.discountBps !== intent.payload.discountBps) throw new Error('This offer is not confirmed with the entered terms yet. Keep this page open and check again; another transaction will not be sent.');
      setBusy('Publishing service details');
      const service = await marketApi<ServiceListing>('/api/market/services', { method: 'POST', body: JSON.stringify(intent.payload) }, ctx.session.token);
      await checkContext(ctx);
      setPublishIntent(null); setQuery(''); setCategory(''); setServices(current => [service, ...current.filter(item => item.id !== service.id)]); setSelectedId(service.id); setView('browse'); setCatalogRevision(value => value + 1);
      setNotice('Your service is live. Buyers can discover it and pay your wallet directly.');
      await refreshBalance(ctx.session.token, ctx.epoch);
    } catch (error) {
      if (intent && !intent.hash && isUserRejection(error)) setPublishIntent(null);
      report(error);
    } finally { finish(); }
  }

  return <div className="market-shell">
    <a className="market-skip" href="#market-main">Skip to marketplace</a>
    <header className="market-header">
      <a className="market-brand" href="/" aria-label="Repeat marketplace"><Mark />Repeat<span>.</span></a>
      <nav className="market-nav" aria-label="Main navigation">
        <button type="button" aria-current={view === 'browse' ? 'page' : undefined} onClick={() => setView('browse')}>Marketplace</button>
        <button type="button" aria-current={view === 'publish' ? 'page' : undefined} onClick={() => setView('publish')}>Publish a service</button>
        <button type="button" aria-current={view === 'agents' ? 'page' : undefined} onClick={() => setView('agents')}>For agents <span aria-hidden="true">↗</span></button>
      </nav>
      <div className="market-wallet-actions">{session && wallet ? <><span className="market-connected" title={wallet.address}><i />{shortAddress(wallet.address)}</span><button className="market-signout" type="button" onClick={() => void logout()} disabled={!!busy}>Sign out</button></> : <button type="button" className="market-connect" onClick={() => void connect()} disabled={!ready || !!busy}>{busy && !session ? 'Check your wallet…' : 'Connect wallet'}<Arrow /></button>}</div>
    </header>

    <main id="market-main">
      <section className="market-hero">
        <div><p className="market-eyebrow">An open market for useful work</p><h1>{view === 'publish' ? <>Your expertise.<br /><em>Your storefront.</em></> : view === 'agents' ? <>Built for people.<br /><em>Open to agents.</em></> : <>Good work.<br /><em>Better the next time.</em></>}</h1></div>
        <div className="market-hero-note"><span className="market-network"><i className={!ready ? 'offline' : ''} />{config ? `${config.chainName} · ${config.chainId}` : 'Connecting to marketplace'}</span><p>{view === 'publish' ? 'Set your price. Reward returning buyers. Get paid directly to your own wallet.' : view === 'agents' ? 'The same services, prices, and paid delivery. Bring your own signing wallet.' : 'Discover services from independent builders. Earn a better price with the sellers you return to.'}</p><span className="market-test-label">Test currency · no monetary value</span></div>
      </section>

      {(configError || (config && !config.ready)) && <div className="market-alert market-alert-error" role="alert"><div><strong>The marketplace needs a connection.</strong><p>{configError || config?.error || 'The checkout contracts are not configured. Run npm run setup:local from the app directory.'}</p></div><button type="button" onClick={() => void loadConfig()}>Retry connection</button></div>}
      {error && <div className="market-alert market-alert-error" role="alert"><div><strong>Action needs attention</strong><p>{error}</p></div><button type="button" aria-label="Dismiss error" onClick={() => setError('')}>×</button></div>}
      {notice && <div className="market-alert" role="status"><p>{notice}</p><button type="button" aria-label="Dismiss notice" onClick={() => setNotice('')}>×</button></div>}
      {busy && <div className="market-working" role="status"><span className="market-spinner" />{busy}<span>Keep this page open.</span></div>}

      <div className="market-account-strip">
        <div><span className="market-strip-label">Your wallet</span>{wallet && session ? <strong>{shortAddress(wallet.address)} <span>· {ownServices} service{ownServices === 1 ? '' : 's'} in this view</span></strong> : <strong>Browse freely. Connect when you’re ready.</strong>}</div>
        {session ? <div className="market-funds"><span><strong>{tokenAmount(balance?.tokenBalance)}</strong> wBSC</span><span>{tokenAmount(balance?.gasBalance, 18)} {config?.nativeSymbol} gas</span>{config?.chainId === 31337 && config.localFaucet && <button type="button" onClick={() => void faucet()} disabled={!!busy}>Get free local test funds <span aria-hidden="true">↗</span></button>}</div> : <span className="market-wallet-note">Your wallet signs. Your history sets your price.</span>}
      </div>

      {savedOrders.length > 0 && <section className="market-recovery" aria-label="Saved order recovery"><div className="market-recovery-heading"><div><span className="market-eyebrow">Your retained orders</span><h2>Pick up where you paid.</h2></div><p>Retrieve with the same order, even if the seller’s offer is no longer listed. This never submits a payment.</p></div>{savedOrders.map(([orderKey, order]) => <article className="market-recovery-order" key={orderKey}><div className="market-recovery-copy"><span className="market-recovery-status">{deliveries[orderKey] ? 'Response retrieved' : order.status === 'paid' ? 'Payment verified' : 'Confirmation needs checking'}</span><h3>{order.title || order.serviceId}</h3><p>Service <span>{order.serviceId}</span></p><p>Order <span>{order.orderId}</span></p>{order.hash && <ChainLink config={config} value={order.hash} kind="tx" label="Payment transaction" />}</div><button type="button" className="market-recovery-button" onClick={() => void retrieve(order, orderKey)} disabled={!!busy}>{deliveries[orderKey] ? 'Retrieve again' : 'Retry retrieval'}<Arrow /></button>{deliveries[orderKey] && (selectedId !== order.serviceId || view !== 'browse') && <section className="market-delivery market-recovery-response" aria-label={`Paid response for ${order.title}`}><div><span>✓ Paid response</span><span>{tokenAmount(deliveries[orderKey].amount)} wBSC</span></div><pre>{deliveries[orderKey].response}</pre></section>}</article>)}</section>}

      {view === 'browse' && <div className="market-workspace">
        <section className="market-catalog" aria-label="Service catalog" aria-busy={loading}>
          <div className="market-catalog-title"><h2>Find your next advantage<span>.</span></h2><span>{loading ? 'Reading services…' : `${services.length} service${services.length === 1 ? '' : 's'}`}</span></div>
          <label className="market-search"><svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 5 5" /></svg><span className="sr-only">Search services</span><input type="search" value={query} maxLength={100} onChange={event => setQuery(event.target.value)} placeholder="What would you like done?" />{query && <button type="button" onClick={() => setQuery('')} aria-label="Clear search">×</button>}</label>
          <div className="market-filters" aria-label="Filter by category">{CATEGORIES.map(item => <button key={item.value} type="button" aria-pressed={category === item.value} onClick={() => setCategory(item.value)}>{item.label}</button>)}</div>
          {catalogError ? <div className="market-empty"><h3>Services are taking a moment.</h3><p>{catalogError}</p><button type="button" onClick={() => setCatalogRevision(value => value + 1)}>Try again ↗</button></div> : !loading && !services.length ? <div className="market-empty"><span className="market-eyebrow">Room for something useful</span><h3>{query || category ? 'No services match this search.' : 'Be the first to open a storefront.'}</h3><p>{query || category ? 'Try a broader phrase or another category.' : 'Publish a hosted response and let people buy it directly from your wallet.'}</p><button type="button" onClick={() => { if (query || category) { setQuery(''); setCategory(''); } else setView('publish'); }}>{query || category ? 'Reset filters' : 'Publish a service'} ↗</button></div> : <div className="market-service-list">{services.map((service, index) => <button className={`market-service ${selectedId === service.id ? 'is-selected' : ''}`} key={service.id} type="button" onClick={() => { setSelectedId(service.id); setError(''); if (window.matchMedia('(max-width: 650px)').matches) requestAnimationFrame(() => { detailRef.current?.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block: 'start' }); detailRef.current?.focus({ preventScroll: true }); }); }} aria-pressed={selectedId === service.id} aria-label={`View ${service.title}`} disabled={!!busy}>
            <span className="market-service-index">{String(index + 1).padStart(2, '0')}</span><span className="market-service-copy"><span className="market-service-category">{service.category}{service.kind === 'fixture' && <span>Builder fixture</span>}</span><strong>{service.title}</strong><span className="market-service-description">{service.description}</span><span className="market-service-seller">{shortAddress(service.seller)}<span>Up to {service.discountBps / 100}% loyalty discount</span></span></span><span className="market-service-price"><strong>{tokenAmount(service.basePrice)}</strong><span>wBSC · list price</span><Arrow /></span>
          </button>)}</div>}
          <div className="market-catalog-footer"><span>Useful work. Direct payment. A reason to return.</span><button type="button" onClick={() => setView('publish')}>Open your storefront <Arrow diagonal /></button></div>
        </section>
        <aside className="market-detail" aria-label="Selected service details" ref={detailRef} tabIndex={-1}>
          {selected ? <>
            <div className="market-detail-heading"><span className="market-eyebrow">Service details / {selected.category}</span><span className="market-detail-symbol" aria-hidden="true">↗</span><h2>{selected.title}</h2><p>{selected.description}</p><div className="market-seller-line"><span>Offered by <ChainLink config={config} value={selected.seller} /></span>{selected.kind === 'fixture' && <span>Builder-operated fixture</span>}</div></div>
            <div className="market-price-area"><span className="market-price-label">{wallet ? 'Your checkout price' : 'Public list price'}</span><div className="market-price"><strong>{tokenAmount(quote?.amount || selected.basePrice)}</strong><span>wBSC</span>{quote?.appliedBps ? <span className="market-earned">{quote.appliedBps / 100}% earned off</span> : null}</div>{quote?.appliedBps ? <p><s>{tokenAmount(selected.basePrice)} wBSC list price</s> · seller-funded savings</p> : <p>{quoteLoading ? 'Checking your paid history…' : wallet ? 'Your price is verified against this seller’s on-chain history.' : 'Connect your wallet to see your personalized price.'}</p>}{quoteError && <p className="market-inline-error" role="alert">{quoteError}</p>}</div>
            <div className="market-loyalty"><div><h3>A better reason to return.</h3><span>{selected.discountBps / 100}% loyalty</span></div><p>Pay {tokenAmount(selected.spendThreshold)} wBSC on this service to unlock {selected.discountBps / 100}% off future purchases.</p>{quote && <><div className="market-loyalty-track" role="progressbar" aria-label="Service loyalty threshold progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Number(BigInt(quote.priorPaid) * 100n / BigInt(selected.spendThreshold) > 100n ? 100n : BigInt(quote.priorPaid) * 100n / BigInt(selected.spendThreshold))}><span style={{ transform: `scaleX(${Number(BigInt(quote.priorPaid) * 10000n / BigInt(selected.spendThreshold) > 10000n ? 10000n : BigInt(quote.priorPaid) * 10000n / BigInt(selected.spendThreshold)) / 10000})` }} /></div><div className="market-loyalty-caption"><span>{tokenAmount(quote.priorPaid)} / {tokenAmount(selected.spendThreshold)} wBSC paid</span><span>{quote.purchaseCount} prior purchase{quote.purchaseCount === '1' ? '' : 's'}</span></div></>}</div>
            <div className="market-checkout">
              {pending && !delivery ? <div className="market-pending"><span className="market-eyebrow">{pending.status === 'paid' ? 'Payment verified' : 'Order retained'}</span><h3>{pending.status === 'paid' ? 'Your response is waiting.' : 'Check this order before paying again.'}</h3><p>{pending.status === 'paid' ? 'Retrieve your service response with the same paid order.' : 'Confirmation may still be pending. Retrieval checks this order on-chain and never submits another payment.'}</p><span className="market-order-id" title={pending.orderId}>Order {shortAddress(pending.orderId)}</span>{pending.hash && <ChainLink config={config} value={pending.hash} kind="tx" label="Payment transaction" />}<button type="button" className="market-primary" onClick={() => void retrieve()} disabled={!!busy || !session}>Retrieve paid response <Arrow /></button></div> : <><button type="button" className="market-primary" onClick={() => session ? void purchase() : void connect()} disabled={!ready || !!busy || (!!session && (!quote || quoteLoading || !!quoteError))}>{!session ? 'Connect wallet to buy' : delivery ? 'Buy this service again' : `Buy for ${tokenAmount(quote?.amount)} wBSC`}<Arrow /></button><p className="market-purchase-note">{session ? 'Two wallet confirmations: exact token approval, then payment. Gas is separate. The quote expires after two minutes.' : 'Sign in with your own wallet. Each purchase requires your approval.'}</p></>}
              {!wallet && !injectedProvider() && <p className="market-no-wallet">No wallet extension detected. Install MetaMask, Rabby, or another EIP-1193 wallet, then return to connect.</p>}
              {delivery && <section className="market-delivery" aria-label="Paid service response"><div><span>✓ Paid response</span><span>{tokenAmount(delivery.amount)} wBSC</span></div><pre>{delivery.response}</pre><p>Order {shortAddress(delivery.orderId)} · verified for your wallet</p></section>}
            </div>
            <details className="market-evidence"><summary>Public contract evidence <span>+</span></summary><dl><div><dt>Checkout</dt><dd>{config && <ChainLink config={config} value={config.checkoutAddress} />}</dd></div><div><dt>Service SKU</dt><dd title={selected.sku}>{shortAddress(selected.sku)}</dd></div><div><dt>Offer version</dt><dd>{quote?.offerVersion || selected.offerVersion}</dd></div><div><dt>Quote block</dt><dd>{quote?.blockNumber || 'Connect for wallet quote'}</dd></div></dl><p>Paid history proves checkout payments. It does not establish delivery quality or reputation.</p></details>
          </> : <div className="market-detail-empty"><span className="market-eyebrow">Your next useful thing</span><h2>Choose a service.<br /><em>Make it yours.</em></h2><p>View a service to see its price, seller, and loyalty terms.</p></div>}
        </aside>
      </div>}

      {view === 'publish' && <PublishPanel connected={!!session} disabled={!!busy || !ready} intent={publishIntent} onConnect={() => void connect()} onPublish={payload => void publish(payload)} />}
      {view === 'agents' && <section className="market-agents"><div><span className="market-eyebrow">One market. Any signing wallet.</span><h2>Put your agent<br /><em>to useful work.</em></h2><p>Discover services without signing in. Use an agent-controlled wallet to publish, purchase, and retrieve a paid response through the same API.</p><p>The browser never needs your private key. For the CLI, keep a disposable test key in your own environment and use an explicit spending cap.</p><div className="market-agent-links"><a href="/api/market/client" download="repeat-agent.mjs">Download agent client <Arrow diagonal /></a><a href="/api/market/skill" target="_blank" rel="noreferrer">Read the agent skill <Arrow diagonal /></a><a href="/api/market/docs" target="_blank" rel="noreferrer">API & CLI reference <Arrow diagonal /></a></div></div><div className="market-agent-guide"><h3>1. Download the agent client</h3><p>Run these commands in any folder on this computer. Requires Node.js 22.12+; no project checkout or npm install.</p><pre>{`curl -fsSL "${window.location.origin}/api/market/client" -o repeat-agent.mjs\nnode ./repeat-agent.mjs discover --query research\nnode ./repeat-agent.mjs quote --service SERVICE_ID --buyer 0xYOUR_WALLET`}</pre><p>Use a real service ID from discovery and your wallet address. A remote agent needs a reachable platform URL; localhost points to its own computer.</p><h3>2. Authorize publishing or buying</h3><p>The <code>buy</code> command needs <code>--max-spend</code> in wBSC and a signing wallet. The client signs with your configured agent wallet. Set up the wallet first, then use these commands. The skill and API reference explain the full payload and recovery flow.</p><pre>{`node ./repeat-agent.mjs publish --file ./service.json
node ./repeat-agent.mjs buy --service SERVICE_ID --max-spend 0.06 --intent purchase-001
node ./repeat-agent.mjs deliver --service SERVICE_ID --order 0xORDER_ID`}</pre><div className="market-api-links"><a href="/api/market/config" target="_blank" rel="noreferrer">Public configuration ↗</a><a href="/api/market/services" target="_blank" rel="noreferrer">Discover services ↗</a></div><p className="market-agent-footnote">Local chain 31337 supports free test funds. BSC testnet 97 requires tBNB for gas. All wBSC here is unbacked test currency.</p></div></section>}
    </main>
    <footer className="market-footer"><div><Mark /><span>Good work deserves<br />a returning customer.</span></div><p>Test currency with no monetary value. Merchant-funded discounts.<br />Your keys stay in your wallet. Payments and loyalty live on-chain.</p><button type="button" onClick={onOpenDemoLab} disabled={!!busy}>Visit the scripted Demo lab <Arrow diagonal /></button></footer>
  </div>;
}

function PublishPanel({ connected, disabled, intent, onConnect, onPublish }: { connected: boolean; disabled: boolean; intent: PublishIntent | null; onConnect: () => void; onPublish: (value: PublishService) => void }) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState<ServiceCategory>('research');
  const [price, setPrice] = useState('0.05');
  const [threshold, setThreshold] = useState('0.15');
  const [discount, setDiscount] = useState('20');
  const [response, setResponse] = useState('');
  const [validation, setValidation] = useState('');
  function submit(event: React.FormEvent) {
    event.preventDefault(); setValidation('');
    if (!connected) { onConnect(); return; }
    if (intent) { onPublish(intent.payload); return; }
    const basePrice = parseTokenAmount(price), spendThreshold = parseTokenAmount(threshold);
    const discountBps = Math.round(Number(discount) * 100);
    if (!title.trim() || !description.trim() || !response.trim()) { setValidation('Add a title, public description, and the content buyers will receive.'); return; }
    if (!basePrice || !spendThreshold) { setValidation('Price and loyalty threshold must be positive amounts with up to six decimal places.'); return; }
    if (!/^\d+(\.\d{1,2})?$/.test(discount) || !Number.isInteger(discountBps) || discountBps < 0 || discountBps > 2000) { setValidation('Choose a loyalty discount between 0% and 20%, with up to two decimal places.'); return; }
    onPublish({ id: crypto.randomUUID(), title: title.trim(), description: description.trim(), category, basePrice, spendThreshold, discountBps, response });
  }
  return <section className="market-publish"><div className="market-publish-intro"><span className="market-eyebrow">A storefront of your own</span><h2>Something useful.<br /><em>Worth coming back for.</em></h2><p>Add a report, guide, answer, or download link that buyers can access after payment. Write normally—the app handles the delivery format.</p><ol><li><span>01</span><div><strong>Make a clear offer.</strong><p>Describe exactly what a buyer will receive.</p></div></li><li><span>02</span><div><strong>Set a returning buyer price.</strong><p>You fund the discount by accepting a lower price.</p></div></li><li><span>03</span><div><strong>Sign and open your storefront.</strong><p>Your wallet sets the offer on-chain before the listing is published.</p></div></li></ol><p className="market-publish-safety">All buyers receive the same saved content. They can read it after their payment is confirmed.</p></div>
    <form className="market-publish-form" onSubmit={submit}>
      <div className="market-form-heading"><span className="market-eyebrow">New service</span><span>Paid directly to your wallet</span></div>
      {intent && <div className="market-publish-pending" role="status"><strong>Your seller offer has been submitted.</strong><p>Keep this page open. Check the existing offer and finish publishing its details without sending another transaction.</p>{intent.hash && <span title={intent.hash}>Transaction {shortAddress(intent.hash)}</span>}</div>}
      <fieldset disabled={disabled || !!intent}>
        <label htmlFor="service-title">Service title<input id="service-title" value={title} onChange={event => setTitle(event.target.value)} maxLength={100} placeholder="e.g. BNB ecosystem research briefing" required={!intent} /></label>
        <label htmlFor="service-description">Public service description<textarea id="service-description" value={description} onChange={event => setDescription(event.target.value)} maxLength={1000} rows={3} placeholder="Tell buyers what they get and why it is useful. The full paid content goes below." required={!intent} /></label>
        <label htmlFor="service-category">Category<select id="service-category" value={category} onChange={event => setCategory(event.target.value as ServiceCategory)}>{CATEGORIES.filter(item => item.value).map(item => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
        <div className="market-price-fields"><label htmlFor="service-price">List price <span>wBSC</span><input id="service-price" inputMode="decimal" value={price} onChange={event => setPrice(event.target.value)} placeholder="0.05" required={!intent} /></label><label htmlFor="service-threshold">Loyalty spend threshold <span>wBSC</span><input id="service-threshold" inputMode="decimal" value={threshold} onChange={event => setThreshold(event.target.value)} placeholder="0.15" required={!intent} /></label><label htmlFor="service-discount">Future discount <span>0–20%</span><input id="service-discount" inputMode="decimal" value={discount} onChange={event => setDiscount(event.target.value)} placeholder="20" required={!intent} /></label></div>
        <p className="market-form-hint">Each service has its own paid history. Only repeat purchases of this service count toward its discount.</p>
        <label htmlFor="service-response">Content buyers receive<span className="market-private-label">Visible only to buyers after payment</span><textarea id="service-response" value={response} onChange={event => setResponse(event.target.value)} maxLength={20000} rows={7} placeholder="Write or paste your report, guide, answer, or download link here. No JSON or coding needed." required={!intent} /></label>
        <p className="market-form-hint">Write in plain language. You don’t need to create a JSON response or add technical formatting.</p>
      </fieldset>
      {validation && <p className="market-inline-error" role="alert">{validation}</p>}
      <button type="submit" className="market-primary" disabled={disabled}>{!connected ? 'Connect wallet to publish' : intent ? 'Check offer & finish publishing' : 'Sign offer & publish service'}<Arrow /></button><p className="market-purchase-note">One seller transaction sets your price and loyalty terms. Publishing requires gas; local test funds are free.</p>
    </form>
  </section>;
}
