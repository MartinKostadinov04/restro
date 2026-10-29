// The read side of the end of the night's payments and of one payment's sheet (#115; plans
// `docs/deliverables/2026-10-29-tonight-paying-plan.md`, `2026-10-27-tonight-end-of-night-plan.md`
// §3 sections 3–6, and the Log plan's "Everything about one thing"). Read-only on `withTenant`, no
// provider call, our ids and public fields only (rule 3): never a provider's or a POS reference.
//
// - The list of what to fix reads the payments by their state (`unconfirmed`, `stranded`,
//   `capture_failed`, a hold that `expired`, a capture with no receipt number), never the alerts:
//   the day's close clears some alerts, and a cleared alert must not drop a payment from the page
//   (#162). The open alert of a payment is attached, for the answer that closes it.
// - Tips are read only for `night.view_full` (staff never see them, decision log 3.4).
// - Sections 4–6 (money alerts and their answers, refunds, disputes) are `night.view_full` only,
//   and what is read of refunds, stornos and disputes is what `payment.observe` recorded.
//
// Times are `Date`s; the screen words them in the venue's zone.

import {
  alerts,
  bars,
  type DbPool,
  logEntries,
  paymentLines,
  payments,
  type ReadTx,
  sentOrders,
  venueTables,
  withTenant,
} from '@restro/db'
import { and, asc, desc, eq, inArray, ne, or, sql } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'

import {
  PAYMENT_CAPTURE_FAILED_KIND,
  PAYMENT_CHECK_FAILED_KIND,
  PAYMENT_HOLD_EXPIRED_KIND,
  PAYMENT_LINES_NOT_BACK_KIND,
  PAYMENT_RELEASE_REFUSED_KIND,
  PAYMENT_STRANDED_KIND,
  PAYMENT_UNCONFIRMED_KIND,
} from './alert-rules'
import type { NightPayWhat } from './night-export'
import {
  accessOf,
  canReadNight,
  dayOf,
  type NightAccess,
  type NightRefusal,
  open,
  RESTRO,
  type ReadInput,
  type Who,
  whoOf,
} from './night-read'
import { PAYMENT_UNCONFIRMED_REASONS } from './pay-route'
import { payingPausedAt } from './paying-pause'
import { loadPayingConnection } from './payment-connection'
import { paymentNumberOf } from './payment-number'
import type { Permission } from './permissions'

/** The kinds of alert that are about one payment (their subject is the payment). */
export const PAYMENT_ALERT_KINDS = [
  PAYMENT_UNCONFIRMED_KIND,
  PAYMENT_LINES_NOT_BACK_KIND,
  PAYMENT_CHECK_FAILED_KIND,
  PAYMENT_STRANDED_KIND,
  PAYMENT_CAPTURE_FAILED_KIND,
  PAYMENT_RELEASE_REFUSED_KIND,
  PAYMENT_HOLD_EXPIRED_KIND,
] as const

/** What is wrong with a payment at the end of the night. */
export type NightPayProblem =
  | 'unconfirmed'
  | 'capture_failed'
  | 'stranded'
  | 'expired'
  | 'no_receipt'

/** The question an unconfirmed payment asks. */
export type PayQuestion = 'close' | 'till' | 'lines_not_back'

/** The most payments one read returns. */
export const PAYMENTS_MAX_ROWS = 2000

/** One payment of the day. */
export interface NightPaymentRow {
  readonly id: string
  readonly tableId: string
  readonly table: string
  readonly numbered: boolean
  /** The bar whose queue it joined, or null. */
  readonly bar: string | null
  /** The payment table it was paid at, by its label, or null before it got one. */
  readonly payTable: string | null
  readonly kind: string
  readonly state: string
  readonly reason: string | null
  /** A pay-first round's order reference. */
  readonly reference: string | null
  readonly amountMinor: number | null
  /** Null for a role that never sees tips. */
  readonly tipMinor: number | null
  readonly capturedMinor: number | null
  readonly refundedMinor: number
  readonly dispute: string | null
  readonly receiptNumber: string | null
  readonly currency: string
  readonly at: Date
  /** Until when the hold may be captured (an unconfirmed payment's end), or null. */
  readonly captureBefore: Date | null
}

