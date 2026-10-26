// The guest API's one deep module (D121; design `2026-10-20-guest-api-design.md` §1–§8; tickets
// #75, #76). The routes `GET /api/guest/state` and `POST /api/guest/actions` are thin adapters:
// they read the headers and the body, call `guestState` or `guestAct`, and send what comes back.
// This module owns the order of the checks:
//
// 1. the code's shape, before the database (a wrong shape is `code_retired` at once);
// 2. the code's table, through the pinned lookup (`guestTableByCodeHash`), remembered for 30 s
//    as a hint only: the tenant it names is re-checked in every transaction against the code's
//    hash, so a re-issued or hidden code fails at once;
// 3. the table code's request rate (20 a second), and for a command the phone's own limits
//    (`guest-limits.ts`); a Send's first answer is looked up before them and before Turnstile;
// 4. for a located command (D118, D121, D122 §4: one that adds or changes an on-the-bill line, a
//    Send with on-the-bill lines, the phone's own "Allow location"): a location pass that holds,
//    or the position checked in memory and dropped, then a fresh pass. A Send also needs Turnstile
//    (fail closed; open only when siteverify itself is down, and counted). Removing a line and
//    Undo are never located, and neither is paying;
// 5. for a command: the action id's first answer, the tap's age, the code again, the pass's
//    sitting, the table's rate and the command itself, all inside `applyService`. A Send (#77)
//    first reads the table's menu (`loadSendMenu`) to price its lines, and an accepted one queues
//    the worker's `order-send` for the table (the sweep queues it again if that fails);
// 6. the answer: the server's view projected to what a phone may see (`GuestTableState`), run
//    through the forbidden-values walk (rule 3) before it leaves. Where the venue checks location,
//    a phone without a pass that holds sees no order, no sent orders and no bill.
//
// The position is never written, logged, returned or passed on: it lives in this request's memory
// for the circle test and nothing else.
//
// Time alone changes the order too (an Undo closing, an idle order set aside): a read past the
// order's next change runs `order.tidy` first, so every phone sees it at its next poll (design §6,
// `next_change_at`). The web never calls a POS: opening the bill queues a fresh reading for the
// worker when the shared one is older than 15 s (`wantsFreshReading`, #74).

import { randomUUID } from 'node:crypto'

import {
  type DbPool,
  guestTableByCodeHash,
  sentOrders,
  sittings,
  venues,
  withTenant,
} from '@restro/db'
import { and, eq, isNull } from 'drizzle-orm'

import { TABLE_TOKEN_PATTERN } from '../guest-files'
import type { LocalizedText } from '../locales'
import {
  type GuestPosition,
  LOCATION_CONSENT_VERSION,
  locationPassExpiry,
  locationVerdict,
} from '../location-check'
import { type OrderingSettings, readOrderingSettings } from '../ordering-settings'
import { hashTableCode } from '../qr'
import { orderFromRow, UNDO_WINDOW_MS } from '../table-order'
import { applyService } from './apply-service'
import { forbiddenPaths, wantsFreshReading } from './bill'
import type { ServiceContext } from './context'
import { GuestLimiter, type GuestLimitName, type LimitAnswer } from './guest-limits'
import {
  type LocationPassClaims,
  openLocationPass,
  passHolds,
  sealLocationPass,
} from './location-pass'
import { readTableState, type TableStateRead, type TableStateUnchanged } from './read'
import type { ServiceResult } from './results'
import { loadSendMenu } from './send-menu'

/** The screens a phone polls from (design §6): the menu polls slower than the order and the bill. */
export const GUEST_VIEWS = ['menu', 'order', 'bill'] as const

/** One screen. */
export type GuestView = (typeof GUEST_VIEWS)[number]

/** The poll cadence (D121, design §6): 2 s on the order and the bill or while a Send is in flight. */
export const GUEST_POLL_MS = { fast: 2_000, menu: 10_000 } as const

/** How long a sent order that ended stays in the state (D122 §2: 15 minutes). */
const ENDED_SENT_ORDER_MS = 15 * 60_000

/** How long a waiter call that ended (handled, lapsed) stays in the state, so a phone sees it. */
const ENDED_WAITER_CALL_MS = 5 * 60_000

/** One line of the order as a phone sees it: no price, no name. */
export interface GuestOrderLine {
  readonly id: string
  readonly itemId: string
  readonly optionIds: readonly string[]
  readonly qty: number
  readonly note: string
  readonly rev: number
  /** Paid with the table's bill or before it is sent (pay first, part 2). */
  readonly mode: 'on_bill' | 'pay_first'
  /** The payment that holds the line, or null. */
  readonly held: string | null
}

