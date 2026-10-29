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
//
// Paying (#110, D127): `pay.start` takes the phone's limits (one Pay per 15 s, five per 10 minutes,
// one open payment), then Turnstile, then the engine; its answer carries a fresh payment handle,
// of which only the sha-256 goes further. `pay.returned` and `pay.cancel` name the payment by that
// handle. Each queues the worker's next step. `guestPayment` answers the paying phone alone: the
// form's values, the one provider value a guest answer carries, are in no other answer (the walk).

import { createHash, randomBytes, randomUUID } from 'node:crypto'

import {
  billReadings,
  type DbPool,
  guestTableByCodeHash,
  paymentLines,
  payments,
  sentOrders,
  sittings,
  venues,
  withTenant,
} from '@restro/db'
import { and, asc, eq, isNull } from 'drizzle-orm'

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
import { type GuestNight, guestNight } from '../service-hours'
import { orderFromRow, UNDO_WINDOW_MS } from '../table-order'
import type { CallWaiterKind } from '../theme'
import { applyService } from './apply-service'
import { billBackendValues, forbiddenPaths, parseStoredBills, wantsFreshReading } from './bill'
import type { ServiceContext } from './context'
import { GuestLimiter, type GuestLimitName, type LimitAnswer } from './guest-limits'
import {
  type LocationPassClaims,
  openLocationPass,
  passHolds,
  sealLocationPass,
} from './location-pass'
import { isFinalPaymentState } from './pay'
import type { PayFirstState, PayingState } from './pay-first'
import { paymentNumberOf } from './payment-number'
import { readTableState, type TableStateRead, type TableStateUnchanged } from './read'
import type { ServiceResult } from './results'
import { loadSendMenu } from './send-menu'
import { readTableCapabilities } from './table-capabilities'

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
    /** A tip can be given when paying here (D127: the POS records it on the receipt); else none. */
    readonly tips: boolean
    /** An email for the venue's electronic receipt can be given when paying here (D127, #186). */
    readonly receiptEmail: boolean
    /** The venue's night (#82): "Last orders at 04:30", "closed for tonight", opening later. */
    readonly night: GuestNight
    /** Whether pay-first items can be paid at Send here now (#113, #114); no ids. */
    readonly payFirst: PayFirstState
    /**
     * Paying on the bill (#114): `on`, `paused` or `off`, with no ids; the phone shows Pay greyed
     * or "Ask your waiter to pay" from it. The server refuses a Pay either way.
     */
    readonly paying: PayingState
    /** The provider's kind (a public word) when paying is offered, so the screen names it. */
    readonly payingProvider: string | null
    /** The smallest card payment here, in minor units: Pay is greyed below it. */
    readonly minCardMinor: number
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
    /** A pay-first round that is on the POS but whose card was not charged ("No receipt", #114). */
    readonly unpaid?: true
  }[]
  /**
   * The table's latest waiter call while it is open, and for a few minutes after it was handled
   * or lapsed; null otherwise (#81). Not hidden by the location check: a call is not located.
   */
  readonly waiterCall: {
    readonly id: string
    readonly state: 'open' | 'done' | 'lapsed'
    /** What the table asked for (#180), in the venue's list order. */
    readonly kinds: readonly CallWaiterKind[]
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
        /** In a payment that isn't final (D127 2.4): no payer, amount or timer. */
        readonly beingPaid: boolean
      }[]
    }[]
    /** The lines paid in the app in this sitting (D127 1.2): never who paid. */
    readonly paidLines: readonly {
      /** The line's name per language; null is "Other item", worded by the shell. */
      readonly name: LocalizedText | null
      readonly quantity: string
      readonly amountMinor: number
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
  /** Likewise for the night (#82): time alone changes it, under an unchanged version. */
  readonly night: GuestNight['state']
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

/** A pay-first sent order's states the phone hears of only through its payment (#113). */
const PAY_FIRST_UNSHOWN: readonly string[] = ['waiting', 'not_sent', 'unconfirmed']

const seconds = (ms: number) => Math.max(0, Math.ceil(ms / 1000))

/** The poll cadence for a screen: fast on the order and the bill, and while a Send is in flight. */
function cadence(view: GuestView, inFlight: boolean): number {
  return view === 'menu' && !inFlight ? GUEST_POLL_MS.menu : GUEST_POLL_MS.fast
}

/** The location part when the caller gives none (a venue that doesn't check). */
const NIGHT_OPEN: GuestNight = { state: 'open', at: null }

/** The venue's night as a phone is told it, at `now` (milliseconds). */
function nightOf(guard: GuardRead, now: number): GuestNight {
  return guestNight(guard.settings, guard.timezone, guard.dayEndsAt, new Date(now))
}

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
  night: GuestNight = NIGHT_OPEN,
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
    // A pay-first round not on the bill (#113): waiting for its payment, Not sent or unconfirmed,
    // the payment's own screen speaks for it, never a word of a sent order's.
    if (sent.kind === 'pay_first' && PAY_FIRST_UNSHOWN.includes(sent.state)) return []
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
            ...(sent.unpaid ? { unpaid: true as const } : {}),
          },
        ]
  })
  const inFlight = sentOrders.some(
    (sent) => sent.state === 'sending' || sent.state === 'awaiting_approval',
  )
  const bill = sees ? read.bill : null
  // An item paid first at this table (#113): the face sends it with Pay, or offers it through
  // the waiter while pay-first is off.
  const modeOf = (itemId: string) =>
    read.payFirst.items.has(itemId) ? ('pay_first' as const) : ('on_bill' as const)
  return {
    unchanged: false,
    version: read.version,
    next: cadence(view, inFlight),
    table: { label: read.table.label },
    ordering: {
      state: read.sitting === null ? 'closed' : read.pauses.length > 0 ? 'paused' : 'on',
      notesAndOptions: read.notesAndOptions,
      tips: read.tips,
      receiptEmail: read.receiptEmail,
      payFirst: read.sitting === null ? 'off' : read.payFirst.state,
      paying: read.sitting === null ? 'off' : read.paying.state,
      payingProvider: read.paying.state === 'off' ? null : read.paying.provider,
      minCardMinor: read.paying.minCardMinor,
      night,
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
              mode: modeOf(line.itemId),
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
                    mode: modeOf(line.itemId),
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
            kinds: read.waiterCall.kinds,
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
                beingPaid: line.beingPaid,
              })),
            })),
            paidLines: bill.paidLines.map((line) => ({
              name: line.name,
              quantity: shownQuantity(line.quantity),
              amountMinor: line.amountMinor,
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
        night: nightOf(guard, now).state,
      },
    }
  }
  return {
    ok: true,
    answer: walked(projectGuestState(state, input.view, location, nightOf(guard, now)), state),
  }
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
  // The line an add made, the sent order a Send made or repeats (#78), the item a refused Send
  // names, or the payment a Pay made.
  const subject =
    result.details.lineId ??
    result.details.sentOrderId ??
    result.details.duplicateOf ??
    result.details.itemId ??
    result.details.paymentId
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

