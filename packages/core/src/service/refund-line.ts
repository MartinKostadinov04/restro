// Restro refunds a paid line staff mark "Not served" (the 11-18 refund decision, 148; design B of
// `docs/deliverables/2026-11-18-sold-out-paid-line-refund.md`, step one). Rule 1: every service write
// goes through `applyService`, so the staff's tap, the worker's answer and the owner's switch are
// commands here, and nothing else writes a refund row.
//
// The route, in order, each step recorded before the next:
//   1. `payment.refund_line` (staff): the refund row is written FIRST, with the staff's actor and job,
//      a Log entry "refund requested" and the storno to-do the manager already knows (D122 §8). The
//      row is the job: the worker finds it (`pendingRefunds`).
//   2. The worker calls the provider's one refund step, `refundLine`, with the row's id as the
//      idempotency key, and records its answer with `payment.refund_sent` (the provider's id of the
//      refund, or "did not go through"). A timeout is retried with the same key, never a second refund.
//   3. The guest's bill says "refund being sent" until Restro reads the refund back from the provider
//      (`payment.observe`, `confirmRefund`): "refunded" is never a local success (D72).
//
// The bounds, all here and checked in one function (`refundBoundsProblem`), at the tap and again by
// the worker before the call: only a payment Restro captured, only a line the POS closed and only at
// most the amount it closed that line for (per unit for part of a line), once per line (the unique
// index of the row, and a refused second tap), and only inside the night the payment was captured
// in. Nothing here limits what a person may refund beyond that: no manager's PIN, no ceiling, no
// cut-off (Martin: "I am not interested into imposing limits"). The nightly alarm
// (`refund-tripwire.ts`) only tells owners to look and blocks nothing. The one thing that stops the
// route is a refund made with Restro's key that has no row of ours (`tripStrayRefund`): a leaked key
// or a bug, not a person.
//
// Locks: the payment's route locks (`lockRoute`: the table's order, the refund alert, the payment), then
// the payment's refund rows. The venue's account row is taken last, `FOR UPDATE`, when a stray refund
// stops the route or an owner switches it back on.

import {
  alerts,
  authOrganization,
  type DbPool,
  paymentAccounts,
  paymentLines,
  paymentRefunds,
  payments,
  withSystem,
  withTenant,
} from '@restro/db'
import { and, asc, eq, isNull, sql } from 'drizzle-orm'
import { z } from 'zod'

import { idSchema, newId } from '../ids'
import { addMinor, decimalToMinor, ratioOfMinor, subtractMinor } from '../money'
import {
  PAYMENT_REFUND_ALARM_KIND,
  PAYMENT_REFUND_ROUTE_OFF_KIND,
  PAYMENT_REFUNDED_KIND,
} from './alert-rules'
import { defineCommand, type ServiceTx } from './definition'
import { lockRoute, refusedLock } from './pay-route'
import { closeAlertRows, insertRefundAlert, openAlertsOf } from './payment-refunds'
import { refundAlarm } from './refund-tripwire'
import { accepted, refused } from './results'

/** The Tonight permission of "Not served": whoever may answer a sent order and the alerts. */
export const REFUND_LINE_PERMISSION = 'alerts.answer' as const

/** The owners' permission, which also switches the route back on (D125 2.2). */
const ROUTE_PERMISSION = 'settings.connect_payments' as const

/** The alerts of the tripwire are for owners and managers. */
const ALERT_PERMISSION = 'money.follow_up' as const

const refundId = idSchema('rf')

/** A quantity as a decimal text: whole or with up to six decimals, like `payment_lines.quantity`. */
const QUANTITY = /^\d{1,12}(?:\.\d{1,6})?$/

// ---------------------------------------------------------------------------------------------
// The bounds