/** A payment the page lists under "To fix", with the open alert that asks for its answer. */
export interface NightPayFix {
  readonly payment: NightPaymentRow
  readonly problem: NightPayProblem
  readonly question: PayQuestion | null
  readonly alert: {
    readonly id: string
    readonly kind: string
    readonly raisedAt: Date
  } | null
}

/** A money alert and its answer (section 4). */
export interface NightMoneyAlert {
  readonly alertId: string
  readonly kind: string
  readonly paymentId: string
  readonly table: string
  readonly numbered: boolean
  readonly raisedAt: Date
  /** Null while open. */
  readonly answer: {
    /** A payment answer's code, `seen` (an acknowledgement) or `expired` (the hold ran out). */
    readonly code: 'receipt_printed' | 'no_receipt' | 'on_till' | 'not_on_till' | 'seen' | 'expired'
    readonly who: Who
    readonly via: string | null
    readonly at: Date
  } | null
}

/** The money of the day beyond the payments themselves, for managers and owners. */
export interface NightMoneySections {
  readonly alerts: readonly NightMoneyAlert[]
  /** Refunds seen on the day's payments, as `payment.observe` read them back. */
  readonly refunds: readonly {
    readonly paymentId: string
    readonly table: string
    readonly numbered: boolean
    readonly refundedMinor: number
    readonly currency: string
  }[]
  readonly disputes: {
    readonly rows: readonly {
      readonly paymentId: string
      readonly table: string
      readonly numbered: boolean
      readonly amountMinor: number | null
      readonly currency: string
      readonly state: string
    }[]
    /** Disputes still open at the venue, whatever their day. */
    readonly openCount: number
  }
}

/** The day's payments for the end-of-night page. */
export interface NightPayments {
  readonly day: string
  readonly full: boolean
  readonly counts: {
    readonly all: number
    readonly captured: number
    readonly released: number
    readonly unconfirmed: number
  }
  /** What to fix, from the payments' states. */
  readonly fix: readonly NightPayFix[]
  /** The ones that did not end charged first; every payment after "Show all" (`all`). */
  readonly rows: readonly NightPaymentRow[]
  readonly hasMore: boolean
  /** Only today: why card payments in the app are still stopped. */
  readonly paying: 'paused' | 'lost' | 'restricted' | null
  readonly money: NightMoneySections | null
}

const PAGE = 100

/** The question an unconfirmed payment asks, from why it is unconfirmed. */
export function questionOf(reason: string | null): PayQuestion {
  if (reason === 'lines_not_back') return 'lines_not_back'
  if (reason === 'enter_unknown' || reason === 'entered_check_failed') return 'till'
  return 'close'
}

const payTable = alias(venueTables, 'pay_table')

type PaymentSelect = {
  id: string
  tableId: string
  tableName: string | null
  tableNumber: string | null
  bar: string | null
  payTableName: string | null
  payTableNumber: string | null
  kind: string
  state: string
  reason: string | null
  reference: string | null
  amountMinor: number | null
  tipMinor: number
  capturedMinor: number | null
  refundedMinor: number
  dispute: string | null
  receiptNumber: string | null
  currency: string
  at: Date
  captureBefore: Date | null
}

const columns = {
  id: payments.id,
  tableId: payments.tableId,
  tableName: venueTables.name,
  tableNumber: venueTables.number,
  bar: bars.name,
  payTableName: payTable.name,
  payTableNumber: payTable.number,
  kind: payments.kind,
  state: payments.state,
  reason: payments.reason,
  reference: sentOrders.reference,
  amountMinor: payments.amountMinor,
  tipMinor: payments.tipMinor,
  capturedMinor: payments.capturedMinor,
  refundedMinor: payments.refundedMinor,
  dispute: payments.dispute,
  receiptNumber: payments.receiptNumber,
  currency: payments.currency,
  at: payments.createdAt,
  captureBefore: payments.captureBefore,
}

