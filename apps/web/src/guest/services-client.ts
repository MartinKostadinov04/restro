// The guest page's services client (D121; design `2026-10-20-guest-api-design.md` §6, §8; #75):
// the only code that fetches the guest API. It keeps the table's state for the face:
//
// - It polls `GET /api/guest/state` with the version it has (`since`), waiting what the server
//   says (`next`: 2 s on the order and the bill, 10 s on the menu). A failed poll backs off 4, 8,
//   16, then 30 s, each with a little jitter; a 429 waits its `Retry-After`. After about 10 s
//   without an answer the state says `offline`, so the face can say so. A 401 (`code_retired`)
//   stops it: the table's code is no longer the table's.
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
//   without asking. "Not now" is remembered for the day; the guest's own "Allow location" tap
//   asks again. The pass the server hands back is kept in the tab's session storage and sent in
//   `X-Restro-Pass`; every command carries `X-Restro-Phone`, the value made at load. A Send asks
//   the page for Turnstile's token first.
//
// Pure TypeScript with its timers, clock and fetch passed in, so tests drive it without a page.

import {
  applyOrderEdit,
  type GuestPosition,
  LOCATION_CONSENT_VERSION,
  type OrderEdit,
  orderLineIdFor,
  type TableOrderDraft,
  type TableOrderLine,
  UNDO_WINDOW_MS,
} from '@restro/core'
import {
  type CommandResult,
  EMPTY_SERVICE_STATE,
  GUEST_PASS_HEADER,
  GUEST_PHONE_HEADER,
  type GuestActionAnswer,
  GuestActionAnswerSchema,
  type GuestApiView,
  type GuestCheck,
  type GuestCommand,
  GuestStateAnswerSchema,
  type GuestTableState,
  type LocationControls,
  type LocationView,
  type OrderLineView,
  type ServiceState,
  TABLE_AUTH_SCHEME,
} from '@restro/shell'

/** The back-off after failed polls, in milliseconds; the last one repeats. */
export const POLL_BACKOFF_MS = [4_000, 8_000, 16_000, 30_000] as const

/** Without an answer for this long, the state says `offline`. */
export const OFFLINE_AFTER_MS = 10_000

/** What the client needs from the page; tests pass their own. */
export interface TableServicesDeps {
  /** The table's code, sent in `Authorization: Table <code>`. */
  readonly code: string
  readonly fetch: (url: string, init: RequestInit) => Promise<Response>
  /** Milliseconds since the epoch. */
  readonly now: () => number
  readonly setTimer: (run: () => void, ms: number) => () => void
  /** 0 ≤ x < 1, for the jitter. */
  readonly random?: () => number
  /** Where the API lives (the page's own origin by default). */
  readonly base?: string
  /** The random value the page made at load (`newPhoneValue`): the per-phone limits' key. */
  readonly phone: string
  /** The tab's session storage, or none; failures inside are the page's to swallow. */
  readonly memory?: SessionMemory
  /** The phone's position, or null when the guest refused it or it took too long. */
  readonly locate?: () => Promise<GuestPosition | null>
  /** Turnstile's token for a Send, or null when the widget gave none. */
  readonly humanToken?: () => Promise<string | null>
}

/** What the client keeps in the tab's session storage. */
export interface SessionMemory {
  readonly get: (key: string) => string | null
  readonly set: (key: string, value: string) => void
  readonly remove: (key: string) => void
}

/** The session storage key of the location pass. */
export const PASS_KEY = 'restro.locationPass'

/** The session storage key of the guest's consent answer, kept until the service day ends. */
export const CONSENT_KEY = 'restro.locationConsent'

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
  /** Starts polling (again): when the page shows. */
  readonly start: () => void
  /** Stops polling: when the page hides or goes away. */
  readonly stop: () => void
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
const LOCATED = new Set(['order.add', 'order.change', 'order.restore', 'order.send'])

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