/** What the bounds look at: the payment, the line the POS closed, and what is refunded already. */
export interface RefundBoundsInput {
  readonly payment: {
    readonly state: string
    readonly providerPaymentRef: string | null
    readonly capturedMinor: number | null
    readonly refundedMinor: number
    readonly serviceDate: string
  }
  readonly line: {
    readonly closedMinor: number | null
    readonly closedQuantity: string | null
  }
  /** The amount to refund, in minor units. */
  readonly amountMinor: number
  /** Refunds Restro sent that the provider's total does not hold yet (no provider id on the row). */
  readonly unsentMinor: number
  /** The venue's service day now. */
  readonly serviceDate: string
}

/**
 * Why a refund is outside Restro's own bounds, or null when it is inside them: a code for the
 * answer. The one place the bounds live.
 */
export function refundBoundsProblem(input: RefundBoundsInput): string | null {
  const { payment, line } = input
  if (payment.state !== 'captured' || payment.providerPaymentRef === null) {
    return 'payment_not_captured'
  }
  if (payment.serviceDate !== input.serviceDate) return 'refund_not_tonight'
  if (line.closedMinor === null || line.closedQuantity === null) return 'line_not_paid'
  if (input.amountMinor < 1 || input.amountMinor > line.closedMinor) return 'refund_above_line'
  const left = subtractMinor(
    payment.capturedMinor ?? 0,
    addMinor(payment.refundedMinor, input.unsentMinor),
  )
  if (input.amountMinor > left) return 'refund_above_payment'
  return null
}

/**
 * The amount of a refund: what the POS closed the line for (all of it, or for part of the line the
 * POS's amount per unit times the quantity, rounded half-up, rule 8), or null for a quantity that
 * is none or more than was closed.
 */
export function refundAmountMinor(
  closedMinor: number,
  closedQuantity: string,
  quantity: string | undefined,
): number | null {
  if (quantity === undefined) return closedMinor
  const asked = decimalToMinor(quantity, 6)
  const closed = decimalToMinor(closedQuantity, 6)
  if (asked < 1 || asked > closed) return null
  return ratioOfMinor(closedMinor, asked, closed)
}

// ---------------------------------------------------------------------------------------------
// The route's state at the venue

/** Whether Restro's own refunds are switched off at the venue, and why. */
async function routeOff(stx: ServiceTx): Promise<boolean> {
  const [account] = await stx.tx
    .select({ off: paymentAccounts.refundRouteOffAt })
    .from(paymentAccounts)
    .where(eq(paymentAccounts.venueId, stx.venueId))
  return account?.off != null
}

/** One alert for owners and managers; no amount, no guest data. */
async function raiseAlert(
  stx: ServiceTx,
  kind: string,
  subjectId: string,
  details: Readonly<Record<string, string | number | boolean | null>>,
): Promise<void> {
  const id = newId('al')
  await stx.tx.insert(alerts).values({
    id,
    tenantId: stx.tenantId,
    venueId: stx.venueId,
    serviceDate: stx.serviceDate,
    kind,
    audience: 'venue',
    subjectId,
    permission: ALERT_PERMISSION,
    details,
    ...stx.provenance,
    updatedAt: sql`now()`,
  })
  await stx.log({ kind: 'alert.raised', reason: kind, details: { alertId: id } })
}

/** Stops the route for a stray refund; the first stop stands. Never touches a refund already confirmed. */
async function switchOff(stx: ServiceTx, reason: 'stray'): Promise<boolean> {
  const switched = await stx.tx
    .update(paymentAccounts)
    .set({
      refundRouteOffAt: sql`now()`,
      refundRouteOffReason: reason,
      ...stx.provenance,
      updatedAt: sql`now()`,
    })
    .where(and(eq(paymentAccounts.venueId, stx.venueId), isNull(paymentAccounts.refundRouteOffAt)))
    .returning({ venueId: paymentAccounts.venueId })
  return switched.length > 0
}

