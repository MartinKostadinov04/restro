// The refunds the venue made in its provider's dashboard, and the storno they leave to do (#222;
// D122 §8; decision log `docs/deliverables/2026-10-21-refunds-disputes-decision-log.md` 5.1–5.8).
//
// Restro never refunds (rule 7, D125 3.5): `payment.observe` reads the provider's refund total back
// and `reconcileRefunds` keeps one `payment_refunds` row per rise of it. A total that falls back
// marks the newest rows "didn't go through". The storno is the venue's own work at the till, so
// "Storno done" (`payment.storno_done`) only records who said it was made and when; Restro never
// checks the POS for it. Both commands are `money.follow_up`: a manager's PIN on the shared tablet,
// one tap on a manager's own session.
//
// Locks: the payment's route locks (`lockRoute`: the table's order, the refund alert, the payment),
// then the refund rows of the payment.

import { alerts, logEntries, paymentRefunds } from '@restro/db'
import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm'
import { z } from 'zod'

import { idSchema, newId } from '../ids'
import { PAYMENT_REFUNDED_KIND } from './alert-rules'
import { defineCommand, type ServiceTx } from './definition'
import { type Locked, lockRoute, refusedLock } from './pay-route'
import { accepted, refused, type ServiceResult } from './results'
import { changedSince, UndoTokenSchema } from './undo'

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

/**
 * Brings the payment's refund rows in line with the provider's refund total (`targetMinor`, an
 * absolute reading): the rows not failed add up to it afterwards.
 * - A total above them is a new refund: one row for the rise (two refunds read back at once make
 *   one), one `record` Log entry and one alert for the venue's group. A duplicate or out-of-order
 *   notice reads the same total and so adds nothing.
 * - A total below them is a refund that did not go through: the newest rows are marked until the
 *   rest add up, their alert closes, and a row already answered is left for the accountant.
 */
export async function reconcileRefunds(
  stx: ServiceTx,
  locked: Locked,
  targetMinor: number,
): Promise<{ readonly added: number; readonly failed: number }> {
  const { payment } = locked
  const rows = await stx.tx
    .select()
    .from(paymentRefunds)
    .where(eq(paymentRefunds.paymentId, payment.id))
    .orderBy(asc(paymentRefunds.seenAt), asc(paymentRefunds.id))
    .for('update')
  const active = rows.filter((row) => row.failedAt === null)
  let sum = active.reduce((total, row) => total + row.amountMinor, 0)
  let failed = 0
  if (sum > targetMinor) {
    const failing: RefundRow[] = []
    for (const row of [...active].reverse()) {
      if (sum <= targetMinor) break
      failing.push(row)
      sum -= row.amountMinor
    }
    if (failing.length > 0) {
      await stx.tx
        .update(paymentRefunds)
        .set({ failedAt: sql`now()`, ...stx.provenance, updatedAt: sql`now()` })
        .where(
          inArray(
            paymentRefunds.id,
            failing.map((row) => row.id),
          ),
        )
      for (const row of failing) {
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
        await closeAlertRows(
          stx,
          await openAlertsOf(stx, payment.id, PAYMENT_REFUNDED_KIND, row.id),
        )
      }
      failed = failing.length
    }
  }
  if (sum >= targetMinor) return { added: 0, failed }
  const id = newId('rf')
  const amountMinor = targetMinor - sum
  await stx.tx.insert(paymentRefunds).values({
    id,
    tenantId: stx.tenantId,
    venueId: stx.venueId,
    paymentId: payment.id,
    amountMinor,
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
    details: { refundId: id, amountMinor, providerKind: payment.providerKind },
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
  return { added: 1, failed }
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
 * `payment.storno_undo`: takes the answer back. With the `undo` token "Storno done" answered with
 * it is refused `undo_expired` after 30 seconds and `undo_stale` when the storno was answered or
 * taken back again since (#219); without a token it is a normal command.
 */
export function paymentStornoUndo() {
  return defineCommand({
    schema: StornoSchema('payment.storno_undo').extend({ undo: UndoTokenSchema.optional() }),
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
    handle: (stx, command) => markStorno(stx, command, false),
  })
}