function paymentQuery(tx: ReadTx) {
  return tx
    .select(columns)
    .from(payments)
    .innerJoin(venueTables, eq(venueTables.id, payments.tableId))
    .leftJoin(payTable, eq(payTable.id, payments.paymentTableId))
    .leftJoin(bars, eq(bars.id, payments.barId))
    .leftJoin(sentOrders, eq(sentOrders.id, payments.sentOrderId))
}

function rowOf(row: PaymentSelect, full: boolean): NightPaymentRow {
  const label = (name: string | null, number: string | null) => name ?? number
  return {
    id: row.id,
    tableId: row.tableId,
    table: row.tableName ?? row.tableNumber ?? '',
    numbered: row.tableName === null && row.tableNumber !== null,
    bar: row.bar,
    payTable: label(row.payTableName, row.payTableNumber),
    kind: row.kind,
    state: row.state,
    reason: row.reason,
    reference: row.reference,
    amountMinor: row.amountMinor,
    tipMinor: full ? row.tipMinor : null,
    capturedMinor: row.capturedMinor,
    refundedMinor: row.refundedMinor,
    dispute: row.dispute,
    receiptNumber: row.receiptNumber,
    currency: row.currency,
    at: row.at,
    captureBefore: row.captureBefore,
  }
}

/** The problem a payment shows at the end of the night, or null when it is in order. */
export function problemOf(row: {
  readonly state: string
  readonly reason: string | null
  readonly receiptNumber: string | null
}): NightPayProblem | null {
  // Answered ("Receipt printed", "No receipt") it waits for the worker, no longer for a person.
  if (row.state === 'unconfirmed') {
    return (PAYMENT_UNCONFIRMED_REASONS as readonly (string | null)[]).includes(row.reason)
      ? 'unconfirmed'
      : null
  }
  if (row.state === 'capture_failed') return 'capture_failed'
  if (row.state === 'stranded') return 'stranded'
  if (row.state === 'released' && row.reason === 'expired') return 'expired'
  if (row.state === 'captured' && row.receiptNumber === null) return 'no_receipt'
  return null
}

/** A person pressed Done on the payment's alert of that kind (a day's close clearing it is not). */
const doneByPerson = (kind: string) =>
  sql`exists (select 1 from ${alerts} a where a.subject_id = ${payments.id} and a.kind = ${kind}
    and a.done_at is not null and not jsonb_exists(a.details, 'clearedAt'))`

/** The payment was told to a person: its alert of that kind exists. */
const toldBy = (kind: string) =>
  sql`exists (select 1 from ${alerts} a where a.subject_id = ${payments.id} and a.kind = ${kind})`

/**
 * What the end of the night lists, from the payments' states and never from the alerts alone: a
 * cleared alert drops nothing (#162), but a row leaves once a person has dealt with it. A hold that
 * ran out is a problem only where it was told to someone (`payment_hold_expired`): an abandoned
 * checkout ends released/expired with no alert and nobody to fix it.
 */
export const FIX_CONDITION = or(
  and(
    eq(payments.state, 'unconfirmed'),
    inArray(payments.reason, [...PAYMENT_UNCONFIRMED_REASONS]),
  ),
  and(eq(payments.state, 'capture_failed'), sql`not ${doneByPerson(PAYMENT_CAPTURE_FAILED_KIND)}`),
  and(eq(payments.state, 'stranded'), sql`not ${doneByPerson(PAYMENT_STRANDED_KIND)}`),
  and(
    eq(payments.state, 'released'),
    eq(payments.reason, 'expired'),
    toldBy(PAYMENT_HOLD_EXPIRED_KIND),
    sql`not ${doneByPerson(PAYMENT_HOLD_EXPIRED_KIND)}`,
  ),
  and(eq(payments.state, 'captured'), sql`${payments.receiptNumber} is null`),
)

