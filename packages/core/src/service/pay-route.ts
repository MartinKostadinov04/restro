// The payment route after the hold (#111; D122 §8, D124 §1, D127 §The route; design §5.1 steps
// 5–9, §5.3, §6): the worker's compare-and-sets from `held` to captured, released, unconfirmed,
// stranded or capture failed, and the staff's answer to an unconfirmed close.
//
//   held ─claim_table─▶ queued ─(a table)─isolated─▶ isolated ─checked─▶ checked ─closed─▶ closed ─captured─▶ captured
//    │                    │                              │                      │                   └──▶ capture_failed
//    └──── busy / paused ─┴─▶ cancelling ◀─ undone ◀─────┘ check_failed          └─▶ unconfirmed ─answer─▶ (receipt printed: capture)
//                                  │                                                              (no receipt: undone → cancelling,
//                                  └──▶ released (or stranded)                                     or lines not back → unconfirmed)
//
// - The queue (D124 §1): a held payment joins its bar's queue, or the venue's where its table has
//   no bar (then the payment tables with no bar serve it). First come, first served: it takes the
//   n-th free payment table, n being the payments ahead of it. A table counts as free only when the
//   worker just read it empty and no payment holds it. After 60 seconds of waiting the payment is
//   cancelled `busy` (or `paying_paused` while ordering is paused).
// - The payment owns its payment table from `queued` until it is final and a read shows the table
//   empty (`payment.table_freed`): the lock has no deadline, nothing takes it over.
// - The worker moves the lines (`isolateLines`) and puts them back (`undoIsolate`) only while it
//   holds the real table's write turn (`payment.turn`, the table's `order_slot`), so no send adds a
//   round to the bill meanwhile.
// - The last check (`payment.checked`): the isolated bill shows exactly the confirmed lines and
//   amounts, still open; anything else stops the payment (`check_failed`), which the worker undoes.
//   A lower amount only when a fresh read of the real table shows the missing line was voided.
// - Once a close was attempted (a `payAndClose` step), the payment is never undone or released:
//   an unknown or refused close is `unconfirmed` until a manager or owner answers "Receipt
//   printed" (capture) or "No receipt" (put the lines back, release). A close may still land
//   after the read-back window (C52): after "No receipt" the hold is released only once the lines
//   are proven back on the real table. Otherwise the payment is `unconfirmed` again
//   (`lines_not_back`) and a manager answers once more: "Receipt printed" captures, "No receipt"
//   releases and settles it `stranded`, with no move back tried (#153).
// - Money alerts go through #83's alert kinds (`alert-rules.ts`); every step is a `payment.state`
//   Log entry, kept as a record.
//
// Paying pauses only stop a payment from joining the queue: once its lines moved, the route runs
// to its end, whatever the sitting does (staff may end a sitting at any time).

import {
  alerts,
  logEntries,
  paymentAccounts,
  paymentLines,
  paymentSteps,
  payments,
  venueTables,
} from '@restro/db'
import { and, desc, eq, gt, inArray, isNull, lt, or, sql } from 'drizzle-orm'
import { z } from 'zod'

import { idSchema, newId } from '../ids'
import { addMinor } from '../money'
import { DecimalQuantitySchema } from '../quantity'
import { SERVICE_TIMINGS, type ServiceTimings } from '../timings'
import {
  PAYMENT_CAPTURE_FAILED_KIND,
  PAYMENT_CHECK_FAILED_KIND,
  PAYMENT_HOLD_EXPIRED_KIND,
  PAYMENT_LINES_NOT_BACK_KIND,
  PAYMENT_RELEASE_REFUSED_KIND,
  PAYMENT_STRANDED_KIND,
  PAYMENT_STUCK_KIND,
  PAYMENT_UNCONFIRMED_KIND,
} from './alert-rules'
import { defineCommand, type ServiceTx } from './definition'
import {
  freePaymentTable,
  type LeaseKey,
  leaseLedgerKey,
  lockLeases,
  readLease,
  releaseLease,
  takeLease,
  takePaymentTable,
} from './leases'
import { recordRetainUntil } from './log'
import { orderingPaused } from './pause-scope'
import {
  closeAttempted,
  isFinalPaymentState,
  lockSentOrder,
  logPayment,
  PAYMENT_QUEUE_MS,
  type PaymentRow,
  quantityKey,
  signedSumMinor,
} from './pay'
import { settlePayFirstSentOrder } from './pay-first-sent-order'
import { payingPaused } from './paying-pause'
import type { Permission } from './permissions'
import { accepted, type ResultDetails, refused, type ServiceResult } from './results'
import { BUDGET_WAIT_MS, LEASE_MARGIN_MS } from './send-timings'

/** The pause before each POS write of the route, inside the POS's calls per second (5 for the pilot). */
export const PAYMENT_WRITE_PAUSE_MS = 1_000

/**
 * How long one hold of the real table's write turn lasts, in whole seconds, for these timings: one
 * move with its reads (the payment table and the real table before it, one read back after it),
 * the pause and the write. One undo (a read, the write, a read back, the real table's read that
 * proves the lines back) fits too. Derived from the
 * timings as the send's slot leases are (`slotLeaseSeconds`), so the turn never passes mid-move.
 */
export function paymentTurnSeconds(timings: ServiceTimings = SERVICE_TIMINGS): number {
  const read = BUDGET_WAIT_MS + timings.readTimeoutMs
  const write = BUDGET_WAIT_MS + timings.writeTimeoutMs
  return Math.ceil((3 * read + PAYMENT_WRITE_PAUSE_MS + write + LEASE_MARGIN_MS) / 1_000)
}

/** The real table's write turn for the default timings. */
export const PAYMENT_TURN_SECONDS = paymentTurnSeconds()

/** A wait for a payment table longer than this is counted (#111). */
export const PAYMENT_LONG_WAIT_MS = 10_000

/**
 * The staff's answers to an unconfirmed payment. To a close (#111): "Receipt printed" or "No
 * receipt". To a pay-first round whose entry is not known or whose check failed (#113), where no
 * close was attempted: the round is on the till (`on_till`: checked again, then closed and
 * captured as usual) or it is not (`not_on_till`: the hold is released). Staff words come with the
 * Tonight screen (#115).
 */