/** What a token was made for: a Send, or a Pay (each widget names its own action). */
export type HumanCheckUse = 'send' | 'pay'

/** Calls siteverify for `token` with `actionId` as its idempotency key. */
export type HumanCheck = (
  token: string,
  actionId: string,
  use: HumanCheckUse,
) => Promise<HumanCheckVerdict>

/** A payment's id with its venue: what the worker's payment jobs name. */
export interface PaymentTarget {
  readonly tenantId: string
  readonly venueId: string
  readonly paymentId: string
}

/**
 * Queues the worker's next step of a payment (#110): `prepare` prices it and makes the hold, or
 * cancels it; `check` reads the hold from the provider. Errors are the caller's.
 */
export type QueuePayment = (target: PaymentTarget, job: 'prepare' | 'check') => Promise<void>

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
  /** The payment handle from `X-Restro-Payment` (`pay.returned`, `pay.cancel`); never logged. */
  readonly handle?: string
  /** Queues the worker's next step of a payment; without it the phone's poll queues it. */
  readonly queuePayment?: QueuePayment
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
  /**
   * The payment handle, only in the answer to a `pay.start`, or a Send with pay-first lines
   * (#113), that made or repeats a payment.
   */
  readonly handle: string | null
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

/** The guest's pay commands (#110): guarded here, then the engine. Never located (D122 §4). */
const PAY_TYPES: ReadonlySet<string> = new Set(['pay.start', 'pay.returned', 'pay.cancel'])

