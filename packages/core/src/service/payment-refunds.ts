// The refunds the venue made in its provider's dashboard, and the storno they leave to do (#222;
// D122 §8; decision log `docs/deliverables/2026-10-21-refunds-disputes-decision-log.md` 5.1–5.8).
//
// Restro never refunds (rule 7, D125 3.5): `payment.observe` reads the provider's refunds back and
// `reconcileRefunds` keeps one `payment_refunds` row per refund, matched by the provider's id
// (#261). A refund the provider says failed marks its row "didn't go through". The storno is the
// venue's own work at the till, so
// "Storno done" (`payment.storno_done`) only records who said it was made and when; Restro never
// checks the POS for it. Both commands are `money.follow_up`: a manager's PIN on the shared tablet,
// one tap on a manager's own session.
//
// A refund that did not go through after its storno stays on Tonight for three days. "Got it"
// (`payment.refund_failed_seen`, same right) clears it earlier: the Log entry is the whole record,
// the reads leave out a refund whose newest such entry says `seen`, and the Undo writes `open`.
//
// Locks: the payment's route locks (`lockRoute`: the table's order, the refund alert, the payment),
// then the refund rows of the payment.

import { alerts, logEntries, paymentRefunds } from '@restro/db'
import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm'
import { z } from 'zod'

import { idSchema, newId } from '../ids'
import { addMinor, subtractMinor } from '../money'
import { PAYMENT_REFUNDED_KIND } from './alert-rules'
import { defineCommand, type ServiceTx } from './definition'
import { type Locked, lockRoute, refusedLock } from './pay-route'
import { accepted, refused, type ServiceResult } from './results'
import { changedSince, tokenEntry, UndoTokenSchema } from './undo'

const refundId = idSchema('rf')

/** The alert permission of a refund or a dispute: managers and owners (decision log 5.3). */
export const FOLLOW_UP_ALERT_PERMISSION = 'money.follow_up' as const

/** A refund row as the commands and the reads see it. */
export type RefundRow = typeof paymentRefunds.$inferSelect

/** Closes the open alerts of a payment of these ids, as an answer would (no Done button). */
export async function closeAlertRows(
  stx: ServiceTx,
  rows: readonly { readonly id: string }[],
): Promise<void> {
  if (rows.length === 0) return
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
    .where(
      and(
        inArray(
          alerts.id,
          rows.map((row) => row.id),
        ),
        isNull(alerts.doneAt),
      ),
    )
}

/** The open alerts of a kind about a payment, optionally of one refund. Locked by `lockRoute`. */
export async function openAlertsOf(
  stx: ServiceTx,
  paymentId: string,
  kind: string,
  refund?: string,
): Promise<readonly { readonly id: string }[]> {
  return stx.tx
    .select({ id: alerts.id })
    .from(alerts)
    .where(
      and(
        eq(alerts.venueId, stx.venueId),
        eq(alerts.kind, kind),
        eq(alerts.subjectId, paymentId),
        isNull(alerts.doneAt),
        refund === undefined ? undefined : sql`${alerts.details} ->> 'refundId' = ${refund}`,
      ),
    )
}

/** The most refunds one reading carries: a provider's list stops well before it. */
export const REFUND_LIST_CAP = 1_000

/** One refund as the provider lists it, in the database's words. */
export interface ObservedRefund {
  readonly ref: string
  readonly amountMinor: number
  readonly failed: boolean
}

/** What the provider says was refunded: its refunds that did not fail. */
export function refundTotalMinor(refunds: readonly ObservedRefund[]): number {
  return refunds
    .filter((refund) => !refund.failed)
    .reduce((total, refund) => addMinor(total, refund.amountMinor), 0)
}

/** `a - b`, stopping at nothing: a total from before the ids may be less than its rows. */
function lessMinor(a: number, b: number): number {
  return b > a ? 0 : subtractMinor(a, b)
}

/**
 * Brings the payment's refund rows in line with the provider's list (`refunds`, oldest first), by
 * the provider's id, never by an amount:
 * - A refund with no row is new: one row, one `record` Log entry and one alert for the venue's
 *   group. A refund that failed before Restro ever saw it makes no row: it has no storno to do.
 * - A refund the list says failed marks its row, and its alert closes. A row already answered is
 *   left for the accountant (Tonight reads it from the row).
 * - A row the list contradicts (back after failing, or more on the rows than the list adds up to:
 *   neither documented) is left as it is and counted `unmatched`, and the worker logs it.
 *
 * Rows and totals from before migration 0044 have no id, and a reading can't count them twice:
 * - A row with no id is given the id of a refund of exactly its amount, active refunds first, with
 *   no new Log entry or alert: it is that refund, already told. If that refund failed, the row is
 *   marked like any other.
 * - What the stored total holds beyond the rows with an id (`recorded`) stands for refunds already
 *   counted: a row of two refunds read at once, or a refund made before the rows existed. Refunds
 *   with no row use it up, oldest first, and make none; a refund it can't cover is new. Once every
 *   refund has a row, the stored total is what those rows add up to and `recorded` is nothing, so
 *   it can't hide a new refund.
 */