export const PAYMENT_ANSWERS = ['receipt_printed', 'no_receipt', 'on_till', 'not_on_till'] as const
/** The answers a manager gives about a pay-first round, before any close (#113). */
const ENTRY_ANSWERS: readonly string[] = ['on_till', 'not_on_till']
/** The unconfirmed reasons of a pay-first round before any close (#113). */
const ENTRY_REASONS: readonly (string | null)[] = ['enter_unknown', 'entered_check_failed']
/** The questions a manager answers: the close, then whether the items are back (#153). */
export const PAYMENT_QUESTIONS = ['close', 'lines_not_back'] as const

/**
 * Why a close is unconfirmed, waiting for an answer: the POS didn't answer, or refused after the
 * close was attempted; or, after "No receipt", the lines were not proven back on the table (#153).
 * A pay-first round (#113): its entry's outcome is not known, or its bill failed the check.
 */
export const PAYMENT_UNCONFIRMED_REASONS = [
  'close_unknown',
  'close_refused',
  'lines_not_back',
  'enter_unknown',
  'entered_check_failed',
] as const
const UNCONFIRMED_REASONS = PAYMENT_UNCONFIRMED_REASONS

const paymentId = idSchema('py')
const tableId = idSchema('tb')
export const CodeSchema = z.string().regex(/^[a-z][a-z0-9_]{0,63}$/)
export const MinorSchema = z.int().nonnegative().max(Number.MAX_SAFE_INTEGER)
export const PosRefSchema = z.string().min(1).max(200)

// ---------------------------------------------------------------------------------------------
// Locks

// The helpers below are shared with the pay-first route (`pay-first.ts`, #113).

export interface Locked {
  readonly payment: PaymentRow
  readonly tableOpen: boolean
  readonly leases: Map<string, { readonly holder: string | null; readonly fence: number }>
  /** The open alert of each kind claimed, by kind. */
  readonly alerts: Map<string, { readonly id: string; readonly doneAt: Date | null }>
}

/**
 * Locks a payment and what its step may touch, in the fixed order: the table's order (sitting
 * share), a pay-first payment's sent order, the leases, the alerts it may raise or close, then the
 * payment.
 */
export async function lockRoute(
  stx: ServiceTx,
  id: string,
  touches: {
    readonly leases?: (found: {
      readonly tableId: string
      readonly paymentTableId: string | null
    }) => readonly LeaseKey[]
    readonly alertKinds?: readonly string[]
  } = {},
): Promise<Locked | ServiceResult> {
  // The table never changes on a payment; the payment table only under the payment's lock, so a
  // step that finds it changed meanwhile refuses and the worker runs it again.
  const [found] = await stx.tx
    .select({
      tableId: payments.tableId,
      paymentTableId: payments.paymentTableId,
      sentOrderId: payments.sentOrderId,
    })
    .from(payments)
    .where(and(eq(payments.id, id), eq(payments.venueId, stx.venueId)))
  if (found === undefined) return refused(null, 'payment_missing')
  const order = await stx.rows.tableOrder(found.tableId)
  if (found.sentOrderId !== null) await lockSentOrder(stx, found.sentOrderId)
  const leases = await lockLeases(stx, touches.leases?.(found) ?? [])
  const kinds = touches.alertKinds ?? []
  const open = new Map<string, { readonly id: string; readonly doneAt: Date | null }>()
  if (kinds.length > 0) {
    stx.rows.claim(
      'alert',
      kinds.map((kind) => `${kind}:${id}`),
    )
    const rows = await stx.tx
      .select({ id: alerts.id, kind: alerts.kind, doneAt: alerts.doneAt })
      .from(alerts)
      .where(and(inArray(alerts.kind, [...kinds]), eq(alerts.subjectId, id)))
      .orderBy(alerts.kind)
      .for('update')
    for (const row of rows) {
      if (!open.has(row.kind) || row.doneAt === null) open.set(row.kind, row)
    }
  }
  stx.rows.claim('payment', [id])
  const [payment] = await stx.tx.select().from(payments).where(eq(payments.id, id)).for('update')
  if (payment === undefined) return refused(null, 'payment_missing')
  if (payment.paymentTableId !== found.paymentTableId) return refused(null, 'payment_changed')
  return { payment, tableOpen: order !== null, leases, alerts: open }
}

/** The payment table's lease. */
const paymentTableLease = (key: string): LeaseKey => ({ scope: 'payment_table', key })
/** The real table's write turn: its `order_slot` lease (D115). */
const turnLease = (key: string): LeaseKey => ({ scope: 'order_slot', key })

// ---------------------------------------------------------------------------------------------
// Writes

/** Moves the payment to `state` (with more columns), logs it, and touches the table. */
export async function move(
  stx: ServiceTx,
  locked: Locked,
  state: string,
  set: Partial<typeof payments.$inferInsert> = {},
  details?: Readonly<Record<string, string | number | boolean | null>>,
): Promise<void> {
  const { payment, tableOpen } = locked
  const final = isFinalPaymentState(state)
  const settles = final && payment.settledAt === null
  await stx.tx
    .update(payments)
    .set({
      state,
      ...(settles
        ? { settledAt: sql`now()`, retainUntil: recordRetainUntil(await stx.dbNow()) }
        : {}),
      ...(final ? {} : { settledAt: null, retainUntil: null }),
      ...set,
      ...stx.provenance,
      updatedAt: sql`now()`,
    })
    .where(eq(payments.id, payment.id))
  if (tableOpen) stx.rows.touch(payment.tableId)
  await logPayment(stx, payment, state, set.reason ?? payment.reason ?? null, details)
}

/**
 * Raises one alert of `kind` about the payment, once (its key is claimed by `lockRoute`). `again`
 * raises a new one where the earlier is done: the same question asked a second time (#113).
 */
export async function raise(
  stx: ServiceTx,
  locked: Locked,
  kind: string,
  permission: Permission,
  more: Readonly<Record<string, string>> = {},
  again = false,
): Promise<void> {
  const earlier = locked.alerts.get(kind)
  if (earlier !== undefined && (!again || earlier.doneAt === null)) return
  const { payment } = locked
  await stx.tx.insert(alerts).values({
    id: newId('al'),
    tenantId: stx.tenantId,
    venueId: stx.venueId,
    serviceDate: stx.serviceDate,
    kind,
    audience: 'venue',
    subjectId: payment.id,
    permission,
    // What staff need at the till: the table and the amounts. Never a POS id or a guest's data.
    // Until when the hold may be captured: a question is reminded again as it runs out (#112).
    details: {
      paymentId: payment.id,
      tableId: payment.tableId,
      amountMinor: payment.amountMinor,
      tipMinor: payment.tipMinor,
      currency: payment.currency,
      captureBefore: payment.captureBefore?.toISOString() ?? null,
      ...more,
    },
    ...stx.provenance,
    updatedAt: sql`now()`,
  })
  await stx.log({
    kind: 'alert.raised',
    tableId: payment.tableId,
    sittingId: payment.sittingId,
    reason: kind,
  })
}