/** The alert kind that asks for the answer of each problem. */
const ALERT_OF_PROBLEM: Readonly<Record<NightPayProblem, readonly string[]>> = {
  unconfirmed: [PAYMENT_UNCONFIRMED_KIND, PAYMENT_LINES_NOT_BACK_KIND],
  capture_failed: [PAYMENT_CAPTURE_FAILED_KIND],
  stranded: [PAYMENT_STRANDED_KIND],
  expired: [PAYMENT_HOLD_EXPIRED_KIND],
  no_receipt: [],
}

/** The answers a manager gave about a payment, as the Log keeps them. */
const ANSWER_CODES = ['receipt_printed', 'no_receipt', 'on_till', 'not_on_till'] as const

export interface NightPaymentsInput extends ReadInput {
  readonly day?: string
  /** Every payment of the day, newest first, this many (pages of 100); omitted: the unusual ones. */
  readonly all?: number
}

/** The day's payments, what to fix and (for managers) the money sections. */
export async function readNightPayments(
  pool: DbPool,
  input: NightPaymentsInput,
): Promise<
  | { readonly ok: true; readonly access: NightAccess; readonly payments: NightPayments }
  | { readonly ok: false; readonly code: NightRefusal }
> {
  return withTenant(pool, input.tenantId, async (tx) => {
    const opened = await open(tx, input)
    if (!opened.ok) return opened
    const { reader } = opened
    if (!canReadNight(reader.held)) return { ok: false, code: 'permission_denied' } as const
    const day = dayOf(input.day, reader.today)
    const full = reader.held.has('night.view_full')
    const { venue } = reader
    const inDay = and(eq(payments.venueId, venue.id), eq(payments.serviceDate, day))

    const [counts] = await tx
      .select({
        all: sql<string>`count(*)`,
        captured: sql<string>`count(*) filter (where ${payments.state} = 'captured')`,
        released: sql<string>`count(*) filter (where ${payments.state} = 'released')`,
        unconfirmed: sql<string>`count(*) filter (where ${payments.state} = 'unconfirmed')`,
      })
      .from(payments)
      .where(inDay)

    const fixRows = await paymentQuery(tx)
      .where(and(inDay, FIX_CONDITION))
      .orderBy(asc(payments.createdAt), asc(payments.id))
      .limit(PAYMENTS_MAX_ROWS)
    const fixIds = fixRows.map((row) => row.id)
    const openAlerts =
      fixIds.length === 0
        ? []
        : await tx
            .select({
              id: alerts.id,
              kind: alerts.kind,
              subjectId: alerts.subjectId,
              raisedAt: alerts.raisedAt,
              doneAt: alerts.doneAt,
            })
            .from(alerts)
            .where(
              and(
                eq(alerts.venueId, venue.id),
                inArray(alerts.subjectId, fixIds),
                inArray(alerts.kind, [...PAYMENT_ALERT_KINDS]),
              ),
            )
            .orderBy(desc(alerts.raisedAt))
    // A card not charged after close and a hold that ran out are the owners' and managers': the
    // end of the night follows Tonight's rows (a waiter never sees them).
    const sees = reader.held.has('money.follow_up') || reader.device
    const fix = fixRows.flatMap((row): NightPayFix[] => {
      const problem = problemOf(row)
      if (problem === null) return []
      if ((problem === 'capture_failed' || problem === 'expired') && !sees) return []
      const kinds = ALERT_OF_PROBLEM[problem]
      const alert = openAlerts.find(
        (candidate) =>
          candidate.subjectId === row.id &&
          candidate.doneAt === null &&
          kinds.includes(candidate.kind),
      )
      return [
        {
          payment: rowOf(row, full),
          problem,
          question: problem === 'unconfirmed' ? questionOf(row.reason) : null,
          alert:
            alert === undefined
              ? null
              : { id: alert.id, kind: alert.kind, raisedAt: alert.raisedAt },
        },
      ]
    })

    const limit =
      input.all === undefined ? null : Math.min(Math.max(input.all, 1), PAYMENTS_MAX_ROWS)
    const listed = await paymentQuery(tx)
      .where(limit === null ? and(inDay, ne(payments.state, 'captured')) : inDay)
      .orderBy(desc(payments.createdAt), desc(payments.id))
      .limit((limit ?? PAYMENTS_MAX_ROWS) + 1)
    const pageSize = limit ?? PAYMENTS_MAX_ROWS
    const rows = listed.slice(0, pageSize).map((row) => rowOf(row, full))

    const money = full ? await moneySections(tx, venue.id, day) : null
    const paying = day === reader.today ? await payingProblem(tx, venue.id) : null

    return {
      ok: true,
      access: accessOf(reader),
      payments: {
        day,
        full,
        counts: {
          all: Number(counts?.all ?? 0),
          captured: Number(counts?.captured ?? 0),
          released: Number(counts?.released ?? 0),
          unconfirmed: Number(counts?.unconfirmed ?? 0),
        },
        fix,
        rows,
        hasMore: listed.length > pageSize,
        paying,
        money,
      },
    } as const
  })
}