/** The commands this module answers without the engine: "Allow location". */
const GUARDED_HERE: ReadonlySet<string> = new Set(['location.check'])

/**
 * True for a command that must come from a phone at the venue (D121, D122 §4): one that adds or
 * changes a line, a Send with on-the-bill lines, and the phone's own check. Removing a line and
 * Undo never are. A Send of pay-first lines alone is not (#113): it is paid before it goes.
 * An addition is located whatever its item: the order does not know yet how it will be sent.
 */
function isLocated(command: GuestActInput['command'], type: string): boolean {
  if (type === 'order.send') return !Array.isArray(command.lines) || command.lines.length > 0
  return (
    type === 'order.add' ||
    type === 'order.change' ||
    type === 'order.restore' ||
    type === 'location.check'
  )
}

/** The pay-first part of a Send as the shell's schema parsed it (#113), or null. */
function payFirstOf(command: GuestActInput['command']): {
  readonly lines: unknown
  readonly tipMinor: unknown
  readonly tipPercent: unknown
} | null {
  const part = command.payFirst
  return typeof part === 'object' && part !== null && 'lines' in part
    ? (part as { lines: unknown; tipMinor: unknown; tipPercent: unknown })
    : null
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
  // A Send that pays (#113) counts as a Pay too.
  if (command.type === 'order.send' && payFirstOf(command) !== null) names.push('payGap', 'pays')
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
  // The shell's request is a call for a waiter: its kind goes on and its note goes no further
  // (D122 §4: no text from the guest), and it is never located.
  const type = input.command.type === 'service.request' ? 'waiter.call' : input.command.type
  const reject = (code: string): GuestActed => ({
    ok: true,
    result: { actionId, status: 'rejected', code, subjectId: null, ref: null },
    state: null,
    pass: null,
    retryAfter: null,
    handle: null,
  })
  const count = (kind: GuardEvent['kind']) =>
    input.onGuard?.({ kind, venueId: target.venueId, tableId: target.tableId })

  const codeLimit = (input.limiter ?? limiter).take(target.hash, ['codeRequests'], Date.now())
  if (!codeLimit.ok) {
    count('code_limited')
    return limited(codeLimit)
  }
  if (PAY_TYPES.has(type)) return payAct(pool, input, target, count)
  if (!GUEST_COMMAND_TYPES.has(type) && !GUARDED_HERE.has(type)) return reject('not_built')

  // A Send's first answer comes before every guard, Turnstile's siteverify above all (its token
  // works once): a repeat skips the phone's limits, the location and Turnstile, and the engine
  // answers it with the sent order it made.
  const payFirst = type === 'order.send' ? payFirstOf(input.command) : null
  const repeatSend =
    type === 'order.send' &&
    ((await sentOrderMade(pool, target, actionId)) ||
      (payFirst !== null && (await paymentByAction(pool, target, actionId)) !== null))

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
  const limits = input.limiter ?? limiter
  const subject = `${target.hash}:${input.phone}`
  if (payFirst !== null && !repeatSend) {
    // One open payment per phone, as at Pay (D127 §Limits).
    const open = limits.openPayment(subject)
    if (open !== null && !(await paymentEnded(pool, target, open))) return reject('rate_limited')
  }

  const guard = await readGuard(pool, target)
  if (guard === null) return { ok: false, code: 'code_retired' }
  const now = Date.now()
  const checks = guard.settings.locationCheck
  let claims = checks ? heldClaims(input.pass, input.passKey, target, guard.sittingId, now) : null
  let pass: string | null = null
  const located = checks && isLocated(input.command, type) && !repeatSend

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
    // Turnstile at every Send (D119, D121), one token for both of its parts (#113).
    const token = input.check?.humanToken
    const verdict =
      token === undefined || input.humanCheck === undefined
        ? 'failed'
        : await input.humanCheck(token, actionId, 'send')
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
        handle: null,
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
            projectGuestState(
              state,
              input.view,
              locationOf(guard, holds ? claims : null, now),
              nightOf(guard, now),
            ),
            state,
          ),
      pass: holds ? pass : null,
      retryAfter: null,
      handle: null,
    }
  }

  // A Send that pays gets a fresh handle, a repeat too: the engine stores its hash (#113).
  const handle = payFirst === null ? null : randomBytes(16).toString('base64url')
  const command =
    type === 'waiter.call'
      ? {
          type,
          actionId,
          tableId: target.tableId,
          kind: input.command.request,
          ageMs: input.ageMs,
        }
      : {
          ...input.command,
          tableId: target.tableId,
          ageMs: input.ageMs,
          ...(payFirst === null || handle === null
            ? {}
            : {
                payFirst: {
                  lines: payFirst.lines,
                  tip: tipOfCommand(payFirst),
                  handleHash: hashPaymentHandle(handle),
                },
              }),
        }
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
  if (
    type === 'order.send' &&
    result.status === 'accepted' &&
    typeof result.details.sentOrderId === 'string' &&
    input.queueSend !== undefined
  ) {
    await input.queueSend({
      tenantId: target.tenantId,
      venueId: target.venueId,
      tableId: target.tableId,
    })
  }
  // The Send's payment (#113): the worker prices it and makes the hold, as after a Pay.
  const paymentId = result.details.paymentId
  const paying = result.status === 'accepted' && typeof paymentId === 'string'
  if (paying) {
    limits.setOpenPayment(subject, paymentId)
    await input.queuePayment?.(
      { tenantId: target.tenantId, venueId: target.venueId, paymentId },
      'prepare',
    )
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
          projectGuestState(
            state,
            input.view,
            locationOf(guard, holds ? claims : null, now),
            nightOf(guard, now),
          ),
          state,
        )
  return {
    ok: true,
    result: guestResult(result),
    state: projected,
    pass: holds ? pass : null,
    retryAfter: result.status === 'refused' && result.code === 'rate_limited' ? 10 : null,
    handle: paying ? handle : null,
  }
}

