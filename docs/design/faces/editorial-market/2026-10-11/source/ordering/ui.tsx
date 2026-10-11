import { createContext, useContext, useEffect, useMemo, useReducer, useRef, useState, type ReactNode } from 'react';
import { Overlay } from '../face';
import { ConciergeBell, CreditCard, Droplets, Hand, MessageSquare, Plus, ReceiptText, Utensils } from 'lucide-react';
import type { Locale, ViewItem } from '../types';
import { bagCount, bagReducer, bagTotal, lineTotal, myItemsTotal, needsChoices, orderable, selectionOptions, selectionValid, sendBag, splitEqually, tabTotal, tipAmount, toggleOption, unitTotal, vatIncluded, groupValid, type BagAction, type BagLine, type Selection, type TabRound } from './logic';
import { orderStrings, type OrderStrings } from './strings';

export type ServerRequest = { kind: 'waiter' | 'bill' | 'water' | 'cutlery' | 'terminal' | 'other'; note: string };
export type PayRequest = { amountMinor: number; tipMinor: number; method: 'apple' | 'google' | 'card' | 'waiter'; scope: 'full' | 'split' | 'mine' };
export type OrderingConfig = {
  formatMoney: (minor: number) => string;
  tab?: TabRound[];
  vatRate?: number;
  venueName?: string;
  tableLabel?: string;
  onSend?: (lines: BagLine[]) => void;
  onCallServer?: (r: ServerRequest) => void;
  onPay?: (r: PayRequest) => Promise<boolean> | boolean;
};
type Sheet = 'bag' | 'tab' | 'call' | 'pay' | 'receipt';
type Ctx = { cfg: OrderingConfig; s: OrderStrings; locale: Locale; bag: BagLine[]; dispatch: (a: BagAction) => void; rounds: TabRound[]; send: () => void; open: (x: Sheet, replace?: boolean) => void; close: () => void; sheet: Sheet | null; editing: BagLine | null; setEditing: (l: BagLine | null) => void; paid: PaidInfo | null; setPaid: (p: PaidInfo) => void; money: (n: number) => string; openItem: (id: string) => void };
type PaidInfo = PayRequest & { at: string; ref: string };
const OrderCtx = createContext<Ctx | null>(null);
export const useOrdering = () => useContext(OrderCtx);

const SHEETS: Sheet[] = ['bag', 'tab', 'call', 'pay', 'receipt'];
const nowTime = (l: Locale) => new Date().toLocaleTimeString(l.replace('_', '-'), { hour: '2-digit', minute: '2-digit', hour12: false });

export function OrderingProvider({ cfg, locale, children, openItem }: { cfg?: OrderingConfig | null; locale: Locale; children: ReactNode; openItem: (id: string) => void }) {
  const [bag, dispatch] = useReducer(bagReducer, []);
  const [sent, setSent] = useState<TabRound[]>([]);
  const [sheet, setSheet] = useState<Sheet | null>(null);
  const [editing, setEditing] = useState<BagLine | null>(null);
  const [paid, setPaid] = useState<PaidInfo | null>(null);
  useEffect(() => {
    const read = () => { const h = window.location.hash.slice(1) as Sheet; setSheet(SHEETS.includes(h) ? h : null); };
    read(); window.addEventListener('popstate', read); return () => window.removeEventListener('popstate', read);
  }, []);
  useEffect(() => { if (!sheet) return; const k = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); }; window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k); }, [sheet]);
  if (!cfg) return <>{children}</>;
  const open = (x: Sheet, replace = false) => { const fn = replace || sheet ? 'replaceState' : 'pushState'; window.history[fn]({ rmSheet: x }, '', `#${x}`); setSheet(x); };
  function close() { if ((window.history.state as { rmSheet?: string } | null)?.rmSheet) window.history.back(); else { window.history.replaceState(null, '', window.location.pathname + window.location.search); } setSheet(null); }
  const rounds = [...(cfg.tab ?? []), ...sent];
  const send = () => { cfg.onSend?.(bag); setSent(r => sendBag(r, bag, `app-${Date.now()}`, nowTime(locale))); dispatch({ type: 'clear' }); open('tab', true); };
  const value: Ctx = { cfg, s: orderStrings(locale), locale, bag, dispatch, rounds, send, open, close, sheet, editing, setEditing, paid, setPaid, money: cfg.formatMoney, openItem };
  return <OrderCtx.Provider value={value}>{children}<OrderingLayer /></OrderCtx.Provider>;
}


export function OrderingHeaderButtons() {
  const o = useOrdering(); if (!o) return null;
  const n = o.rounds.reduce((s, r) => s + r.lines.length, 0);
  return <>
    <button type="button" className="ro-pill" onClick={() => o.open('tab')} aria-label={o.s.tab}><ReceiptText aria-hidden="true" /><span><span className="ro-billword">{o.s.bill}{n > 0 ? ' · ' : ''}</span>{n > 0 ? o.money(tabTotal(o.rounds)) : ''}</span></button>
  </>;
}

export function Stepper({ value, onChange, label, min = 0, size = 'md' }: { value: number; onChange: (n: number) => void; label: string; min?: number; size?: 'sm' | 'md' }) {
  const o = useOrdering(); const s = o?.s ?? orderStrings('en_US');
  return <div className={`ro-stepper is-${size}`} role="group" aria-label={`${s.quantity}: ${label}`}>
    <button type="button" onClick={() => onChange(value - 1)} disabled={value <= min} aria-label={`${s.decrease} — ${label}`}>−</button>
    <output key={value} aria-live="polite">{value}</output>
    <button type="button" onClick={() => onChange(value + 1)} aria-label={`${s.increase} — ${label}`}>+</button>
  </div>;
}

export function QuickAdd({ item }: { item: ViewItem }) {
  const o = useOrdering(); if (!o || !orderable(item) || !item.price) return null;
  const simple = o.bag.find(l => l.itemId === item.id && !l.options.length && !l.note);
  const total = o.bag.filter(l => l.itemId === item.id).reduce((s, l) => s + l.qty, 0);
  if (simple && !needsChoices(item)) return <div className="ro-quick"><Stepper size="sm" value={simple.qty} label={item.name.text} onChange={n => o.dispatch({ type: 'qty', key: simple.key, delta: n - simple.qty })} /></div>;
  return <div className="ro-quick"><button type="button" className="ro-plus" aria-label={o.s.addNamed(item.name.text)} onClick={() => needsChoices(item) ? o.openItem(item.id) : o.dispatch({ type: 'add', line: { itemId: item.id, name: item.name.text, qty: 1, unitMinor: item.price!.minor, options: [], note: '' } })}><Plus aria-hidden="true" strokeWidth={2.4} />{total > 0 && <span className="ro-plus-count">{total}</span>}</button></div>;
}