/** Why card payments in the app are stopped at the venue now, or null. */
async function payingProblem(tx: ReadTx, venueId: string): Promise<NightPayments['paying']> {
  const connection = await loadPayingConnection(tx, venueId)
  if (connection.state === 'lost_access') {
    return connection.checks.lostReason === 'account_restricted' ? 'restricted' : 'lost'
  }
  return connection.state === 'connected' && (await payingPausedAt(tx, venueId)) ? 'paused' : null
}

async function moneySections(
  tx: ReadTx,
  venueId: string,
  day: string,
): Promise<NightMoneySections> {
  const day_ = and(eq(payments.venueId, venueId), eq(payments.serviceDate, day))
  const raised = await tx
    .select({
      id: alerts.id,
      kind: alerts.kind,
      subjectId: alerts.subjectId,
      raisedAt: alerts.raisedAt,
      doneAt: alerts.doneAt,
      doneBy: alerts.doneBy,
      via: alerts.via,
      details: alerts.details,
      tableName: venueTables.name,
      tableNumber: venueTables.number,
    })
    .from(alerts)
    .innerJoin(payments, eq(payments.id, alerts.subjectId))
    .innerJoin(venueTables, eq(venueTables.id, payments.tableId))
    .where(
      and(
        eq(alerts.venueId, venueId),
        eq(alerts.serviceDate, day),
        inArray(alerts.kind, [...PAYMENT_ALERT_KINDS]),
      ),
    )
    .orderBy(asc(alerts.raisedAt), asc(alerts.id))
  const paymentIds = [...new Set(raised.map((row) => row.subjectId))]
  const answers =
    paymentIds.length === 0
      ? []
      : await tx
          .select({
            paymentId: logEntries.paymentId,
            reason: logEntries.reason,
            details: logEntries.details,
            at: logEntries.at,
            actor: logEntries.actor,
            via: logEntries.via,
          })
          .from(logEntries)
          .where(
            and(
              eq(logEntries.venueId, venueId),
              eq(logEntries.kind, 'payment.answered'),
              inArray(logEntries.paymentId, paymentIds),
            ),
          )
          .orderBy(asc(logEntries.seq))
  const names = await whoOf(tx, [
    ...answers.map((answer) => answer.actor),
    ...raised.flatMap((row) => (row.doneBy === null ? [] : [row.doneBy])),
  ])
  // The first answer at or after the alert was raised: a pay-first round asks its question again
  // with a new alert, and the earlier answer belongs to the earlier one.
  const answered = (paymentId: string, answering: string, notBefore: Date) =>
    answers.find(
      (answer) =>
        answer.paymentId === paymentId &&
        answer.at.getTime() >= notBefore.getTime() &&
        (answer.details.answering ?? 'close') === answering &&
        (ANSWER_CODES as readonly (string | null)[]).includes(answer.reason),
    )
  const alertRows = raised.map((row): NightMoneyAlert => {
    const base = {
      alertId: row.id,
      kind: row.kind,
      paymentId: row.subjectId,
      table: row.tableName ?? row.tableNumber ?? '',
      numbered: row.tableName === null && row.tableNumber !== null,
      raisedAt: row.raisedAt,
    }
    if (row.doneAt === null) return { ...base, answer: null }
    const question =
      row.kind === PAYMENT_UNCONFIRMED_KIND
        ? 'close'
        : row.kind === PAYMENT_LINES_NOT_BACK_KIND
          ? 'lines_not_back'
          : null
    if (question !== null) {
      const answer = answered(row.subjectId, question, row.raisedAt)
      if (answer !== undefined) {
        return {
          ...base,
          answer: {
            code: answer.reason as (typeof ANSWER_CODES)[number],
            who: names.get(answer.actor) ?? RESTRO,
            via: answer.via,
            at: answer.at,
          },
        }
      }
      // Closed without an answer: the hold ran out first (`payment.expired`).
      return {
        ...base,
        answer: { code: 'expired', who: RESTRO, via: null, at: row.doneAt },
      }
    }
    // A day-close clearing answers nothing: the alert stays "not answered yet".
    if (row.details.clearedAt !== undefined) return { ...base, answer: null }
    return {
      ...base,
      answer: {
        code: 'seen',
        who: row.doneBy === null ? RESTRO : (names.get(row.doneBy) ?? RESTRO),
        via: row.via,
        at: row.doneAt,
      },
    }
  })

  const refunded = await paymentQuery(tx)
    .where(and(day_, sql`${payments.refundedMinor} > 0`))
    .orderBy(asc(payments.createdAt), asc(payments.id))
  const disputed = await paymentQuery(tx)
    .where(and(day_, sql`${payments.dispute} is not null`))
    .orderBy(asc(payments.createdAt), asc(payments.id))
  const [open] = await tx
    .select({ n: sql<string>`count(*)` })
    .from(payments)
    .where(and(eq(payments.venueId, venueId), eq(payments.dispute, 'open')))
  return {
    alerts: alertRows,
    refunds: refunded.map((row) => ({
      paymentId: row.id,
      table: row.tableName ?? row.tableNumber ?? '',
      numbered: row.tableName === null && row.tableNumber !== null,
      refundedMinor: row.refundedMinor,
      currency: row.currency,
    })),
    disputes: {
      rows: disputed.map((row) => ({
        paymentId: row.id,
        table: row.tableName ?? row.tableNumber ?? '',
        numbered: row.tableName === null && row.tableNumber !== null,
        amountMinor: row.amountMinor,
        currency: row.currency,
        state: row.dispute ?? '',
      })),
      openCount: Number(open?.n ?? 0),
    },
  }
}