// ---------------------------------------------------------------------------------------------
// Paying (#110)

/** The sha-256 of a payment handle, hex: all that is stored of it (D127 2.2). */
export function hashPaymentHandle(handle: string): string {
  return createHash('sha256').update(handle, 'utf8').digest('hex')
}

/** A payment handle's shape: 16 random bytes, base64url (the shell's `PAYMENT_HANDLE_PATTERN`). */
const HANDLE_PATTERN = /^[A-Za-z0-9_-]{22}$/

/** How long the paying phone waits between polls of its payment. */
const PAYMENT_POLL_MS = 2_000

/** The payment a `pay.start` with this action id made at this table, or null. */
async function paymentByAction(
  pool: DbPool,
  target: CodeTarget,
  actionId: string,
): Promise<{ readonly id: string } | null> {
  return withTenant(pool, target.tenantId, async (tx) => {
    const [made] = await tx
      .select({ id: payments.id })
      .from(payments)
      .where(and(eq(payments.actionId, actionId), eq(payments.tableId, target.tableId)))
    return made ?? null
  })
}

/** True when the payment is final (or gone): the phone may start another. */
async function paymentEnded(pool: DbPool, target: CodeTarget, paymentId: string): Promise<boolean> {
  return withTenant(pool, target.tenantId, async (tx) => {
    const [found] = await tx
      .select({ state: payments.state })
      .from(payments)
      .where(eq(payments.id, paymentId))
    return found === undefined || isFinalPaymentState(found.state)
  })
}

/** The tip a `pay.start` (or a Send's pay-first part) names, in the engine's words: zero first (D127). */
function tipOfCommand(command: Readonly<Record<string, unknown>>) {
  const { tipMinor, tipPercent } = command
  if (typeof tipMinor === 'number' && tipMinor > 0) return { kind: 'amount', minor: tipMinor }
  if (typeof tipPercent === 'number') return { kind: 'percent', percent: tipPercent }
  return { kind: 'none' }
}