export async function reconcileRefunds(
  stx: ServiceTx,
  locked: Locked,
  refunds: readonly ObservedRefund[],
  totalMinor: number,
): Promise<{
  readonly added: number
  readonly failed: number
  readonly named: number
  readonly unmatched: number
}> {
  const { payment } = locked
  const rows = await stx.tx
    .select()
    .from(paymentRefunds)
    .where(eq(paymentRefunds.paymentId, payment.id))
    .orderBy(asc(paymentRefunds.seenAt), asc(paymentRefunds.id))
    .for('update')
  const byRef = new Map<string, RefundRow>()
  let recorded = payment.refundedMinor
  let rowsMinor = 0
  for (const row of rows) {
    if (row.providerRefundRef !== null) byRef.set(row.providerRefundRef, row)
    if (row.failedAt !== null) continue
    rowsMinor = addMinor(rowsMinor, row.amountMinor)
    if (row.providerRefundRef !== null) recorded = lessMinor(recorded, row.amountMinor)
  }

  let named = 0
  const unnamed = rows.filter((row) => row.providerRefundRef === null && row.failedAt === null)
  const activeFirst = [...refunds.filter((r) => !r.failed), ...refunds.filter((r) => r.failed)]
  for (const refund of activeFirst) {
    if (byRef.has(refund.ref)) continue
    const at = unnamed.findIndex((row) => row.amountMinor === refund.amountMinor)
    const row = unnamed[at]
    if (row === undefined) continue
    unnamed.splice(at, 1)
    await stx.tx
      .update(paymentRefunds)
      .set({ providerRefundRef: refund.ref, ...stx.provenance, updatedAt: sql`now()` })
      .where(eq(paymentRefunds.id, row.id))
    byRef.set(refund.ref, row)
    recorded = lessMinor(recorded, row.amountMinor)
    named += 1
  }

  let added = 0
  let failed = 0
  let unmatched = 0
  for (const refund of refunds) {
    const row = byRef.get(refund.ref)
    if (row === undefined) {
      if (refund.failed) continue
      if (refund.amountMinor <= recorded) {
        recorded = subtractMinor(recorded, refund.amountMinor)
        continue
      }
      await addRefundRow(stx, locked, refund)
      rowsMinor = addMinor(rowsMinor, refund.amountMinor)
      added += 1
    } else if (refund.failed && row.failedAt === null) {
      await markRefundFailed(stx, locked, row)
      rowsMinor = subtractMinor(rowsMinor, row.amountMinor)
      failed += 1
    } else if (!refund.failed && row.failedAt !== null) {
      // Back after failing: not documented, and the row stays marked. The total counts it, so it
      // must not count as `recorded` for a later refund.
      recorded = lessMinor(recorded, refund.amountMinor)
      unmatched += 1
    }
  }
  if (rowsMinor > totalMinor) unmatched += 1
  return { added, failed, named, unmatched }
}

/** A refund the provider says did not go through: its row is marked and its alert closes. */
async function markRefundFailed(stx: ServiceTx, locked: Locked, row: RefundRow): Promise<void> {
  const { payment } = locked
  await stx.tx
    .update(paymentRefunds)
    .set({ failedAt: sql`now()`, ...stx.provenance, updatedAt: sql`now()` })
    .where(eq(paymentRefunds.id, row.id))
  await stx.log({
    kind: 'payment.refund_seen',
    paymentId: payment.id,
    tableId: payment.tableId,
    sittingId: payment.sittingId,
    toState: 'failed',
    details: {
      refundId: row.id,
      amountMinor: row.amountMinor,
      providerKind: payment.providerKind,
    },
  })
  await closeAlertRows(stx, await openAlertsOf(stx, payment.id, PAYMENT_REFUNDED_KIND, row.id))
}