export { PAGE as PAYMENTS_PAGE_SIZE }

// ───────────────────────────── one payment's sheet ─────────────────────────────

/** One step of a payment in its sheet. */
export interface PaymentStep {
  readonly at: Date
  readonly kind: 'payment.state' | 'payment.answered'
  readonly toState: string | null
  readonly reason: string | null
  readonly who: Who
  readonly via: string | null
}

/** Everything about one payment (the Log's and the end of the night's sheet). */
export interface PaymentDetail {
  readonly payment: NightPaymentRow
  /** The number the guest shows the waiter on the Paid screen (`paymentNumberOf`). */
  readonly number: string
  readonly lines: readonly {
    readonly name: string
    readonly quantity: string
    readonly amountMinor: number
  }[]
  readonly steps: readonly PaymentStep[]
}

/**
 * One payment for its sheet; null `detail` when it is not this venue's. Whoever reads the Log or
 * the end of the night may open it; tips only for `night.view_full`.
 */
export async function readPaymentDetail(
  pool: DbPool,
  input: ReadInput & { readonly paymentId: string },
): Promise<
  | { readonly ok: true; readonly access: NightAccess; readonly detail: PaymentDetail | null }
  | { readonly ok: false; readonly code: NightRefusal }
> {
  return withTenant(pool, input.tenantId, async (tx) => {
    const opened = await open(tx, input)
    if (!opened.ok) return opened
    const { reader } = opened
    const mayRead = (permission: Permission) => reader.held.has(permission)
    if (!mayRead('log.view') && !canReadNight(reader.held)) {
      return { ok: false, code: 'permission_denied' } as const
    }
    const full = mayRead('night.view_full')
    const [row] = await paymentQuery(tx).where(
      and(eq(payments.venueId, reader.venue.id), eq(payments.id, input.paymentId)),
    )
    if (row === undefined) return { ok: true, access: accessOf(reader), detail: null } as const
    const lines = await tx
      .select({
        name: paymentLines.displayName,
        quantity: paymentLines.quantity,
        amountMinor: paymentLines.posAmountMinor,
      })
      .from(paymentLines)
      .where(eq(paymentLines.paymentId, row.id))
      .orderBy(asc(paymentLines.position))
    const steps = await tx
      .select({
        at: logEntries.at,
        kind: logEntries.kind,
        toState: logEntries.toState,
        reason: logEntries.reason,
        actor: logEntries.actor,
        via: logEntries.via,
      })
      .from(logEntries)
      .where(
        and(
          eq(logEntries.venueId, reader.venue.id),
          eq(logEntries.paymentId, row.id),
          inArray(logEntries.kind, ['payment.state', 'payment.answered']),
        ),
      )
      .orderBy(asc(logEntries.seq))
    const names = await whoOf(
      tx,
      steps.map((step) => step.actor),
    )
    return {
      ok: true,
      access: accessOf(reader),
      detail: {
        payment: rowOf(row, full),
        number: paymentNumberOf(row.id),
        lines,
        steps: steps.map((step) => ({
          at: step.at,
          kind: step.kind as PaymentStep['kind'],
          toState: step.toState,
          reason: step.reason,
          who: names.get(step.actor) ?? RESTRO,
          via: step.via,
        })),
      },
    } as const
  })
}