/** A pay command: the phone's guards, the engine, and the worker's next step. */
async function payAct(
  pool: DbPool,
  input: GuestActInput,
  target: CodeTarget,
  count: (kind: GuardEvent['kind']) => void,
): Promise<GuestActed | GuestStateless> {
  const { type, actionId } = input.command
  const reject = (code: string): GuestActed => ({
    ok: true,
    result: { actionId, status: 'rejected', code, subjectId: null, ref: null },
    state: null,
    pass: null,
    retryAfter: null,
    handle: null,
  })
  const limits = input.limiter ?? limiter
  const subject = `${target.hash}:${input.phone}`
  let handle: string | null = null
  let command: { readonly type: string; readonly actionId: string } & Record<string, unknown>

  if (type === 'pay.start') {
    // A repeat of the same tap (its answer was lost) skips the guards: its Turnstile token is
    // spent, and the payment is already counted. The engine gives it a fresh handle.
    const repeat = await paymentByAction(pool, target, actionId)
    if (repeat === null) {
      const phoneLimit = limits.take(subject, ['payGap', 'pays'], Date.now())
      if (!phoneLimit.ok) {
        count('phone_limited')
        return limited(phoneLimit)
      }
      const open = limits.openPayment(subject)
      if (open !== null && !(await paymentEnded(pool, target, open))) return reject('rate_limited')
      // Turnstile at every Pay (D127 §Limits): fail closed, open only when siteverify is down.
      const token = input.check?.humanToken
      const verdict =
        token === undefined || input.humanCheck === undefined
          ? 'failed'
          : await input.humanCheck(token, actionId, 'pay')
      if (verdict === 'failed') {
        count('human_check_failed')
        return reject('turnstile')
      }
      if (verdict === 'unavailable') count('human_check_open')
    }
    handle = randomBytes(16).toString('base64url')
    command = {
      type,
      actionId,
      tableId: target.tableId,
      ageMs: input.ageMs,
      handleHash: hashPaymentHandle(handle),
      pick: input.command.pick,
      seen: input.command.seen,
      tip: tipOfCommand(input.command),
      // The guest's email for the venue's electronic receipt (D127, #186): the engine's schema
      // checks it, and refuses it where the connector declares no electronic receipt.
      ...(input.command.receiptEmail === undefined
        ? {}
        : { receiptEmail: input.command.receiptEmail }),
    }
  } else {
    if (input.handle === undefined || !HANDLE_PATTERN.test(input.handle)) {
      return reject('unknown_payment')
    }
    command = {
      type,
      actionId,
      tableId: target.tableId,
      ageMs: input.ageMs,
      handleHash: hashPaymentHandle(input.handle),
    }
  }

  const { result, state } = await applyService(
    pool,
    command,
    guestContext(target, input.jobId, null),
  )
  if (result.status === 'refused' && result.code === 'code_retired') {
    return { ok: false, code: 'code_retired' }
  }
  const paymentId = result.details.paymentId
  if (result.status === 'accepted' && typeof paymentId === 'string') {
    const paid = { tenantId: target.tenantId, venueId: target.venueId, paymentId }
    const next = result.details.state
    if (type === 'pay.start') limits.setOpenPayment(subject, paymentId)
    // The worker takes it from here; a job that can't be queued is queued again by the phone's
    // poll of its payment (`guestPayment`).
    const job =
      type === 'pay.start' || next === 'cancelling'
        ? 'prepare'
        : next === 'awaiting_guest'
          ? 'check'
          : null
    if (job !== null) await input.queuePayment?.(paid, job)
  }

  // Paying is never located: the state is drawn as the phone's pass allows (D122 §4).
  const guard = await readGuard(pool, target)
  if (guard === null) return { ok: false, code: 'code_retired' }
  const now = Date.now()
  const claims = guard.settings.locationCheck
    ? heldClaims(input.pass, input.passKey, target, guard.sittingId, now)
    : null
  const holds =
    claims !== null && (state === null || state.unchanged || state.sitting?.id === claims.sittingId)
  const projected =
    state === null || state.unchanged
      ? null
      : walked(
          projectGuestState(
            state,
            input.view,
            locationOf(guard, holds ? claims : null, now),
            nightOf(guard, now),
          ),
          state,
        )
  return {
    ok: true,
    result: guestResult(result),
    state: projected,
    pass: null,
    retryAfter: null,
    handle: result.status === 'accepted' ? handle : null,
  }
}