/**
 * Where the phone stands with the location check (#76): `off` at a venue without it, `held` with a
 * pass that holds, `needed` without one (the order and the bill are then left out).
 */
export type GuestLocationState = 'off' | 'needed' | 'held'

/** The location part of a phone's state. */
export interface GuestLocation {
  readonly state: GuestLocationState
  /** Seconds the pass still lasts, or null without one. */
  readonly passSeconds: number | null
  /** Seconds to the end of the venue's service day: how long a phone remembers its consent. */
  readonly dayEndsInSeconds: number
  /** The venue's name, which the consent text names ("[Venue] and Restro check…"). */
  readonly venueName: string
}

/** What a phone may see of its table (design §3, with D122's words). */
export interface GuestTableState {
  readonly unchanged: false
  readonly version: number
  /** Milliseconds to the next poll. */
  readonly next: number
  readonly table: { readonly label: string }
  /**
   * `notesAndOptions`: notes and options reach the POS's ticket (#78); else the template draws no
   * note field, and items that must have options are ordered from the waiter.
   */
  readonly ordering: {
    readonly state: 'on' | 'paused' | 'closed'
    readonly notesAndOptions: boolean
  }
  readonly location: GuestLocation
  /** The table's order; null without a pass where the venue checks location (D122 §4). */
  readonly order: {
    readonly lines: readonly GuestOrderLine[]
    /** Removed lines while their Undo lasts. */
    readonly removed: readonly {
      readonly id: string
      readonly itemId: string
      readonly optionIds: readonly string[]
      readonly qty: number
      readonly note: string
      readonly undoSeconds: number
    }[]
    /** The order set aside when it went idle ("Earlier order · Restore"), or null. */
    readonly earlier: {
      /** What `order.restore` names (milliseconds since the epoch). */
      readonly setAsideAt: number
      readonly setAsideAgoSeconds: number
      readonly lines: readonly Omit<GuestOrderLine, 'rev' | 'held'>[]
    } | null
  } | null
  /** The sitting's sent orders in flight or ended in the last 15 minutes, newest first. */
  readonly sentOrders: readonly {
    readonly id: string
    readonly state: 'sending' | 'awaiting_approval' | 'added' | 'not_sent' | 'unconfirmed'
    readonly reason: string | null
    /** The short reference a waiter reads (K7Q). */
    readonly ref: string
    /** What was sent, for "Show this to your waiter" (the face names the items from the menu). */
    readonly lines: readonly {
      readonly itemId: string
      readonly optionIds: readonly string[]
      readonly qty: number
      /** The POS said this item ran out, so the order ended Not sent (#80). */
      readonly outOfStock?: true
    }[]
    /** Seconds since it was sent, for the time "Show this to your waiter" gives. */
    readonly sentAgoSeconds: number
  }[]
  /**
   * The table's latest waiter call while it is open, and for a few minutes after it was handled
   * or lapsed; null otherwise (#81). Not hidden by the location check: a call is not located.
   */
  readonly waiterCall: {
    readonly id: string
    readonly state: 'open' | 'done' | 'lapsed'
    readonly calledAgoSeconds: number
  } | null
  /** The table's bill as the last complete reading showed it, or null. */
  readonly bill: {
    readonly readAgoSeconds: number
    readonly complete: boolean
    readonly currency: string | null
    readonly totalMinor: number
    readonly paidMinor: number
    readonly owedMinor: number
    readonly parts: readonly {
      readonly id: string
      readonly beingPaid: boolean
      readonly totalMinor: number
      readonly paidMinor: number
      readonly lines: readonly {
        readonly id: string
        /** Our item's name; null is "Other item", worded by the shell. */
        readonly name: LocalizedText | null
        readonly quantity: string
        readonly amountMinor: number
      }[]
    }[]
  } | null
}

/** "Nothing changed since your version." */
export interface GuestUnchanged {
  readonly unchanged: true
  readonly version: number
  readonly next: number
  /** The phone asks for the whole state again when this differs from the one it holds. */
  readonly location: GuestLocationState
}

/** A command's answer as a phone gets it. */
export interface GuestCommandResult {
  readonly actionId: string | null
  readonly status: 'accepted' | 'rejected'
  readonly code: string | null
  /** What the command made or acted on (the line an add made). */
  readonly subjectId: string | null
  readonly ref: string | null
}

