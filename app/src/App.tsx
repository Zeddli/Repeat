import { useCallback, useEffect, useRef, useState } from 'react';
import Marketplace from './Marketplace';
import type { HistoryOrder, MerchantSnapshot, Quote, Run, RunEvent, Snapshot, TaskResult } from '../shared/types';

type IconName = 'arrow' | 'external' | 'check' | 'close' | 'terminal' | 'refresh' | 'stop' | 'chevron' | 'shield' | 'copy' | 'activity' | 'data';
function Icon({ name, size = 16, className = '' }: { name: IconName; size?: number; className?: string }) {
  const paths: Record<IconName, React.ReactNode> = {
    arrow: <><path d="M4 12h15M13 6l6 6-6 6" /></>,
    external: <><path d="M14 4h6v6M20 4l-9 9M10 4H4v16h16v-6" /></>,
    check: <path d="m5 12 4 4L19 6" />,
    close: <path d="m6 6 12 12M18 6 6 18" />,
    terminal: <><path d="m4 6 6 6-6 6M13 18h7" /></>,
    refresh: <><path d="M20 7v5h-5M4 17v-5h5" /><path d="M6.1 7a7 7 0 0 1 11.5-1L20 9M4 15l2.4 3A7 7 0 0 0 18 17" /></>,
    stop: <rect x="7" y="7" width="10" height="10" />,
    chevron: <path d="m7 10 5 5 5-5" />,
    shield: <><path d="M12 3 4 6v6c0 5 8 9 8 9s8-4 8-9V6l-8-3Z" /><path d="m8 12 3 3 5-6" /></>,
    copy: <><rect x="8" y="8" width="12" height="12" rx="1" /><path d="M16 8V4H4v12h4" /></>,
    activity: <path d="M2 12h5l3-8 4 16 3-8h5" />,
    data: <><path d="M5 3h10l4 4v14H5V3Z" /><path d="M14 3v5h5M9 12h6M9 16h6" /></>,
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={className}>{paths[name]}</svg>;
}
function RepeatMark({ small = false }: { small?: boolean }) {
  return <svg className={small ? '' : 'brand-mark'} width="33" height="36" viewBox="0 0 34 36" fill="none" aria-hidden="true"><path d="M6 14V8h18l5 6-5 6h-7" stroke="currentColor" strokeWidth="3.3" strokeLinejoin="miter" /><path d="M28 22v6H10l-5-6 5-6h7" stroke="currentColor" strokeWidth="3.3" strokeLinejoin="miter" /></svg>;
}
const DEFAULT_MISSION = 'Get this BNB research record. Spend no more than 0.06 wBSC.';
const ACTIVE = new Set(['planning', 'running']);
const TITLES: Record<string, string> = { 'bnb-agents': 'BNB agent tooling', 'bnb-identity': 'Agent identity', 'bnb-commerce': 'Agent commerce', 'bnb-budget': 'BNB research record' };
const EVENT_TITLES: Record<RunEvent['type'], string> = { plan: 'Mission planned', quotes: 'Quotes read from chain', decision: 'Best eligible offer selected', submitted: 'Payment submitted', confirmed: 'Payment confirmed', delivery: 'Service response received', stopped: 'Mission stopped', error: 'Action needed', recovery: 'Payment recovery' };
function money(value?: string, decimals = 6): string {
  if (value === undefined || !/^\d+$/.test(value)) return '—';
  const units = BigInt(value);
  const divisor = 10n ** BigInt(decimals);
  const whole = units / divisor;
  const fraction = (units % divisor).toString().padStart(decimals, '0').replace(/0+$/, '');
  return `${whole}${fraction ? `.${fraction}` : ''}`;
}
function gas(value?: string) { return money(value, 18); }
function short(value?: string, width = 5) { return value ? `${value.slice(0, width + 2)}…${value.slice(-width)}` : 'Not configured'; }
function parseBudget(value: string): string | null {
  const match = value.trim().match(/^(\d+)(?:\.(\d{1,6}))?$/);
  if (!match) return null;
  return (BigInt(match[1]) * 1000000n + BigInt((match[2] || '').padEnd(6, '0'))).toString();
}
function txUrl(snapshot: Snapshot | null, hash: string) { return snapshot?.network.explorerUrl ? `${snapshot.network.explorerUrl.replace(/\/$/, '')}/tx/${hash}` : undefined; }
function addressUrl(snapshot: Snapshot | null, address: string) { return snapshot?.network.explorerUrl ? `${snapshot.network.explorerUrl.replace(/\/$/, '')}/address/${address}` : undefined; }
async function api<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(path, { ...options, headers: { 'Content-Type': 'application/json', ...options?.headers } });
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new Error(payload?.message || payload?.error || `Request failed (${response.status}).`);
  if (!payload) throw new Error('The local API returned an empty response.');
  return payload as T;
}
function ReceiptLink({ snapshot, hash, label }: { snapshot: Snapshot | null; hash: string; label?: string }) {
  const href = txUrl(snapshot, hash);
  if (href) return <a href={href} target="_blank" rel="noreferrer" className="payment-link" title={hash}>{label || short(hash)} <Icon name="external" size={10} /></a>;
  return <span className="payment-link" title={hash}>{label || short(hash)} <span className="muted">local receipt</span></span>;
}
function QuoteCard({ item, winner, ready }: { item?: MerchantSnapshot | Quote; winner: boolean; ready: boolean }) {
  const id = item ? ('id' in item ? item.id : item.merchantId) : undefined;
  const amount = item ? ('price' in item ? item.price : item.amount) : undefined;
  const discounted = !!item?.appliedBps;
  return <article className={`quote-card ${winner ? 'recommended' : ''}`} aria-label={`${item?.name || 'Seller'} quote`}>
    <div className="seller-top"><div className="seller-name"><span className={`seller-avatar ${id === 'b' ? 'b' : ''}`}>{(id || '?').toUpperCase()}</span>{item?.name || (ready ? 'Awaiting quote' : 'Seller quote')}</div>{winner ? <span className="quote-badge"><Icon name="check" size={11} />Best price</span> : <span className="quote-badge neutral">Equivalent data</span>}</div>
    <p className="quote-price">{ready ? money(amount) : '—'}<small>wBSC</small></p>
    <div className="quote-list-price">{discounted ? <><s>{money(item?.basePrice)} list</s><span className="discount-tag">{(item!.appliedBps / 100).toFixed(0)}% earned off</span></> : <span>Public list price{ready && item ? ` · ${money(item.basePrice)}` : ''}</span>}</div>
    <div className="quote-bottom"><span>{discounted ? 'Verified returning buyer' : 'No discount applied'}</span><strong>{ready && item ? `${item.purchaseCount} prior purchase${item.purchaseCount === '1' ? '' : 's'}` : 'Read from checkout'}</strong></div>
  </article>;
}
function TechnicalPanel({ snapshot, onClose }: { snapshot: Snapshot | null; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  async function copy() { if (!snapshot) return; await navigator.clipboard.writeText(snapshot.buyer.address); setCopied(true); window.setTimeout(() => setCopied(false), 1800); }
  const publicAddress = (address?: string) => !address || !snapshot?.ready ? 'Not configured' : addressUrl(snapshot, address) ? <a href={addressUrl(snapshot, address)} target="_blank" rel="noreferrer">{address}<Icon name="external" size={11} /></a> : address;
  return <section className="technical-panel" aria-label="Public chain evidence">
    <div className="technical-panel-header"><h2>Open evidence, portable history.</h2><button className="text-button" aria-label="Close public evidence" onClick={onClose}><Icon name="close" /></button></div>
    <dl className="technical-grid">
      <div className="technical-item"><dt>Network</dt><dd>{snapshot ? `${snapshot.network.name} · Chain ${snapshot.network.chainId}` : 'Waiting for local API'}{snapshot?.mode === 'local' ? ' · Actual local-chain transactions' : ''}</dd></div>
      <div className="technical-item"><dt>Planner</dt><dd>{snapshot?.planner.mode === 'anthropic' ? 'Anthropic · model plan, validated allowlist' : 'Deterministic fallback · no model inference'} · deterministic price and budget controller</dd></div>
      <div className="technical-item"><dt>Buyer wallet {snapshot?.ready && <button className="copy-button" onClick={() => void copy()} aria-label="Copy public buyer address"><Icon name={copied ? 'check' : 'copy'} size={10} />{copied ? 'Copied' : 'Copy'}</button>}</dt><dd>{publicAddress(snapshot?.buyer.address)}</dd></div>
      <div className="technical-item"><dt>Loyalty checkout</dt><dd>{publicAddress(snapshot?.checkoutAddress)}</dd></div>
      <div className="technical-item"><dt>wBSC test currency</dt><dd>{publicAddress(snapshot?.tokenAddress)}</dd></div>
      <div className="technical-item"><dt>Merchant wallets</dt><dd>{snapshot?.merchants.length ? snapshot.merchants.map(merchant => <div key={merchant.id}>{merchant.name}: {publicAddress(merchant.address)}</div>) : 'Not configured'}</dd></div>
      <div className="technical-item"><dt>Independent reader · run with API stopped</dt><dd className="technical-command">{snapshot?.ready ? `npm run quote -- --chain ${snapshot.network.chainId} --buyer ${snapshot.buyer.address} --record bnb-budget` : 'npm run quote -- --chain 31337 --record bnb-budget'}</dd></div>
      <div className="technical-item"><dt>Buyer balances · independent of mission budget</dt><dd>{snapshot?.ready ? `${money(snapshot.buyer.tokenBalance)} wBSC · ${gas(snapshot.buyer.gasBalance)} ${snapshot.mode === 'local' ? 'local ETH' : 'tBNB'}` : 'Connect the chain to read balances.'}</dd></div>
    </dl>
    <p className="technical-notice">Public addresses only. Eligibility is specific to this buyer, seller and service SKU, based on paid spend through this checkout. Payment and HTTP delivery are reported separately. {snapshot?.mode === 'local' ? 'This is a local-chain demonstration; no BSC testnet deployment is claimed.' : 'Test currency has no monetary value.'}</p>
  </section>;
}
function EventFeed({ run, snapshot }: { run: Run | null; snapshot: Snapshot | null }) {
  return <section className="activity-section" aria-label="Mission activity">
    <div className="section-heading"><h2>Execution trace</h2><span className="live-indicator"><span className={`status-dot ${run?.status === 'failed' ? 'offline' : ''}`} />{run && ACTIVE.has(run.status) ? 'Live' : run ? 'Recorded' : 'Standing by'}</span></div>
    {run?.events.length ? <ol className="activity-list" aria-live="polite" aria-relevant="additions text">{run.events.map(event => <li className={`activity-item ${['confirmed', 'delivery'].includes(event.type) ? 'success' : event.type === 'error' ? 'error' : ''}`} key={event.id}>
      <span className="activity-dot" /><p className="event-title">{EVENT_TITLES[event.type]}<time dateTime={event.at}>{new Date(event.at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</time></p><p className="event-detail">{event.message}</p>{event.transactionHash && <div className="event-link"><ReceiptLink snapshot={snapshot} hash={event.transactionHash} /></div>}
    </li>)}</ol> : <div className="event-empty"><Icon name="activity" size={25} /><h3>Ready for a considered purchase.</h3><p>The agent will plan the request, compare its eligible prices, and pay only after you run the mission.</p></div>}
    <p className="planner-label"><Icon name="shield" size={13} />{(run?.plannerMode || snapshot?.planner.mode) === 'anthropic' ? 'AI plans the task. Code enforces the spend.' : 'Deterministic planner fallback · clearly labeled.'}</p>
  </section>;
}
function History({ snapshot }: { snapshot: Snapshot | null }) {
  const history = snapshot?.history.filter(order => order.recordId === snapshot.recordId && order.merchant.toLowerCase() === snapshot.merchants.find(m => m.id === 'a')?.address.toLowerCase() && order.buyer.toLowerCase() === snapshot.buyer.address.toLowerCase()) || [];
  const a = snapshot?.merchants.find(merchant => merchant.id === 'a');
  const historicalPaid = history.reduce((sum, order) => sum + BigInt(order.amount), 0n).toString();
  return <section className="history-section" aria-label="Service purchase history">
    <div className="history-header"><h2 className="section-title"><span className="section-index">03</span>This service’s returning buyer advantage</h2><p className="history-context">Confirmed purchases of this same service. Other service purchases do not count toward this tier.</p></div>
    <div className="history-layout">
      {history.length ? <div className="history-payments">{history.map((order: HistoryOrder, index) => <div className="history-payment" key={order.orderId}>
        <div className="payment-label"><span className="payment-check"><Icon name="check" size={10} /></span>Purchase {index + 1}</div><div className="payment-amount">{money(order.amount)} <small>wBSC</small></div><ReceiptLink snapshot={snapshot} hash={order.transactionHash} /><p className="payment-record">{TITLES[order.recordId] || order.recordId}</p>
      </div>)}</div> : <div className="history-empty">{snapshot?.ready ? 'No prepared payments found for this buyer. Run the seed command to establish genuine purchase history.' : 'Connect the checkout to read verifiable historical purchases.'}</div>}
      <div className="history-total"><div className="history-total-number">{snapshot?.ready ? money(a?.priorPaid) : '—'}<small>wBSC paid for this service at Seller A</small></div><div className="history-total-caption"><strong>{a?.appliedBps ? `${a.appliedBps / 100}% customer discount unlocked` : 'Merchant-defined loyalty'}</strong>{history.length ? `${money(historicalPaid)} wBSC paid for this service. No reward token; the seller accepts less revenue.` : 'A lower checkout price, funded by the merchant.'}</div></div>
    </div>
  </section>;
}
function DataResult({ result, snapshot }: { result?: TaskResult; snapshot: Snapshot | null }) {
  if (!result) return <div className="result-placeholder"><Icon name="data" size={22} /><span><strong>The useful part comes after payment.</strong> The requested research record will appear here when the service returns it.</span></div>;
  if (!result.data) return <section className="result-section"><div><p className="result-overline">Payment confirmed · delivery {result.deliveryStatus}</p><h2 className="result-title">Paid. Awaiting the record.</h2><p className="result-description">{result.error || 'The service has not returned this record. Payment evidence is retained; a delivery failure does not undo the payment.'}</p></div><div><p className="result-description">{money(result.amount)} wBSC paid to Seller {result.merchantId.toUpperCase()}.</p><ReceiptLink snapshot={snapshot} hash={result.transactionHash} /></div></section>;
  const data = result.data;
  return <section className="result-section" aria-label="Returned research record">
    <div><p className="result-overline"><Icon name="check" size={13} />Payment confirmed / data returned</p><h2 className="result-title">{data.title}</h2><p className="result-description">Fixed demo corpus · recorded {new Date(data.corpusTimestamp).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}. Served by Seller {result.merchantId.toUpperCase()} against a verified paid order.</p><p className="result-description">Seller received {money(result.amount)} wBSC from the agent wallet.</p><ReceiptLink snapshot={snapshot} hash={result.transactionHash} /><a className="result-source" href={data.sourceUrl} target="_blank" rel="noreferrer">Read source record<Icon name="external" size={11} /></a></div>
    <dl className="result-facts">{data.facts.map((fact, index) => <div className="result-fact" key={index}><dt>Source fact {String(index + 1).padStart(2, '0')}</dt><dd>{fact}</dd></div>)}</dl>
  </section>;
}
export function DemoLab() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [run, setRun] = useState<Run | null>(null);
  const [mission, setMission] = useState(DEFAULT_MISSION);
  const [budget, setBudget] = useState('0.06');
  const [loading, setLoading] = useState(true);
  const [connectionError, setConnectionError] = useState('');
  const [actionError, setActionError] = useState('');
  const [actionBusy, setActionBusy] = useState<'run' | 'stop' | 'scenario' | null>(null);
  const [fresh, setFresh] = useState(false);
  const [technical, setTechnical] = useState(false);
  const [scenarioOpen, setScenarioOpen] = useState(false);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const mounted = useRef(true);
  const pendingRequest = useRef<{ key: string; payload: string } | null>(null);
  const contextRef = useRef<string | null>(null);
  const refresh = useCallback(async () => {
    try {
      const next = await api<Snapshot>('/api/state');
      if (!mounted.current) return;
      const context = [next.network.chainId, next.checkoutAddress, next.buyer.address].join(':');
      const changed = contextRef.current !== null && contextRef.current !== context;
      contextRef.current = context;
      setSnapshot(next); setConnectionError(''); setUpdatedAt(new Date());
      if (changed) { setRun(next.latestRun ?? null); pendingRequest.current = null; }
      else if (next.latestRun) setRun(current => !current || next.latestRun!.updatedAt >= current.updatedAt ? next.latestRun! : current);
    } catch (error) { if (mounted.current) setConnectionError(error instanceof Error ? error.message : 'Cannot reach the local API.'); }
    finally { if (mounted.current) setLoading(false); }
  }, []);
  useEffect(() => { mounted.current = true; void refresh(); const timer = window.setInterval(() => void refresh(), 6000); return () => { mounted.current = false; window.clearInterval(timer); }; }, [refresh]);
  const active = !!run && ACTIVE.has(run.status);
  useEffect(() => {
    if (!run || !ACTIVE.has(run.status)) return;
    let pending = false; let cancelled = false;
    const poll = async () => { if (pending) return; pending = true; try { const next = await api<Run>(`/api/runs/${encodeURIComponent(run.id)}`); if (!cancelled) { setRun(next); setConnectionError(''); if (!ACTIVE.has(next.status)) void refresh(); } } catch (error) { if (!cancelled) setConnectionError(error instanceof Error ? error.message : 'Mission polling interrupted.'); } finally { pending = false; } };
    const timer = window.setInterval(() => void poll(), 1000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [run?.id, active, refresh]);
  const ready = !!snapshot?.ready;
  const units = parseBudget(budget);
  const maxUnits = snapshot?.maxSpendUnits || '300000';
  const budgetError = !units || BigInt(units) <= 0n ? 'Enter a positive budget with up to six decimals.' : BigInt(units) > BigInt(maxUnits) ? `The owner ceiling is ${money(maxUnits)} wBSC.` : '';
  const items: (MerchantSnapshot | Quote)[] = ready ? fresh ? snapshot!.freshQuotes : snapshot!.merchants : [];
  const quoteAmount = (quote: MerchantSnapshot | Quote) => 'price' in quote ? quote.price : quote.amount;
  const sorted = [...items].sort((a, b) => { const first = BigInt(quoteAmount(a)); const second = BigInt(quoteAmount(b)); return first < second ? -1 : first > second ? 1 : ('address' in a ? a.address : a.merchant).localeCompare('address' in b ? b.address : b.merchant); });
  const winner = sorted[0];
  const winnerId = winner ? ('id' in winner ? winner.id : winner.merchantId) : undefined;
  const winnerPrice = winner ? quoteAmount(winner) : undefined;
  const result = run?.results.at(-1);
  const spent = run?.spent || '0';
  const cap = run?.maxSpend || units || '60000';
  const remaining = run?.remaining || units || '60000';
  const ratio = BigInt(cap) > 0n ? Math.min(1, Number(BigInt(spent) * 10000n / BigInt(cap)) / 10000) : 0;
  const gasPaid = run?.gasSpent ?? run?.results.reduce((sum, item) => sum + BigInt(item.gasCost), 0n).toString() ?? '0';
  const latestSavings = result ? (BigInt(result.basePrice) - BigInt(result.amount)).toString() : undefined;
  async function runMission(event: React.FormEvent) {
    event.preventDefault(); if (!ready || budgetError || !mission.trim() || actionBusy || active) return;
    setActionBusy('run'); setActionError(''); setFresh(false);
    try { const payload = JSON.stringify({ mission: mission.trim(), maxSpend: units }); if (pendingRequest.current?.payload !== payload) pendingRequest.current = { key: crypto.randomUUID(), payload }; const next = await api<Run>('/api/runs', { method: 'POST', headers: { 'Idempotency-Key': pendingRequest.current!.key }, body: payload }); setRun(next); pendingRequest.current = null; }
    catch (error) { setActionError(error instanceof Error ? error.message : 'The mission could not start.'); }
    finally { setActionBusy(null); }
  }
  async function stopMission() {
    if (!run || !active || actionBusy) return; setActionBusy('stop'); setActionError('');
    try { const next = await api<Run>(`/api/runs/${encodeURIComponent(run.id)}/stop`, { method: 'POST', body: '{}' }); setRun(next); }
    catch (error) { setActionError(error instanceof Error ? error.message : 'Could not stop the mission.'); }
    finally { setActionBusy(null); }
  }
  async function changeScenario(price: string) {
    if (!ready || active || actionBusy) return; setActionBusy('scenario'); setActionError('');
    try { const next = await api<Snapshot>('/api/scenario', { method: 'POST', body: JSON.stringify({ recordId: snapshot!.recordId, sellerBPrice: price }) }); setSnapshot(next); setUpdatedAt(new Date()); }
    catch (error) { setActionError(error instanceof Error ? error.message : 'The offer could not be updated.'); }
    finally { setActionBusy(null); }
  }
  const sellerB = snapshot?.merchants.find(item => item.id === 'b');
  const network = snapshot?.mode === 'local' ? `Local chain · ${snapshot.network.chainId}` : snapshot?.mode === 'bsc-testnet' ? 'BNB Smart Chain · testnet' : 'Chain not configured';
  return <>
    {connectionError && snapshot && <div className="connection-bar" role="status">Connection interrupted. Last verified values are shown; spending is paused until the API reconnects.</div>}
    <div className="app-shell">
      <header className="topbar"><a className="brand" href="/" aria-label="Repeat home"><RepeatMark />Repeat<span className="brand-period">.</span></a><div className="topbar-right"><span className="network-badge"><span className={`status-dot ${!ready || connectionError ? 'offline' : ''}`} />{network}</span><button className="text-button" onClick={() => setTechnical(value => !value)} aria-expanded={technical} aria-controls="public-evidence">Public evidence <Icon name="terminal" size={14} /></button></div></header>
      <div className="intro"><div><p className="eyebrow">Loyalty-aware agent commerce</p><h1>The returning buyer <em>advantage.</em></h1></div><p className="intro-note">The same request. A better earned price.<br /><strong>Verified history. Bounded spending.</strong></p></div>
      {technical && <div id="public-evidence"><TechnicalPanel snapshot={snapshot} onClose={() => setTechnical(false)} /></div>}
      {!ready && !loading && <div className="setup-banner" role="status"><div><strong>{snapshot ? 'Connect the checkout to begin.' : 'The console is ready. Start the local API.'}</strong><p>{snapshot?.error || connectionError || 'Deploy and configure the contracts, fund the demo buyer, and seed its genuine paid history.'}</p><code>{snapshot ? 'npm run setup:local' : 'npm run dev:api'}</code><p>Run from the app directory. Then refresh this connection.</p></div><button className="text-button" onClick={() => void refresh()}><Icon name="refresh" size={13} />Retry</button></div>}
      {actionError && <div className="error-banner" role="alert"><div><strong>The action needs attention.</strong><p>{actionError}</p></div><button className="text-button" aria-label="Dismiss action error" onClick={() => setActionError('')}><Icon name="close" size={14} /></button></div>}
      <main className="workspace-grid" aria-busy={loading}>
        <form className="mission-panel" onSubmit={event => void runMission(event)}>
          <div className="panel-kicker"><label className="section-number" htmlFor="mission"><span>01</span>Your mission</label><span className="small-tag">Owner-approved budget</span></div>
          <textarea id="mission" className="mission-input" value={mission} onChange={event => setMission(event.target.value)} maxLength={1000} disabled={active || !!actionBusy} aria-describedby="mission-safety" />
          <div className="mission-bottom"><div className="budget-field"><label className="field-label" htmlFor="budget">Maximum spend</label><div className="budget-input-line"><input id="budget" type="text" inputMode="decimal" value={budget} onChange={event => setBudget(event.target.value)} aria-invalid={!!budgetError} aria-describedby={budgetError ? 'budget-error' : undefined} disabled={active || !!actionBusy} /><span>wBSC</span></div></div><button className="primary-button" disabled={!ready || loading || !!connectionError || active || !!actionBusy || !!budgetError || !mission.trim()} type="submit">{actionBusy === 'run' ? 'Planning mission' : active ? 'Mission in progress' : run ? 'Run new mission' : 'Run mission'}<Icon name={active || actionBusy === 'run' ? 'refresh' : 'arrow'} className={active || actionBusy === 'run' ? 'spinner' : ''} /></button></div>
          {budgetError && <p className="mission-error" id="budget-error">{budgetError}</p>}
          <p className="mission-footnote" id="mission-safety"><Icon name="shield" size={11} />{money(maxUnits)} wBSC owner ceiling. Only requested work; no purchases to farm a tier.</p>
          <p className="mission-footnote wallet-holding"><Icon name="data" size={11} />Agent wallet holds {ready ? money(snapshot!.buyer.tokenBalance) : '—'} wBSC · actual ERC-20 balance</p>
        </form>
        <section className="budget-panel" aria-label="Mission budget">
          <div className="section-heading"><h2>{run ? 'Latest mission budget' : 'Mission budget'}</h2><span className="budget-status"><span className={`status-dot ${run?.status === 'failed' ? 'offline' : ''}`} />{run ? run.status.charAt(0).toUpperCase() + run.status.slice(1) : 'Awaiting approval'}</span></div>
          <div className="accounting"><div className="accounting-item"><span className="accounting-label">Spending cap</span><strong className="accounting-value">{money(cap)}</strong><span className="accounting-currency">wBSC</span></div><div className="accounting-item"><span className="accounting-label">Confirmed spend</span><strong className="accounting-value">{money(spent)}</strong><span className="accounting-currency">wBSC</span></div><div className="accounting-item"><span className="accounting-label">Remaining</span><strong className="accounting-value">{money(remaining)}</strong><span className="accounting-currency">wBSC</span></div></div>
          <div className="budget-track" aria-hidden="true"><span className="budget-track-fill" style={{ width: '100%', transform: `scaleX(${ratio})` }} /></div>
          <div className="accounting-details"><span>Gas, separately: <strong>{gas(gasPaid)} {snapshot?.mode === 'local' ? 'local ETH' : 'tBNB'}</strong></span>{active ? <button className="stop-button" type="button" onClick={() => void stopMission()} disabled={!!actionBusy}><Icon name="stop" size={11} />{actionBusy === 'stop' ? 'Stopping…' : 'Stop mission'}</button> : <span>{result ? `Gross discount: ${money(latestSavings)} wBSC` : 'No payment authorized yet'}</span>}</div>
          {run?.status === 'completed' && <p className="run-outcome">Requested work complete. Remaining budget stays with the buyer.</p>}{run?.error && <p className="run-outcome failed">{run.error}</p>}
        </section>
        <section className="quotes-section" aria-label="Competing eligible prices">
          <div className="quotes-header"><h2 className="section-title"><span className="section-index">02</span>Same record. Your price.</h2><div className="buyer-toggle" aria-label="Wallet quote preview"><button type="button" className={!fresh ? 'active' : ''} aria-pressed={!fresh} onClick={() => setFresh(false)}>Returning buyer</button><button type="button" className={fresh ? 'active' : ''} aria-pressed={fresh} onClick={() => setFresh(true)} disabled={!ready}>Fresh wallet</button></div></div>
          <div className={`quote-grid ${actionBusy === 'scenario' ? 'quote-loading' : ''}`}><QuoteCard item={items.find(item => ('id' in item ? item.id : item.merchantId) === 'a')} winner={winnerId === 'a'} ready={ready} /><QuoteCard item={items.find(item => ('id' in item ? item.id : item.merchantId) === 'b')} winner={winnerId === 'b'} ready={ready} /></div>
          <div className="decision-bar"><span className="decision-icon"><Icon name="arrow" size={15} /></span><span>{winner ? <><strong>{fresh ? 'Fresh wallet' : 'Returning buyer'} chooses Seller {winnerId?.toUpperCase()}.</strong> {money(winnerPrice)} wBSC is the lowest eligible price{fresh ? ' with no prior history.' : ' for this record.'}</> : loading ? 'Reading eligible prices from the checkout…' : 'Connect the checkout to compare verified customer prices.'}</span></div>
          <p className="quote-context">{TITLES[snapshot?.recordId || 'bnb-budget']} · fixed demo corpus · equivalent service schema{ready ? ` · buyer ${short(fresh ? snapshot?.freshQuotes[0]?.buyer : snapshot?.buyer.address)}` : ''}. {fresh ? 'Read-only preview; this wallet will not pay.' : 'Quotes are refreshed before each purchase.'}</p>
          <div className="scenario-controls"><button className="scenario-button" type="button" onClick={() => setScenarioOpen(value => !value)} aria-expanded={scenarioOpen} disabled={!ready || active || !!actionBusy || !!connectionError}><Icon name={actionBusy === 'scenario' ? 'refresh' : 'refresh'} size={11} className={actionBusy === 'scenario' ? 'spinner' : ''} />{actionBusy === 'scenario' ? 'Confirming competitor offer…' : 'Change competitor offer'}<Icon name="chevron" size={10} /></button>{scenarioOpen && <div className="scenario-options" aria-label="Seller B on-chain price">{['45000', '35000', '55000'].map(price => <button type="button" onClick={() => void changeScenario(price)} key={price} aria-label={`Set Seller B price to ${money(price)} wBSC`} disabled={active || !!actionBusy} aria-pressed={sellerB?.basePrice === price}>{money(price)}</button>)}</div>}<span className="data-freshness">{updatedAt ? `Verified ${updatedAt.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}` : 'Waiting for chain'}</span></div>
          {scenarioOpen && <p className="quote-context">Updates Seller B’s offer on-chain. Quote preview only; a new purchase requires a new mission.</p>}
        </section>
        <EventFeed run={run} snapshot={snapshot} />
        <History snapshot={snapshot} />
        <DataResult result={result} snapshot={snapshot} />
      </main>
      <footer className="bottom-bar"><p>Test currency · fixed research corpus · builder-operated sellers · merchant-funded discounts<br />{snapshot?.mode === 'local' ? 'Local chain demonstration. BSC testnet deployment is a separate configuration.' : snapshot?.mode === 'bsc-testnet' ? 'BNB Smart Chain testnet demonstration. No reward token.' : 'Awaiting network configuration. No reward token.'}</p><span className="footer-brand"><RepeatMark small />Benefits earned. Prices enforced.</span></footer>
    </div>
  </>;
}

export default function App() {
  const [demoLab, setDemoLab] = useState(false);
  if (!demoLab) return <Marketplace onOpenDemoLab={() => setDemoLab(true)} />;
  return <><div className="demo-lab-banner"><span><strong>Demo lab</strong> · Scripted builder wallets and prepared history. These actions use the separate demo agent wallet.</span><button type="button" onClick={() => setDemoLab(false)}>← Back to marketplace</button></div><DemoLab /></>;
}