// ───────────────────────── the payment lines of the closing message ─────────────────────────

/**
 * What the group's closing message says of the day's card payments (#115): how many were taken and
 * the table and the trouble of each to fix. Counts and words only, never an amount. For the worker
 * (no actor). Null when the venue is gone.
 */
export async function readNightPaymentsReport(
  pool: DbPool,
  input: { readonly tenantId: string; readonly venueId: string; readonly day: string },
): Promise<{
  readonly taken: number
  readonly fix: readonly {
    readonly name: string | null
    readonly number: string | null
    readonly what: NightPayWhat
  }[]
}> {
  return withTenant(pool, input.tenantId, async (tx) => {
    const inDay = and(eq(payments.venueId, input.venueId), eq(payments.serviceDate, input.day))
    const [taken] = await tx
      .select({ n: sql<string>`count(*)` })
      .from(payments)
      .where(and(inDay, eq(payments.state, 'captured')))
    const rows = await paymentQuery(tx)
      .where(and(inDay, FIX_CONDITION))
      .orderBy(asc(payments.createdAt), asc(payments.id))
      .limit(PAYMENTS_MAX_ROWS)
    return {
      taken: Number(taken?.n ?? 0),
      fix: rows.flatMap((row) => {
        const problem = problemOf(row)
        if (problem === null) return []
        // The group may hold staff, who are not shown these rows: counts of the rest only.
        if (problem === 'capture_failed' || problem === 'expired') return []
        const what: NightPayWhat =
          problem === 'unconfirmed' && questionOf(row.reason) === 'lines_not_back'
            ? 'lines_not_back'
            : problem
        return [{ name: row.tableName, number: row.tableNumber, what }]
      }),
    }
  })
}
