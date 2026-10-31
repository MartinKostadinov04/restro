// The guest page's services client (D121; design `2026-10-20-guest-api-design.md` §6, §8; #75):
// the only code that fetches the guest API. It keeps the table's state for the face:
//
// - It polls `GET /api/guest/state` with the version it has (`since`), waiting what the server
//   says (`next`: 2 s on the order and the bill, 10 s on the menu). A failed poll backs off 4, 8,
//   16, then 30 s, each with a little jitter; a 429 waits its `Retry-After`. After about 10 s
//   without an answer the state says `offline`, so the face can say so. A 401 (`code_retired`)
//   stops it: the table's code is no longer the table's. Every request (a poll, a payment's poll, an
//   action) is aborted after about 10 s (`REQUEST_TIMEOUT_MS`), and a watch turns `offline` on at
//   the 10 s mark even when no request ends (RR-51). While offline, Send and Pay are refused
//   (`offline`), never queued (D121); an edit still goes (the bag stays editable, D120).
// - The screen the face has open (`setScreen`, RR-52): the bag asks `view=order`, the bill
//   `view=bill` (which makes the server queue a fresh reading of a bill older than 15 s), and the
//   menu the default (`order` while the order has lines, else `menu`).
// - A Send whose answer is lost (the request threw, timed out, came back 5xx or unreadable; RR-50,
//   D120) is answered `pending` with `answer_lost` and shown as `state.sendLost`: the order may
//   already be in the POS, so no second Send goes out for `LOST_SEND_HOLD_MS` and a poll that
//   answered since (the table's sent orders carry no action id: another phone's order cannot be
//   told from this one's, so the time limit alone lets go).
// - "Stop location check" (`location.stop`, D119) drops the pass and remembers "declined".
// - An order edit (`order.add`, `.change`, `.remove`, `.undo`, `.restore`) is drawn at once
//   (optimistic: the shared reducer of `@restro/core`, with the same new line id the server will
//   give) and sent with its tap's age. The server's answer replaces it: its state when accepted,
//   the edit taken back when refused. A lost answer takes the edit back too, and the next poll
//   shows what really happened (D72: no local success). Anything else, a Send above all, is never
//   drawn before the server answers.
// - The location check (#76, D122 §4): where the venue checks, the server answers an addition from
//   a phone without a pass `location_needed`. The first time in a service day the client asks the
//   face for the consent screen and keeps the edit; "Allow" locates the phone (its position goes
//   only into that one request) and sends the edit again with it. Once allowed, later checks run
//   without asking. "Not now", or a browser that blocks location, is remembered for the day, in the
//   durable memory (once per phone, D119); the guest's own "Allow location" tap asks again. The
//   pass the server hands back is kept in the tab's session storage and sent in
//   `X-Restro-Pass`; every command carries `X-Restro-Phone`, the value made at load. A Send asks
//   the page for Turnstile's token first.
// - Paying (#110, #114, D127): the payment handle comes in the answer to the phone's `pay.start` (or
//   to its `order.send` with pay-first lines, #258) and is kept in the tab's session storage (never
//   in an address), so a closed or reloaded page comes back to where the payment stands. While it is not final the client polls `GET
//   /api/guest/payment` with it and the face sees the payment as `state.payment`; the provider's
//   form values stay here (`formValues`) for the page to fill the form slot. `pay.returned` and
//   `pay.cancel` carry the handle in `X-Restro-Payment`. After a redirect back from the card form
//   the page has set a marker, and the client sends `pay.returned` once.
// - Send (#77, D122 §5): the table's sent orders come with the state, and the client marks the ones
//   this phone's Sends made (`mine`, from the accepted answer's subject), so only this phone shows
//   "Sending…". The mark lives in this page's memory: a reload shows them as any phone's.
//
// Pure TypeScript with its timers, clock and fetch passed in, so tests drive it without a page.

import {
  applyOrderEdit,
  type GuestPosition,
  LOCATE_TIMEOUT_MS,
  LOCATION_CONSENT_VERSION,
  type OrderEdit,
  orderLineIdFor,
  type TableOrderDraft,
  type TableOrderLine,
  UNDO_WINDOW_MS,
} from '@restro/core'
import {
  ANSWER_LOST_CODE,
  type CommandResult,
  EMPTY_SERVICE_STATE,
  GUEST_PASS_HEADER,
  GUEST_PAYMENT_HEADER,
  GUEST_PHONE_HEADER,
  type GuestActionAnswer,
  GuestActionAnswerSchema,
  type GuestApiView,
  type GuestCheck,
  type GuestCommand,
  type GuestPaymentAnswer,
  GuestPaymentAnswerSchema,
  type GuestScreen,
  GuestStateAnswerSchema,
  type GuestTableState,
  LOST_SEND_HOLD_MS,
  type LocationControls,
  type LocationView,
  OFFLINE_CODE,
  type OrderLineView,
  PAYMENT_HANDLE_PATTERN,
  type PayingView,
  type PaymentView,
  paymentIsFinal,
  type RequestView,
  type SentOrderView,
  type ServiceState,
  TABLE_AUTH_SCHEME,
  type TableBillView,
  TURNSTILE_PAY_ACTION,
  TURNSTILE_SEND_ACTION,
} from '@restro/shell'

import { processorName } from '../connectors/card-forms'

/** The back-off after failed polls, in milliseconds; the last one repeats. */
export const POLL_BACKOFF_MS = [4_000, 8_000, 16_000, 30_000] as const