/** Why a guest is answered with no state at all. */
export type GuestRefusal = 'code_retired'

/** A request answered with no state: an unknown code, or a table code past its request rate. */
export type GuestStateless =
  | { readonly ok: false; readonly code: GuestRefusal }
  | { readonly ok: false; readonly code: 'rate_limited'; readonly retryAfter: number }

/** Thrown when an answer would carry a backend value: a bug, answered 500 and never sent. */
export class ForbiddenValueError extends Error {
  constructor(readonly paths: readonly string[]) {
    super(`a guest answer carries backend values at ${paths.join(', ')}`)
  }
}

/** Where a code leads, as the lookup said. */
interface CodeTarget {
  readonly tenantId: string
  readonly venueId: string
  readonly tableId: string
  readonly hash: string
  /**
   * The code's generation. Fixed for the life of a hash: a re-issue gives a new code (a new hash)
   * and raises the generation in one transaction, so the memo never holds a stale generation for
   * a code that still works.
   */
  readonly codeGeneration: number
}

/** How long the code → table memo trusts an answer (design §2: a hint only). */
const MEMO_MS = 30_000
const MEMO_SIZE = 4_000
const memo = new Map<string, { readonly target: CodeTarget | null; readonly until: number }>()

/** The request limits of this process: counts in memory only, never stored (D122 §4). */
const limiter = new GuestLimiter()

/** Forgets every remembered code and every limit's counts (tests). */
export function forgetGuestCodes(): void {
  memo.clear()
  limiter.clear()
}

async function targetOf(pool: DbPool, code: string): Promise<CodeTarget | null> {
  if (!TABLE_TOKEN_PATTERN.test(code)) return null
  const hash = await hashTableCode(code)
  const now = Date.now()
  const known = memo.get(hash)
  if (known !== undefined && known.until > now) return known.target
  const found = await guestTableByCodeHash(pool, hash)
  const target =
    found === null || found.state !== 'live'
      ? null
      : {
          tenantId: found.tenantId,
          venueId: found.venueId,
          tableId: found.tableId,
          hash,
          codeGeneration: found.codeGeneration,
        }
  // Bounded: a full memo starts again (it is a hint, so forgetting costs one lookup each).
  if (memo.size >= MEMO_SIZE) memo.clear()
  memo.set(hash, { target, until: now + MEMO_MS })
  return target
}

/** What the guards need to know of the venue and the table, read once per request. */
interface GuardRead {
  readonly venueName: string
  readonly settings: OrderingSettings
  readonly timezone: string
  readonly dayEndsAt: string
  /** The table's open sitting, or null. */
  readonly sittingId: string | null
}

async function readGuard(pool: DbPool, target: CodeTarget): Promise<GuardRead | null> {
  return withTenant(pool, target.tenantId, async (tx) => {
    const [venue] = await tx
      .select({
        name: venues.name,
        settings: venues.settings,
        timezone: venues.timezone,
        dayEndsAt: venues.serviceDayEndsAt,
      })
      .from(venues)
      .where(eq(venues.id, target.venueId))
    if (venue === undefined) return null
    const [open] = await tx
      .select({ id: sittings.id })
      .from(sittings)
      .where(and(eq(sittings.tableId, target.tableId), isNull(sittings.endedAt)))
    return {
      venueName: venue.name,
      settings: readOrderingSettings(venue.settings),
      timezone: venue.timezone,
      dayEndsAt: venue.dayEndsAt,
      sittingId: open?.id ?? null,
    }
  })
}

/** The claims of a presented pass that holds at this table now, or null. */
function heldClaims(
  pass: string | undefined,
  passKey: string | null | undefined,
  target: CodeTarget,
  sittingId: string | null,
  now: number,
): LocationPassClaims | null {
  if (pass === undefined || passKey == null) return null
  const claims = openLocationPass(pass, passKey)
  if (claims === null) return null
  return passHolds(claims, {
    venueId: target.venueId,
    codeGeneration: target.codeGeneration,
    sittingId,
    now: new Date(now),
  })
    ? claims
    : null
}

/** The location part of the answer. */
function locationOf(
  guard: GuardRead,
  claims: LocationPassClaims | null,
  now: number,
): GuestLocation {
  const dayEnds = locationPassExpiry(new Date(now), 24 * 60, guard.timezone, guard.dayEndsAt)
  const dayEndsInSeconds = seconds(dayEnds.getTime() - now)
  if (!guard.settings.locationCheck) {
    return { state: 'off', passSeconds: null, dayEndsInSeconds, venueName: guard.venueName }
  }
  return {
    state: claims === null ? 'needed' : 'held',
    passSeconds: claims === null ? null : seconds(claims.expiresAt - now),
    dayEndsInSeconds,
    venueName: guard.venueName,
  }
}