/** An accepted answer naming the payment and where it stands. */
export function at(
  payment: { readonly id: string },
  state: string,
  changed: boolean,
  more: ResultDetails = {},
): ServiceResult {
  return accepted(null, { details: { paymentId: payment.id, state, changed, ...more } })
}

/** True when `lockRoute` refused instead of locking. */
export const refusedLock = (locked: Locked | ServiceResult): locked is ServiceResult =>
  'status' in locked

// ---------------------------------------------------------------------------------------------
// The queue

/**
 * `payment.claim_table`: a held (or waiting) payment asks for a payment table. `freeTables` are the
 * payment tables the worker read empty just now; only one no payment holds is taken.
 */
export function paymentClaimTable() {
  return defineCommand({
    schema: z.strictObject({
      type: z.literal('payment.claim_table'),
      paymentId,
      freeTables: z.array(tableId).max(100),
    }),
    origins: ['worker'],
    permission: null,
    idempotency: 'by_state',
    async handle(stx, command) {
      const locked = await lockRoute(stx, command.paymentId, {
        leases: () => command.freeTables.map(paymentTableLease),
      })
      if (refusedLock(locked)) return locked
      const { payment } = locked
      if (
        (payment.state !== 'held' && payment.state !== 'queued') ||
        payment.paymentTableId !== null
      ) {
        return at(payment, payment.state, false, { paymentTableId: payment.paymentTableId })
      }
      const [account] = await stx.tx
        .select({ state: paymentAccounts.state })
        .from(paymentAccounts)
        .where(eq(paymentAccounts.venueId, stx.venueId))
      if (account?.state !== 'connected') {
        const reason = account?.state === 'lost_access' ? 'paying_paused' : 'paying_not_offered'
        await move(stx, locked, 'cancelling', { reason })
        return at(payment, 'cancelling', true)
      }

      const now = (await stx.dbNow()).getTime()
      const endsAt = payment.queueEndsAt ?? new Date(now + PAYMENT_QUEUE_MS)
      const paused =
        (await orderingPaused(stx, payment.tableId, payment.barId)) || (await payingPaused(stx))
      // The payments ahead in the same queue: waiting longer, with no table yet.
      const sameQueue =
        payment.barId === null ? isNull(payments.barId) : eq(payments.barId, payment.barId)
      const ahead = await stx.tx
        .select({ id: payments.id })
        .from(payments)
        .where(
          and(
            eq(payments.venueId, stx.venueId),
            inArray(payments.state, ['held', 'queued']),
            isNull(payments.paymentTableId),
            sameQueue,
            // A payment whose wait already ran out is cancelled at its own turn, never ahead (P8).
            gt(payments.queueEndsAt, new Date(now)),
            or(
              lt(payments.queueEndsAt, endsAt),
              and(eq(payments.queueEndsAt, endsAt), lt(payments.id, payment.id)),
            ),
          ),
        )
      const sameBar =
        payment.barId === null ? isNull(venueTables.barId) : eq(venueTables.barId, payment.barId)
      const candidates =
        command.freeTables.length === 0
          ? []
          : await stx.tx
              .select({ id: venueTables.id })
              .from(venueTables)
              .where(
                and(
                  inArray(venueTables.id, command.freeTables),
                  eq(venueTables.isPaymentTable, true),
                  isNull(venueTables.archivedAt),
                  sameBar,
                ),
              )
              .orderBy(venueTables.id)
      const free = candidates.filter(
        (table) =>
          (locked.leases.get(leaseLedgerKey(paymentTableLease(table.id)))?.holder ?? null) === null,
      )
      const waitedMs = Math.max(0, now - (endsAt.getTime() - PAYMENT_QUEUE_MS))
      const choice = paused ? undefined : free[ahead.length]
      if (choice !== undefined) {
        const taken = await takePaymentTable(stx, { key: choice.id, holder: payment.id })
        if (taken.taken) {
          await move(
            stx,
            locked,
            'queued',
            { paymentTableId: choice.id, queueEndsAt: endsAt },
            { paymentTableId: choice.id, waitedMs, longWait: waitedMs > PAYMENT_LONG_WAIT_MS },
          )
          return at(payment, 'queued', true, { paymentTableId: choice.id, waitedMs })
        }
      }
      if (now >= endsAt.getTime()) {
        await move(
          stx,
          locked,
          'cancelling',
          { reason: paused ? 'paying_paused' : 'busy' },
          {
            waitedMs,
            longWait: waitedMs > PAYMENT_LONG_WAIT_MS,
          },
        )
        return at(payment, 'cancelling', true, { waitedMs })
      }
      if (payment.state === 'held') {
        await move(stx, locked, 'queued', { queueEndsAt: endsAt })
        return at(payment, 'queued', true, { paymentTableId: null, waiting: true })
      }
      return at(payment, 'queued', false, { paymentTableId: null, waiting: true })
    },
  })
}

/**
 * `payment.table_freed`: the worker read the payment table empty after its payment became final.
 * The table is free for the next payment. An unconfirmed payment keeps it until it is answered.
 */
export function paymentTableFreed() {
  return defineCommand({
    schema: z.strictObject({ type: z.literal('payment.table_freed'), paymentId }),
    origins: ['worker'],
    permission: null,
    idempotency: 'by_state',
    async handle(stx, command) {
      const locked = await lockRoute(stx, command.paymentId, {
        leases: (found) =>
          found.paymentTableId === null ? [] : [paymentTableLease(found.paymentTableId)],
      })
      if (refusedLock(locked)) return locked
      const { payment } = locked
      if (payment.paymentTableId === null) return at(payment, payment.state, false)
      if (!isFinalPaymentState(payment.state) || payment.state === 'unconfirmed') {
        return refused(null, 'payment_not_final', { state: payment.state })
      }
      await freePaymentTable(stx, { key: payment.paymentTableId, holder: payment.id })
      await stx.tx
        .update(payments)
        .set({ paymentTableId: null, ...stx.provenance, updatedAt: sql`now()` })
        .where(eq(payments.id, payment.id))
      await logPayment(stx, payment, payment.state, 'table_freed', {
        paymentTableId: payment.paymentTableId,
      })
      return at(payment, payment.state, true, { freed: payment.paymentTableId })
    },
  })
}