export function DishOrder({ item, onDone }: { item: ViewItem; onDone: () => void }) {
  const o = useOrdering();
  const edit = o?.editing?.itemId === item.id ? o.editing : null;
  const [sel, setSel] = useState<Selection>(() => { const x: Selection = {}; edit?.options.forEach(op => { (x[op.groupId] ??= []).push(op.optionId); }); return x; });
  const [qty, setQty] = useState(edit?.qty ?? 1); const [note, setNote] = useState(edit?.note ?? ''); const [tried, setTried] = useState(false);
  if (!o || !item.price) return null;
  const options = selectionOptions(item.modifierGroups, sel); const valid = selectionValid(item.modifierGroups, sel);
  const can = orderable(item); const price = unitTotal({ unitMinor: item.price.minor, options }) * qty;
  const add = () => { if (!valid) { setTried(true); return; } const line = { itemId: item.id, name: item.name.text, qty, unitMinor: item.price!.minor, options, note }; o.dispatch(edit ? { type: 'replace', key: edit.key, line } : { type: 'add', line }); o.setEditing(null); onDone(); };
  return <div className="ro-dish">
    {item.modifierGroups.map(g => { const picked = sel[g.id] ?? []; const bad = tried && !groupValid(g, picked); const req = g.required || g.min > 0;
      return <fieldset key={g.id} className={`ro-group ${bad ? 'is-invalid' : ''}`}><legend><span>{g.name.text}</span><small>{req ? o.s.required : o.s.optional} · {g.max === 1 ? o.s.pickOne : g.max > 1 ? o.s.pickUpTo(g.max) : o.s.pickAtLeast(Math.max(1, g.min))}</small></legend>
        <div className="ro-options">{g.options.map(op => <button type="button" key={op.id} role={g.max === 1 ? 'radio' : 'checkbox'} aria-checked={picked.includes(op.id)} onClick={() => setSel({ ...sel, [g.id]: toggleOption(g, picked, op.id) })}><span>{op.name.text}</span>{op.delta && <b>{op.delta.text}</b>}<i aria-hidden="true" /></button>)}</div></fieldset>; })}
    <label className="ro-note"><span>{o.s.note}</span><textarea rows={2} value={note} placeholder={o.s.notePlaceholder} onChange={e => setNote(e.target.value)} /></label>
    {can && <div className="ro-dish-bar"><Stepper value={qty} min={1} onChange={setQty} label={item.name.text} /><button type="button" className="ro-primary" onClick={add} aria-disabled={!valid}><span>{o.s.addToBag}</span><b key={price}>{o.money(price)}</b></button></div>}
  </div>;
}

export function BagBar() {
  const o = useOrdering(); if (!o || o.sheet) return null; const has = o.bag.length > 0;
  return <div className="ro-bagbar" data-bag={has ? 'true' : 'false'}><button type="button" className="ro-waiter" onClick={() => o.open('call')} aria-label={o.s.callServer}><Hand aria-hidden="true" /><span>{o.s.bell}</span></button>{has && <button type="button" className="ro-bagbtn" onClick={() => o.open('bag')}><span className="ro-count" key={bagCount(o.bag)}>{bagCount(o.bag)}</span><span>{o.s.viewBag}</span><b>{o.money(bagTotal(o.bag))}</b></button>}</div>;
}

function OrderingLayer() {
  const o = useOrdering()!;
  return <><BagBar />
    {o.sheet === 'bag' && <Overlay title={o.s.bag} close={o.s.close} onClose={o.close}><BagSheet /></Overlay>}
    {o.sheet === 'tab' && <Overlay title={o.s.tab} close={o.s.close} onClose={o.close}><LiveTab /></Overlay>}
    {o.sheet === 'call' && <Overlay title={o.s.callServer} close={o.s.close} onClose={o.close}><CallServer /></Overlay>}
    {o.sheet === 'pay' && <Overlay title={o.s.payTitle} close={o.s.close} onClose={o.close}><PaymentFlow /></Overlay>}
    {o.sheet === 'receipt' && <Overlay title={o.s.receipt} close={o.s.close} onClose={o.close} detail><div className="ro-page"><h2>{o.s.receipt}</h2><Receipt /></div></Overlay>}
  </>;
}

function BagSheet() {
  const o = useOrdering()!;
  if (!o.bag.length) return <p className="ro-empty">{o.s.emptyBag}</p>;
  return <div className="ro-sheet">
    <ul className="ro-lines">{o.bag.map(l => <li key={l.key}>
      <div className="ro-line-main"><strong>{l.name}</strong>{l.options.length > 0 && <small>{l.options.map(x => x.name).join(' · ')}</small>}{l.note && <small>“{l.note}”</small>}
        <div className="ro-line-actions"><button type="button" onClick={() => { o.setEditing(l); o.close(); window.setTimeout(() => o.openItem(l.itemId), 30); }}>{o.s.edit}</button><button type="button" onClick={() => o.dispatch({ type: 'remove', key: l.key })}>{o.s.remove}</button></div></div>
      <div className="ro-line-side"><b>{o.money(lineTotal(l))}</b><Stepper size="sm" value={l.qty} label={l.name} onChange={n => o.dispatch({ type: 'qty', key: l.key, delta: n - l.qty })} /></div>
    </li>)}</ul>
    <div className="ro-sum"><span>{o.s.subtotal}</span><b>{o.money(bagTotal(o.bag))}</b></div>
    <button type="button" className="ro-primary is-wide" onClick={o.send}><span>{o.s.sendToKitchen}</span><b>{o.money(bagTotal(o.bag))}</b></button>
  </div>;
}