/** What Restro refunded tonight and what the night captured (the alarm's two numbers). */
async function nightTotals(stx: ServiceTx) {
  const [captured] = await stx.tx
    .select({ total: sql<string>`coalesce(sum(${payments.capturedMinor}), 0)` })
    .from(payments)
    .where(
      and(
        eq(payments.venueId, stx.venueId),
        eq(payments.serviceDate, stx.serviceDate),
        eq(payments.state, 'captured'),
      ),
    )
  const [refunded] = await stx.tx
    .select({
      total: sql<string>`coalesce(sum(${paymentRefunds.amountMinor}), 0)`,
      count: sql<string>`count(*)`,
    })
    .from(paymentRefunds)
    .where(
      and(
        eq(paymentRefunds.venueId, stx.venueId),
        eq(paymentRefunds.serviceDate, stx.serviceDate),
        eq(paymentRefunds.origin, 'line'),
        isNull(paymentRefunds.failedAt),
      ),
    )
  return {
    capturedMinor: Number(captured?.total ?? 0),
    refundedMinor: Number(refunded?.total ?? 0),
    refundCount: Number(refunded?.count ?? 0),
  }
}

/** Whether the night's alarm was raised already (one a night). */
async function alarmRaised(stx: ServiceTx): Promise<boolean> {
  const [found] = await stx.tx
    .select({ id: alerts.id })
    .from(alerts)
    .where(
      and(
        eq(alerts.venueId, stx.venueId),
        eq(alerts.kind, PAYMENT_REFUND_ALARM_KIND),
        eq(alerts.serviceDate, stx.serviceDate),
      ),
    )
    .limit(1)
  return found !== undefined
}

/**
 * The alarm after a refund was written (it counts the new row): past 1 % of the night's captured
 * amount with three refunds or more, once a night, an alert (so a `alert.raised` Log entry) for
 * owners and the team. It blocks nothing: the refund just written stands and so does every later one.
 */
async function checkNight(stx: ServiceTx, subjectId: string): Promise<void> {
  if (!refundAlarm(await nightTotals(stx))) return
  if (!(await alarmRaised(stx))) {
    await raiseAlert(stx, PAYMENT_REFUND_ALARM_KIND, subjectId, {})
  }
}

/**
 * A refund that carries Restro's stamp and has no row of ours (`reconcileRefunds`): somebody used
 * Restro's refund key without Restro's code. The route goes off and the owners are told, at once.
 */
export async function tripStrayRefund(stx: ServiceTx, paymentId: string): Promise<void> {
  if (await switchOff(stx, 'stray')) {
    await raiseAlert(stx, PAYMENT_REFUND_ROUTE_OFF_KIND, paymentId, { reason: 'stray' })
  }
  if (!(await alarmRaised(stx))) await raiseAlert(stx, PAYMENT_REFUND_ALARM_KIND, paymentId, {})
}

// ---------------------------------------------------------------------------------------------
// The commands

/**
 * `payment.refund_line` ("Not served"): a person who may answer alerts says a line the guest paid
 * for was never served. The refund row is written first; the worker sends it. Refused when the
 * route is off (`refund_route_off`), the line is not paid or not this payment's, or it was refunded
 * already (`refund_already`).
 */