// ---------------------------------------------------------------------------------------------
// The real table's write turn

/** True when the payment's next POS write is moving lines back (an undo). */
function undoDue(payment: PaymentRow): boolean {
  return (
    (payment.state === 'isolated' && payment.reason === 'check_failed') ||
    (payment.state === 'unconfirmed' && payment.reason === 'no_receipt')
  )
}

/**
 * `payment.turn`: the worker takes the real table's write turn before it moves the payment's
 * lines (or moves them back), and releases it after. A send in flight holds it: `busy`.
 */
export function paymentTurn() {
  return defineCommand({
    schema: z.strictObject({
      type: z.literal('payment.turn'),
      paymentId,
      /** Null to take the turn; the fence of the take to release it. */
      release: z.int().nonnegative().nullable(),
    }),
    origins: ['worker'],
    permission: null,
    idempotency: 'by_state',
    async handle(stx, command) {
      const locked = await lockRoute(stx, command.paymentId, {
        leases: (found) => [turnLease(found.tableId)],
      })
      if (refusedLock(locked)) return locked
      const { payment } = locked
      const lease = turnLease(payment.tableId)
      if (command.release !== null) {
        const released = await releaseLease(stx, {
          ...lease,
          holder: payment.id,
          fence: command.release,
        })
        return at(payment, payment.state, released.released, { turn: 'released' })
      }
      const moving =
        (payment.state === 'queued' && payment.paymentTableId !== null) || undoDue(payment)
      if (!moving) return refused(null, 'payment_moved_on', { state: payment.state })
      const held = locked.leases.get(leaseLedgerKey(lease))?.holder ?? null
      if (held === payment.id) {
        // The payment's own turn. Passed: a run that died holding it, and this run takes it again
        // with a new fence. Not passed: another run of this payment is still moving its lines (a
        // job retried while its first run went on), and this one waits.
        const state = await readLease(stx.tx, lease)
        if (state?.expired !== true) return at(payment, payment.state, false, { turn: 'busy' })
        await releaseLease(stx, { ...lease, holder: payment.id, fence: state.fence })
      } else if (held !== null) {
        // A send in flight, or one whose worker died: the sweep settles it first.
        return at(payment, payment.state, false, { turn: 'busy' })
      }
      const taken = await takeLease(stx, {
        ...lease,
        holder: payment.id,
        seconds: PAYMENT_TURN_SECONDS,
      })
      if (!taken.taken) return at(payment, payment.state, false, { turn: 'busy' })
      return at(payment, payment.state, false, { turn: 'taken', fence: taken.fence })
    },
  })
}

// ---------------------------------------------------------------------------------------------
// The move, the last check, the close, the capture, the undo

/** What a refusal of the move means for the guest (the template words each). */
function isolateRefusalReason(code: string | null): string {
  if (code === 'line_refused' || code === 'bill_closed' || code === 'item_unavailable') {
    return 'bill_changed'
  }
  if (code === 'not_supported') return 'ask_waiter_to_split'
  // The payment table or the bill is another payment's: the queue's own answer.
  if (code === 'busy') return 'busy'
  return 'isolate_refused'
}

/**
 * `payment.isolated`: the POS moved the payment's lines onto its payment table (`moved`), or said a
 * definite no (`refused`, nothing moved: the payment is cancelled and its hold released).
 */
export function paymentIsolated() {
  return defineCommand({
    schema: z.strictObject({
      type: z.literal('payment.isolated'),
      paymentId,
      outcome: z.enum(['moved', 'refused']),
      code: CodeSchema.nullable(),
    }),
    origins: ['worker'],
    permission: null,
    idempotency: 'by_state',
    async handle(stx, command) {
      const locked = await lockRoute(stx, command.paymentId)
      if (refusedLock(locked)) return locked
      const { payment } = locked
      if (payment.state !== 'queued' || payment.paymentTableId === null) {
        return at(payment, payment.state, false)
      }
      if (command.outcome === 'moved') {
        await move(stx, locked, 'isolated')
        return at(payment, 'isolated', true)
      }
      await move(stx, locked, 'cancelling', { reason: isolateRefusalReason(command.code) })
      return at(payment, 'cancelling', true)
    },
  })
}

/** One line as a reading gives it. */
const ReadLineSchema = z.strictObject({ quantity: DecimalQuantitySchema, amountMinor: z.int() })

/** The key a line is matched by in the last check: its quantity and the POS's amount. */
const lineKey = (line: { readonly quantity: string; readonly amountMinor: number }) =>
  `${quantityKey(line.quantity)}:${line.amountMinor}`

/** The outcome of the last check: the lines found, or why it failed. */
export type LastCheck =
  | { readonly ok: true; readonly foundMinor: number; readonly voided: number }
  | { readonly ok: false; readonly why: string }

/**
 * The last check (design §5.1 step 6), pure: the isolated bill must hold exactly the confirmed
 * lines with the POS's amounts, still open, unpaid, its total its lines. A confirmed line missing
 * from it counts as voided only when the fresh read of the real table holds neither that line nor
 * one like it, and only where the provider captures less than the hold.
 */