const SENT_ORDER_STATES: Readonly<Record<string, GuestTableState['sentOrders'][number]['state']>> =
  {
    waiting: 'sending',
    sending: 'sending',
    checking: 'sending',
    awaiting_approval: 'awaiting_approval',
    added: 'added',
    not_sent: 'not_sent',
    unconfirmed: 'unconfirmed',
  }

const seconds = (ms: number) => Math.max(0, Math.ceil(ms / 1000))

/** The poll cadence for a screen: fast on the order and the bill, and while a Send is in flight. */
function cadence(view: GuestView, inFlight: boolean): number {
  return view === 'menu' && !inFlight ? GUEST_POLL_MS.menu : GUEST_POLL_MS.fast
}

/** The location part when the caller gives none (a venue that doesn't check). */
const LOCATION_OFF: GuestLocation = {
  state: 'off',
  passSeconds: null,
  dayEndsInSeconds: 0,
  venueName: '',
}

/**
 * The server's view of the table as a phone may see it (rule 3: our ids and names only). Where the
 * venue checks location, a phone without a pass that holds (`location.state` `needed`) gets no
 * order, no sent orders and no bill (D122 §4).
 */
export function projectGuestState(
  read: TableStateRead,
  view: GuestView,
  location: GuestLocation = LOCATION_OFF,
): GuestTableState {
  const now = read.now.getTime()
  const sees = location.state !== 'needed'
  const order =
    read.sitting === null || read.order === null
      ? null
      : orderFromRow({ ...read.order, earlier: read.order.earlier })
  const sentOrders = (sees ? read.sentOrders : []).flatMap((sent) => {
    const state = SENT_ORDER_STATES[sent.state]
    if (state === undefined) return []
    const ended = sent.settledAt !== null && now - sent.settledAt.getTime() > ENDED_SENT_ORDER_MS
    return ended
      ? []
      : [
          {
            id: sent.id,
            state,
            reason: sent.reason,
            ref: sent.reference,
            lines: sent.lines,
            sentAgoSeconds: seconds(now - sent.createdAt.getTime()),
          },
        ]
  })
  const inFlight = sentOrders.some(
    (sent) => sent.state === 'sending' || sent.state === 'awaiting_approval',
  )
  const bill = sees ? read.bill : null
  return {
    unchanged: false,
    version: read.version,
    next: cadence(view, inFlight),
    table: { label: read.table.label },
    ordering: {
      state: read.sitting === null ? 'closed' : read.pauses.length > 0 ? 'paused' : 'on',
      notesAndOptions: read.notesAndOptions,
    },
    location,
    order: !sees
      ? null
      : {
          lines: (order?.lines ?? [])
            .filter((line) => line.removedAt === null)
            .map((line) => ({
              id: line.id,
              itemId: line.itemId,
              optionIds: line.optionIds,
              qty: line.qty,
              note: line.note,
              rev: line.rev,
              // Nothing in the menu says an item is paid first yet: every line is on the bill.
              mode: 'on_bill' as const,
              held: line.heldBy,
            })),
          removed: (order?.lines ?? []).flatMap((line) =>
            line.removedAt === null || now - line.removedAt > UNDO_WINDOW_MS
              ? []
              : [
                  {
                    id: line.id,
                    itemId: line.itemId,
                    optionIds: line.optionIds,
                    qty: line.qty,
                    note: line.note,
                    undoSeconds: seconds(UNDO_WINDOW_MS - (now - line.removedAt)),
                  },
                ],
          ),
          earlier:
            order?.earlier == null
              ? null
              : {
                  setAsideAt: order.earlier.at,
                  setAsideAgoSeconds: seconds(now - order.earlier.at),
                  lines: order.earlier.lines.map((line) => ({
                    id: line.id,
                    itemId: line.itemId,
                    optionIds: line.optionIds,
                    qty: line.qty,
                    note: line.note,
                    mode: 'on_bill' as const,
                  })),
                },
        },
    sentOrders,
    waiterCall:
      read.sitting === null ||
      read.waiterCall === null ||
      (read.waiterCall.endedAt !== null &&
        now - read.waiterCall.endedAt.getTime() > ENDED_WAITER_CALL_MS)
        ? null
        : {
            id: read.waiterCall.id,
            state: read.waiterCall.state,
            calledAgoSeconds: seconds(now - read.waiterCall.calledAt.getTime()),
          },
    bill:
      bill === null
        ? null
        : {
            readAgoSeconds: seconds(now - bill.readAt.getTime()),
            complete: bill.complete,
            currency: bill.currency,
            totalMinor: bill.totalMinor,
            paidMinor: bill.paidMinor,
            owedMinor: bill.owedMinor,
            parts: bill.bills.map((part) => ({
              id: part.id,
              beingPaid: part.beingPaid,
              totalMinor: part.totalMinor,
              paidMinor: part.paidMinor,
              lines: part.lines.map((line) => ({
                id: line.id,
                name: line.name,
                quantity: line.quantity,
                amountMinor: line.amountMinor,
              })),
            })),
          },
  }
}

