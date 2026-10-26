// The table's shared order (D117, D121; #75), as the hidden reference face draws it: the minimum a
// guest and the Playwright specs need to drive the order, not a designed screen. An "Add" button on
// each orderable item (`item.add`), and the order panel (`menu.bag`): its lines with − and + and
// Remove, a removed line's Undo, the earlier order's Restore, and the host's word when ordering is
// paused or the table is closed. Everything drawn comes from the host's state (D72); the host may
// draw an edit before the server answers, and says so per line (`pending`).
//
// Send (#77, D116, D122 §5): "Send 3 items" sends the order's on-the-bill lines and waits for the
// host's answer; the table's sent orders follow with their state on every phone ("Sending…" only
// on the phone that sent, "Being sent" on the others), "Not confirmed: show K7Q to your waiter",
// and the "Show this to your waiter" panel any phone can open.

import {
  type CommandResult,
  type GuestCommand,
  isGuestRefusalCode,
  isOutOfStock,
  refusedOutOfStock,
  type SentOrderView,
  type ServiceBinding,
  type ServiceStrings,
  type ViewItem,
  type ViewModel,
} from '@restro/shell'
import { useCallback, useMemo, useState } from 'react'

/** A command before its action id is made (one per kind, as the union says). */
export type CommandDraft = GuestCommand extends infer C
  ? C extends GuestCommand
    ? Omit<C, 'actionId'>
    : never
  : never