export function lastCheck(input: {
  readonly confirmed: readonly {
    readonly pos: string | null
    readonly quantity: string
    readonly amountMinor: number
  }[]
  readonly isolated: {
    /** The open bills on the payment table: one, the payment's own. */
    readonly bills: number
    readonly totalMinor: number
    readonly paidMinor: number
    readonly lines: readonly { readonly quantity: string; readonly amountMinor: number }[]
  } | null
  readonly real: readonly {
    readonly pos: string
    readonly quantity: string
    readonly amountMinor: number
  }[]
  readonly partialCapture: boolean
}): LastCheck {
  const bill = input.isolated
  if (bill === null || bill.lines.length === 0) return { ok: false, why: 'no_bill' }
  // Another bill on the payment table too (a waiter's): the close could not tell them apart.
  if (bill.bills > 1) return { ok: false, why: 'several_bills' }
  if (bill.paidMinor > 0) return { ok: false, why: 'part_paid' }
  if (signedSumMinor(bill.lines.map((line) => line.amountMinor)) !== bill.totalMinor) {
    return { ok: false, why: 'total_changed' }
  }
  const wanted = new Map<string, number>()
  for (const line of bill.lines) wanted.set(lineKey(line), (wanted.get(lineKey(line)) ?? 0) + 1)
  const missing: (typeof input.confirmed)[number][] = []
  let foundMinor = 0
  for (const line of input.confirmed) {
    const key = lineKey(line)
    const left = wanted.get(key) ?? 0
    if (left > 0) {
      wanted.set(key, left - 1)
      foundMinor = addMinor(foundMinor, line.amountMinor)
    } else {
      missing.push(line)
    }
  }
  // A line on the isolated bill that the guest didn't confirm (a round slipped in, a change).
  if ([...wanted.values()].some((left) => left > 0)) return { ok: false, why: 'extra_line' }
  if (missing.length === 0) return { ok: true, foundMinor, voided: 0 }
  const realRefs = new Set(input.real.map((line) => line.pos))
  const realKeys = new Set(input.real.map(lineKey))
  const voided = missing.every(
    (line) => line.pos !== null && !realRefs.has(line.pos) && !realKeys.has(lineKey(line)),
  )
  if (!voided) return { ok: false, why: 'line_missing' }
  if (!input.partialCapture) return { ok: false, why: 'partial_not_supported' }
  if (foundMinor <= 0) return { ok: false, why: 'no_lines' }
  return { ok: true, foundMinor, voided: missing.length }
}

/**
 * `payment.checked`: the worker's reading of the isolated bill and a fresh one of the real table.
 * `isolated` → `checked` (the amount lowered for voided lines), or stopped `check_failed` with a
 * staff alert, for the worker to move the lines back and release the hold.
 */
export function paymentChecked() {
  return defineCommand({
    schema: z.strictObject({
      type: z.literal('payment.checked'),
      paymentId,
      isolated: z
        .strictObject({
          bills: z.int().positive().max(100),
          totalMinor: z.int(),
          paidMinor: MinorSchema,
          lines: z.array(ReadLineSchema).max(500),
        })
        .nullable(),
      real: z.array(z.strictObject({ pos: PosRefSchema, ...ReadLineSchema.shape })).max(2000),
      /** The provider captures less than the hold (`capabilities.partialCapture`). */
      partialCapture: z.boolean(),
      /**
       * What the provider holds now, read right before the close: zero for a hold that is no
       * longer `held` (cancelled or run out at the provider). Below the amount, nothing closes.
       */
      heldMinor: MinorSchema,
    }),
    origins: ['worker'],
    permission: null,
    idempotency: 'by_state',
    async handle(stx, command) {
      const locked = await lockRoute(stx, command.paymentId, {
        alertKinds: [PAYMENT_CHECK_FAILED_KIND],
      })
      if (refusedLock(locked)) return locked
      const { payment } = locked
      // Again from `checked` while no close was attempted: a run that died between the check and
      // the close checks once more before it closes.
      const again = payment.state === 'checked' && !(await closeAttempted(stx, payment.id))
      if (!again && (payment.state !== 'isolated' || payment.reason !== null)) {
        return at(payment, payment.state, false)
      }
      const confirmed = await stx.tx
        .select({
          pos: paymentLines.posLineRef,
          quantity: paymentLines.quantity,
          amountMinor: paymentLines.posAmountMinor,
        })
        .from(paymentLines)
        .where(eq(paymentLines.paymentId, payment.id))
      const check = lastCheck({
        confirmed,
        isolated: command.isolated,
        real: command.real,
        partialCapture: command.partialCapture,
      })
      const failed = async (why: string) => {
        await move(stx, locked, 'isolated', { reason: 'check_failed' }, { why })
        await raise(stx, locked, PAYMENT_CHECK_FAILED_KIND, 'alerts.answer')
        return at(payment, 'isolated', true, { reason: 'check_failed', why })
      }
      if (!check.ok) return failed(check.why)
      const amountMinor = addMinor(check.foundMinor, payment.tipMinor)
      // A hold that no longer covers the amount: the bill must not close (no receipt, no capture).
      if (command.heldMinor < amountMinor) return failed('hold_lost')
      const lowered = amountMinor !== payment.amountMinor
      if (again && !lowered) return at(payment, 'checked', false, { amountMinor })
      await move(
        stx,
        locked,
        'checked',
        lowered ? { amountMinor } : {},
        lowered ? { heldMinor: payment.amountMinor, amountMinor, voided: check.voided } : undefined,
      )
      return at(payment, 'checked', true, { amountMinor })
    },
  })
}

/**
 * `payment.closed`: the close's outcome. Proof of the close (`done`, or the POS's "already done")
 * → `closed`, with the receipt's numbers. Anything else, once the close was attempted, is
 * `unconfirmed`: never undone or released until a manager or owner answers.
 *
 * The POS's answer to the close (`step`) is recorded with it, in the same transaction (#112): a
 * worker that dies after the answer never leaves a proven close without its state, nor its
 * receipt number behind. The answer is kept whatever the payment's state.
 */
export function paymentClosed() {
  return defineCommand({
    schema: z.strictObject({
      type: z.literal('payment.closed'),
      paymentId,
      outcome: z.enum(['done', 'refused', 'unknown']),
      code: CodeSchema.nullable(),
      receiptNumber: z.string().min(1).max(64).nullable(),
      fiscalMemoryNumber: z.string().min(1).max(64).nullable(),
      step: z
        .strictObject({
          outcome: z.enum(['done', 'refused']),
          answer: CodeSchema.nullable(),
          idempotencyKey: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,254}$/),
        })
        .nullable()
        .default(null),
    }),
    origins: ['worker'],
    permission: null,
    idempotency: 'by_state',
    async handle(stx, command) {
      const locked = await lockRoute(stx, command.paymentId, {
        alertKinds: [PAYMENT_UNCONFIRMED_KIND],
      })
      if (refusedLock(locked)) return locked
      const { payment } = locked
      if (command.step !== null) {
        await stx.tx.insert(paymentSteps).values({
          tenantId: stx.tenantId,
          venueId: stx.venueId,
          paymentId: payment.id,
          step: 'payAndClose',
          outcome: command.step.outcome,
          answer: command.step.answer,
          idempotencyKey: command.step.idempotencyKey,
          lines: null,
          ...stx.provenance,
        })
      }
      if (payment.state !== 'checked') return at(payment, payment.state, false)
      if (command.outcome === 'done') {
        await move(stx, locked, 'closed', {
          receiptNumber: command.receiptNumber,
          fiscalMemoryNumber: command.fiscalMemoryNumber,
        })
        return at(payment, 'closed', true)
      }
      const reason = command.outcome === 'unknown' ? 'close_unknown' : 'close_refused'
      await move(stx, locked, 'unconfirmed', { reason }, { code: command.code })
      await raise(stx, locked, PAYMENT_UNCONFIRMED_KIND, 'money.follow_up')
      return at(payment, 'unconfirmed', true)
    },
  })
}