/** Without an answer for this long, the state says `offline`. */
export const OFFLINE_AFTER_MS = 10_000

/** A request that has not answered after this long is aborted (D121: "about 10 seconds"). */
export const REQUEST_TIMEOUT_MS = 10_000

/** What the client needs from the page; tests pass their own. */
export interface TableServicesDeps {
  /** The table's code, sent in `Authorization: Table <code>`. */
  readonly code: string
  readonly fetch: (url: string, init: RequestInit) => Promise<Response>
  /** Milliseconds since the epoch. */
  readonly now: () => number
  /**
   * Starts a timer and returns its cancel. `kind` is `'guard'` for the client's own watchdogs (a
   * request's timeout, the offline watch) as opposed to the polls: a host may treat them alike.
   */
  readonly setTimer: (run: () => void, ms: number, kind?: 'guard') => () => void
  /** 0 ≤ x < 1, for the jitter. */
  readonly random?: () => number
  /** Where the API lives (the page's own origin by default). */
  readonly base?: string
  /** The random value the page made at load (`newPhoneValue`): the per-phone limits' key. */
  readonly phone: string
  /** The tab's session storage, or none; failures inside are the page's to swallow. */
  readonly memory?: SessionMemory
  /**
   * The browser's local storage for what must outlive the tab for the sitting: the payment handle
   * and the last payment (see `PAY_HANDLE_KEY`). Falls back to `memory` when absent.
   */
  readonly durable?: SessionMemory
  /** The phone's position, or null when the guest refused it or it took too long. */
  readonly locate?: () => Promise<GuestPosition | typeof LOCATION_BLOCKED | null>
  /** Turnstile's token for a Send, or null when the widget gave none. */
  readonly humanToken?: (action: string) => Promise<string | null>
}

/** What the client keeps in the tab's session storage. */
export interface SessionMemory {
  readonly get: (key: string) => string | null
  readonly set: (key: string, value: string) => void
  readonly remove: (key: string) => void
}

/** The session storage key of the location pass. */
export const PASS_KEY = 'restro.locationPass'

/**
 * The durable key of this phone's payment handle (D127 2.2, log 2.2): in the browser's local
 * storage for the sitting, so a page closed and opened again finds its payment; never in an
 * address. One per table code, ending with the service day. A device with no local storage keeps
 * nothing.
 */
export const PAY_HANDLE_KEY = 'restro.payHandle'

/** The key of one table's handle. */
export const payHandleKey = (code: string): string => `${PAY_HANDLE_KEY}.${code}`

/** Set by the page when it came back from a redirect of the card form: send `pay.returned` once. */
export const PAY_RETURNED_KEY = 'restro.payReturned'

/** The last payment this phone was paid for: `<id>:<amountMinor>:<at ms>`, durable like the handle. */
export const PAY_RECENT_KEY = 'restro.payRecent'

/** The key of one table's last payment. */
export const payRecentKey = (code: string): string => `${PAY_RECENT_KEY}.${code}`

/**
 * The address this phone gave for the venue's electronic receipt (#186), durable like the handle and
 * removed with it: the server erases its copy at the close, so the Paid screen's "sent to …" line
 * is worded from this one, kept only in the guest's own browser and never sent again.
 */
export const PAY_EMAIL_KEY = 'restro.payEmail'

/** The key of one table's receipt address. */
export const payEmailKey = (code: string): string => `${PAY_EMAIL_KEY}.${code}`

/** When a day has no end the server named, a handle is kept this long (hours). */
const DEFAULT_KEEP_HOURS = 6

/**
 * The durable memory's key of the guest's consent answer, one per venue (the consent is to the venue
 * it names, D119), kept until the service day ends. It outlives the tab: "once per phone per
 * service day".
 */
export const CONSENT_KEY = 'restro.locationConsent'

/** The answer to a request for the phone's position that the browser refused or can't give. */
export const LOCATION_BLOCKED = 'blocked'

/** What the browser's location API needs to be here (`navigator.geolocation`). */
type PositionSource = Pick<Geolocation, 'getCurrentPosition'>

/**
 * The phone's position, precise, within about 10 s. `blocked` when the browser refuses it or has no
 * location at all, which counts as a refusal (D119); null when this try just got no answer (no fix,
 * too slow), which says nothing of what the guest wants.
 */
export function locateWith(
  source: PositionSource | undefined,
): Promise<GuestPosition | typeof LOCATION_BLOCKED | null> {
  return new Promise((resolve) => {
    if (source === undefined) {
      resolve(LOCATION_BLOCKED)
      return
    }
    source.getCurrentPosition(
      (position) =>
        resolve({
          lat: position.coords.latitude,
          lng: position.coords.longitude,
          accuracyM: position.coords.accuracy,
        }),
      (error) => resolve(error.code === error.PERMISSION_DENIED ? LOCATION_BLOCKED : null),
      { enableHighAccuracy: true, timeout: LOCATE_TIMEOUT_MS, maximumAge: 0 },
    )
  })
}

/** A fresh phone value from 16 random bytes: base64url, 22 characters. */
export function newPhoneValue(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')
}