/** A new refund: its row, its Log entry and one alert for the venue's group. */
async function addRefundRow(stx: ServiceTx, locked: Locked, refund: ObservedRefund): Promise<void> {
  const { payment } = locked
  const id = newId('rf')
  await stx.tx.insert(paymentRefunds).values({
    id,
    tenantId: stx.tenantId,
    venueId: stx.venueId,
    paymentId: payment.id,
    providerRefundRef: refund.ref,
    amountMinor: refund.amountMinor,
    seenAt: await stx.dbNow(),
    serviceDate: stx.serviceDate,
    ...stx.provenance,
  })
  await stx.log({
    kind: 'payment.refund_seen',
    paymentId: payment.id,
    tableId: payment.tableId,
    sittingId: payment.sittingId,
    toState: 'seen',
    details: { refundId: id, amountMinor: refund.amountMinor, providerKind: payment.providerKind },
  })
  // The group is told once, with the table and the payment's day and no amount (decision log 5.8).
  await stx.tx.insert(alerts).values({
    id: newId('al'),
    tenantId: stx.tenantId,
    venueId: stx.venueId,
    serviceDate: stx.serviceDate,
    kind: PAYMENT_REFUNDED_KIND,
    audience: 'venue',
    subjectId: payment.id,
    permission: FOLLOW_UP_ALERT_PERMISSION,
    details: {
      paymentId: payment.id,
      refundId: id,
      tableId: payment.tableId,
      paymentDate: payment.serviceDate,
      providerKind: payment.providerKind,
    },
    ...stx.provenance,
    updatedAt: sql`now()`,
  })
}

const StornoSchema = (type: 'payment.storno_done' | 'payment.storno_undo') =>
  z.strictObject({ type: z.literal(type), refundId })

/** Records or takes back the storno of one refund row. */
async function markStorno(
  stx: ServiceTx,
  command: { readonly refundId: string },
  done: boolean,
): Promise<ServiceResult> {
  const [found] = await stx.tx
    .select({ paymentId: paymentRefunds.paymentId })
    .from(paymentRefunds)
    .where(and(eq(paymentRefunds.id, command.refundId), eq(paymentRefunds.venueId, stx.venueId)))
  if (found === undefined) return refused(null, 'refund_missing')
  const locked = await lockRoute(stx, found.paymentId, { alertKinds: [PAYMENT_REFUNDED_KIND] })
  if (refusedLock(locked)) return locked
  const [refund] = await stx.tx
    .select()
    .from(paymentRefunds)
    .where(eq(paymentRefunds.id, command.refundId))
    .for('update')
  if (refund === undefined) return refused(null, 'refund_missing')
  const { payment } = locked
  if (refund.failedAt !== null) return refused(null, 'refund_failed')
  if (done) {
    // A second answer is refused: the first person's is kept (decision log 5.4).
    if (refund.stornoAt !== null) return refused(null, 'storno_answered')
  } else if (refund.stornoAt === null) {
    return accepted(null, { details: { refundId: refund.id, done, changed: false } })
  }
  await stx.tx
    .update(paymentRefunds)
    .set({
      stornoAt: done ? await stx.dbNow() : null,
      stornoBy: done ? stx.provenance.actor : null,
      ...stx.provenance,
      updatedAt: sql`now()`,
    })
    .where(eq(paymentRefunds.id, refund.id))
  if (done) {
    await closeAlertRows(stx, await openAlertsOf(stx, payment.id, PAYMENT_REFUNDED_KIND, refund.id))
  }
  await stx.log({
    kind: 'payment.storno',
    paymentId: payment.id,
    tableId: payment.tableId,
    sittingId: payment.sittingId,
    toState: done ? 'done' : 'open',
    details: { refundId: refund.id },
  })
  return accepted(null, { details: { refundId: refund.id, done, changed: true } })
}

/**
 * `payment.storno_done`: a manager or owner says the storno of a refund was made at the till. It
 * saves at once; Tonight offers an Undo for 8 seconds. A second answer is refused `storno_answered`,
 * and a refund that did not go through `refund_failed`. Restro never checks the POS (rule 7).
 */
export function paymentStornoDone() {
  return defineCommand({
    schema: StornoSchema('payment.storno_done'),
    origins: ['staff'],
    permission: 'money.follow_up',
    idempotency: 'by_nature',
    undoable: { kinds: ['payment.storno'] },
    handle: (stx, command) => markStorno(stx, command, true),
  })
}

/**
 * `payment.storno_undo`: takes the answer back. It needs the `undo` token "Storno done" answered
 * with (like `tables.undo_open_all`), so nobody can quietly wipe someone else's answer: it is
 * refused `undo_expired` after 30 seconds and `undo_stale` when the storno was answered or taken
 * back again since (#219).
 */