/**
 * `payment.captured`: the capture's outcome, after a proven close or a manager's "Receipt
 * printed". A refused capture is `capture_failed`, and the owners are told.
 */
export function paymentCaptured() {
  return defineCommand({
    schema: z.strictObject({
      type: z.literal('payment.captured'),
      paymentId,
      outcome: z.enum(['captured', 'refused']),
      capturedMinor: MinorSchema.nullable(),
      code: CodeSchema.nullable(),
    }),
    origins: ['worker'],
    permission: null,
    idempotency: 'by_state',
    async handle(stx, command) {
      const locked = await lockRoute(stx, command.paymentId, {
        alertKinds: [PAYMENT_CAPTURE_FAILED_KIND],
      })
      if (refusedLock(locked)) return locked
      const { payment } = locked
      const capturable =
        payment.state === 'closed' ||
        (payment.state === 'unconfirmed' && payment.reason === 'receipt_printed')
      if (!capturable) return at(payment, payment.state, false)
      if (command.outcome === 'captured') {
        const captured = command.capturedMinor
        if (captured === null || payment.amountMinor === null || captured > payment.amountMinor) {
          return refused(null, 'payment_mismatch', { reason: 'captured_amount' })
        }
        await move(stx, locked, 'captured', { capturedMinor: captured })
        return at(payment, 'captured', true)
      }
      await move(stx, locked, 'capture_failed', { reason: command.code ?? 'capture_refused' })
      await raise(stx, locked, PAYMENT_CAPTURE_FAILED_KIND, 'money.follow_up')
      return at(payment, 'capture_failed', true)
    },
  })
}

/**
 * `payment.undone`: the worker put the lines back on the real table (`returned`), or the POS would
 * not (`stranded`, staff are told). Either way the payment is cancelled and its hold released;
 * stranded lines settle it `stranded`. Never after a close was attempted, unless a manager or owner
 * answered "No receipt" and the lines are proven back on the real table: stranded, or not proven
 * (`not_back`: the payment table read empty, the bill closed), the close may have landed after
 * all (C52), so the hold stays and the payment is `unconfirmed` again for a manager (#153).
 */
export function paymentUndone() {
  return defineCommand({
    schema: z.strictObject({
      type: z.literal('payment.undone'),
      paymentId,
      outcome: z.enum(['returned', 'stranded', 'not_back']),
    }),
    origins: ['worker'],
    permission: null,
    idempotency: 'by_state',
    async handle(stx, command) {
      const locked = await lockRoute(stx, command.paymentId, {
        alertKinds: [PAYMENT_STRANDED_KIND, PAYMENT_LINES_NOT_BACK_KIND],
      })
      if (refusedLock(locked)) return locked
      const { payment } = locked
      if (!undoDue(payment)) return at(payment, payment.state, false)
      if (payment.reason !== 'no_receipt' && (await closeAttempted(stx, payment.id))) {
        return refused(null, 'close_attempted')
      }
      if (payment.reason === 'no_receipt' && command.outcome !== 'returned') {
        await move(
          stx,
          locked,
          'unconfirmed',
          { reason: 'lines_not_back' },
          { outcome: command.outcome },
        )
        await raise(stx, locked, PAYMENT_LINES_NOT_BACK_KIND, 'money.follow_up')
        return at(payment, 'unconfirmed', true, { reason: 'lines_not_back' })
      }
      // Proof is asked for only after a close was attempted; a failed check's undo has none.
      if (command.outcome === 'not_back') return refused(null, 'payment_mismatch')
      if (command.outcome === 'returned') {
        await move(stx, locked, 'cancelling')
        return at(payment, 'cancelling', true)
      }
      await move(stx, locked, 'cancelling', { reason: 'stranded' })
      await raise(stx, locked, PAYMENT_STRANDED_KIND, 'alerts.answer')
      return at(payment, 'cancelling', true)
    },
  })
}

// ---------------------------------------------------------------------------------------------
// The staff's answer

/**
 * `payment.answer`: a manager or owner answers an unconfirmed close after checking the till:
 * "Receipt printed" (the worker captures) or "No receipt" (the worker moves the lines back and
 * releases the hold). Closes the unconfirmed alert. A second, different answer is refused.
 * Asked again because the items were not back after "No receipt" (`lines_not_back`, #153):
 * "Receipt printed" captures; "No receipt" releases the hold and settles the payment `stranded`
 * with no move back tried, since the manager saw the items missing.
 *
 * The answer names the question it answers (`answering`), so a late tap on the first question (a
 * second manager, a retry, an old push) is never taken for the second: once the second is asked,
 * the same first answer changes nothing and another is refused; the second before it is asked is
 * refused.
 */