/** Throws unless `answer` is free of every backend value the read knows of (rule 3). */
function walked<T>(answer: T, read: TableStateRead | null): T {
  const paths = forbiddenPaths(answer, read?.backendValues ?? new Set())
  if (paths.length > 0) throw new ForbiddenValueError(paths)
  return answer
}

/** A limit's refusal as the route sends it. */
function limited(answer: Extract<LimitAnswer, { ok: false }>): GuestStateless {
  return { ok: false, code: 'rate_limited', retryAfter: Math.max(1, seconds(answer.retryAfterMs)) }
}

/** What a read of the state needs from its caller. */
export interface GuestStateInput {
  /** The table code from the `Authorization: Table <code>` header. */
  readonly code: string
  /** The version the phone has, or undefined for the whole state. */
  readonly since?: number
  readonly view: GuestView
  /** The location pass the phone holds, from its header, or undefined. */
  readonly pass?: string
  /** `GUEST_PASS_KEY`, or null when the app has none (no pass then holds). */
  readonly passKey?: string | null
  /** The request's id, for the provenance of the changes time made. */
  readonly jobId?: string
  /** The limits' counts; this process's own unless a test passes another. */
  readonly limiter?: GuestLimiter
  /** Queues a fresh reading of the table's bill (the web's job queue); errors are the caller's. */
  readonly queueReading?: (target: {
    readonly tenantId: string
    readonly venueId: string
    readonly tableId: string
  }) => Promise<void>
}

/** Reads a table's state for a phone. */
export async function guestState(
  pool: DbPool,
  input: GuestStateInput,
): Promise<
  { readonly ok: true; readonly answer: GuestTableState | GuestUnchanged } | GuestStateless
> {
  const target = await targetOf(pool, input.code)
  if (target === null) return { ok: false, code: 'code_retired' }
  const codeLimit = (input.limiter ?? limiter).take(target.hash, ['codeRequests'], Date.now())
  if (!codeLimit.ok) return limited(codeLimit)
  const guard = await readGuard(pool, target)
  if (guard === null) return { ok: false, code: 'code_retired' }
  const now = Date.now()
  const claims = guard.settings.locationCheck
    ? heldClaims(input.pass, input.passKey, target, guard.sittingId, now)
    : null

  const read = (since?: number) =>
    readTableState(pool, {
      tenantId: target.tenantId,
      tableId: target.tableId,
      tableCodeHash: target.hash,
      ...(since === undefined ? {} : { since }),
    })

  let state: TableStateRead | TableStateUnchanged | null = await read(input.since)
  if (state === null) return { ok: false, code: 'code_retired' }
  if (state.nextChangeAt !== null && state.nextChangeAt.getTime() <= state.now.getTime()) {
    // Time made the change, not the guest: it runs as the system, like the worker's tick.
    await applyService(
      pool,
      { type: 'order.tidy', tableId: target.tableId },
      {
        tenantId: target.tenantId,
        venueId: target.venueId,
        origin: 'worker',
        actor: { kind: 'system' },
        jobId: input.jobId ?? `guest-read-${randomUUID()}`,
      },
    )
    state = await read(input.since)
    if (state === null) return { ok: false, code: 'code_retired' }
  }
  // The sitting may have ended between the guard's read and this one: the pass holds only for the
  // sitting the state shows.
  const holds = claims !== null && (state.unchanged || state.sitting?.id === claims.sittingId)
  const location = locationOf(guard, holds ? claims : null, now)

  // A poll on the bill asks for a fresh reading on both paths: a reading that found the same bill
  // leaves the version, so most bill polls are answered unchanged. Only a phone that may see it.
  const open = state.unchanged ? state.open : state.sitting !== null
  const billReadAt = state.unchanged ? state.billReadAt : (state.bill?.readAt ?? null)
  if (
    input.view === 'bill' &&
    open &&
    location.state !== 'needed' &&
    input.queueReading !== undefined &&
    wantsFreshReading(billReadAt, state.now)
  ) {
    await input.queueReading({
      tenantId: target.tenantId,
      venueId: target.venueId,
      tableId: target.tableId,
    })
  }
  if (state.unchanged) {
    return {
      ok: true,
      answer: {
        unchanged: true,
        version: state.version,
        next: cadence(input.view, false),
        location: location.state,
      },
    }
  }
  return { ok: true, answer: walked(projectGuestState(state, input.view, location), state) }
}