export function paymentRefundLine() {
  return defineCommand({
    schema: z.strictObject({
      type: z.literal('payment.refund_line'),
      paymentId: idSchema('py'),
      /** The line's place in the payment (`payment_lines.position`). */
      position: z.int().min(1).max(10_000),
      /** For part of a line (1 of 2): the quantity not served, a decimal text. Left out: all of it. */
      quantity: z.string().regex(QUANTITY).optional(),
    }),
    origins: ['staff'],
    permission: REFUND_LINE_PERMISSION,
    // A second tap on the same line is refused by the line's own once-only rule, whoever taps.
    idempotency: 'by_state',
    // No `quickOnSharedDevice`: on a shared tablet a person's own PIN names who tapped, and the Log
    // and the end of the night show that name beside every refund.
    async handle(stx, command) {
      const locked = await lockRoute(stx, command.paymentId, {
        alertKinds: [PAYMENT_REFUNDED_KIND],
      })
      if (refusedLock(locked)) return locked
      const { payment } = locked
      if (await routeOff(stx)) return refused(null, 'refund_route_off')
      const [line] = await stx.tx
        .select()
        .from(paymentLines)
        .where(
          and(eq(paymentLines.paymentId, payment.id), eq(paymentLines.position, command.position)),
        )
      if (line === undefined) return refused(null, 'line_missing')
      const rows = await stx.tx
        .select()
        .from(paymentRefunds)
        .where(eq(paymentRefunds.paymentId, payment.id))
        .orderBy(asc(paymentRefunds.seenAt), asc(paymentRefunds.id))
        .for('update')
      if (
        rows.some(
          (row) =>
            row.origin === 'line' && row.linePosition === line.position && row.failedAt === null,
        )
      ) {
        return refused(null, 'refund_already')
      }
      if (line.closedMinor === null || line.closedQuantity === null) {
        return refused(null, 'line_not_paid')
      }
      const amountMinor = refundAmountMinor(line.closedMinor, line.closedQuantity, command.quantity)
      if (amountMinor === null) return refused(null, 'refund_above_line')
      const unsentMinor = rows
        .filter(
          (row) => row.origin === 'line' && row.failedAt === null && row.providerRefundRef === null,
        )
        .reduce((total, row) => addMinor(total, row.amountMinor), 0)
      const problem = refundBoundsProblem({
        payment,
        line,
        amountMinor,
        unsentMinor,
        serviceDate: stx.serviceDate,
      })
      if (problem !== null) return refused(null, problem)

      const id = newId('rf')
      await stx.tx.insert(paymentRefunds).values({
        id,
        tenantId: stx.tenantId,
        venueId: stx.venueId,
        paymentId: payment.id,
        origin: 'line',
        linePosition: line.position,
        amountMinor,
        seenAt: await stx.dbNow(),
        serviceDate: stx.serviceDate,
        ...stx.provenance,
      })
      await stx.log({
        kind: 'payment.refund_requested',
        paymentId: payment.id,
        tableId: payment.tableId,
        sittingId: payment.sittingId,
        toState: 'requested',
        details: {
          refundId: id,
          amountMinor,
          line: line.position,
          providerKind: payment.providerKind,
        },
      })
      // The manager's storno to-do, with the receipt's number, date and fiscal memory number, is
      // read from this row like any refund's (`refundsToDo`): the alert tells the group once.
      await insertRefundAlert(stx, payment, id)
      await checkNight(stx, payment.id)
      return accepted(null, { details: { refundId: id, amountMinor, paymentId: payment.id } })
    },
  })
}

/**
 * `payment.refund_sent` (the worker): what the provider answered to `refundLine`: `sent` with the
 * provider's id of the refund, or `failed` with the provider's refusal (the refund did not go
 * through, so no storno is due for it). Repeating an answer changes nothing. A timeout is not an
 * answer: the worker asks again with the same key.
 */