export function paymentAnswer() {
  return defineCommand({
    schema: z.strictObject({
      type: z.literal('payment.answer'),
      paymentId,
      answering: z.enum(PAYMENT_QUESTIONS),
      answer: z.enum(PAYMENT_ANSWERS),
    }),
    origins: ['staff'],
    permission: 'money.follow_up',
    idempotency: 'by_nature',
    async handle(stx, command) {
      const locked = await lockRoute(stx, command.paymentId, {
        alertKinds: [PAYMENT_UNCONFIRMED_KIND, PAYMENT_LINES_NOT_BACK_KIND, PAYMENT_STRANDED_KIND],
      })
      if (refusedLock(locked)) return locked
      const { payment } = locked
      // The question open now: the second once its alert was raised, done or not.
      const asked = locked.alerts.has(PAYMENT_LINES_NOT_BACK_KIND) ? 'lines_not_back' : 'close'
      if (command.answering !== asked) {
        if (command.answering === 'lines_not_back') {
          return refused(null, 'payment_not_asked', { asked })
        }
        // The close was answered "No receipt": that is the only way to the second question.
        if (command.answer === 'no_receipt') return at(payment, payment.state, false)
        return refused(null, 'payment_answered', { answer: 'no_receipt' })
      }
      if (payment.state !== 'unconfirmed') {
        // Stranded after a close was attempted: a second "No receipt" settled it (it is the only
        // way there). The same answer again changes nothing; a different one is refused.
        if (payment.reason === 'stranded' && (await closeAttempted(stx, payment.id))) {
          if (command.answer === 'no_receipt') return at(payment, payment.state, false)
          return refused(null, 'payment_answered', { answer: 'no_receipt' })
        }
        // A pay-first round moved on by this same answer (a second tap, a second manager): the
        // same answer again changes nothing.
        if (
          payment.kind === 'pay_first' &&
          ENTRY_ANSWERS.includes(command.answer) &&
          (await lastAnswer(stx, payment.id)) === command.answer
        ) {
          return at(payment, payment.state, false)
        }
        return refused(null, 'payment_not_unconfirmed', { state: payment.state })
      }
      if (payment.reason === command.answer) return at(payment, payment.state, false)
      if (!(UNCONFIRMED_REASONS as readonly (string | null)[]).includes(payment.reason)) {
        return refused(null, 'payment_answered', { answer: payment.reason })
      }
      // A pay-first round before any close is answered on the till (#113); a close, by its
      // receipt. "Receipt printed" needs a close that was attempted: none, no bill was closed.
      const entry = payment.kind === 'pay_first' && ENTRY_REASONS.includes(payment.reason)
      if (entry !== ENTRY_ANSWERS.includes(command.answer)) {
        return refused(null, 'payment_answer_not_asked', { reason: payment.reason })
      }
      if (command.answer === 'receipt_printed' && !(await closeAttempted(stx, payment.id))) {
        return refused(null, 'payment_answer_not_asked', { reason: payment.reason })
      }
      let state = payment.state
      if (command.answer === 'on_till') {
        // The round is on the payment table: checked again, then closed and captured as usual.
        state = 'entered'
        await move(stx, locked, state, { reason: null })
        await settlePayFirstSentOrder(stx, payment, command.answer)
      } else if (command.answer === 'not_on_till') {
        // Not on the till (never landed, or staff took it off): the hold is released.
        state = 'cancelling'
        await move(stx, locked, state, { reason: 'not_on_till' })
        await settlePayFirstSentOrder(stx, payment, command.answer)
      } else if (payment.kind === 'pay_first') {
        // A pay-first round has no real table to go back to (#113): "No receipt" releases the
        // hold, and staff deal with the round on the payment table; "Receipt printed" captures.
        if (command.answer === 'no_receipt') {
          state = 'cancelling'
          await move(stx, locked, state, { reason: 'no_receipt' })
        } else {
          await stx.tx
            .update(payments)
            .set({ reason: command.answer, ...stx.provenance, updatedAt: sql`now()` })
            .where(eq(payments.id, payment.id))
        }
        await settlePayFirstSentOrder(stx, payment, command.answer)
      } else if (payment.reason === 'lines_not_back' && command.answer === 'no_receipt') {
        // The manager checked the till again with the items missing: released, the lines stranded.
        state = 'cancelling'
        await move(stx, locked, state, { reason: 'stranded' })
        await raise(stx, locked, PAYMENT_STRANDED_KIND, 'alerts.answer')
      } else {
        await stx.tx
          .update(payments)
          .set({ reason: command.answer, ...stx.provenance, updatedAt: sql`now()` })
          .where(eq(payments.id, payment.id))
      }
      for (const kind of [PAYMENT_UNCONFIRMED_KIND, PAYMENT_LINES_NOT_BACK_KIND]) {
        const alert = locked.alerts.get(kind)
        if (alert === undefined || alert.doneAt !== null) continue
        await stx.tx
          .update(alerts)
          .set({
            doneAt: sql`now()`,
            doneBy: stx.provenance.actor,
            via: stx.via,
            nextRepeatAt: null,
            ...stx.provenance,
            updatedAt: sql`now()`,
          })
          .where(eq(alerts.id, alert.id))
      }
      await stx.log({
        kind: 'payment.answered',
        paymentId: payment.id,
        tableId: payment.tableId,
        sittingId: payment.sittingId,
        fromState: payment.reason ?? undefined,
        toState: command.answer,
        reason: command.answer,
        details: { answering: command.answering },
      })
      return at(payment, state, true, { answer: command.answer })
    },
  })
}

/** The last answer a manager gave about a payment, as the Log keeps it; null when none. */
async function lastAnswer(stx: ServiceTx, id: string): Promise<string | null> {
  const [last] = await stx.tx
    .select({ reason: logEntries.reason })
    .from(logEntries)
    .where(and(eq(logEntries.paymentId, id), eq(logEntries.kind, 'payment.answered')))
    .orderBy(desc(logEntries.seq))
    .limit(1)
  return last?.reason ?? null
}

// ---------------------------------------------------------------------------------------------
// Recovery (#112)

/**
 * `payment.release_refused`: the provider refused to release the hold of a cancelled payment and
 * still holds it. Nothing Restro may do about it (it never refunds): the payment stays
 * `cancelling`, the worker reads it back until the provider drops the hold, and the owners and
 * Restro's team are told once.
 */
export function paymentReleaseRefused() {
  return defineCommand({
    schema: z.strictObject({
      type: z.literal('payment.release_refused'),
      paymentId,
      code: CodeSchema,
    }),
    origins: ['worker'],
    permission: null,
    idempotency: 'by_state',
    async handle(stx, command) {
      const locked = await lockRoute(stx, command.paymentId, {
        alertKinds: [PAYMENT_RELEASE_REFUSED_KIND],
      })
      if (refusedLock(locked)) return locked
      const { payment } = locked
      if (payment.state !== 'cancelling') return at(payment, payment.state, false)
      if (locked.alerts.has(PAYMENT_RELEASE_REFUSED_KIND)) return at(payment, payment.state, false)
      // The refusal's code picks the words: `already_captured` means the card was charged.
      await raise(stx, locked, PAYMENT_RELEASE_REFUSED_KIND, 'money.follow_up', {
        code: command.code,
      })
      await logPayment(stx, payment, payment.state, 'release_refused', { code: command.code })
      return at(payment, payment.state, true)
    },
  })
}