/** A client for one table. Call `start()` to begin polling. */
export function createTableServices(deps: TableServicesDeps): TableServices {
  const random = deps.random ?? Math.random
  const base = deps.base ?? ''
  const listeners = new Set<() => void>()
  let server: GuestTableState | null = null
  let pending: Pending[] = []
  let retired = false
  let lastAnswerAt = deps.now()
  let failures = 0
  let running = false
  let cancelTimer: (() => void) | null = null
  let polling = false
  let state: ServiceState = EMPTY_SERVICE_STATE
  /** The next poll asks for the whole state: the location changed under an unchanged version. */
  let whole = false
  let pass: string | null = deps.memory?.get(PASS_KEY) ?? null
  let prompt: LocationView['prompt'] = 'none'
  /** The edit kept while the consent screen is up, with its tap's time. */
  let waiting: { readonly command: GuestCommand; readonly tappedAt: number } | null = null

  /** The guest's answer this service day (kept with its end and the consent text's version). */
  function consent(): Consent {
    const kept = deps.memory?.get(CONSENT_KEY)
    if (kept == null) return 'unknown'
    const [answer, version, until] = kept.split(':')
    if (version !== LOCATION_CONSENT_VERSION || !(Number(until) > deps.now())) return 'unknown'
    return answer === 'allowed' || answer === 'declined' ? answer : 'unknown'
  }

  function remember(answer: 'allowed' | 'declined'): void {
    const dayEnds = deps.now() + (server?.location.dayEndsInSeconds ?? 0) * 1000
    deps.memory?.set(CONSENT_KEY, `${answer}:${LOCATION_CONSENT_VERSION}:${dayEnds}`)
  }

  function keepPass(next: string | null): void {
    pass = next
    if (next === null) deps.memory?.remove(PASS_KEY)
    else deps.memory?.set(PASS_KEY, next)
  }

  const offline = () => running && deps.now() - lastAnswerAt > OFFLINE_AFTER_MS

  function recompute(): void {
    const now = deps.now()
    state = {
      ...EMPTY_SERVICE_STATE,
      revision: server?.version ?? 0,
      order: server?.order == null ? null : orderView(server.order, pending, now),
      ordering: retired
        ? { state: 'closed' }
        : server === null
          ? null
          : { state: server.ordering.state },
      offline: offline(),
      location:
        server === null || server.location.state === 'off'
          ? null
          : {
              state: server.location.state,
              prompt,
              consent: consent(),
              venueName: server.location.venueName,
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

  /** The screen the polls are for: the order's cadence while anyone at the table is ordering. */
  function view(): GuestApiView {
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
    try {
      const since = server === null || whole ? '' : `&since=${server.version}`
      whole = false
      const response = await deps.fetch(`${base}/api/guest/state?view=${view()}${since}`, {
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
        const answer = GuestStateAnswerSchema.parse(await response.json())
        failures = 0
        lastAnswerAt = deps.now()
        // An edit on its way brings its own fresh state; a poll from before it would draw it twice.
        if (!answer.unchanged && pending.length === 0) accept(answer)
        if (answer.unchanged && server !== null && answer.location !== server.location.state) {
          whole = true
          wait = 0
        } else {
          wait = answer.next
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
    return deps.fetch(`${base}/api/guest/actions`, {
      method: 'POST',
      headers: {
        ...headers(),
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

    if (retired) return settle(answer('rejected', 'code_retired'))
    const check: { location?: GuestPosition; consentVersion?: string; humanToken?: string } = {}
    if (position !== null) {
      check.location = position
      check.consentVersion = LOCATION_CONSENT_VERSION
    }
    if (command.kind === 'order.send' && deps.humanToken !== undefined) {
      const token = await deps.humanToken().catch(() => null)
      if (token !== null) check.humanToken = token
    }
    let response: Response
    try {
      response = await post(command, Math.max(0, deps.now() - tappedAt), check)
    } catch {
      // The answer was lost: the edit may or may not be in. The next poll shows which.
      schedule(0)
      return settle(answer('pending', null))
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
      return settle(answer(response.status >= 500 ? 'pending' : 'rejected', null))
    }
    let body: GuestActionAnswer
    try {
      body = GuestActionAnswerSchema.parse(await response.json())
    } catch {
      schedule(0)
      return settle(answer('pending', null))
    }
    lastAnswerAt = deps.now()
    if (body.pass !== null) keepPass(body.pass)
    if (body.state !== null) accept(body.state)
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
    if (position === null) {
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
      prompt = 'consent'
      recompute()
    },
    dismiss() {
      waiting = null
      prompt = 'none'
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
    start() {
      if (running || retired) return
      running = true
      lastAnswerAt = deps.now()
      schedule(0)
    },
    stop() {
      running = false
      cancelTimer?.()
      cancelTimer = null
      recompute()
    },
  }
}

function retryAfterOf(response: Response): number | null {
  const value = Number(response.headers.get('retry-after'))
  return Number.isFinite(value) && value > 0 ? value : null
}