function guestContext(
  target: CodeTarget,
  jobId: string | undefined,
  located: LocationPassClaims | null,
): ServiceContext {
  return {
    tenantId: target.tenantId,
    venueId: target.venueId,
    origin: 'guest',
    actor: { kind: 'guest' },
    jobId: jobId ?? `guest-${randomUUID()}`,
    tableCodeHash: target.hash,
    ...(located === null
      ? {}
      : { sittingId: located.sittingId, consentVersion: located.consentVersion }),
  }
}

/** The answer a phone gets for a service result. */
export function guestResult(result: ServiceResult): GuestCommandResult {
  // The line an add made, the sent order a Send made or repeats (#78), or the item a refused Send
  // names.
  const subject =
    result.details.lineId ??
    result.details.sentOrderId ??
    result.details.duplicateOf ??
    result.details.itemId
  return {
    actionId: result.actionId,
    status: result.status === 'accepted' ? 'accepted' : 'rejected',
    code: result.status === 'refused' ? result.code : null,
    subjectId: typeof subject === 'string' ? subject : null,
    ref: result.status === 'accepted' ? result.ref : null,
  }
}

/** What Turnstile's siteverify said of a token (the web's call; design §5). */
export type HumanCheckVerdict = 'passed' | 'failed' | 'unavailable'

/** Calls siteverify for `token` with `actionId` as its idempotency key. */
export type HumanCheck = (token: string, actionId: string) => Promise<HumanCheckVerdict>

/** A guard that stopped a command, or Turnstile let through while down: counted, never the position. */
export interface GuardEvent {
  readonly kind:
    | 'location_failed'
    | 'phone_limited'
    | 'code_limited'
    | 'human_check_failed'
    | 'human_check_open'
  readonly venueId: string
  readonly tableId: string
}

/** What the page adds to a command: the position, the consent and Turnstile's token. */
export interface GuestCheck {
  /** Checked in memory and dropped: never written, logged or passed on. */
  readonly location?: GuestPosition
  /** The consent text version the guest allowed (`LOCATION_CONSENT_VERSION`). */
  readonly consentVersion?: string
  /** Turnstile's token, at Send. */
  readonly humanToken?: string
}

/** What a command needs from its caller. */
export interface GuestActInput {
  readonly code: string
  /** The guest's command as the shell's schema parsed it, renamed to the service's `type`. */
  readonly command: { readonly type: string; readonly actionId: string } & Record<string, unknown>
  /** Milliseconds since the guest's tap. */
  readonly ageMs: number
  readonly view: GuestView
  /** The random value the page made at load: the per-phone limits' key, never stored. */
  readonly phone: string
  /** The location pass the phone holds, or undefined. */
  readonly pass?: string
  readonly check?: GuestCheck
  /** `GUEST_PASS_KEY`; without it no pass is issued or held, and located commands are refused. */
  readonly passKey?: string | null
  /** Turnstile's siteverify; without it a Send is refused `human_check` (fail closed). */
  readonly humanCheck?: HumanCheck
  /** Counts a guard's trip (the web logs it with the venue and the table, nothing else). */
  readonly onGuard?: (event: GuardEvent) => void
  readonly jobId?: string
  /** The limits' counts; this process's own unless a test passes another. */
  readonly limiter?: GuestLimiter
  /** Queues the worker's Send for the table (the web's job queue); errors are the caller's. */
  readonly queueSend?: (target: {
    readonly tenantId: string
    readonly venueId: string
    readonly tableId: string
  }) => Promise<void>
}