function LiveTab() {
  const o = useOrdering()!; const total = tabTotal(o.rounds);
  return <div className="ro-sheet"><p className="rm-overlay-intro">{o.s.tabIntro}</p>
    {!o.rounds.length ? <p className="ro-empty">{o.s.emptyTab}</p> : o.rounds.map((r, i) => <section key={r.id} className="ro-round" data-source={r.source}>
      <header><span>{o.s.round} {i + 1} · {r.time}</span><em>{r.source === 'app' ? o.s.fromApp : o.s.fromWaiter}</em></header>
      <ul>{r.lines.map(l => <li key={l.id}><span className="ro-qty">{l.qty}×</span><span className="ro-tabname">{l.name}{l.options?.length ? <small>{l.options.join(' · ')}</small> : null}</span><span className="ro-status" data-status={l.status}>{o.s[l.status]}</span><b>{o.money(l.totalMinor)}</b></li>)}</ul>
    </section>)}
    <div className="ro-sum is-big"><span>{o.s.tableTotal}</span><b>{o.money(total)}</b></div>
    {o.paid && <button type="button" className="ro-ghost" onClick={() => o.open('receipt', true)}>{o.s.viewReceipt}</button>}
    {total > 0 && <button type="button" className="ro-primary is-wide" onClick={() => o.open('pay', true)}><span>{o.s.pay}</span><b>{o.money(total)}</b></button>}
  </div>;
}

function CallServer() {
  const o = useOrdering()!; const [kind, setKind] = useState<ServerRequest['kind'] | null>(null); const [note, setNote] = useState(''); const [sent, setSent] = useState(false);
  const opts: [ServerRequest['kind'], string, ReactNode][] = [['waiter', o.s.callWaiter, <ConciergeBell key="i" aria-hidden="true" />], ['bill', o.s.bringBill, <ReceiptText key="i" aria-hidden="true" />], ['terminal', o.s.terminal, <CreditCard key="i" aria-hidden="true" />], ['water', o.s.water, <Droplets key="i" aria-hidden="true" />], ['cutlery', o.s.cutlery, <Utensils key="i" aria-hidden="true" />], ['other', o.s.other, <MessageSquare key="i" aria-hidden="true" />]];
  if (sent) return <div className="ro-state" role="status"><span className="ro-pulse" aria-hidden="true" /><h3>{o.s.waiterComing}</h3><p>{o.s.waiterComingHint}</p><button type="button" className="ro-ghost" onClick={() => { setSent(false); setKind(null); }}>{o.s.cancelRequest}</button></div>;
  return <div className="ro-sheet"><div className="ro-choicegrid" role="radiogroup" aria-label={o.s.callServer}>{opts.map(([k, l, ic]) => <button type="button" key={k} role="radio" aria-checked={kind === k} onClick={() => setKind(k)}>{ic}<span>{l}</span></button>)}</div>
    {kind === 'other' && <label className="ro-note"><span className="rm-sr">{o.s.other}</span><textarea rows={2} value={note} placeholder={o.s.otherPlaceholder} onChange={e => setNote(e.target.value)} /></label>}
    <button type="button" className="ro-primary is-wide" disabled={!kind || (kind === 'other' && !note.trim())} onClick={() => { o.cfg.onCallServer?.({ kind: kind!, note }); setSent(true); }}><span>{o.s.send}</span></button></div>;
}

function PaymentFlow() {
  const o = useOrdering()!; const full = tabTotal(o.rounds); const mine = myItemsTotal(o.rounds);
  const [scope, setScope] = useState<PayRequest['scope']>('full'); const [people, setPeople] = useState(2); const [tipPct, setTipPct] = useState<number | 'custom'>(10); const [custom, setCustom] = useState(''); const [promo, setPromo] = useState('');
  const [step, setStep] = useState<'choose' | 'processing' | 'success' | 'failure'>('choose'); const last = useRef<PayRequest | null>(null);
  const base = scope === 'full' ? full : scope === 'split' ? splitEqually(full, people) : mine;
  const tip = tipPct === 'custom' ? Math.round((parseFloat(custom.replace(',', '.')) || 0) * 100) : tipAmount(base, tipPct);
  const total = base + tip;
  const pay = async (method: PayRequest['method']) => { const r = { amountMinor: total, tipMinor: tip, method, scope }; last.current = r; setStep('processing'); const ok = await (o.cfg.onPay?.(r) ?? true); if (ok) { o.setPaid({ ...r, at: new Date().toLocaleString(o.locale.replace('_', '-')), ref: `FR-${Date.now().toString().slice(-8)}` }); setStep('success'); } else setStep('failure'); };
  if (step === 'processing') return <div className="ro-state" role="status"><span className="ro-spinner" aria-hidden="true" /><h3>{o.s.processing}</h3><b>{o.money(total)}</b></div>;
  if (step === 'success') return <div className="ro-state" role="status"><span className="ro-check" aria-hidden="true">✓</span><h3>{o.s.success}</h3><p>{o.s.successHint}</p><button type="button" className="ro-primary is-wide" onClick={() => o.open('receipt', true)}><span>{o.s.viewReceipt}</span></button><button type="button" className="ro-ghost" onClick={o.close}>{o.s.done}</button></div>;
  if (step === 'failure') return <div className="ro-state" role="alert"><span className="ro-check is-bad" aria-hidden="true">!</span><h3>{o.s.failure}</h3><p>{o.s.failureHint}</p><button type="button" className="ro-primary is-wide" onClick={() => last.current && pay(last.current.method)}><span>{o.s.retry}</span></button><button type="button" className="ro-ghost" onClick={() => setStep('choose')}>{o.s.payWith}</button></div>;
  const scopes: [PayRequest['scope'], string, number][] = [['full', o.s.fullTab, full], ['split', o.s.splitEqual, splitEqually(full, people)], ['mine', o.s.myItems, mine]];
  return <div className="ro-sheet">
    <h3 className="ro-h">{o.s.whatToPay}</h3>
    <div className="ro-scope" role="radiogroup" aria-label={o.s.whatToPay}>{scopes.map(([k, l, v]) => <button type="button" key={k} role="radio" aria-checked={scope === k} disabled={v <= 0} onClick={() => setScope(k)}><span>{l}</span><b>{o.money(v)}</b></button>)}</div>
    {scope === 'split' && <div className="ro-row"><span>{o.s.people}</span><Stepper value={people} min={2} onChange={setPeople} label={o.s.people} /><small>{o.money(splitEqually(full, people))} {o.s.perPerson}</small></div>}
    <h3 className="ro-h">{o.s.tip}</h3>
    <div className="ro-tips" role="radiogroup" aria-label={o.s.tip}>{([0, 5, 10, 15] as const).map(p => <button type="button" role="radio" key={p} aria-checked={tipPct === p} onClick={() => setTipPct(p)}>{p === 0 ? o.s.noTip : `${p}%`}</button>)}<button type="button" role="radio" aria-checked={tipPct === 'custom'} onClick={() => setTipPct('custom')}>{o.s.custom}</button></div>
    {tipPct === 'custom' && <label className="ro-input"><span className="rm-sr">{o.s.customTip}</span><input inputMode="decimal" value={custom} onChange={e => setCustom(e.target.value)} placeholder="0,00" /></label>}
    <details className="ro-acc"><summary>{o.s.promo}</summary><div className="ro-promo"><input value={promo} onChange={e => setPromo(e.target.value)} aria-label={o.s.promo} /><button type="button" className="ro-ghost">{o.s.apply}</button></div></details>
    <p className="ro-allergy">{o.s.allergyNote}</p>
    <div className="ro-sum is-big"><span>{o.s.total}</span><b key={total}>{o.money(total)}</b></div>
    <div className="ro-methods"><button type="button" className="ro-pay is-apple" onClick={() => pay('apple')}>{o.s.applePay}</button><button type="button" className="ro-pay" onClick={() => pay('google')}>{o.s.googlePay}</button><button type="button" className="ro-pay" onClick={() => pay('card')}>{o.s.card}</button><button type="button" className="ro-ghost" onClick={() => pay('waiter')}>{o.s.payWaiter}</button></div>
  </div>;
}