/** The client a page holds for one table. */
export interface TableServices {
  readonly getState: () => ServiceState
  readonly subscribe: (listener: () => void) => () => void
  readonly dispatch: (command: GuestCommand) => Promise<CommandResult>
  /** The answers to the location screens. */
  readonly location: LocationControls
  /** The screen the face has open: sets the polls' cadence and what they ask for (RR-52). */
  readonly setScreen: (screen: GuestScreen) => void
  /** This phone's payment: the provider's form values while it awaits the card, or null. */
  readonly formValues: () => PayFormValues | null
  /** "Back to the bill": forgets the payment's screen (and its handle) once it is final. */
  readonly dismissPayment: () => void
  /** Starts polling (again): when the page shows. */
  readonly start: () => void
  /** Stops polling: when the page hides or goes away. */
  readonly stop: () => void
}

/** What the page needs to fill the card form: which provider's and its values. Never a face's. */
export interface PayFormValues {
  readonly provider: string
  readonly values: Readonly<Record<string, string>>
}

/** The table's bill as the face draws it (our ids and the POS's own amounts). */
function tableBillOf(bill: GuestTableState['bill']): TableBillView | null {
  if (bill === null) return null
  return {
    readAgoSeconds: bill.readAgoSeconds,
    complete: bill.complete,
    currency: 'EUR',
    totalMinor: bill.totalMinor,
    paidMinor: bill.paidMinor,
    owedMinor: bill.owedMinor,
    parts: bill.parts.map((part) => ({
      id: part.id,
      beingPaid: part.beingPaid,
      totalMinor: part.totalMinor,
      paidMinor: part.paidMinor,
      lines: part.lines.map((line) => ({
        id: line.id,
        name: line.name,
        quantity: line.quantity,
        amountMinor: line.amountMinor,
        beingPaid: line.beingPaid,
      })),
    })),
    paidLines: bill.paidLines,
  }
}

/** The paying phone's payment as the face sees it: the provider's form values stay behind. */
function paymentViewOf(answer: GuestPaymentAnswer, receiptEmail: string | null): PaymentView {
  return {
    id: answer.id,
    mode: answer.mode,
    number: answer.number,
    state: answer.state,
    reason: answer.reason,
    currency: answer.currency as PaymentView['currency'],
    amountMinor: answer.amountMinor,
    tipMinor: answer.tipMinor,
    lines: answer.lines,
    paidAt: answer.paidAt,
    receiptEmailed: answer.receiptEmailed,
    receiptEmail,
    timeZone: answer.timeZone,
    form: answer.form === null ? null : { confirmSeconds: answer.form.confirmSeconds },
  }
}

/** The kinds drawn before the server answers. */
const OPTIMISTIC = new Set([
  'order.add',
  'order.change',
  'order.remove',
  'order.undo',
  'order.restore',
])

type Pending = { readonly actionId: string; readonly edit: OrderEdit }

/** The commands the server may answer `location_needed`: additions, changes and a Send. */
const LOCATED = new Set(['order.add', 'order.change', 'order.restore', 'order.send', 'pay.start'])

/** The commands that name the phone's payment by its handle. */
const BY_HANDLE = new Set(['pay.returned', 'pay.cancel'])

type Consent = LocationView['consent']

/** An order edit as the shared reducer takes it. */
function editOf(command: GuestCommand): OrderEdit | null {
  switch (command.kind) {
    case 'order.add':
      return {
        type: 'order.add',
        itemId: command.itemId,
        optionIds: command.optionIds,
        qty: command.qty,
        note: command.note,
      }
    case 'order.change':
      return { type: 'order.change', lineId: command.lineId, delta: command.delta }
    case 'order.remove':
      return { type: 'order.remove', lineId: command.lineId }
    case 'order.undo':
      return { type: 'order.undo', lineId: command.lineId }
    case 'order.restore':
      return { type: 'order.restore', setAsideAt: command.setAsideAt }
    default:
      return null
  }
}

/** The server's order as the shared reducer holds it, at the phone's `now`. */
export function draftOf(
  order: NonNullable<GuestTableState['order']>,
  now: number,
): TableOrderDraft {
  const line = (
    from: { id: string; itemId: string; optionIds: readonly string[]; qty: number; note: string },
    extra: Partial<TableOrderLine>,
  ): TableOrderLine => ({
    id: from.id,
    itemId: from.itemId,
    optionIds: [...from.optionIds],
    qty: from.qty,
    note: from.note,
    rev: 0,
    heldBy: null,
    removedAt: null,
    ...extra,
  })
  return {
    lines: [
      ...order.lines.map((live) => line(live, { rev: live.rev, heldBy: live.held })),
      ...order.removed.map((gone) =>
        line(gone, { removedAt: now - (UNDO_WINDOW_MS - gone.undoSeconds * 1000) }),
      ),
    ],
    earlier:
      order.earlier === null
        ? null
        : { at: order.earlier.setAsideAt, lines: order.earlier.lines.map((l) => line(l, {})) },
    idleExpiresAt: null,
  }
}