/** The open questions an expiry closes: the unconfirmed close and the items not back (#155). */
const QUESTION_KINDS = [PAYMENT_UNCONFIRMED_KIND, PAYMENT_LINES_NOT_BACK_KIND] as const

/**
 * `payment.expired`: the provider shows the payment's hold gone (it ran out, or the provider
 * dropped it) while Restro still counted on it (design §5.3, #112). Settles it `released` with
 * reason `expired`, kept for the end of the night's list:
 * - `held`, or `queued` with no payment table yet: nothing moved on the POS;
 * - `cancelling`: a release the provider refused, now over (its alert closes);
 * - `unconfirmed`, waiting for an answer: its open question closes too, both kinds, and the Log
 *   says so; the owners and Restro's team are told (`payment_hold_expired`), since the bill may be
 *   closed in the till with nothing charged. Answered, the route goes on (a capture of an expired
 *   hold fails and tells the owners).
 * Anything else changes nothing: once the lines moved, the route runs to its end.
 */
export function paymentExpired() {
  return defineCommand({
    schema: z.strictObject({
      type: z.literal('payment.expired'),
      paymentId,
      /** The provider's status that shows the hold gone. */
      status: z.enum(['released', 'failed']),
    }),
    origins: ['worker'],
    permission: null,
    idempotency: 'by_state',
    async handle(stx, command) {
      const locked = await lockRoute(stx, command.paymentId, {
        alertKinds: [...QUESTION_KINDS, PAYMENT_RELEASE_REFUSED_KIND, PAYMENT_HOLD_EXPIRED_KIND],
      })
      if (refusedLock(locked)) return locked
      const { payment } = locked
      const waiting =
        (payment.state === 'held' || payment.state === 'queued') && payment.paymentTableId === null
      const asking =
        payment.state === 'unconfirmed' &&
        (UNCONFIRMED_REASONS as readonly (string | null)[]).includes(payment.reason)
      const cancelling = payment.state === 'cancelling'
      if (!waiting && !asking && !cancelling) return at(payment, payment.state, false)
      if (
        cancelling &&
        payment.reason !== 'no_receipt' &&
        payment.reason !== 'stranded' &&
        (await closeAttempted(stx, payment.id))
      ) {
        return refused(null, 'close_attempted')
      }
      // Stranded lines stay stranded: staff were told to move them back.
      const state = cancelling && payment.reason === 'stranded' ? 'stranded' : 'released'
      const reason = state === 'stranded' ? 'stranded' : 'expired'
      const closing: readonly string[] = cancelling
        ? [PAYMENT_RELEASE_REFUSED_KIND]
        : asking
          ? QUESTION_KINDS
          : []
      const closed: string[] = []
      for (const kind of closing) {
        const alert = locked.alerts.get(kind)
        if (alert === undefined || alert.doneAt !== null) continue
        await stx.tx
          .update(alerts)
          .set({
            doneAt: sql`now()`,
            doneBy: stx.provenance.actor,
            via: stx.via,
            nextRepeatAt: null,
            ...stx.provenance,
            updatedAt: sql`now()`,
          })
          .where(eq(alerts.id, alert.id))
        closed.push(kind)
      }
      // Nobody answered before the hold ran out: the owners sort the bill out in the till.
      if (asking) await raise(stx, locked, PAYMENT_HOLD_EXPIRED_KIND, 'money.follow_up')
      // An unconfirmed payment was settled already: its 18 months start again from the release.
      const settled = payment.settledAt !== null
      await move(
        stx,
        locked,
        state,
        {
          reason,
          formValues: null,
          ...(settled ? { retainUntil: recordRetainUntil(await stx.dbNow()) } : {}),
        },
        {
          status: command.status,
          ...(closed.length === 0 ? {} : { questionClosed: closed.join(',') }),
        },
      )
      return at(payment, state, true, { closed: closed.join(',') })
    },
  })
}

/** The states a payment may stay in only briefly: the worker's own, with no guest or staff wait. */
const STUCK_STATES: readonly string[] = ['requested', 'priced', 'cancelling']

/**
 * `payment.stuck`: the recovery tried a payment again and it still stays where it was past its
 * bound (#112). Restro's team is told once; the payment itself is not changed (the recovery keeps
 * trying it).
 */
export function paymentStuck() {
  return defineCommand({
    schema: z.strictObject({ type: z.literal('payment.stuck'), paymentId }),
    origins: ['worker'],
    permission: null,
    idempotency: 'by_state',
    async handle(stx, command) {
      const locked = await lockRoute(stx, command.paymentId, { alertKinds: [PAYMENT_STUCK_KIND] })
      if (refusedLock(locked)) return locked
      const { payment } = locked
      if (!STUCK_STATES.includes(payment.state) || locked.alerts.has(PAYMENT_STUCK_KIND)) {
        return at(payment, payment.state, false)
      }
      const id = newId('al')
      await stx.tx.insert(alerts).values({
        id,
        tenantId: stx.tenantId,
        venueId: stx.venueId,
        serviceDate: stx.serviceDate,
        kind: PAYMENT_STUCK_KIND,
        audience: 'restro',
        subjectId: payment.id,
        permission: null,
        // Counts and codes only: never an amount (the team's texts carry none).
        details: { paymentId: payment.id, tableId: payment.tableId, state: payment.state },
        ...stx.provenance,
        updatedAt: sql`now()`,
      })
      await stx.log({
        kind: 'alert.raised',
        tableId: payment.tableId,
        sittingId: payment.sittingId,
        reason: PAYMENT_STUCK_KIND,
        details: { alertId: id },
      })
      return at(payment, payment.state, true)
    },
  })
}

/** The route's commands, for the registry. */
export const PAY_ROUTE_COMMANDS = {
  'payment.claim_table': paymentClaimTable(),
  'payment.table_freed': paymentTableFreed(),
  'payment.turn': paymentTurn(),
  'payment.isolated': paymentIsolated(),
  'payment.checked': paymentChecked(),
  'payment.closed': paymentClosed(),
  'payment.captured': paymentCaptured(),
  'payment.undone': paymentUndone(),
  'payment.answer': paymentAnswer(),
  'payment.release_refused': paymentReleaseRefused(),
  'payment.expired': paymentExpired(),
  'payment.stuck': paymentStuck(),
} as const