export function paymentRefundSent() {
  return defineCommand({
    schema: z.strictObject({
      type: z.literal('payment.refund_sent'),
      refundId,
      outcome: z.enum(['sent', 'failed']),
      /** *Backend*: the provider's id of the refund, when `sent`. */
      providerRefundRef: z
        .string()
        .regex(/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,254}$/)
        .optional(),
      /** The refusal's code when `failed`: a word, never the provider's message. */
      code: z
        .string()
        .regex(/^[a-z][a-z0-9_]{0,63}$/)
        .optional(),
    }),
    origins: ['worker'],
    permission: null,
    idempotency: 'by_state',
    async handle(stx, command) {
      const [found] = await stx.tx
        .select({ paymentId: paymentRefunds.paymentId })
        .from(paymentRefunds)
        .where(
          and(eq(paymentRefunds.id, command.refundId), eq(paymentRefunds.venueId, stx.venueId)),
        )
      if (found === undefined) return refused(null, 'refund_missing')
      const locked = await lockRoute(stx, found.paymentId, { alertKinds: [PAYMENT_REFUNDED_KIND] })
      if (refusedLock(locked)) return locked
      const { payment } = locked
      const [row] = await stx.tx
        .select()
        .from(paymentRefunds)
        .where(eq(paymentRefunds.id, command.refundId))
        .for('update')
      if (row === undefined || row.origin !== 'line') return refused(null, 'refund_missing')
      if (command.outcome === 'sent') {
        if (command.providerRefundRef === undefined) return refused(null, 'invalid_command')
        if (row.failedAt !== null) return refused(null, 'refund_failed')
        if (row.providerRefundRef !== null) {
          // The read-back named it first, or this is a repeat.
          return accepted(null, { details: { refundId: row.id, changed: false } })
        }
        await stx.tx
          .update(paymentRefunds)
          .set({
            providerRefundRef: command.providerRefundRef,
            ...stx.provenance,
            updatedAt: sql`now()`,
          })
          .where(eq(paymentRefunds.id, row.id))
        await stx.log({
          kind: 'payment.refund_sent',
          paymentId: payment.id,
          tableId: payment.tableId,
          sittingId: payment.sittingId,
          toState: 'sent',
          details: {
            refundId: row.id,
            amountMinor: row.amountMinor,
            providerKind: payment.providerKind,
          },
        })
        return accepted(null, { details: { refundId: row.id, changed: true } })
      }
      if (row.failedAt !== null) {
        return accepted(null, { details: { refundId: row.id, changed: false } })
      }
      // A refund the provider already holds (named by the read-back) did not fail.
      if (row.providerRefundRef !== null) return refused(null, 'refund_sent')
      await stx.tx
        .update(paymentRefunds)
        .set({ failedAt: sql`now()`, ...stx.provenance, updatedAt: sql`now()` })
        .where(eq(paymentRefunds.id, row.id))
      await stx.log({
        kind: 'payment.refund_sent',
        paymentId: payment.id,
        tableId: payment.tableId,
        sittingId: payment.sittingId,
        toState: 'failed',
        reason: command.code ?? 'refused',
        details: {
          refundId: row.id,
          amountMinor: row.amountMinor,
          providerKind: payment.providerKind,
        },
      })
      await closeAlertRows(stx, await openAlertsOf(stx, payment.id, PAYMENT_REFUNDED_KIND, row.id))
      return accepted(null, { details: { refundId: row.id, changed: true } })
    },
  })
}

/**
 * `payment_account.refund_route_on` (an owner): switches Restro's own refunds back on after the
 * tripwire or a stray refund switched them off, and closes the alert about it. The venue's own
 * provider dashboard never stopped working.
 */
export function paymentRefundRouteOn() {
  return defineCommand({
    schema: z.strictObject({ type: z.literal('payment_account.refund_route_on') }),
    origins: ['staff'],
    permission: ROUTE_PERMISSION,
    idempotency: 'by_nature',
    async handle(stx) {
      const switched = await stx.tx
        .update(paymentAccounts)
        .set({
          refundRouteOffAt: null,
          refundRouteOffReason: null,
          ...stx.provenance,
          updatedAt: sql`now()`,
        })
        .where(
          and(
            eq(paymentAccounts.venueId, stx.venueId),
            sql`${paymentAccounts.refundRouteOffAt} is not null`,
          ),
        )
        .returning({ venueId: paymentAccounts.venueId })
      if (switched.length === 0) return accepted(null, { details: { changed: false } })
      const open = await stx.tx
        .select({ id: alerts.id })
        .from(alerts)
        .where(
          and(
            eq(alerts.venueId, stx.venueId),
            eq(alerts.kind, PAYMENT_REFUND_ROUTE_OFF_KIND),
            isNull(alerts.doneAt),
          ),
        )
      await closeAlertRows(stx, open)
      await stx.log({ kind: 'settings.changed', reason: 'refund_route', details: { on: true } })
      return accepted(null, { details: { changed: true } })
    },
  })
}

// ---------------------------------------------------------------------------------------------
// What the worker reads