/** The face's view of the order: the server's, with the edits still on their way drawn on it. */
export function orderView(
  server: NonNullable<GuestTableState['order']>,
  pending: readonly Pending[],
  now: number,
): NonNullable<ServiceState['order']> {
  let draft = draftOf(server, now)
  for (const { actionId, edit } of pending) {
    const outcome = applyOrderEdit(draft, edit, { now, newLineId: orderLineIdFor(actionId) })
    if (outcome.ok) draft = outcome.order
  }
  const known = new Map<string, NonNullable<GuestTableState['order']>['lines'][number]>(
    server.lines.map((line) => [line.id, line]),
  )
  const modeOf = (id: string) =>
    known.get(id)?.mode ??
    server.earlier?.lines.find((line) => line.id === (id as typeof line.id))?.mode ??
    'on_bill'
  const lines: OrderLineView[] = draft.lines
    .filter((line) => line.removedAt === null)
    .map((line) => ({
      id: line.id,
      itemId: line.itemId as OrderLineView['itemId'],
      optionIds: line.optionIds as OrderLineView['optionIds'],
      qty: line.qty,
      note: line.note,
      mode: modeOf(line.id),
      held: line.heldBy !== null,
      pending: known.get(line.id)?.qty !== line.qty,
    }))
  const removed = draft.lines.flatMap((line) =>
    line.removedAt === null || now - line.removedAt >= UNDO_WINDOW_MS
      ? []
      : [
          {
            id: line.id,
            itemId: line.itemId as OrderLineView['itemId'],
            optionIds: line.optionIds as OrderLineView['optionIds'],
            qty: line.qty,
            note: line.note,
            mode: modeOf(line.id),
            undoSeconds: Math.ceil((UNDO_WINDOW_MS - (now - line.removedAt)) / 1000),
          },
        ],
  )
  return {
    lines,
    removed,
    earlier:
      draft.earlier === null
        ? null
        : {
            setAsideAt: draft.earlier.at,
            lines: draft.earlier.lines.map((line) => ({
              id: line.id,
              itemId: line.itemId as OrderLineView['itemId'],
              optionIds: line.optionIds as OrderLineView['optionIds'],
              qty: line.qty,
              note: line.note,
              mode: modeOf(line.id),
            })),
          },
  }
}

/**
 * The table's waiter call as the face's requests (#81, #180): one call per table holds the kinds
 * its guests asked for, so the shell sees one request per kind, each with the call's status and the
 * call's id as its action id (the sheet then shows them as the open request). A call nobody
 * answered in time is one the team could not take ("Ask your waiter").
 */
function requestsOf(call: NonNullable<GuestTableState['waiterCall']>): RequestView[] {
  const status: RequestView['status'] =
    call.state === 'open' ? 'sent' : call.state === 'done' ? 'done' : 'rejected'
  return call.kinds.map((kind) => ({
    id: `${call.id}:${kind}`,
    actionId: call.id,
    kind,
    status,
    note: '',
  }))
}