/** A uuid for one user action (version 4); `randomUUID` exists only on secure pages. */
function newActionId(): string {
  const webCrypto = globalThis.crypto
  if (typeof webCrypto.randomUUID === 'function') return webCrypto.randomUUID()
  const bytes = webCrypto.getRandomValues(new Uint8Array(16))
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

/** Every item of the view by id, for the order's names. */
export function itemsById(view: ViewModel): ReadonlyMap<string, ViewItem> {
  const found = new Map<string, ViewItem>()
  const walk = (sections: ViewModel['sections']) => {
    for (const section of sections) {
      for (const item of section.items) if (!found.has(item.id)) found.set(item.id, item)
      walk(section.sections)
    }
  }
  walk(view.sections)
  return found
}

/** Sends commands and keeps the last refusal's words; `view` names the item a refused Send names. */
export function useOrderCommands(
  services: ServiceBinding | undefined,
  strings: ServiceStrings,
  view?: ViewModel,
) {
  const [notice, setNotice] = useState<string | null>(null)
  const items = useMemo(() => (view === undefined ? null : itemsById(view)), [view])
  const send = useCallback(
    async (command: CommandDraft): Promise<CommandResult | null> => {
      if (services === undefined) return null
      setNotice(null)
      let result: CommandResult
      try {
        result = await services.dispatch({ ...command, actionId: newActionId() } as GuestCommand)
      } catch {
        setNotice(strings.refusedOther)
        return null
      }
      if (result.status === 'rejected') {
        const code = result.code ?? null
        // The location panel answers these itself (the consent screen, the failed check).
        if (code === 'location_needed' || code === 'location_failed') return result
        const named =
          code === 'item_unavailable' && result.subjectId != null
            ? items?.get(result.subjectId)?.name.text
            : undefined
        setNotice(
          named !== undefined
            ? strings.itemUnavailableNamed(named)
            : code !== null && isGuestRefusalCode(code)
              ? strings.refusals[code]
              : strings.refusedOther,
        )
      }
      return result
    },
    [services, strings, items],
  )
  return { send, notice }
}

/** What a sent order says on this phone (D116, D122 §5). */
export function sentWords(sent: SentOrderView, strings: ServiceStrings): string {
  switch (sent.state) {
    case 'sending':
      return sent.mine ? strings.sendingNow : strings.beingSent
    case 'awaiting_approval':
      return strings.sentAwaitingApproval
    case 'added':
      return strings.sentAdded
    case 'not_sent':
      if (sent.reason === 'ordering_paused') return strings.sentNotSentPaused
      if (sent.reason === 'item_unavailable') return strings.sentNotSentOutOfStock
      return sent.reason === 'needs_first_item' ? strings.sentNotSentFirstItem : strings.sentNotSent
    case 'unconfirmed':
      return strings.sentUnconfirmed(sent.ref)
  }
}

/** The time a sent order went, as the phone's clock shows it ("19:42"). */
function clockOf(at: number): string {
  const date = new Date(at)
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

/**
 * The table's sent orders, each with its state, and the "Show this to your waiter" panel: the
 * reference in large type, the time and the items, black on white (D120).
 */
export function SentOrders({
  services,
  strings,
  nameOf,
}: {
  readonly services: ServiceBinding | undefined
  readonly strings: ServiceStrings
  readonly nameOf: (itemId: string) => string
}) {
  const [shown, setShown] = useState<string | null>(null)
  const sentOrders = services?.state.sentOrders ?? []
  if (sentOrders.length === 0) return null
  const open = sentOrders.find((sent) => sent.id === shown) ?? null
  return (
    <div className="rq-sent" data-sent-orders="">
      <ul className="rq-order-lines">
        {sentOrders.map((sent) => (
          <li key={sent.id} data-sent-order={sent.id} data-sent-state={sent.state}>
            <p className="rq-order-hint">
              {sent.lines.map((line) => `${line.qty} × ${nameOf(line.itemId)}`).join(', ')}
            </p>
            <p className={sent.state === 'unconfirmed' ? 'rq-note' : undefined} role="status">
              {sentWords(sent, strings)}
            </p>
            <button type="button" onClick={() => setShown(sent.id)}>
              {strings.showWaiter}
            </button>
          </li>
        ))}
      </ul>
      {open !== null ? (
        <div
          className="rq-waiter"
          role="dialog"
          aria-label={strings.showWaiter}
          data-show-waiter=""
        >
          <p className="rq-waiter-ref">{open.ref}</p>
          <p>{clockOf(open.sentAt)}</p>
          <ul>
            {open.lines.map((line, index) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: a sent order's lines never change or reorder
              <li key={`${line.itemId}-${index}`}>
                {line.qty} × {nameOf(line.itemId)}
              </li>
            ))}
          </ul>
          <button type="button" onClick={() => setShown(null)}>
            {strings.showWaiterClose}
          </button>
        </div>
      ) : null}
    </div>
  )
}

/** The order panel. */
export function OrderPanel({
  view,
  services,
  strings,
  send,
  notice,
}: {
  readonly view: ViewModel
  readonly services: ServiceBinding | undefined
  readonly strings: ServiceStrings
  readonly send: (command: CommandDraft) => unknown
  readonly notice: string | null
}) {
  const items = useMemo(() => itemsById(view), [view])
  const [sending, setSending] = useState(false)
  const order = services?.state.order ?? null
  const ordering = services?.state.ordering?.state ?? 'on'
  const nameOf = (itemId: string) => items.get(itemId)?.name.text ?? strings.otherItem
  const lines = order?.lines ?? []
  // What ran out (#80): sold out on the menu, or named by the POS when it refused the last Send.
  const refused = refusedOutOfStock(services?.state.sentOrders)
  const outOfStock = (line: { readonly itemId: string }) =>
    isOutOfStock(line.itemId, items.get(line.itemId), refused)
  // A Send takes the lines on the bill that no payment holds and the server already has, and
  // leaves the out-of-stock ones behind, greyed: the guest sends the rest with one tap.
  const ready = lines.filter((line) => line.mode === 'on_bill' && !line.held && !line.pending)
  const sendable = ready.filter((line) => !outOfStock(line))
  const leftBehind = sendable.length < ready.length
  const count = sendable.reduce((sum, line) => sum + line.qty, 0)
  const sendOrder = async () => {
    setSending(true)
    try {
      await send({
        kind: 'order.send',
        lines: sendable.map((line) => ({
          itemId: line.itemId,
          optionIds: line.optionIds,
          qty: line.qty,
          note: line.note,
        })),
      })
    } finally {
      setSending(false)
    }
  }
  return (
    <section className="rq-order" data-slot="menu.bag" aria-label={strings.tableOrder}>
      <h2>{strings.tableOrder}</h2>
      {services?.state.offline === true ? (
        <p className="rq-note" role="status">
          {strings.offline}
        </p>
      ) : null}
      <LocationPanel
        services={services}
        strings={strings}
        send={send}
        callWaiter={view.features.callWaiter !== null}
      />
      {ordering === 'paused' ? <p className="rq-note">{strings.orderingPaused}</p> : null}
      {ordering === 'closed' ? <p className="rq-note">{strings.orderingClosed}</p> : null}
      {notice !== null ? (
        <p className="rq-note" role="alert" data-order-notice="">
          {notice}
        </p>
      ) : null}
      {lines.length === 0 && order !== null ? <p>{strings.emptyOrder}</p> : null}
      <ul className="rq-order-lines">
        {lines.map((line) => (
          <li
            key={line.id}
            data-order-line={line.id}
            data-item-id={line.itemId}
            data-qty={line.qty}
            data-pending={line.pending ? '' : undefined}
            data-out-of-stock={outOfStock(line) ? '' : undefined}
            className={outOfStock(line) ? 'rq-order-out' : undefined}
          >
            <span className="rq-order-name">{nameOf(line.itemId)}</span>{' '}
            <span className="rq-order-qty">× {line.qty}</span>
            {outOfStock(line) ? (
              <p className="rq-note">{strings.outOfStockNamed(nameOf(line.itemId))}</p>
            ) : null}
            {line.pending ? <span className="rq-order-hint"> {strings.saving}</span> : null}
            {line.mode === 'pay_first' ? (
              <p className="rq-note">{strings.orderFromWaiter}</p>
            ) : null}
            {line.held ? (
              <span className="rq-order-hint"> {strings.heldLine}</span>
            ) : (
              <span className="rq-order-controls">
                <button
                  type="button"
                  aria-label={strings.decrease}
                  onClick={() => send({ kind: 'order.change', lineId: line.id, delta: -1 })}
                >
                  −
                </button>
                <button
                  type="button"
                  aria-label={strings.increase}
                  onClick={() => send({ kind: 'order.change', lineId: line.id, delta: 1 })}
                >
                  +
                </button>
                <button
                  type="button"
                  onClick={() => send({ kind: 'order.remove', lineId: line.id })}
                >
                  {strings.remove}
                </button>
              </span>
            )}
          </li>
        ))}
      </ul>
      {(order?.removed ?? []).map((line) => (
        <p key={line.id} className="rq-order-removed" data-removed-line={line.id}>
          {strings.removedNamed(nameOf(line.itemId))}{' '}
          <button type="button" onClick={() => send({ kind: 'order.undo', lineId: line.id })}>
            {strings.undo}
          </button>
        </p>
      ))}
      {order?.earlier != null ? (
        <div className="rq-order-earlier" data-earlier-order="">
          <h3>{strings.earlierOrder}</h3>
          <ul>
            {order.earlier.lines.map((line) => (
              <li key={line.id}>
                {nameOf(line.itemId)} × {line.qty}
              </li>
            ))}
          </ul>
          <button
            type="button"
            onClick={() =>
              order.earlier !== null &&
              send({ kind: 'order.restore', setAsideAt: order.earlier.setAsideAt })
            }
          >
            {strings.restore}
          </button>
        </div>
      ) : null}
      {count > 0 && ordering === 'on' ? (
        <button
          type="button"
          className="rq-send"
          data-send=""
          disabled={sending}
          onClick={() => void sendOrder()}
        >
          {sending
            ? strings.sendingNow
            : leftBehind
              ? strings.sendOthers(count)
              : strings.sendItems(count)}
        </button>
      ) : null}
      <SentOrders services={services} strings={strings} nameOf={nameOf} />
    </section>
  )
}

/**
 * The location check (#76, D122 §4), drawn from the host's `location`: the consent screen (Allow /
 * Not now), "Checking your location…", the failed check (Call a waiter, or the still card "Please
 * order from your waiter" where the venue takes no calls, and Cancel), and, while the
 * phone has no pass, why the order and the bill are hidden with the guest's own "Allow location".
 */
export function LocationPanel({
  services,
  strings,
  send,
  callWaiter,
}: {
  readonly services: ServiceBinding | undefined
  readonly strings: ServiceStrings
  readonly send: (command: CommandDraft) => void
  /** The venue takes waiter calls (`view.features.callWaiter`); otherwise the still card shows. */
  readonly callWaiter: boolean
}) {
  const location = services?.state.location ?? null
  const controls = services?.location
  if (location === null || controls === undefined) return null
  switch (location.prompt) {
    case 'consent':
      return (
        <div
          className="rq-location"
          role="dialog"
          aria-modal="false"
          data-location-prompt="consent"
        >
          <p>{strings.locationConsent(location.venueName)}</p>
          <button type="button" onClick={() => void controls.allow()}>
            {strings.locationAllow}
          </button>{' '}
          <button type="button" onClick={() => controls.decline()}>
            {strings.locationNotNow}
          </button>
        </div>
      )
    case 'checking':
      return (
        <p className="rq-note" role="status" data-location-prompt="checking">
          {strings.locationChecking}
        </p>
      )
    case 'failed':
      return (
        <div className="rq-location" role="alert" data-location-prompt="failed">
          <p className="rq-note">{strings.locationFailed}</p>
          <p className="rq-order-hint">{strings.locationWhy}</p>
          {callWaiter ? (
            <>
              <button
                type="button"
                onClick={() => {
                  send({ kind: 'service.request', request: 'waiter', note: '' })
                  controls.dismiss()
                }}
              >
                {strings.locationCallWaiter}
              </button>{' '}
            </>
          ) : (
            <p className="rq-note" data-location-still-card="">
              {strings.locationOrderFromWaiter}
            </p>
          )}
          <button type="button" onClick={() => controls.dismiss()}>
            {strings.locationCancel}
          </button>
        </div>
      )
    case 'none':
      return location.state === 'needed' ? (
        <div className="rq-location" data-location-prompt="none">
          <p className="rq-order-hint">{strings.locationNeeded}</p>
          <button type="button" onClick={() => controls.reopen()}>
            {strings.locationAllowAgain}
          </button>
        </div>
      ) : null
  }
}

/** The "Add" button of an orderable item. */
export function AddButton({
  item,
  strings,
  send,
}: {
  readonly item: ViewItem
  readonly strings: ServiceStrings
  readonly send: (command: CommandDraft) => void
}) {
  return (
    <button
      type="button"
      className="rq-add"
      data-slot="item.add"
      onClick={() => send({ kind: 'order.add', itemId: item.id, optionIds: [], qty: 1, note: '' })}
    >
      {strings.addNamed(item.name.text)}
    </button>
  )
}