export function paymentStornoUndo() {
  return defineCommand({
    schema: StornoSchema('payment.storno_undo').extend({ undo: UndoTokenSchema }),
    origins: ['staff'],
    permission: 'money.follow_up',
    idempotency: 'by_nature',
    undoStale: (stx, command, entry) =>
      changedSince(
        stx,
        entry,
        sql`${logEntries.kind} = 'payment.storno'
          and ${logEntries.details} ->> 'refundId' = ${command.refundId}`,
      ),
    async handle(stx, command) {
      // The token must be the Log entry "Storno done" wrote for this very refund: any other
      // recent entry's number would otherwise let one answer wipe another's.
      const given = await tokenEntry(stx, command.undo)
      if (
        given === null ||
        given.kind !== 'payment.storno' ||
        given.toState !== 'done' ||
        given.details.refundId !== command.refundId
      ) {
        return refused(null, 'invalid_command')
      }
      return markStorno(stx, command, false)
    },
  })
}

const FailedSeenSchema = (type: 'payment.refund_failed_seen' | 'payment.refund_failed_seen_undo') =>
  z.strictObject({ type: z.literal(type), refundId })

/** Records or takes back that a refund that did not go through was seen. */
async function markFailedSeen(
  stx: ServiceTx,
  command: { readonly refundId: string },
  seen: boolean,
): Promise<ServiceResult> {
  const [found] = await stx.tx
    .select({ paymentId: paymentRefunds.paymentId })
    .from(paymentRefunds)
    .where(and(eq(paymentRefunds.id, command.refundId), eq(paymentRefunds.venueId, stx.venueId)))
  if (found === undefined) return refused(null, 'refund_missing')
  const locked = await lockRoute(stx, found.paymentId)
  if (refusedLock(locked)) return locked
  const [refund] = await stx.tx
    .select()
    .from(paymentRefunds)
    .where(eq(paymentRefunds.id, command.refundId))
    .for('update')
  if (refund === undefined) return refused(null, 'refund_missing')
  // Only a refund that did not go through can be seen as such.
  if (refund.failedAt === null) return refused(null, 'refund_not_failed')
  // Tonight lists only a refund that failed after its storno was made (`refundsFailedAfterStorno`).
  if (refund.stornoAt === null) return refused(null, 'invalid_command')
  const [latest] = await stx.tx
    .select({ toState: logEntries.toState })
    .from(logEntries)
    .where(
      and(
        eq(logEntries.venueId, stx.venueId),
        eq(logEntries.kind, 'payment.refund_failed_seen'),
        sql`${logEntries.details} ->> 'refundId' = ${refund.id}`,
      ),
    )
    .orderBy(desc(logEntries.seq))
    .limit(1)
  // A second answer changes nothing: the first person's is kept, and no Undo is offered for it.
  if ((latest?.toState === 'seen') === seen) {
    return accepted(null, { details: { refundId: refund.id, seen, changed: false } })
  }
  const { payment } = locked
  await stx.log({
    kind: 'payment.refund_failed_seen',
    paymentId: payment.id,
    tableId: payment.tableId,
    sittingId: payment.sittingId,
    toState: seen ? 'seen' : 'open',
    details: { refundId: refund.id },
  })
  return accepted(null, { details: { refundId: refund.id, seen, changed: true } })
}

/**
 * `payment.refund_failed_seen` ("Got it"): a manager or owner says they saw a refund that did not
 * go through. Tonight stops showing it; the Log keeps who and when. It saves at once, with an Undo
 * for 8 seconds. A second answer changes nothing; the three-day fallback still ends the row.
 */
export function paymentRefundFailedSeen() {
  return defineCommand({
    schema: FailedSeenSchema('payment.refund_failed_seen'),
    origins: ['staff'],
    permission: 'money.follow_up',
    idempotency: 'by_nature',
    undoable: { kinds: ['payment.refund_failed_seen'] },
    handle: (stx, command) => markFailedSeen(stx, command, true),
  })
}

/**
 * `payment.refund_failed_seen_undo`: brings the row back. It needs the `undo` token "Got it"
 * answered with: refused `undo_expired` after 30 seconds and `undo_stale` when the refund was
 * answered or taken back again since (#219).
 */
export function paymentRefundFailedSeenUndo() {
  return defineCommand({
    schema: FailedSeenSchema('payment.refund_failed_seen_undo').extend({ undo: UndoTokenSchema }),
    origins: ['staff'],
    permission: 'money.follow_up',
    idempotency: 'by_nature',
    undoStale: (stx, command, entry) =>
      changedSince(
        stx,
        entry,
        sql`${logEntries.kind} = 'payment.refund_failed_seen'
          and ${logEntries.details} ->> 'refundId' = ${command.refundId}`,
      ),
    async handle(stx, command) {
      // The token must be the Log entry "Got it" wrote for this very refund.
      const given = await tokenEntry(stx, command.undo)
      if (
        given === null ||
        given.kind !== 'payment.refund_failed_seen' ||
        given.toState !== 'seen' ||
        given.details.refundId !== command.refundId
      ) {
        return refused(null, 'invalid_command')
      }
      return markFailedSeen(stx, command, false)
    },
  })
}