/** What the paying phone sees of its payment (the shell's `GuestPaymentAnswer`). */
export interface GuestPaymentView {
  readonly id: string
  /** `pay_first`: the payment of a round paid at Send; `bill`: lines of the table's bill. */
  readonly mode: 'bill' | 'pay_first'
  /** The short number the guest shows the waiter on the Paid screen (`paymentNumberOf`). */
  readonly number: string
  readonly state: string
  readonly reason: string | null
  readonly currency: string
  readonly amountMinor: number | null
  readonly tipMinor: number
  readonly lines: readonly {
    /** The line's name per language; null is "Other item", worded by the shell. */
    readonly name: LocalizedText | null
    readonly quantity: string
    readonly amountMinor: number
  }[]
  /** When it was captured (an ISO instant), or null: the Payment confirmation's time. */
  readonly paidAt: string | null
  /**
   * The guest's electronic receipt, once paid (D127, #186): `sent` where Restro sent the POS's
   * file, `requested` where the POS sends it itself; null where none went out and the waiter
   * brings paper (the guest gave no email, or no receipt was issued).
   */
  readonly receiptEmailed: 'sent' | 'requested' | null
  /** The venue's time zone (IANA): the confirmation shows the time there (D127 1.4). */
  readonly timeZone: string
  /** The card form: only while the payment awaits the guest. */
  readonly form: {
    readonly provider: string
    readonly values: Readonly<Record<string, string>>
    readonly confirmSeconds: number
  } | null
  readonly next: number
}

/** What `guestPayment` needs from its caller. */
export interface GuestPaymentInput {
  /** The table code from `Authorization: Table <code>`. */
  readonly code: string
  /** The payment handle from `X-Restro-Payment`: never logged, never stored. */
  readonly handle: string
  readonly limiter?: GuestLimiter
  /** Queues the worker's next step when the payment waits on it (recovery after a lost job). */
  readonly queuePayment?: QueuePayment
}

/** The states the worker moves on: a poll that finds one queues the step again. */
const WORKER_STEP: Readonly<Record<string, 'prepare'>> = {
  requested: 'prepare',
  priced: 'prepare',
  cancelling: 'prepare',
  // The route after the hold (#111).
  held: 'prepare',
  queued: 'prepare',
  isolated: 'prepare',
  // A pay-first round on the payment table (#113), after its entry or a manager's "On the till".
  entered: 'prepare',
  checked: 'prepare',
  closed: 'prepare',
}

/** An unconfirmed close a manager or owner answered: the worker captures or puts the lines back. */
const ANSWERED = ['receipt_printed', 'no_receipt']

/**
 * The worker job a payment waits on, or null where it waits on the guest, staff or nothing. The
 * phone's poll queues it, and so does whoever moved the payment there (a manager's answer: "On the
 * till" leaves it `entered`, "Not on the till" `cancelling`), so the worker never waits for
 * recovery.
 */
export function paymentWorkerJob(payment: {
  readonly state: string
  readonly reason: string | null
}): 'prepare' | null {
  const step = WORKER_STEP[payment.state]
  if (step !== undefined) return step
  return payment.state === 'unconfirmed' && ANSWERED.includes(payment.reason ?? '')
    ? 'prepare'
    : null
}

/** A decimal quantity as the bill shows it: "2.000000" is "2", "0.500000" is "0.5". */
function shownQuantity(quantity: string): string {
  return quantity.includes('.') ? quantity.replace(/\.?0+$/, '') : quantity
}

/**
 * Reads the paying phone's own payment (`GET /api/guest/payment`, #110). The handle names it, and
 * the table's code must still lead to its table. The answer is walked against every backend value
 * of the table's bill and the payment; the form's values are the one provider value it carries.
 */
export async function guestPayment(
  pool: DbPool,
  input: GuestPaymentInput,
): Promise<
  | { readonly ok: true; readonly answer: GuestPaymentView }
  | GuestStateless
  | { readonly ok: false; readonly code: 'unknown_payment' }