/** A client for one table. Call `start()` to begin polling. */
export function createTableServices(deps: TableServicesDeps): TableServices {
  const random = deps.random ?? Math.random
  const base = deps.base ?? ''
  const listeners = new Set<() => void>()
  let server: GuestTableState | null = null
  let pending: Pending[] = []
  let retired = false
  let lastAnswerAt = deps.now()
  /** When the oldest request still without an answer went out, or null: nothing is outstanding. */
  let awaitingSince: number | null = null
  /** Counts the location stops: a poll that went out before one has its answer discarded. */
  let generation = 0
  /** Turns `offline` on at the 10 s mark when no request ends to compute it (RR-51). */
  let cancelWatch: (() => void) | null = null
  /**
   * A Send of this phone whose answer was lost, and when. The table's sent orders carry no action id,
   * so this phone's order cannot be told from another's: only the hold's time limit lets go.
   */
  let lost: { readonly at: number } | null = null
  /** The screen the face says is open, or null: the default cadence. */
  let screen: GuestScreen | null = null
  let failures = 0
  let running = false
  let cancelTimer: (() => void) | null = null
  let polling = false
  let state: ServiceState = EMPTY_SERVICE_STATE
  /** The next poll asks for the whole state: the location changed under an unchanged version. */
  let whole = false
  let pass: string | null = deps.memory?.get(PASS_KEY) ?? null
  const durable = deps.durable ?? deps.memory
  /** This phone's payment handle and what the last poll of its payment answered. */
  let handle: string | null = readHandle()
  // An address outlives no handle: one whose handle expired or never held is forgotten at once
  // (the memory cannot list its keys, so another table's stale address waits for its own visit).
  if (handle === null) durable?.remove(payEmailKey(deps.code))
  /** The address this phone gave with its payment, for the Paid screen's line (#186). */
  let receiptEmail: string | null =
    handle === null ? null : (durable?.get(payEmailKey(deps.code)) ?? null)
  /** The state of an unconfirmed payment the guest sent away with "Back to the bill". */
  let hidden: { readonly id: string; readonly state: string } | null = null
  let payment: GuestPaymentAnswer | null = null
  let cancelPayTimer: (() => void) | null = null
  let payPolling = false
  let recentNoted: string | null = null
  let prompt: LocationView['prompt'] = 'none'
  /** The sent orders this phone's Sends made. */
  const mine = new Set<string>()
  /** The edit kept while the consent screen is up, with its tap's time. */
  let waiting: { readonly command: GuestCommand; readonly tappedAt: number } | null = null

  /** The guest's answer this service day (kept with its end and the consent text's version). */
  function consent(): Consent {
    const key = consentKey()
    const kept = key === null ? null : durable?.get(key)
    if (key === null || kept == null) return 'unknown'
    const [answer, version, until] = kept.split(':')
    if (version !== LOCATION_CONSENT_VERSION || !(Number(until) > deps.now())) {
      durable?.remove(key)
      return 'unknown'
    }
    return answer === 'allowed' || answer === 'declined' ? answer : 'unknown'
  }

  /** The answer's key at this venue; none before the server has named the venue. */
  function consentKey(): string | null {
    return server === null ? null : `${CONSENT_KEY}:${server.location.venueName}`
  }

  function remember(answer: 'allowed' | 'declined'): void {
    const key = consentKey()
    if (key === null) return
    const dayEnds = deps.now() + (server?.location.dayEndsInSeconds ?? 0) * 1000
    durable?.set(key, `${answer}:${LOCATION_CONSENT_VERSION}:${dayEnds}`)
  }

  function keepPass(next: string | null): void {
    pass = next
    if (next === null) deps.memory?.remove(PASS_KEY)
    else deps.memory?.set(PASS_KEY, next)
  }

  // Offline is about 10 s without an answer to a request that went out (or keeps failing), never the
  // idle gap before the next scheduled poll.
  const offline = () =>
    running && awaitingSince !== null && deps.now() - awaitingSince > OFFLINE_AFTER_MS

  /** Notes an answer from the server: nothing is awaited any more, and the watch is let go. */
  function answered(): void {
    lastAnswerAt = deps.now()
    awaitingSince = null
    cancelWatch?.()
    cancelWatch = null
  }

  function armWatch(): void {
    cancelWatch?.()
    cancelWatch = running
      ? deps.setTimer(
          () => {
            cancelWatch = null
            recompute()
          },
          OFFLINE_AFTER_MS + 1,
          'guard',
        )
      : null
  }

  /**
   * Waits for `work` at most `REQUEST_TIMEOUT_MS`: after that it gives up (and calls `abort`) even
   * when the request ignores the abort, so nothing waits on a stalled connection for a minute.
   */
  function guarded<T>(work: Promise<T>, abort: () => void = () => {}): Promise<T> {
    let cancel = () => {}
    const timedOut = new Promise<never>((_, reject) => {
      cancel = deps.setTimer(
        () => {
          abort()
          reject(new Error('no answer in time'))
        },
        REQUEST_TIMEOUT_MS,
        'guard',
      )
    })
    return Promise.race([work, timedOut]).finally(cancel)
  }

  /** A request of the guest API that gives up after about 10 s. */
  function request(url: string, init: RequestInit): Promise<Response> {
    // The first request with no answer yet starts the clock, and the watch turns offline on with it.
    if (awaitingSince === null) {
      awaitingSince = deps.now()
      armWatch()
    }
    const controller = new AbortController()
    return guarded(deps.fetch(url, { ...init, signal: controller.signal }), () =>
      controller.abort(),
    )
  }

  /** A response's JSON, with the same limit: the body can stall after the headers came. */
  const readJson = (response: Response): Promise<unknown> => guarded(response.json())

  /** Lets go of a lost Send once its hold is over and a poll answered since (or it showed up). */
  function releaseLost(): void {
    if (lost !== null && deps.now() - lost.at >= LOST_SEND_HOLD_MS && lastAnswerAt > lost.at) {
      lost = null
    }
  }

  /** The handle kept for this table, unless the service day it was kept for has ended. */
  function readHandle(): string | null {
    const kept = durable?.get(payHandleKey(deps.code))
    if (kept == null) return null
    const [value, until] = kept.split('|')
    if (value === undefined || !(Number(until) > deps.now())) {
      durable?.remove(payHandleKey(deps.code))
      return null
    }
    return PAYMENT_HANDLE_PATTERN.test(value) ? value : null
  }

  /** The last payment this phone was paid for, from the durable memory. */
  function recent(): PayingView['recent'] {
    const kept = durable?.get(payRecentKey(deps.code))
    if (kept == null) return null
    const [, amount, at] = kept.split(':')
    const amountMinor = Number(amount)
    const startedAt = Number(at)
    if (!Number.isSafeInteger(amountMinor) || !Number.isFinite(startedAt)) return null
    return { amountMinor, agoSeconds: Math.max(0, Math.round((deps.now() - startedAt) / 1000)) }
  }

  function payingView(from: GuestTableState): PayingView {
    return {
      state: from.ordering.paying,
      minCardMinor: from.ordering.minCardMinor,
      processor: processorName(from.ordering.payingProvider),
      venueName: from.location.venueName,
      legal: from.ordering.payingLegal,
      electronicReceipt: from.ordering.receiptEmail,
      recent: recent(),
    }
  }

  /** Keeps the handle until the service day ends, or forgets it. */
  function keepHandle(next: string | null): void {
    handle = next
    hidden = null
    if (next === null) {
      durable?.remove(payHandleKey(deps.code))
      durable?.remove(payEmailKey(deps.code))
      receiptEmail = null
      return
    }
    const hours = DEFAULT_KEEP_HOURS * 3_600
    const seconds = Math.max(60, server?.location.dayEndsInSeconds ?? hours)
    durable?.set(payHandleKey(deps.code), `${next}|${deps.now() + seconds * 1000}`)
  }

  /** Notes the payment once it is paid, for the "same amount" check (D127). */
  function noteRecent(answer: GuestPaymentAnswer): void {
    if (answer.amountMinor === null || answer.state !== 'captured') return
    if (recentNoted === answer.id) return
    recentNoted = answer.id
    durable?.set(payRecentKey(deps.code), `${answer.id}:${answer.amountMinor}:${deps.now()}`)
  }

  /** The payment is the unconfirmed one the guest sent away, and it has not moved since. */
  function isHidden(answer: GuestPaymentAnswer): boolean {
    return hidden !== null && hidden.id === answer.id && hidden.state === answer.state
  }

  function schedulePay(ms: number): void {
    cancelPayTimer?.()
    cancelPayTimer = running && handle !== null ? deps.setTimer(pollPayment, ms) : null
  }

  /** Reads this phone's payment by its handle until it is final. */
  async function pollPayment(): Promise<void> {
    if (!running || retired || payPolling || handle === null) return
    payPolling = true
    let wait: number | null = null
    try {
      const response = await request(`${base}/api/guest/payment`, {
        method: 'GET',
        headers: { ...headers(), [GUEST_PAYMENT_HEADER]: handle },
        cache: 'no-store',
        referrerPolicy: 'no-referrer',
      })
      if (response.status === 401) {
        retired = true
      } else if (response.status === 404) {
        // The payment is not known (its day ended, or another table's): the phone forgets it.
        payment = null
        keepHandle(null)
      } else if (!response.ok) {
        wait = backoff(retryAfterOf(response))
      } else {
        const answer = GuestPaymentAnswerSchema.parse(await readJson(response))
        failures = 0
        answered()
        payment = answer
        noteRecent(answer)
        if (paymentIsFinal(paymentViewOf(answer, receiptEmail))) schedule(0)
        // Unconfirmed is read on: a manager's answer moves it to captured or released.
        else wait = answer.next
      }
    } catch {
      wait = backoff(null)
    } finally {
      payPolling = false
    }
    recompute()
    if (wait !== null) schedulePay(wait)
  }

  function recompute(): void {
    const now = deps.now()
    releaseLost()
    state = {
      ...EMPTY_SERVICE_STATE,
      revision: server?.version ?? 0,
      tableBill: server === null ? null : tableBillOf(server.bill),
      paying: server === null || retired ? null : payingView(server),
      payment: payment === null || isHidden(payment) ? null : paymentViewOf(payment, receiptEmail),
      order: server?.order == null ? null : orderView(server.order, pending, now),
      requests: server?.waiterCall == null ? [] : requestsOf(server.waiterCall),
      ordering: retired
        ? { state: 'closed', retired: true }
        : server === null
          ? null
          : {
              state: server.ordering.state,
              notesAndOptions: server.ordering.notesAndOptions,
              payFirst: server.ordering.payFirst,
              tips: server.ordering.tips,
              night: server.ordering.night,
            },
      offline: offline(),
      sendLost: lost === null ? null : { ref: null },
      sentOrders: (server?.sentOrders ?? []).map(
        (sent): SentOrderView => ({
          id: sent.id,
          state: sent.state,
          reason: sent.reason,
          ref: sent.ref,
          lines: sent.lines,
          sentAt: now - sent.sentAgoSeconds * 1000,
          sentClock: sent.sentClock,
          mine: mine.has(sent.id),
          ...(sent.unpaid === true ? { unpaid: true as const } : {}),
        }),
      ),
      location:
        server === null || server.location.state === 'off'
          ? null
          : {
              state: server.location.state,
              prompt,
              consent: consent(),
              venueName: server.location.venueName,
              privacyUrl: server.location.privacyUrl,
            },
    }
    for (const listener of listeners) listener()
  }

  function headers(): Record<string, string> {
    return {
      Authorization: `${TABLE_AUTH_SCHEME} ${deps.code}`,
      ...(pass === null ? {} : { [GUEST_PASS_HEADER]: pass }),
    }
  }

  /**
   * The screen the polls are for: what the face says is open (the bill, the bag), else the order's
   * cadence while anyone at the table is ordering.
   */
  function view(): GuestApiView {
    if (screen === 'bill') return 'bill'
    if (screen === 'bag') return 'order'
    return (server?.order?.lines.length ?? 0) > 0 || pending.length > 0 ? 'order' : 'menu'
  }

  function accept(next: GuestTableState): void {
    if (server !== null && next.version < server.version) return
    server = next
    // The server saw no pass that holds: the one kept is dead (its sitting ended, or the code).
    if (next.location.state === 'needed' && pass !== null) keepPass(null)
  }

  function schedule(ms: number): void {
    cancelTimer?.()
    cancelTimer = running ? deps.setTimer(poll, ms) : null
  }

  function backoff(retryAfterSeconds: number | null): number {
    const step = POLL_BACKOFF_MS[Math.min(failures, POLL_BACKOFF_MS.length - 1)] ?? 30_000
    failures += 1
    const jittered = step * (0.8 + random() * 0.4)
    return Math.max(jittered, (retryAfterSeconds ?? 0) * 1000)
  }

  async function poll(): Promise<void> {
    if (!running || retired || polling) return
    polling = true
    let wait: number
    const asked = view()
    const born = generation
    try {
      const since = server === null || whole ? '' : `&since=${server.version}`
      whole = false
      const response = await request(`${base}/api/guest/state?view=${asked}${since}`, {
        method: 'GET',
        headers: headers(),
        cache: 'no-store',
        referrerPolicy: 'no-referrer',
      })
      if (response.status === 401) {
        retired = true
        recompute()
        return
      }
      if (!response.ok) {
        wait = backoff(retryAfterOf(response))
      } else {
        const answer = GuestStateAnswerSchema.parse(await readJson(response))
        failures = 0
        answered()
        if (born !== generation) {
          // The location check was stopped while this poll was out: its answer is of the old pass,
          // so it is dropped and the whole state is asked for again at once.
          whole = true
          wait = 0
        } else {
          // An edit on its way brings its own fresh state; a poll from before it would draw it twice.
          if (!answer.unchanged && pending.length === 0) accept(answer)
          if (
            answer.unchanged &&
            server !== null &&
            (answer.location !== server.location.state ||
              answer.night !== server.ordering.night.state)
          ) {
            whole = true
            wait = 0
          } else {
            // The face opened another screen while this one was out: ask again for that one at once.
            wait = view() === asked ? answer.next : 0
          }
        }
      }
    } catch {
      wait = backoff(null)
    } finally {
      polling = false
    }
    recompute()
    schedule(wait)
  }

  async function post(command: GuestCommand, ageMs: number, check: GuestCheck): Promise<Response> {
    return request(`${base}/api/guest/actions`, {
      method: 'POST',
      headers: {
        ...headers(),
        ...(BY_HANDLE.has(command.kind) && handle !== null
          ? { [GUEST_PAYMENT_HEADER]: handle }
          : {}),
        [GUEST_PHONE_HEADER]: deps.phone,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        command,
        ageMs,
        view: view(),
        ...(Object.keys(check).length === 0 ? {} : { check }),
      }),
      cache: 'no-store',
      referrerPolicy: 'no-referrer',
    })
  }

  /** Sends one command, with the phone's position when it has one for it. */
  async function send(
    command: GuestCommand,
    tappedAt: number,
    position: GuestPosition | null,
  ): Promise<CommandResult> {
    const edit = OPTIMISTIC.has(command.kind) ? editOf(command) : null
    if (edit !== null) {
      pending = [...pending, { actionId: command.actionId, edit }]
      recompute()
    }
    const settle = (result: CommandResult): CommandResult => {
      pending = pending.filter((entry) => entry.actionId !== command.actionId)
      recompute()
      return result
    }
    const answer = (
      status: CommandResult['status'],
      code: string | null,
      extra: Partial<CommandResult> = {},
    ): CommandResult => ({
      actionId: command.actionId,
      status,
      message: null,
      ref: null,
      code,
      ...extra,
    })

    /** The outcome is unknown: for a Send the order may already be in the POS (D120). */
    const unknown = (): CommandResult => {
      if (command.kind === 'order.send') {
        lost = { at: deps.now() }
      }
      return settle(answer('pending', ANSWER_LOST_CODE))
    }

    if (retired) return settle(answer('rejected', 'code_retired'))
    // A payment is named by the handle only this phone holds: without one there is nothing to name.
    if (BY_HANDLE.has(command.kind) && handle === null) {
      return settle(answer('rejected', 'unknown_payment'))
    }
    const check: { location?: GuestPosition; consentVersion?: string; humanToken?: string } = {}
    if (position !== null) {
      check.location = position
      check.consentVersion = LOCATION_CONSENT_VERSION
    }
    if ((command.kind === 'order.send' || command.kind === 'pay.start') && deps.humanToken) {
      const action = command.kind === 'pay.start' ? TURNSTILE_PAY_ACTION : TURNSTILE_SEND_ACTION
      const token = await deps.humanToken(action).catch(() => null)
      if (token !== null) check.humanToken = token
    }
    let response: Response
    try {
      response = await post(command, Math.max(0, deps.now() - tappedAt), check)
    } catch {
      // The answer was lost: the edit may or may not be in. The next poll shows which.
      schedule(0)
      return unknown()
    }
    if (response.status === 401) {
      retired = true
      return settle(answer('rejected', 'code_retired'))
    }
    if (response.status === 429) {
      schedule(backoff(retryAfterOf(response)))
      return settle(answer('rejected', 'rate_limited'))
    }
    if (!response.ok) {
      schedule(0)
      return response.status >= 500 ? unknown() : settle(answer('rejected', null))
    }
    let body: GuestActionAnswer
    try {
      body = GuestActionAnswerSchema.parse(await readJson(response))
    } catch {
      schedule(0)
      return unknown()
    }
    answered()
    if (body.pass !== null) keepPass(body.pass)
    if (
      command.kind === 'order.send' &&
      body.result.status === 'accepted' &&
      body.result.subjectId !== null
    ) {
      mine.add(body.result.subjectId)
    }
    if (body.state !== null) accept(body.state)
    // The payment this phone started, by a Pay or by a Send with pay-first lines (#258, D113): its
    // handle is kept, and its payment is read until it is final.
    if (
      (command.kind === 'pay.start' ||
        (command.kind === 'order.send' && command.payFirst !== undefined)) &&
      body.handle !== null
    ) {
      keepHandle(body.handle)
      // The address the guest gave, kept as long as the handle (the line after Paid names it). A
      // Send takes none: the pay-first payment has no receipt field.
      receiptEmail = command.kind === 'pay.start' ? (command.receiptEmail ?? null) : null
      if (receiptEmail === null) durable?.remove(payEmailKey(deps.code))
      else durable?.set(payEmailKey(deps.code), receiptEmail)
      payment = null
      recentNoted = null
      schedulePay(0)
    } else if (command.kind === 'pay.returned' || command.kind === 'pay.cancel') {
      schedulePay(0)
    }
    return settle(
      answer(body.result.status, body.result.code, {
        ref: body.result.ref,
        subjectId: body.result.subjectId,
      }),
    )
  }

  /** Locates the phone and sends `command` again with its position; the failed screen on a miss. */
  async function locateAndSend(command: GuestCommand, tappedAt: number): Promise<CommandResult> {
    prompt = 'checking'
    recompute()
    const position = await (deps.locate?.() ?? Promise.resolve(null)).catch(() => null)
    if (position === null || position === LOCATION_BLOCKED) {
      // A browser that blocks location counts as a refusal: not asked again today (D119). The
      // guest's own "Allow location" tap still asks.
      if (position === LOCATION_BLOCKED) remember('declined')
      prompt = 'failed'
      recompute()
      return {
        actionId: command.actionId,
        status: 'rejected',
        message: null,
        ref: null,
        code: 'location_failed',
      }
    }
    const result = await send(command, tappedAt, position)
    prompt = result.code === 'location_failed' ? 'failed' : 'none'
    recompute()
    return result
  }

  async function dispatch(command: GuestCommand): Promise<CommandResult> {
    const refused = (status: CommandResult['status'], code: string): CommandResult => ({
      actionId: command.actionId,
      status,
      message: null,
      ref: null,
      code,
    })
    // Send and Pay are blocked while the phone is offline, never queued (D121); the bag stays editable.
    if ((command.kind === 'order.send' || command.kind === 'pay.start') && offline()) {
      return refused('rejected', OFFLINE_CODE)
    }
    // A Send whose answer was lost may be in the POS already: no second one until it shows up (D120).
    releaseLost()
    if (command.kind === 'order.send' && lost !== null) return refused('pending', ANSWER_LOST_CODE)
    const tappedAt = deps.now()
    const result = await send(command, tappedAt, null)
    if (result.code !== 'location_needed' || !LOCATED.has(command.kind)) return result
    // The server needs the phone's location for this one (D122 §4).
    switch (consent()) {
      case 'allowed':
        return locateAndSend(command, tappedAt)
      case 'unknown':
        waiting = { command, tappedAt }
        prompt = 'consent'
        recompute()
        return result
      case 'declined':
        return result
    }
  }

  const location: LocationControls = {
    async allow() {
      remember('allowed')
      const kept = waiting
      waiting = null
      if (kept !== null) return locateAndSend(kept.command, kept.tappedAt)
      const check: GuestCommand = { kind: 'location.check', actionId: crypto.randomUUID() }
      const result = await locateAndSend(check, deps.now())
      return result.status === 'rejected' && result.code === 'location_failed' ? result : null
    },
    decline() {
      remember('declined')
      waiting = null
      prompt = 'none'
      recompute()
    },
    reopen() {
      // The answer is kept for the phone and the service day, but the pass is the tab's own (RR-89):
      // a new tab of a phone that already allowed has no pass, and its tap on "Allow location" only
      // finds the position again, with no second consent screen. After "Not now" or "Stop location
      // check" the screen comes back, as D122 says.
      if (consent() === 'allowed') {
        void location.allow()
        return
      }
      prompt = 'consent'
      recompute()
    },
    dismiss() {
      waiting = null
      prompt = 'none'
      recompute()
    },
    stop() {
      // "Stop location check" (D119): the pass goes, the choice is kept for the day as "Not now" is,
      // and the order and bill are hidden at once, as a phone with no pass has them (the next poll
      // asks for the whole state without the pass and confirms it).
      keepPass(null)
      remember('declined')
      generation += 1
      waiting = null
      prompt = 'none'
      if (server !== null) {
        server = {
          ...server,
          location: { ...server.location, state: 'needed', passSeconds: null },
          order: null,
          bill: null,
          sentOrders: [],
        }
      }
      whole = true
      schedule(0)
      recompute()
    },
  }

  return {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    dispatch,
    location,
    setScreen(next) {
      if (screen === next) return
      const before = view()
      screen = next
      // A screen that asks differently is asked for now (opening the bill reads it fresh, D111).
      if (running && view() !== before && !polling) schedule(0)
      recompute()
    },
    formValues() {
      return payment?.form == null
        ? null
        : { provider: payment.form.provider, values: payment.form.values }
    },
    dismissPayment() {
      // "The venue is checking the payment" is not an end: the handle stays and the payment is read
      // on, and its screen comes back when the manager's answer moves it.
      if (payment !== null && payment.state === 'unconfirmed') {
        hidden = { id: payment.id, state: payment.state }
        recompute()
        return
      }
      payment = null
      keepHandle(null)
      cancelPayTimer?.()
      cancelPayTimer = null
      recompute()
    },
    start() {
      if (running || retired) return
      running = true
      answered()
      schedule(0)
      if (handle !== null) {
        schedulePay(0)
        // Back from a redirect of the card form: the phone's word is a nudge (D127).
        if (deps.memory?.get(PAY_RETURNED_KEY) != null) {
          deps.memory.remove(PAY_RETURNED_KEY)
          void dispatch({ kind: 'pay.returned', actionId: crypto.randomUUID() })
        }
      }
    },
    stop() {
      running = false
      awaitingSince = null
      cancelWatch?.()
      cancelWatch = null
      cancelTimer?.()
      cancelTimer = null
      cancelPayTimer?.()
      cancelPayTimer = null
      recompute()
    },
  }
}

function retryAfterOf(response: Response): number | null {
  const value = Number(response.headers.get('retry-after'))
  return Number.isFinite(value) && value > 0 ? value : null
}