/** What `guestAct` answers when it reached the table. */
export interface GuestActed {
  readonly ok: true
  readonly result: GuestCommandResult
  readonly state: GuestTableState | null
  /** A fresh location pass for the phone to keep, or null. */
  readonly pass: string | null
  /** Seconds the phone should wait before it tries again (a rate trip), or null. */
  readonly retryAfter: number | null
}

/**
 * The guest commands that reach the engine, each with its tap's age. A Send is guarded here
 * (limits, location, Turnstile) before it reaches the engine, and the phone's own location check is
 * answered here; anything else the shell knows (paying) is answered `not_built` until its ticket.
 * The shell's `service.request` is a call for a waiter (#81).
 */
const GUEST_COMMAND_TYPES: ReadonlySet<string> = new Set([
  'order.add',
  'order.change',
  'order.remove',
  'order.undo',
  'order.restore',
  'order.send',
  'waiter.call',
])

/** The commands this module answers without the engine: "Allow location". */
const GUARDED_HERE: ReadonlySet<string> = new Set(['location.check'])

/**
 * True for a command that must come from a phone at the venue (D121, D122 §4): one that adds or
 * changes an on-the-bill line, a Send with on-the-bill lines, and the phone's own check. Removing a
 * line and Undo never are. Every line is on the bill until the menu can say an item is paid first,
 * so every addition, change and Send is.
 */
function isLocated(type: string): boolean {
  return (
    type === 'order.add' ||
    type === 'order.change' ||
    type === 'order.restore' ||
    type === 'order.send' ||
    type === 'location.check'
  )
}

/** The per-phone limits a command counts against. */
function phoneLimits(command: GuestActInput['command'], withPosition: boolean): GuestLimitName[] {
  const names: GuestLimitName[] = withPosition ? ['locationTries'] : []
  const addition =
    command.type === 'order.add' ||
    command.type === 'order.restore' ||
    (command.type === 'order.change' && typeof command.delta === 'number' && command.delta > 0)
  if (addition) names.push('additions')
  if (command.type === 'order.send') names.push('sendGap', 'sends')
  return names
}

/** True when a Send with this action id already made a sent order (its first answer wins). */
async function sentOrderMade(pool: DbPool, target: CodeTarget, actionId: string): Promise<boolean> {
  return withTenant(pool, target.tenantId, async (tx) => {
    const [made] = await tx
      .select({ id: sentOrders.id })
      .from(sentOrders)
      .where(eq(sentOrders.actionId, actionId))
    return made !== undefined
  })
}