> {
  const target = await targetOf(pool, input.code)
  if (target === null) return { ok: false, code: 'code_retired' }
  const codeLimit = (input.limiter ?? limiter).take(target.hash, ['codeRequests'], Date.now())
  if (!codeLimit.ok) return limited(codeLimit)
  if (!HANDLE_PATTERN.test(input.handle)) return { ok: false, code: 'unknown_payment' }
  const handleHash = hashPaymentHandle(input.handle)

  const found = await withTenant(pool, target.tenantId, async (tx) => {
    const [payment] = await tx
      .select()
      .from(payments)
      .where(
        and(
          eq(payments.handleHash, handleHash),
          eq(payments.tableId, target.tableId),
          eq(payments.venueId, target.venueId),
        ),
      )
    if (payment === undefined) return null
    const lines = await tx
      .select({
        ref: paymentLines.posLineRef,
        name: paymentLines.name,
        quantity: paymentLines.quantity,
        amountMinor: paymentLines.posAmountMinor,
        closedQuantity: paymentLines.closedQuantity,
        closedMinor: paymentLines.closedMinor,
      })
      .from(paymentLines)
      .where(eq(paymentLines.paymentId, payment.id))
      .orderBy(asc(paymentLines.position))
    const [reading] = await tx
      .select({ bills: billReadings.bills })
      .from(billReadings)
      .where(eq(billReadings.tableId, target.tableId))
    const [venue] = await tx
      .select({ timezone: venues.timezone })
      .from(venues)
      .where(eq(venues.id, target.venueId))
    const capabilities = await readTableCapabilities(tx, target.tableId)
    return {
      payment,
      lines,
      capabilities,
      now: new Date(),
      bills: reading?.bills,
      timeZone: venue?.timezone ?? 'Europe/Sofia',
    }
  })
  if (found === null) return { ok: false, code: 'unknown_payment' }
  const { payment, lines } = found

  const step = paymentWorkerJob(payment)
  const overdue =
    payment.state === 'awaiting_guest' &&
    payment.confirmBy !== null &&
    payment.confirmBy.getTime() <= found.now.getTime()
  const job = step ?? (overdue ? 'check' : null)
  if (job !== null) {
    await input.queuePayment?.(
      { tenantId: target.tenantId, venueId: target.venueId, paymentId: payment.id },
      job,
    )
  }

  const values: Record<string, string> = {}
  for (const [key, value] of Object.entries(payment.formValues ?? {})) {
    if (typeof value === 'string') values[key] = value
  }
  const answer: GuestPaymentView = {
    id: payment.id,
    mode: payment.kind === 'pay_first' ? 'pay_first' : 'bill',
    number: paymentNumberOf(payment.id),
    state: payment.state,
    reason: payment.reason,
    currency: payment.currency,
    amountMinor: payment.amountMinor,
    tipMinor: payment.tipMinor,
    // A captured payment shows the lines the POS closed, at what it closed them for, so the lines
    // plus the tip are the total (#197); before that, the lines the guest confirmed.
    lines: lines.flatMap((line) => {
      if (payment.state !== 'captured') {
        return [
          {
            name: line.name,
            quantity: shownQuantity(line.quantity),
            amountMinor: line.amountMinor,
          },
        ]
      }
      return line.closedMinor === null || line.closedQuantity === null
        ? []
        : [
            {
              name: line.name,
              quantity: shownQuantity(line.closedQuantity),
              amountMinor: line.closedMinor,
            },
          ]
    }),
    paidAt: payment.state === 'captured' ? (payment.settledAt?.toISOString() ?? null) : null,
    // A captured payment whose paper receipt is not to be brought had its electronic one go out
    // (the worker passes that at the capture, #186, #200).
    receiptEmailed:
      payment.state === 'captured' && payment.receiptToBringAt === null
        ? found.capabilities.electronicReceiptFile
          ? 'sent'
          : 'requested'
        : null,
    timeZone: found.timeZone,
    form:
      payment.state === 'awaiting_guest' && payment.formValues !== null
        ? {
            provider: payment.providerKind,
            values,
            confirmSeconds: seconds(
              (payment.confirmBy?.getTime() ?? found.now.getTime()) - found.now.getTime(),
            ),
          }
        : null,
    next: PAYMENT_POLL_MS,
  }
  // Every value of the bill and the payment that is the backend's, the provider's reference and
  // the form's values among them: none may appear outside the form (rule 3).
  const backend = billBackendValues(parseStoredBills(found.bills))
  for (const line of lines) if (line.ref !== null) backend.add(line.ref)
  if (payment.providerPaymentRef !== null) backend.add(payment.providerPaymentRef)
  for (const value of Object.values(values)) backend.add(value)
  const paths = forbiddenPaths({ ...answer, form: null }, backend)
  if (paths.length > 0) throw new ForbiddenValueError(paths)
  return { ok: true, answer }
}