/** One refund of ours the worker has something to do for. */
export interface PendingRefund {
  readonly tenantId: string
  readonly venueId: string
  readonly refundId: string
  readonly paymentId: string
  readonly providerKind: string
  /** *Backend*: the provider's ids; only the worker reads them. */
  readonly accountRef: string
  readonly providerPaymentRef: string
  readonly providerRefundRef: string | null
  readonly amountMinor: number
  readonly state: string
  readonly capturedMinor: number | null
  readonly refundedMinor: number
  /** The payment's service day. */
  readonly serviceDate: string
  /** The day the refund was asked on: the day the worker holds the bounds against. */
  readonly refundServiceDate: string
  readonly closedMinor: number | null
  readonly closedQuantity: string | null
  readonly unsentMinor: number
}

/**
 * The refunds Restro sent that are not final: not yet asked of the provider (`providerRefundRef`
 * null) or asked and not yet read back, oldest first. Each tenant is read in turn, as the floor tick
 * does. A failed row, and one read back, are done.
 */
export async function pendingRefunds(pool: DbPool): Promise<readonly PendingRefund[]> {
  const organisations = await withSystem(pool, (tx) =>
    tx.select({ id: authOrganization.id }).from(authOrganization),
  )
  const found: PendingRefund[] = []
  for (const organisation of organisations) {
    const rows = await withTenant(pool, organisation.id, (tx) =>
      tx
        .select({
          venueId: paymentRefunds.venueId,
          refundId: paymentRefunds.id,
          paymentId: paymentRefunds.paymentId,
          providerKind: payments.providerKind,
          accountRef: paymentAccounts.accountRef,
          providerPaymentRef: payments.providerPaymentRef,
          providerRefundRef: paymentRefunds.providerRefundRef,
          amountMinor: paymentRefunds.amountMinor,
          state: payments.state,
          capturedMinor: payments.capturedMinor,
          refundedMinor: payments.refundedMinor,
          serviceDate: payments.serviceDate,
          refundServiceDate: paymentRefunds.serviceDate,
          closedMinor: paymentLines.closedMinor,
          closedQuantity: paymentLines.closedQuantity,
          unsentMinor: sql<string>`coalesce((select sum(r.amount_minor) from ${paymentRefunds} r
            where r.payment_id = ${paymentRefunds.paymentId} and r.origin = 'line'
              and r.failed_at is null and r.provider_refund_ref is null), 0)`,
        })
        .from(paymentRefunds)
        .innerJoin(payments, eq(payments.id, paymentRefunds.paymentId))
        .innerJoin(
          paymentAccounts,
          and(
            eq(paymentAccounts.venueId, paymentRefunds.venueId),
            eq(paymentAccounts.providerKind, payments.providerKind),
          ),
        )
        .innerJoin(
          paymentLines,
          and(
            eq(paymentLines.paymentId, paymentRefunds.paymentId),
            eq(paymentLines.position, paymentRefunds.linePosition),
          ),
        )
        .where(
          and(
            eq(paymentRefunds.origin, 'line'),
            isNull(paymentRefunds.failedAt),
            isNull(paymentRefunds.confirmedAt),
          ),
        )
        .orderBy(asc(paymentRefunds.seenAt), asc(paymentRefunds.id))
        .limit(200),
    )
    for (const row of rows) {
      if (row.accountRef === null || row.providerPaymentRef === null) continue
      found.push({
        tenantId: organisation.id,
        venueId: row.venueId,
        refundId: row.refundId,
        paymentId: row.paymentId,
        providerKind: row.providerKind,
        accountRef: row.accountRef,
        providerPaymentRef: row.providerPaymentRef,
        providerRefundRef: row.providerRefundRef,
        amountMinor: row.amountMinor,
        state: row.state,
        capturedMinor: row.capturedMinor,
        refundedMinor: row.refundedMinor,
        serviceDate: row.serviceDate,
        refundServiceDate: row.refundServiceDate,
        closedMinor: row.closedMinor,
        closedQuantity: row.closedQuantity,
        unsentMinor: Number(row.unsentMinor),
      })
    }
  }
  return found
}
