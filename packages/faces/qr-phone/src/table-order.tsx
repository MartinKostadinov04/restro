// The table's shared order (D117, D121; #75), as the hidden reference face draws it: the minimum a
// guest and the Playwright specs need to drive the order, not a designed screen. An "Add" button on
// each orderable item (`item.add`), and the order panel (`menu.bag`): its lines with − and + and
// Remove, a removed line's Undo, the earlier order's Restore, and the host's word when ordering is
// paused or the table is closed. Everything drawn comes from the host's state (D72); the host may
// draw an edit before the server answers, and says so per line (`pending`).

import {
  type CommandResult,
  type GuestCommand,
  isGuestRefusalCode,
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

/** Sends commands and keeps the last refusal's words. */
export function useOrderCommands(services: ServiceBinding | undefined, strings: ServiceStrings) {
  const [notice, setNotice] = useState<string | null>(null)
  const send = useCallback(
    async (command: CommandDraft) => {
      if (services === undefined) return
      setNotice(null)
      let result: CommandResult
      try {
        result = await services.dispatch({ ...command, actionId: newActionId() } as GuestCommand)
      } catch {
        setNotice(strings.refusedOther)
        return
      }
      if (result.status === 'rejected') {
        const code = result.code ?? null
        // The location panel answers these itself (the consent screen, the failed check).
        if (code === 'location_needed' || code === 'location_failed') return
        setNotice(
          code !== null && isGuestRefusalCode(code) ? strings.refusals[code] : strings.refusedOther,
        )
      }
    },
    [services, strings],
  )
  return { send, notice }
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
  readonly send: (command: CommandDraft) => void
  readonly notice: string | null
}) {
  const items = useMemo(() => itemsById(view), [view])
  const order = services?.state.order ?? null
  const ordering = services?.state.ordering?.state ?? 'on'
  const nameOf = (itemId: string) => items.get(itemId)?.name.text ?? strings.otherItem
  const lines = order?.lines ?? []
  return (
    <section className="rq-order" data-slot="menu.bag" aria-label={strings.tableOrder}>
      <h2>{strings.tableOrder}</h2>
      {services?.state.offline === true ? (
        <p className="rq-note" role="status">
          {strings.offline}
        </p>
      ) : null}
      <LocationPanel services={services} strings={strings} send={send} />
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
          >
            <span className="rq-order-name">{nameOf(line.itemId)}</span>{' '}
            <span className="rq-order-qty">× {line.qty}</span>
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
    </section>
  )
}

/**
 * The location check (#76, D122 §4), drawn from the host's `location`: the consent screen (Allow /
 * Not now), "Checking your location…", the failed check (Call a waiter / Cancel), and, while the
 * phone has no pass, why the order and the bill are hidden with the guest's own "Allow location".
 */
export function LocationPanel({
  services,
  strings,
  send,
}: {
  readonly services: ServiceBinding | undefined
  readonly strings: ServiceStrings
  readonly send: (command: CommandDraft) => void
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
          <button
            type="button"
            onClick={() => {
              send({ kind: 'service.request', request: 'waiter', note: '' })
              controls.dismiss()
            }}
          >
            {strings.locationCallWaiter}
          </button>{' '}
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