function Receipt() {
  const o = useOrdering()!; const [msg, setMsg] = useState(''); const p = o.paid; const rate = o.cfg.vatRate ?? 20;
  const lines = useMemo(() => o.rounds.flatMap(r => r.lines), [o.rounds]);
  if (!p) return <p className="ro-empty">{o.s.emptyTab}</p>;
  const net = p.amountMinor - p.tipMinor; const methods = { apple: o.s.applePay, google: o.s.googlePay, card: o.s.card, waiter: o.s.payWaiter };
  return <div className="ro-sheet"><article className="ro-receipt" aria-label={o.s.receipt}>
    <header><strong>{o.cfg.venueName ?? 'RESTRO'}</strong><span>{o.s.table} {o.cfg.tableLabel ?? ''}</span><span>{o.s.date}: {p.at}</span></header>
    {p.scope === 'full' && <ul>{lines.map(l => <li key={l.id}><span>{l.qty}× {l.name}</span><b>{o.money(l.totalMinor)}</b></li>)}</ul>}
    <dl><div><dt>{o.s.subtotal}</dt><dd>{o.money(net)}</dd></div><div><dt>{o.s.vat(rate)}</dt><dd>{o.money(vatIncluded(net, rate))}</dd></div><div><dt>{o.s.tip}</dt><dd>{o.money(p.tipMinor)}</dd></div><div className="is-total"><dt>{o.s.total}</dt><dd>{o.money(p.amountMinor)}</dd></div><div><dt>{o.s.method}</dt><dd>{methods[p.method]}</dd></div><div><dt>{o.s.fiscal}</dt><dd>{p.ref}</dd></div></dl>
  </article>
    <div className="ro-methods">{[o.s.downloadPdf, o.s.email, o.s.print].map(x => <button type="button" key={x} className="ro-ghost" onClick={() => setMsg(o.s.actionDone)}>{x}</button>)}</div>
    {msg && <p className="ro-toast" role="status">{msg}</p>}
  </div>;
}