/** Applies one guest command and answers with the fresh state. */
export async function guestAct(
  pool: DbPool,
  input: GuestActInput,
): Promise<GuestActed | GuestStateless> {
  const target = await targetOf(pool, input.code)
  if (target === null) return { ok: false, code: 'code_retired' }
  const { actionId } = input.command
  // The shell's request is a call for a waiter: its kind and note go no further (D122 §4: no text
  // from the guest), and it is never located.
  const type = input.command.type === 'service.request' ? 'waiter.call' : input.command.type
  const reject = (code: string): GuestActed => ({
    ok: true,
    result: { actionId, status: 'rejected', code, subjectId: null, ref: null },
    state: null,
    pass: null,
    retryAfter: null,
  })
  const count = (kind: GuardEvent['kind']) =>
    input.onGuard?.({ kind, venueId: target.venueId, tableId: target.tableId })

  const codeLimit = (input.limiter ?? limiter).take(target.hash, ['codeRequests'], Date.now())
  if (!codeLimit.ok) {
    count('code_limited')
    return limited(codeLimit)
  }
  if (!GUEST_COMMAND_TYPES.has(type) && !GUARDED_HERE.has(type)) return reject('not_built')

  // A Send's first answer comes before every guard, Turnstile's siteverify above all (its token
  // works once): a repeat skips the phone's limits, the location and Turnstile, and the engine
  // answers it with the sent order it made.
  const repeatSend = type === 'order.send' && (await sentOrderMade(pool, target, actionId))

  const position = input.check?.location
  if (!repeatSend) {
    const phoneLimit = (input.limiter ?? limiter).take(
      `${target.hash}:${input.phone}`,
      phoneLimits(input.command, position !== undefined),
      Date.now(),
    )
    if (!phoneLimit.ok) {
      count('phone_limited')
      return limited(phoneLimit)
    }
  }

  const guard = await readGuard(pool, target)
  if (guard === null) return { ok: false, code: 'code_retired' }
  const now = Date.now()
  const checks = guard.settings.locationCheck
  let claims = checks ? heldClaims(input.pass, input.passKey, target, guard.sittingId, now) : null
  let pass: string | null = null
  const located = checks && isLocated(type) && !repeatSend

  if (located && claims === null) {
    if (position === undefined || input.check?.consentVersion !== LOCATION_CONSENT_VERSION) {
      return reject('location_needed')
    }
    if (input.passKey == null) throw new Error('GUEST_PASS_KEY is not set: no location pass')
    // The position's one use: the circle test. It goes nowhere else.
    if (locationVerdict(position, guard.settings.spot, guard.settings.radiusMetres) !== 'inside') {
      count('location_failed')
      return reject('location_failed')
    }
    if (guard.sittingId === null) return reject('table_not_open')
    const fresh: LocationPassClaims = {
      v: 1,
      venueId: target.venueId as LocationPassClaims['venueId'],
      sittingId: guard.sittingId as LocationPassClaims['sittingId'],
      codeGeneration: target.codeGeneration,
      expiresAt: locationPassExpiry(
        new Date(now),
        guard.settings.passMinutes,
        guard.timezone,
        guard.dayEndsAt,
      ).getTime(),
      consentVersion: LOCATION_CONSENT_VERSION,
    }
    claims = fresh
    pass = sealLocationPass(fresh, input.passKey)
  }

  if (type === 'order.send' && !repeatSend) {
    // Turnstile at an on-the-bill Send only (D119, D121): every line is on the bill for now.
    const token = input.check?.humanToken
    const verdict =
      token === undefined || input.humanCheck === undefined
        ? 'failed'
        : await input.humanCheck(token, actionId)
    if (verdict === 'failed') {
      count('human_check_failed')
      return { ...reject('human_check'), pass }
    }
    if (verdict === 'unavailable') count('human_check_open')
  }

  if (type === 'location.check') {
    if (!checks) {
      return {
        ok: true,
        result: { actionId, status: 'accepted', code: null, subjectId: null, ref: null },
        state: null,
        pass: null,
        retryAfter: null,
      }
    }
    if (claims === null) return reject('table_not_open')
    const state = await readTableState(pool, {
      tenantId: target.tenantId,
      tableId: target.tableId,
      tableCodeHash: target.hash,
    })
    if (state === null) return { ok: false, code: 'code_retired' }
    const holds = !state.unchanged && state.sitting?.id === claims.sittingId
    return {
      ok: true,
      result: holds
        ? { actionId, status: 'accepted', code: null, subjectId: null, ref: null }
        : { actionId, status: 'rejected', code: 'location_needed', subjectId: null, ref: null },
      state: state.unchanged
        ? null
        : walked(
            projectGuestState(state, input.view, locationOf(guard, holds ? claims : null, now)),
            state,
          ),
      pass: holds ? pass : null,
      retryAfter: null,
    }
  }

  const command =
    type === 'waiter.call'
      ? { type, actionId, tableId: target.tableId, ageMs: input.ageMs }
      : { ...input.command, tableId: target.tableId, ageMs: input.ageMs }
  // A Send prices its lines from the table's menu, read before the transaction; the pass's consent
  // version goes on the sent order with the pass's sitting (D119).
  const sendMenu =
    type === 'order.send' && !repeatSend
      ? await loadSendMenu(pool, {
          tenantId: target.tenantId,
          venueId: target.venueId,
          tableId: target.tableId,
        })
      : null
  const { result, state } = await applyService(
    pool,
    command,
    guestContext(target, input.jobId, located ? claims : null),
    sendMenu === null ? {} : { sendMenu },
  )
  if (result.status === 'refused' && result.code === 'code_retired') {
    return { ok: false, code: 'code_retired' }
  }
  if (type === 'order.send' && result.status === 'accepted' && input.queueSend !== undefined) {
    await input.queueSend({
      tenantId: target.tenantId,
      venueId: target.venueId,
      tableId: target.tableId,
    })
  }
  // The engine refuses a located command whose pass names a sitting that has since ended.
  const lost = result.status === 'refused' && result.code === 'location_needed'
  const holds =
    !lost &&
    claims !== null &&
    (state === null || state.unchanged || state.sitting?.id === claims.sittingId)
  const projected =
    state === null || state.unchanged
      ? null
      : walked(
          projectGuestState(state, input.view, locationOf(guard, holds ? claims : null, now)),
          state,
        )
  return {
    ok: true,
    result: guestResult(result),
    state: projected,
    pass: holds ? pass : null,
    retryAfter: result.status === 'refused' && result.code === 'rate_limited' ? 10 : null,
  }
}
