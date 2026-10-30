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
//
// Send's guards (#78, D117): a line the live overlay shows sold out stays on the order, marked,
// and the button says "Send the other 4"; a round the table sent in the last 15 minutes asks
// "Same as 4 minutes ago. Send another?" (closing itself after 60 s), and Send another is a new
// action naming that sent order.

import {
  ANSWER_LOST_CODE,
  type CommandResult,
  DUPLICATE_ASK_SECONDS,
  type GuestCommand,
  isOutOfStock,
  itemsById,
  LOST_SEND_HOLD_MS,
  minutesSinceSent,
  refusalText,
  refusedOutOfStock,
  type SentOrderView,
  type ServiceBinding,
  type ServiceState,
  type ServiceStrings,
  sentClock,
  sentWords,
  type ViewItem,
  type ViewModel,
} from '@restro/shell'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

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

// The words and rules every template shares live in the shell (`table-order.ts`); this face's tests
// still reach them here.
export { DUPLICATE_ASK_SECONDS, itemsById, minutesSinceSent, sentWords }

/** Sends commands and keeps the last refusal's words; `view` names the item a refused Send names. */
export function useOrderCommands(
  services: ServiceBinding | undefined,
  strings: ServiceStrings,
  view?: ViewModel,
) {
  const [notice, setNotice] = useState<string | null>(null)
  // The last Send's answer was lost, before the host's state says so (it draws the line from then).
  // It is no notice: the line is `state.sendLost`'s, and this only bridges the moment before it.
  const [answerLost, setAnswerLost] = useState(false)
  const hostLost = services?.state.sendLost != null
  const hostSaid = useRef(false)
  useEffect(() => {
    if (hostLost) hostSaid.current = true
    else if (hostSaid.current) {
      hostSaid.current = false
      setAnswerLost(false)
    }
  }, [hostLost])
  // A host that never says it still lets the guest send again after the hold (D120).
  useEffect(() => {
    if (!answerLost) return
    const timer = setTimeout(() => setAnswerLost(false), LOST_SEND_HOLD_MS)
    return () => clearTimeout(timer)
  }, [answerLost])
  const items = useMemo(() => (view === undefined ? null : itemsById(view)), [view])
  const send = useCallback(
    async (command: CommandDraft): Promise<CommandResult | null> => {
      if (services === undefined) return null
      setNotice(null)
      setAnswerLost(false)
      let result: CommandResult
      try {
        result = await services.dispatch({ ...command, actionId: newActionId() } as GuestCommand)
      } catch {
        setNotice(strings.refusedOther)
        return null
      }
      // A Send whose answer was lost (D120): the order may already be in the POS, so the guest is
      // told to call a waiter, never "Try again".
      if (
        result.status === 'pending' &&
        result.code === ANSWER_LOST_CODE &&
        command.kind === 'order.send'
      ) {
        setAnswerLost(true)
        return result
      }
      // A pay command's refusal is worded where the guest paid (the bill panel), not as the
      // order's notice.
      if (result.status === 'rejected' && !command.kind.startsWith('pay.')) {
        const code = result.code ?? null
        // The location panel answers these itself (the consent screen, the failed check), and the
        // order panel the duplicate check.
        if (
          code === 'location_needed' ||
          code === 'location_failed' ||
          code === 'duplicate_order'
        ) {
          return result
        }
        const named =
          code === 'item_unavailable' && result.subjectId != null
            ? items?.get(result.subjectId)?.name.text
            : undefined
        setNotice(
          named !== undefined
            ? strings.itemUnavailableNamed(named)
            : refusalText(strings, code, { command: command.kind }),
        )
      }
      return result
    },
    [services, strings, items],
  )
  return { send, notice, answerLost }
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
          <p>{sentClock(open.sentAt)}</p>
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

/** The duplicate check: "Same as 4 minutes ago. Send another?" with Send another and Cancel. */
export function DuplicateCheck({
  minutes,
  strings,
  onSend,
  onCancel,
}: {
  readonly minutes: number | null
  readonly strings: ServiceStrings
  readonly onSend: () => void
  readonly onCancel: () => void
}) {
  return (
    <div className="rq-ask" role="alertdialog" aria-modal="false" data-duplicate-check="">
      <p>{minutes === null ? strings.refusals.duplicate_order : strings.duplicateAsk(minutes)}</p>
      <button type="button" onClick={onSend}>
        {strings.sendAnother}
      </button>{' '}
      <button type="button" onClick={onCancel}>
        {strings.duplicateCancel}
      </button>
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
  answerLost,
}: {
  readonly view: ViewModel
  readonly services: ServiceBinding | undefined
  readonly strings: ServiceStrings
  readonly send: (command: CommandDraft) => Promise<CommandResult | null>
  readonly notice: string | null
  /** The last Send's answer was lost and the host's state does not say so yet. */
  readonly answerLost: boolean
}) {
  const items = useMemo(() => itemsById(view), [view])
  const [sending, setSending] = useState(false)
  const [asked, setAsked] = useState<{
    readonly minutes: number | null
    readonly of: string
  } | null>(null)
  useEffect(() => {
    if (asked === null) return
    const timer = setTimeout(() => setAsked(null), DUPLICATE_ASK_SECONDS * 1000)
    return () => clearTimeout(timer)
  }, [asked])
  const order = services?.state.order ?? null
  const offline = services?.state.offline === true
  // A Send whose answer was lost (D120) says its own line in place of the general weak-signal one
  // (D122: "Nothing new was sent yet" would be false), and the bag is not offered for a re-send.
  const hostSendLost = services?.state.sendLost ?? null
  const sendLost = hostSendLost ?? (answerLost ? { ref: null } : null)
  const ordering = services?.state.ordering?.state ?? 'on'
  const night = services?.state.ordering?.night
  const phonesMayOrder =
    night === undefined || night.state === 'open' || night.state === 'last_orders'
  // No note field here: where the POS's ticket takes no notes (#78), the guest tells the staff.
  const notesAtStaff = services?.state.ordering?.notesAndOptions !== true
  const nameOf = (itemId: string) => items.get(itemId)?.name.text ?? strings.otherItem
  const lines = order?.lines ?? []
  // Sold out on the menu, or named by the POS when it refused the last Send (#80): greyed, kept
  // on the order and left out of the next Send.
  const refused = refusedOutOfStock(services?.state.sentOrders)
  const soldOut = (itemId: string) => isOutOfStock(itemId, items.get(itemId), refused)
  // A Send takes the lines on the bill that no payment holds and the server already has, and
  // leaves the sold-out ones on the order.
  const live = lines.filter((line) => line.mode === 'on_bill' && !line.held && !line.pending)
  const sendable = live.filter((line) => !soldOut(line.itemId))
  const keptBack = live.length > sendable.length
  const count = sendable.reduce((sum, line) => sum + line.qty, 0)
  const sendOrder = async (confirmDuplicateOf?: string) => {
    setAsked(null)
    setSending(true)
    try {
      const result = await send({
        kind: 'order.send',
        lines: sendable.map((line) => ({
          itemId: line.itemId,
          optionIds: line.optionIds,
          qty: line.qty,
          note: line.note,
        })),
        ...(confirmDuplicateOf === undefined ? {} : { confirmDuplicateOf }),
      })
      if (result?.code === 'duplicate_order' && result.subjectId != null) {
        const sentOrders = services?.state.sentOrders ?? []
        setAsked({
          of: result.subjectId,
          minutes: minutesSinceSent(sentOrders, result.subjectId, Date.now()),
        })
      }
    } finally {
      setSending(false)
    }
  }
  return (
    <section className="rq-order" data-slot="menu.bag" aria-label={strings.tableOrder}>
      <h2>{strings.tableOrder}</h2>
      {sendLost !== null ? (
        <p className="rq-note" role="alert" data-send-lost="">
          {strings.sendLost}
          {sendLost.ref === null ? null : ` ${strings.reference(sendLost.ref)}`}
        </p>
      ) : offline ? (
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
      {night?.state === 'last_orders' && night.at !== null ? (
        <p className="rq-note" data-last-orders="">
          {strings.lastOrdersAt(night.at)}
        </p>
      ) : null}
      {night?.state === 'closed' ? (
        <p className="rq-note" data-ordering-closed-tonight="">
          {strings.orderingClosedTonight}
        </p>
      ) : null}
      {night?.state === 'opens_later' && night.at !== null ? (
        <p className="rq-note" data-ordering-opens-later="">
          {strings.orderingOpensAt(night.at)}
        </p>
      ) : null}
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
            data-sold-out={soldOut(line.itemId) ? '' : undefined}
          >
            <span className="rq-order-name">{nameOf(line.itemId)}</span>{' '}
            <span className="rq-order-qty">× {line.qty}</span>
            {soldOut(line.itemId) ? (
              <span className="rq-order-hint"> {strings.lineSoldOut}</span>
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
      {notesAtStaff && lines.length > 0 ? (
        <p className="rq-note" data-notes-at-staff="">
          {strings.notesAtStaff}
        </p>
      ) : null}
      {asked !== null ? (
        <DuplicateCheck
          minutes={asked.minutes}
          strings={strings}
          onSend={() => void sendOrder(asked.of)}
          onCancel={() => setAsked(null)}
        />
      ) : count > 0 && ordering === 'on' && phonesMayOrder && sendLost === null ? (
        <button
          type="button"
          className="rq-send"
          data-send=""
          disabled={sending || offline}
          onClick={() => void sendOrder()}
        >
          {sending
            ? strings.sendingNow
            : keptBack
              ? strings.sendOthers(count)
              : strings.sendItems(count)}
        </button>
      ) : null}
      <SentOrders services={services} strings={strings} nameOf={nameOf} />
    </section>
  )
}

/** Whether the bill panel is drawn: the host has the table's bill or this phone's payment. */
export function billShown(state: ServiceState | undefined): boolean {
  return state?.tableBill != null || state?.payment != null
}

/**
 * "Stop location check" (D119): one small control that drops the phone's pass and ends the check
 * for the service day. Only where the host can stop it (`location.stop`).
 */
export function StopLocationCheck({
  services,
  strings,
}: {
  readonly services: ServiceBinding | undefined
  readonly strings: ServiceStrings
}) {
  const stop = services?.location?.stop
  if (stop === undefined) return null
  return (
    <button
      type="button"
      className="rq-order-hint"
      data-slot="location.stop"
      onClick={() => stop()}
    >
      {strings.locationStop}
    </button>
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
  // The notice D119 says the details sit behind (the location's own field: it is there whatever
  // paying is).
  const privacyUrl = location.privacyUrl ?? null
  switch (location.prompt) {
    case 'consent':
      return (
        <div
          className="rq-location"
          role="dialog"
          aria-modal="false"
          data-location-prompt="consent"
        >
          <p>
            {strings.locationConsent(location.venueName)}
            {privacyUrl === null ? null : (
              <>
                {' '}
                <a href={privacyUrl} target="_blank" rel="noopener noreferrer">
                  {strings.paying.legalPrivacyLink}
                </a>
              </>
            )}
          </p>
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
          </button>{' '}
          <StopLocationCheck services={services} strings={strings} />
        </div>
      )
    case 'none':
      if (location.state === 'held') {
        // The stop is on the bill where one is drawn; without a bill it sits here.
        return billShown(services?.state) ? null : (
          <div className="rq-location" data-location-prompt="none">
            <StopLocationCheck services={services} strings={strings} />
          </div>
        )
      }
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

/**
 * The "Add" button of an orderable item. Where options do not reach the POS's ticket (#78), an item
 * that needs a choice is ordered from the waiter instead.
 */
export function AddButton({
  item,
  strings,
  send,
  notesAndOptions,
}: {
  readonly item: ViewItem
  readonly strings: ServiceStrings
  readonly send: (command: CommandDraft) => void
  readonly notesAndOptions: boolean
}) {
  if (!notesAndOptions && item.modifierGroups.some((group) => group.required)) {
    return (
      <p className="rq-note" data-order-from-waiter="">
        {strings.orderFromWaiter}
      </p>
    )
  }
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