export const ORDER_CSS = String.raw`
.rm .ro-plus{color:var(--rm-bg);cursor:pointer;transition:transform .18s ease,background .18s ease,color .18s ease,box-shadow .18s ease}.rm .ro-plus svg{width:22px;height:22px}.rm .ro-plus:focus-visible{outline:3px solid var(--rm-accent-text);outline-offset:3px}
@media (hover:hover){.rm .ro-plus:hover{background:var(--rm-accent);color:var(--rm-on-accent);transform:translateY(-2px);box-shadow:0 6px 16px color-mix(in srgb,var(--rm-text) 22%,transparent)}.rm .ro-stepper button:hover{background:var(--rm-accent);color:var(--rm-on-accent)}}
.rm .ro-pill{display:inline-flex;align-items:center;gap:6px;min-height:40px;padding:0 12px;border:1px solid color-mix(in srgb,var(--rm-bg) 30%,transparent);border-radius:999px;background:transparent;color:var(--rm-bg);font-size:12px;font-weight:800;white-space:nowrap;transition:background .18s,color .18s}.rm .ro-pill svg{width:17px;height:17px}@media (hover:hover){.rm .ro-pill:hover{background:var(--rm-bg);color:var(--rm-text)}}
.rm-headtools{flex-wrap:wrap;justify-content:flex-end}@media(max-width:380px){.rm .ro-pill{padding:0 9px;gap:4px;font-size:11px}.rm-headtools{gap:4px}}
.ro-choicegrid button{display:flex;align-items:center;gap:10px}.ro-choicegrid button svg{width:20px;height:20px;flex:none}
.ro-bagbar{gap:10px;animation:none}.rm .ro-bagbar button{animation:ro-up .34s cubic-bezier(.16,1,.3,1) both}.rm .ro-bagbar .ro-bagbtn{flex:1 1 auto;max-width:490px;width:auto}.rm .ro-bagbar .ro-waiter{display:flex;grid-template-columns:none;gap:8px;justify-content:center;flex:none;width:auto;min-width:58px;padding:0 20px;transition:padding .3s cubic-bezier(.16,1,.3,1),transform .12s}.rm .ro-waiter svg{width:20px;height:20px}.rm .ro-bagbar[data-bag="true"] .ro-waiter{width:58px;padding:0}.rm .ro-bagbar[data-bag="true"] .ro-waiter span{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0,0,0,0)}@media(hover:hover){.rm .ro-bagbar button:hover{background:color-mix(in srgb,var(--rm-text) 86%,var(--rm-accent))}}
.rm-layout{display:flex;gap:6px;padding:16px 20px 0}.rm-layout button{display:inline-flex;align-items:center;gap:6px;min-height:40px;padding:0 12px;border:1px solid var(--rm-border);border-radius:999px;background:transparent;color:var(--rm-muted);font-size:12px;font-weight:800;transition:background .18s,color .18s}.rm-layout button svg{width:16px;height:16px}.rm-layout button[aria-checked="true"]{background:var(--rm-text);color:var(--rm-bg);border-color:var(--rm-text)}@media(hover:hover){.rm-layout button:hover{color:var(--rm-text);border-color:var(--rm-text)}.rm-layout button[aria-checked="true"]:hover{color:var(--rm-bg)}}
.rm[data-layout="two"] .rm-section:not(.is-feature)>.rm-items{grid-template-columns:repeat(2,minmax(0,1fr));column-gap:14px}.rm[data-layout="two"] .rm-section:not(.is-feature) .rm-item.is-text{grid-column:1/-1}.rm[data-layout="two"] .rm-section:not(.is-feature) .rm-item.has-photo{padding:14px 0 28px}.rm[data-layout="two"] .rm-section:not(.is-feature) .rm-item.has-photo .rm-photo{padding:8px}.rm[data-layout="two"] .rm-section:not(.is-feature) .rm-item.has-photo .rm-photo img{aspect-ratio:1/1}.rm[data-layout="two"] .rm-section:not(.is-feature) .rm-item.has-photo h3{font-size:15px;line-height:1.15}.rm[data-layout="two"] .rm-section:not(.is-feature) .rm-item.has-photo .rm-item-copy{padding-top:12px}.rm[data-layout="two"] .rm-section:not(.is-feature) .rm-item.has-photo .rm-description{font-size:12.5px}.rm[data-layout="two"] .rm-section:not(.is-feature) .rm-chevron{display:none}.rm[data-layout="two"] .rm-section:not(.is-feature) .ro-quick{margin-top:10px;justify-content:flex-start}.rm[data-layout="two"] .rm-section:not(.is-feature) .rm-modifiers,.rm[data-layout="two"] .rm-section:not(.is-feature) .rm-extra{display:none}
.rm[data-layout="list"] .rm-section:not(.is-feature) .rm-item.has-photo{display:grid;grid-template-columns:minmax(0,1fr) 96px;gap:14px;padding:18px 0;border-top:1px solid var(--rm-border)}.rm[data-layout="list"] .rm-section:not(.is-feature) .rm-item.has-photo .rm-photo{grid-column:2;padding:6px}.rm[data-layout="list"] .rm-section:not(.is-feature) .rm-item.has-photo .rm-photo img{aspect-ratio:1/1}.rm[data-layout="list"] .rm-section:not(.is-feature) .rm-item.has-photo .rm-item-copy{grid-column:1;grid-row:1;padding-top:0}.rm[data-layout="list"] .rm-section:not(.is-feature) .rm-item.has-photo h3{font-size:17px}
.ro-page{padding:76px 20px 40px}.ro-page>h2{margin:0 0 6px;font-size:30px;font-weight:880;text-transform:uppercase;letter-spacing:-.01em}.ro-page .ro-receipt{background:var(--rm-surface);box-shadow:0 1px 0 var(--rm-border)}

@keyframes ro-up{from{transform:translateY(100%)}to{transform:none}}@keyframes ro-fade{from{opacity:0}to{opacity:1}}@keyframes ro-pop{0%{transform:scale(.7);opacity:.3}100%{transform:none;opacity:1}}@keyframes ro-spin{to{transform:rotate(360deg)}}@keyframes ro-pulse{0%{box-shadow:0 0 0 0 color-mix(in srgb,var(--rm-accent) 60%,transparent)}100%{box-shadow:0 0 0 22px transparent}}
.rm-overlay{animation:ro-fade .24s ease both}.rm-overlay-panel{animation:ro-up .34s cubic-bezier(.16,1,.3,1) both}.rm-item-open:active,.ro-primary:active,.ro-pay:active,.ro-bagbar button:active{transform:scale(.98)}
.ro-headbtn{position:relative}.ro-dot{position:absolute;top:6px;right:4px;min-width:17px;height:17px;padding:0 4px;border-radius:999px;background:var(--rm-accent);color:var(--rm-on-accent);font-size:10px;font-weight:850;line-height:17px;text-align:center}
.ro-quick{display:flex;justify-content:flex-end;margin-top:-34px;position:relative;z-index:1;pointer-events:none}.ro-quick>*{pointer-events:auto}.ro-plus{position:relative;display:grid;place-items:center;width:44px;height:44px;border:0;border-radius:999px;background:var(--rm-text);color:var(--rm-bg);font-size:24px;font-weight:500;line-height:1;transition:transform .15s ease}.ro-plus:active{transform:scale(.9)}.ro-plus-count{position:absolute;top:-4px;right:-4px;min-width:18px;height:18px;border-radius:999px;background:var(--rm-accent);color:var(--rm-on-accent);font-size:10px;font-weight:850;line-height:18px}
.ro-stepper{display:inline-flex;align-items:center;border:1px solid var(--rm-border);border-radius:999px;background:var(--rm-bg);color:var(--rm-text)}.ro-stepper button{width:44px;height:44px;border:0;background:transparent;font-size:20px}.ro-stepper button:disabled{opacity:.3;cursor:default}.ro-stepper output{min-width:22px;text-align:center;font-weight:850;animation:ro-pop .2s ease}.ro-stepper.is-sm button{width:40px;height:44px;font-size:18px}
.ro-dish{margin-top:8px}.ro-group{margin:30px 0 0;padding:22px 0 0;border:0;border-top:1px solid var(--rm-border)}.ro-group legend{display:flex;flex-direction:column;gap:3px;width:100%;padding:0;margin-bottom:14px}.ro-group legend span{font-size:19px;font-weight:850}.ro-group legend small{color:var(--rm-muted);font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.06em}.ro-group.is-invalid legend small{color:var(--rm-accent-text)}.ro-options{display:grid;grid-template-columns:1fr 1fr;gap:9px}.ro-options button,.ro-choicegrid button,.ro-tips button,.ro-scope button{position:relative;display:grid;grid-template-columns:minmax(0,1fr) auto;gap:8px;align-items:center;min-height:58px;padding:10px 14px;border:1px solid var(--rm-border);border-radius:var(--rm-radius);background:transparent;text-align:left;font-size:14px;font-weight:700;transition:background .15s,border-color .15s,color .15s}.ro-options button i{display:none}.ro-options [aria-checked="true"],.ro-choicegrid [aria-checked="true"],.ro-tips [aria-checked="true"],.ro-scope [aria-checked="true"]{border-color:var(--rm-text);box-shadow:inset 0 0 0 1px var(--rm-text);background:var(--rm-surface)}.ro-options b{font-size:12px;color:var(--rm-muted)}
.ro-note{display:grid;gap:8px;margin-top:26px;font-size:13px;font-weight:800}.ro-note textarea,.ro-input input,.ro-promo input{width:100%;min-height:52px;padding:13px 14px;border:1px solid var(--rm-border);border-radius:var(--rm-radius);background:transparent;color:inherit;font:inherit;font-size:15px;resize:vertical}
.ro-dish-bar{position:sticky;bottom:0;z-index:2;display:flex;gap:10px;align-items:center;margin:30px -20px -52px;padding:14px 20px calc(14px + env(safe-area-inset-bottom));background:color-mix(in srgb,var(--rm-bg) 94%,transparent);backdrop-filter:blur(12px);border-top:1px solid var(--rm-border)}
.ro-primary{flex:1;display:flex;justify-content:space-between;align-items:center;gap:12px;min-height:54px;padding:0 20px;border:0;border-radius:999px;background:var(--rm-accent);color:var(--rm-on-accent);font-weight:850;font-size:15px;transition:transform .12s ease,opacity .15s}.ro-primary[aria-disabled="true"],.ro-primary:disabled{opacity:.45}.ro-primary.is-wide{width:100%;margin-top:22px}.ro-primary b{animation:ro-pop .2s ease}.ro-primary span:only-child{margin:auto}.ro-dish-bar .ro-primary{padding:0 16px;font-size:14px}.ro-dish-bar .ro-primary span{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.rm-headtools{gap:2px}
.ro-ghost{min-height:50px;padding:0 18px;border:1px solid color-mix(in srgb,currentColor 26%,transparent);border-radius:999px;background:transparent;font-weight:800;width:100%;margin-top:10px}
.ro-bagbar{position:fixed;z-index:40;left:0;right:0;bottom:0;display:flex;justify-content:center;padding:12px 14px calc(12px + env(safe-area-inset-bottom));pointer-events:none;animation:ro-up .34s cubic-bezier(.16,1,.3,1) both}.ro-bagbar button{pointer-events:auto;display:grid;grid-template-columns:auto 1fr auto;gap:14px;align-items:center;width:min(100%,560px);min-height:58px;padding:0 20px 0 8px;border:0;border-radius:999px;background:var(--rm-text);color:var(--rm-bg);font-weight:850;box-shadow:0 14px 34px color-mix(in srgb,var(--rm-text) 30%,transparent);transition:transform .12s}.ro-bagbar span:nth-child(2){text-align:left}.ro-count{display:grid;place-items:center;width:42px;height:42px;border-radius:999px;background:var(--rm-accent);color:var(--rm-on-accent);animation:ro-pop .22s ease}
.ro-sheet{padding-top:6px}.ro-empty{padding:30px 0;color:color-mix(in srgb,currentColor 70%,transparent)}.ro-lines{list-style:none;margin:0;padding:0}.ro-lines li{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:14px;padding:18px 0;border-bottom:1px solid color-mix(in srgb,currentColor 14%,transparent)}.ro-line-main{display:grid;gap:4px;min-width:0}.ro-line-main strong{font-size:16px;overflow-wrap:anywhere}.ro-line-main small{color:color-mix(in srgb,currentColor 65%,transparent)}.ro-line-actions{display:flex;gap:16px}.ro-line-actions button{min-height:44px;padding:0;border:0;background:transparent;font-size:13px;font-weight:800;text-decoration:underline;text-underline-offset:3px}.ro-line-side{display:grid;justify-items:end;gap:8px}
.ro-sum{display:flex;justify-content:space-between;padding:18px 0 0;font-weight:800}.ro-sum.is-big{font-size:20px;border-top:1px solid color-mix(in srgb,currentColor 18%,transparent);margin-top:18px}
.ro-round{margin-top:22px;padding:16px;border-radius:var(--rm-radius);background:color-mix(in srgb,currentColor 7%,transparent)}.ro-round header{display:flex;justify-content:space-between;gap:10px;font-size:12px;font-weight:850;text-transform:uppercase;letter-spacing:.06em}.ro-round em{font-style:normal;padding:3px 9px;border-radius:999px;border:1px solid color-mix(in srgb,currentColor 30%,transparent)}.ro-round[data-source="app"] em{background:var(--rm-accent);color:var(--rm-on-accent);border-color:transparent}.ro-round ul{list-style:none;margin:10px 0 0;padding:0}.ro-round li{display:grid;grid-template-columns:auto minmax(0,1fr) auto auto;gap:10px;align-items:center;padding:10px 0;font-size:14px}.ro-tabname{display:grid;overflow-wrap:anywhere}.ro-tabname small{opacity:.65}.ro-qty{font-weight:850}.ro-status{font-size:11px;font-weight:850;padding:4px 8px;border-radius:999px;background:color-mix(in srgb,currentColor 12%,transparent)}.ro-status[data-status="preparing"]{background:var(--rm-accent);color:var(--rm-on-accent)}.ro-status[data-status="served"]{opacity:.6}
.ro-choicegrid,.ro-tips{display:grid;grid-template-columns:1fr 1fr;gap:9px;margin-top:14px}.ro-choicegrid button,.ro-tips button,.ro-scope button{border-color:color-mix(in srgb,currentColor 24%,transparent)}.ro-choicegrid [aria-checked="true"],.ro-tips [aria-checked="true"],.ro-scope [aria-checked="true"]{background:var(--rm-accent);color:var(--rm-on-accent);border-color:var(--rm-accent);box-shadow:none}.ro-tips{grid-template-columns:repeat(5,1fr);gap:6px}.ro-tips button{grid-template-columns:1fr;text-align:center;padding:0 4px;font-size:13px}.ro-scope{display:grid;gap:8px}.ro-scope button:disabled{opacity:.4}.ro-h{margin:26px 0 10px;font-size:15px;font-weight:850}.ro-row{display:flex;align-items:center;gap:12px;margin-top:12px;flex-wrap:wrap}.ro-row .ro-stepper{background:transparent;color:inherit;border-color:color-mix(in srgb,currentColor 24%,transparent)}.ro-input{display:block;margin-top:10px}
.ro-acc{margin-top:22px;border-top:1px solid color-mix(in srgb,currentColor 16%,transparent);border-bottom:1px solid color-mix(in srgb,currentColor 16%,transparent)}.ro-acc summary{min-height:52px;display:flex;align-items:center;font-weight:800;cursor:pointer}.ro-promo{display:flex;gap:8px;padding-bottom:14px}.ro-promo .ro-ghost{width:auto;margin:0}.ro-allergy{font-size:13px;opacity:.75}
.ro-methods{display:grid;gap:9px;margin-top:20px}.ro-pay{min-height:54px;border:1px solid color-mix(in srgb,currentColor 26%,transparent);border-radius:999px;background:var(--rm-bg);color:var(--rm-text);font-weight:850}.ro-pay.is-apple{background:var(--rm-accent);color:var(--rm-on-accent);border-color:transparent}
.ro-state{display:grid;justify-items:center;text-align:center;gap:8px;padding:40px 0 10px}.ro-state h3{margin:12px 0 0;font-size:22px}.ro-state p{margin:0;opacity:.75;max-width:32ch}.ro-spinner{width:54px;height:54px;border-radius:999px;border:3px solid color-mix(in srgb,currentColor 18%,transparent);border-top-color:var(--rm-accent);animation:ro-spin .8s linear infinite}.ro-check{display:grid;place-items:center;width:64px;height:64px;border-radius:999px;background:var(--rm-accent);color:var(--rm-on-accent);font-size:30px;font-weight:900;animation:ro-pop .35s cubic-bezier(.16,1,.3,1)}.ro-check.is-bad{background:transparent;border:2px solid currentColor;color:inherit}.ro-pulse{width:20px;height:20px;border-radius:999px;background:var(--rm-accent);animation:ro-pulse 1.4s ease-out infinite}
.ro-receipt{margin-top:10px;padding:22px 20px;border-radius:var(--rm-radius);background:var(--rm-bg);color:var(--rm-text);font-size:14px}.ro-receipt header{display:grid;gap:3px;justify-items:center;text-align:center;padding-bottom:16px;border-bottom:1px dashed var(--rm-border)}.ro-receipt header strong{font-size:18px;letter-spacing:.12em}.ro-receipt header span{color:var(--rm-muted);font-size:12px}.ro-receipt ul{list-style:none;margin:0;padding:12px 0;border-bottom:1px dashed var(--rm-border)}.ro-receipt li,.ro-receipt dl div{display:flex;justify-content:space-between;gap:12px;padding:5px 0}.ro-receipt dl{margin:12px 0 0}.ro-receipt dd{margin:0;font-weight:700}.ro-receipt .is-total{font-size:18px;font-weight:900;padding:10px 0;border-top:1px solid var(--rm-border);border-bottom:1px solid var(--rm-border);margin:6px 0}.ro-toast{margin-top:14px;text-align:center;font-weight:800;animation:ro-fade .2s}
@media (prefers-reduced-motion:reduce){.rm-overlay,.rm-overlay-panel,.ro-bagbar,.ro-count,.ro-stepper output,.ro-primary b,.ro-check,.ro-spinner,.ro-pulse{animation:none!important}.rm-item-open:active,.ro-primary:active,.ro-plus:active{transform:none}}
.rm{--rm-pill:calc(var(--rm-radius)*1.6)}
.rm .ro-plus,.rm .ro-stepper,.rm .ro-pill,.rm .ro-bagbar .ro-waiter,.rm .ro-bagbar .ro-bagbtn,.rm .ro-primary,.rm .ro-pay,.rm .rm-filter-group button,.rm .rm-language,.rm .rm-layout{border-radius:var(--rm-pill)}
.rm .ro-stepper{overflow:hidden}.rm .ro-stepper button{border-radius:0}
.rm .rm-layout{display:inline-flex;gap:2px;padding:3px;margin:14px 20px 0;width:auto;border:1px solid var(--rm-border);background:var(--rm-bg)}.rm .rm-layout button{display:grid;place-items:center;width:44px;height:38px;padding:0;border:0;border-radius:calc(var(--rm-pill) - 3px);background:transparent;color:var(--rm-muted)}.rm .rm-layout button svg{width:18px;height:18px}.rm .rm-layout button[aria-checked="true"]{background:var(--rm-text);color:var(--rm-bg)}.rm .rm-layout span{display:none}
.rm .rm-language{display:inline-flex;padding:3px;gap:2px;border:1px solid color-mix(in srgb,var(--rm-bg) 30%,transparent)}.rm .rm-language button{min-width:38px;height:34px;padding:0 8px;border:0;border-radius:calc(var(--rm-pill) - 3px);background:transparent;color:color-mix(in srgb,var(--rm-bg) 70%,transparent);font-size:11px;font-weight:850;letter-spacing:.06em}.rm .rm-language button[aria-pressed="true"]{background:var(--rm-bg);color:var(--rm-text)}
.rm-headtools{flex-wrap:nowrap;gap:6px;min-width:0}.rm-brandline{gap:10px}
@media(max-width:380px){.rm .rm-table{display:none}.rm .rm-language button{min-width:32px;padding:0 6px}.rm .rm-layout{margin-left:14px}}
.rm[data-layout="two"] .rm-section:not(.is-feature) .rm-item.has-photo{min-width:0}.rm[data-layout="two"] .rm-section:not(.is-feature) .rm-item.has-photo h3{overflow-wrap:anywhere;hyphens:auto}
.rm[data-layout="list"] .rm-section:not(.is-feature) .rm-item.has-photo{align-items:start}.rm[data-layout="list"] .rm-section:not(.is-feature) .rm-item.has-photo .rm-photo{align-self:start;height:auto}.rm[data-layout="list"] .rm-section:not(.is-feature) .rm-item.has-photo .ro-quick{position:absolute;top:84px;right:-4px;margin:0;z-index:3}.rm[data-layout="list"] .rm-section:not(.is-feature) .rm-item.has-photo .ro-quick .ro-plus{width:40px;height:40px;box-shadow:0 4px 12px color-mix(in srgb,var(--rm-text) 20%,transparent)}
.rm .ro-bagbar{left:max(12px,env(safe-area-inset-left));right:max(12px,env(safe-area-inset-right));bottom:calc(12px + env(safe-area-inset-bottom))}
@media(max-width:350px){.rm .rm-section.is-feature .rm-items{margin:0 -14px;padding:0 14px 18px}.rm .rm-section.is-feature .rm-item{flex-basis:82vw;width:82vw}}
.rm{overflow-x:clip}

.rm-layoutrow{display:flex;justify-content:flex-end;padding:8px 18px 0}
.rm main{padding-bottom:calc(104px + env(safe-area-inset-bottom))}
.rm[data-layout="list"] .rm-section:not(.is-feature) .rm-item.has-photo{position:relative}
.rm[data-layout="list"] .rm-section:not(.is-feature) .rm-item.has-photo .rm-photo{width:96px;height:96px;padding:0;overflow:visible}
.rm[data-layout="list"] .rm-section:not(.is-feature) .rm-item.has-photo .rm-photo img{width:96px;height:96px;object-fit:cover}
.rm[data-layout="list"] .rm-section:not(.is-feature) .rm-item.has-photo .rm-badge{top:-6px;left:-6px;right:auto;font-size:9px;padding:3px 6px;max-width:90px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.rm[data-layout="list"] .rm-section:not(.is-feature) .rm-item.has-photo .ro-quick{position:absolute;top:calc(18px + 96px - 24px);right:-4px;margin:0;z-index:3}
.rm[data-layout="list"] .rm-section:not(.is-feature) .rm-item.has-photo .rm-item-copy{min-width:0}

html:has(.rm),body:has(.rm){overflow-x:hidden;scrollbar-width:none}html:has(.rm)::-webkit-scrollbar{display:none}
.rm{overflow-x:clip;max-width:100vw}
.rm .rm-layout{margin-top:14px;padding:2px}.rm .rm-layout button{width:36px;height:30px;min-height:30px}.rm .rm-layout svg{width:15px;height:15px}
.rm[data-layout="list"] .rm-section:not(.is-feature) .rm-item.has-photo .rm-photo{overflow:hidden}
.rm[data-layout="list"] .rm-section:not(.is-feature) .rm-item.has-photo .rm-badge{top:5px;left:5px}
.rm[data-layout="list"] .rm-section:not(.is-feature) .rm-item.has-photo .ro-quick{top:calc(18px + 96px - 42px);right:4px}
.rm[data-layout="list"] .rm-section:not(.is-feature) .rm-item.has-photo .ro-quick .ro-plus{width:36px;height:36px}
.rm[data-layout="list"] .rm-section:not(.is-feature) .rm-item.is-text .ro-quick{margin-top:-40px}
.rm[data-layout="two"] .rm-section:not(.is-feature)>.rm-items{column-gap:12px}
.rm[data-layout="two"] .rm-section:not(.is-feature) .rm-item.has-photo .rm-photo img{aspect-ratio:4/3}
.rm[data-layout="two"] .rm-section:not(.is-feature) .rm-item.has-photo h3{font-size:14px}
.rm .rm-brandline>:first-child{min-width:0}.rm .rm-wordmark{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
@media(max-width:389px){.rm .ro-billword{display:none}}
@media(max-width:359px){.rm[data-layout="two"] .rm-section:not(.is-feature)>.rm-items{column-gap:10px}.rm[data-layout="two"] .rm-section:not(.is-feature) .rm-item.has-photo h3{font-size:12.5px}.rm[data-layout="two"] .rm-section:not(.is-feature) .rm-item.has-photo .rm-photo{padding:5px}}
.rm main{padding-bottom:calc(110px + env(safe-area-inset-bottom))}.rm-footer{padding-bottom:calc(120px + env(safe-area-inset-bottom))}
@media(min-width:641px){.rm{width:min(100%,820px)}.rm-section.is-feature .rm-item{flex-basis:46%;width:46%}}
.rm-section.is-feature .rm-items{scroll-padding-inline:20px}@media(min-width:641px){.rm-section.is-feature .rm-items{scroll-padding-inline:34px}}@media(max-width:350px){.rm-section.is-feature .rm-items{scroll-padding-inline:14px}}

/* right-sized controls */
.rm{--ro-btn:clamp(32px,8.6vw,38px);--ro-bar:clamp(46px,12.4vw,52px);--ro-icon:clamp(16px,4.4vw,18px)}
.rm .ro-plus{width:var(--ro-btn);height:var(--ro-btn);font-size:18px}
.rm .ro-plus svg{width:var(--ro-icon);height:var(--ro-icon)}
.rm .ro-plus::after{content:"";position:absolute;inset:calc((var(--ro-btn) - 44px)/2)}
.rm .ro-quick .ro-stepper button,.rm .ro-stepper.is-sm button{width:var(--ro-btn);height:var(--ro-btn);font-size:16px;position:relative}
.rm .ro-quick .ro-stepper button::after{content:"";position:absolute;inset:-5px 0}
.rm .ro-stepper output{min-width:18px;font-size:14px}
.rm .ro-bagbar button{min-height:var(--ro-bar);font-size:14px;gap:10px;padding:0 16px 0 6px}
.rm .ro-bagbar .ro-waiter{min-width:var(--ro-bar);padding:0 16px;font-size:14px}
.rm .ro-bagbar[data-bag="true"] .ro-waiter{width:var(--ro-bar);padding:0}
.rm .ro-bagbar svg{width:var(--ro-icon);height:var(--ro-icon)}
.rm .ro-count{width:calc(var(--ro-bar) - 14px);height:calc(var(--ro-bar) - 14px);font-size:13px}
.rm .ro-pill{min-height:34px;font-size:12.5px;padding:0 12px}.rm .ro-pill svg{width:15px;height:15px}
.rm .rm-language button{min-height:30px;font-size:11.5px}
.rm .ro-primary{min-height:var(--ro-bar);font-size:15px}
.rm[data-layout="two"] .rm-section:not(.is-feature) .rm-item.has-photo .rm-item-copy{display:flex;flex-wrap:wrap;align-items:center;column-gap:8px}
.rm[data-layout="two"] .rm-section:not(.is-feature) .rm-item.has-photo .rm-item-copy>*{flex:1 1 100%}
.rm[data-layout="two"] .rm-section:not(.is-feature) .rm-item.has-photo .rm-item-copy>.rm-price{flex:1 1 auto;min-width:0;margin:0}
.rm[data-layout="two"] .rm-section:not(.is-feature) .rm-item.has-photo .rm-item-copy>.ro-quick{flex:0 0 auto;margin:0}
.rm[data-layout="two"] .rm-section:not(.is-feature) .rm-item.has-photo .rm-item-copy>.rm-state:empty{display:none}
`;
