// The read side of the end of the night's payments and of one payment's sheet (#115; plans
// `docs/deliverables/2026-10-29-tonight-paying-plan.md`, `2026-10-27-tonight-end-of-night-plan.md`
// §3 sections 3–6, and the Log plan's "Everything about one thing"). Read-only on `withTenant`, no
// provider call, our ids and public fields only (rule 3): never a provider's or a POS reference.
//
// - The list of what to fix reads the payments by their state (`unconfirmed`, `stranded`,
//   `capture_failed`, a hold that `expired`, a capture with no receipt number), never the alerts:
//   the day's close clears some alerts, and a cleared alert must not drop a payment from the page
//   (#162). The open alert of a payment is attached, for the answer that closes it.
// - Tips are read only for `night.view_full` (staff never see them, decision log 3.4). Without it
//   every amount of a payment is the amount without the tip, so total minus lines gives nothing
//   away (#220).
// - On today's page the list of what to fix also holds the earlier nights' payments that still wait
//   for a person (#220), each with its service day; a past night's page lists its own day only.
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
  paymentRefunds,
  payments,
  type ReadTx,
  sentOrders,
  venueTables,
  withTenant,
} from '@restro/db'
import { and, asc, desc, eq, inArray, lt, ne, or, sql } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import { serviceDate } from '../service-day'
import {
  PAYMENT_ALERT_KINDS,
  PAYMENT_CAPTURE_FAILED_KIND,
  PAYMENT_CHECK_FAILED_KIND,
  PAYMENT_HOLD_EXPIRED_KIND,
  PAYMENT_LINES_NOT_BACK_KIND,
  PAYMENT_RELEASE_REFUSED_KIND,
  PAYMENT_STRANDED_KIND,
  PAYMENT_UNCONFIRMED_KIND,
} from './alert-rules'
import type { DisputeEvidenceInput, EvidenceWho } from './dispute-evidence'
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
import { refundsToDo } from './payment-todos'
import type { Permission } from './permissions'
import { type ReceiptNotBrought, receiptsNotBrought } from './receipt-rows'
import { withoutTipMinor } from './staff-amount'

export { PAYMENT_ALERT_KINDS }

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
  /** Without the tip for a role that never sees tips. */
  readonly amountMinor: number | null
  /** Null for a role that never sees tips. */
  readonly tipMinor: number | null
  /** Without the tip for a role that never sees tips. */
  readonly capturedMinor: number | null
  /** Refunds are read for `night.view_full` only (a refund may hold the tip): 0 for the rest. */
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
  /** The service day of a payment from an earlier night, on today's page; else null. */
  readonly earlier: string | null
  /**
   * The charge with its tip, only for a reader who answers the question and does not read tips
   * (the shared device): its confirmation tells what the card will bear. Null otherwise.
   */
  readonly chargeMinor: number | null
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
  /**
   * The refunds seen on the day, then every refund of an earlier day still waiting for its storno
   * (#222; decision log 5.17), as `payment.observe` recorded them.
   */
  readonly refunds: readonly NightRefund[]
  readonly disputes: {
    /** The disputes opened on the day. */
    readonly rows: readonly NightDispute[]
    /** Disputes still open at the venue, whatever their day. */
    readonly openCount: number
  }
}

/** One refund of section 5. */
export interface NightRefund {
  readonly refundId: string
  readonly paymentId: string
  readonly paymentNumber: string
  readonly table: string
  readonly numbered: boolean
  readonly amountMinor: number
  readonly currency: string
  /** The POS's receipt number of the payment, where it gave one. */
  readonly receiptNumber: string | null
  /** The service day the refund was seen on. */
  readonly serviceDate: string
  /** Seen on an earlier day and still waiting for its storno. */
  readonly earlier: boolean
  /** The refund did not go through at the provider. */
  readonly failed: boolean
  /** Who said the storno was made, and when; null while it waits. */
  readonly storno: { readonly who: Who; readonly via: string | null; readonly at: Date } | null
  /** Who saw a refund that did not go through ("Got it", #234), and when; null while unseen. */
  readonly seen: { readonly who: Who; readonly via: string | null; readonly at: Date } | null
}

/** One dispute of section 6. */
export interface NightDispute {
  readonly paymentId: string
  readonly paymentNumber: string
  readonly table: string
  readonly numbered: boolean
  readonly amountMinor: number | null
  readonly currency: string
  readonly state: string
  /** The payment's service day. */
  readonly serviceDate: string
  readonly openedAt: Date | null
  /** The provider's answer-by date, where it gave one. */
  readonly dueAt: Date | null
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
  /** Paper receipts of the day never marked Brought (#200): table and payment number, no amount. */
  readonly notBrought: readonly ReceiptNotBrought[]
  /**
   * Refunds still waiting for a storno, from any day (#222; decision log 5.17), on today's page for
   * those who answer them: one line each, no amount.
   */
  readonly stornoFix: readonly {
    readonly refundId: string
    readonly paymentId: string
    readonly paymentNumber: string
    readonly table: string
    readonly numbered: boolean
    /** The service day the refund was seen on. */
    readonly serviceDate: string
  }[]
  /** The ones that did not end charged first; every payment after "Show all" (`all`). */
  readonly rows: readonly NightPaymentRow[]
  readonly hasMore: boolean
  /** Only today: why card payments in the app are still stopped. */
  readonly paying: 'paused' | 'lost' | 'restricted' | null
  /** The venue's payment provider (its kind), for the words that name it; null with no account. */
  readonly providerKind: string | null
  readonly money: NightMoneySections | null
}

const PAGE = 100

const DAY_MS = 86_400_000

/** The question an unconfirmed payment asks, from why it is unconfirmed. */
export function questionOf(reason: string | null): PayQuestion {
  if (reason === 'lines_not_back') return 'lines_not_back'
  if (reason === 'enter_unknown' || reason === 'entered_check_failed') return 'till'
  return 'close'
}

const payTable = alias(venueTables, 'pay_table')

type PaymentSelect = {
  id: string
  serviceDate: string
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
  disputeOpenedAt: Date | null
  disputeDueAt: Date | null
  receiptNumber: string | null
  currency: string
  at: Date
  captureBefore: Date | null
}

const columns = {
  id: payments.id,
  serviceDate: payments.serviceDate,
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
  disputeOpenedAt: payments.disputeOpenedAt,
  disputeDueAt: payments.disputeDueAt,
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
    amountMinor: full ? row.amountMinor : withoutTipMinor(row.amountMinor, row.tipMinor),
    tipMinor: full ? row.tipMinor : null,
    capturedMinor: full ? row.capturedMinor : withoutTipMinor(row.capturedMinor, row.tipMinor),
    refundedMinor: full ? row.refundedMinor : 0,
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
    // A card not charged after close and a hold that ran out are the owners' and managers': the
    // end of the night follows Tonight's rows (a waiter never sees them).
    const sees = reader.held.has('money.follow_up') || reader.device
    // Today's page also lists the earlier nights' payments still waiting for a person (#220): those
    // with an alert still open, as Tonight lists them. The day's close clears some alerts, and a
    // cleared one must not bring its payment back on every night after.
    const toFix = and(
      eq(payments.venueId, venue.id),
      day === reader.today
        ? or(
            eq(payments.serviceDate, day),
            and(
              lt(payments.serviceDate, day),
              sql`exists (select 1 from ${alerts} a where a.subject_id = ${payments.id}
                and a.done_at is null and a.kind in (${sql.join(
                  PAYMENT_ALERT_KINDS.map((kind) => sql`${kind}`),
                  sql`, `,
                )}))`,
            ),
          )
        : eq(payments.serviceDate, day),
      FIX_CONDITION,
      sees
        ? undefined
        : and(
            ne(payments.state, 'capture_failed'),
            or(ne(payments.state, 'released'), sql`${payments.reason} is distinct from 'expired'`),
          ),
    )

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
      .where(toFix)
      .orderBy(asc(payments.serviceDate), asc(payments.createdAt), asc(payments.id))
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
    const fix = fixRows.flatMap((row): NightPayFix[] => {
      const problem = problemOf(row)
      if (problem === null) return []
      const earlier = row.serviceDate === day ? null : row.serviceDate
      // A charge with no receipt number is a line with no answer and no night's mark: tonight's only.
      if (earlier !== null && problem === 'no_receipt') return []
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
          earlier,
          chargeMinor: !full && sees ? row.amountMinor : null,
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

    const notBrought = (await receiptsNotBrought(tx, venue.id, day)).rows
    const stornoFix =
      sees && day === reader.today
        ? (await refundsToDo(tx, venue.id)).map((refund) => ({
            refundId: refund.refundId,
            paymentId: refund.paymentId,
            paymentNumber: refund.paymentNumber,
            table: refund.name ?? refund.number ?? '',
            numbered: refund.name === null && refund.number !== null,
            serviceDate: refund.serviceDate,
          }))
        : []
    const money = full ? await moneySections(tx, venue, day) : null
    const paying = day === reader.today ? await payingProblem(tx, venue.id) : null
    const providerKind = (await loadPayingConnection(tx, venue.id)).providerKind

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
        notBrought,
        stornoFix,
        rows,
        hasMore: listed.length > pageSize,
        paying,
        providerKind,
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
  venue: { readonly id: string; readonly timezone: string; readonly dayEndsAt: string },
  day: string,
): Promise<NightMoneySections> {
  const venueId = venue.id
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

  // Section 5: the refunds seen on the day, then every earlier one still waiting for a storno.
  const refundRows = await tx
    .select({
      refundId: paymentRefunds.id,
      paymentId: paymentRefunds.paymentId,
      name: venueTables.name,
      number: venueTables.number,
      amountMinor: paymentRefunds.amountMinor,
      currency: payments.currency,
      receiptNumber: payments.receiptNumber,
      serviceDate: paymentRefunds.serviceDate,
      seenAt: paymentRefunds.seenAt,
      failedAt: paymentRefunds.failedAt,
      stornoAt: paymentRefunds.stornoAt,
      stornoBy: paymentRefunds.stornoBy,
      stornoVia: sql<string | null>`(select l.via from ${logEntries} l
        where l.venue_id = ${paymentRefunds.venueId} and l.kind = 'payment.storno'
          and l.to_state = 'done' and l.details ->> 'refundId' = ${paymentRefunds.id}
        order by l.seq desc limit 1)`,
    })
    .from(paymentRefunds)
    .innerJoin(payments, eq(payments.id, paymentRefunds.paymentId))
    .innerJoin(venueTables, eq(venueTables.id, payments.tableId))
    .where(
      and(
        eq(paymentRefunds.venueId, venue.id),
        or(
          eq(paymentRefunds.serviceDate, day),
          and(
            lt(paymentRefunds.serviceDate, day),
            sql`${paymentRefunds.stornoAt} is null and ${paymentRefunds.failedAt} is null`,
          ),
        ),
      ),
    )
    .orderBy(asc(paymentRefunds.serviceDate), asc(paymentRefunds.seenAt), asc(paymentRefunds.id))
    .limit(PAYMENTS_MAX_ROWS)
  // Who saw a refund that did not go through: its newest "Got it" entry, if it says `seen` (#234).
  const failedIds = refundRows.flatMap((row) => (row.failedAt === null ? [] : [row.refundId]))
  const seenEntries =
    failedIds.length === 0
      ? []
      : await tx
          .select({
            details: logEntries.details,
            toState: logEntries.toState,
            actor: logEntries.actor,
            via: logEntries.via,
            at: logEntries.at,
          })
          .from(logEntries)
          .where(
            and(
              eq(logEntries.venueId, venue.id),
              eq(logEntries.kind, 'payment.refund_failed_seen'),
              inArray(sql<string>`${logEntries.details} ->> 'refundId'`, failedIds),
            ),
          )
          .orderBy(asc(logEntries.seq))
  const seenOf = (refundId: string) => {
    const latest = seenEntries.filter((entry) => entry.details.refundId === refundId).at(-1)
    return latest?.toState === 'seen' ? latest : undefined
  }
  const stornoNames = await whoOf(tx, [
    ...refundRows.flatMap((row) => (row.stornoBy === null ? [] : [row.stornoBy])),
    ...failedIds.flatMap((id) => seenOf(id)?.actor ?? []),
  ])
  // Section 6: the disputes opened on the day (a dispute read before its times were kept belongs
  // to its payment's day), and how many are open now.
  const nearDay = new Date(`${day}T12:00:00Z`).getTime()
  const disputed = await paymentQuery(tx)
    .where(
      and(
        eq(payments.venueId, venue.id),
        sql`${payments.dispute} is not null`,
        or(
          and(sql`${payments.disputeOpenedAt} is null`, eq(payments.serviceDate, day)),
          sql`${payments.disputeOpenedAt} between ${new Date(nearDay - 3 * DAY_MS)} and ${new Date(nearDay + 3 * DAY_MS)}`,
        ),
      ),
    )
    .orderBy(asc(payments.disputeOpenedAt), asc(payments.createdAt), asc(payments.id))
  const [open] = await tx
    .select({ n: sql<string>`count(*)` })
    .from(payments)
    .where(and(eq(payments.venueId, venue.id), eq(payments.dispute, 'open')))
  return {
    alerts: alertRows,
    refunds: refundRows.map(
      (row): NightRefund => ({
        refundId: row.refundId,
        paymentId: row.paymentId,
        paymentNumber: paymentNumberOf(row.paymentId),
        table: row.name ?? row.number ?? '',
        numbered: row.name === null && row.number !== null,
        amountMinor: row.amountMinor,
        currency: row.currency,
        receiptNumber: row.receiptNumber,
        serviceDate: row.serviceDate,
        earlier: row.serviceDate !== day,
        failed: row.failedAt !== null,
        storno:
          row.stornoAt === null || row.stornoBy === null
            ? null
            : {
                who: stornoNames.get(row.stornoBy) ?? RESTRO,
                via: row.stornoVia,
                at: row.stornoAt,
              },
        seen: ((entry) =>
          entry === undefined
            ? null
            : { who: stornoNames.get(entry.actor) ?? RESTRO, via: entry.via, at: entry.at })(
          seenOf(row.refundId),
        ),
      }),
    ),
    disputes: {
      rows: disputed.flatMap((row): NightDispute[] => {
        const openedAt = row.disputeOpenedAt
        if (openedAt !== null && serviceDate(openedAt, venue.timezone, venue.dayEndsAt) !== day) {
          return []
        }
        return [
          {
            paymentId: row.id,
            paymentNumber: paymentNumberOf(row.id),
            table: row.tableName ?? row.tableNumber ?? '',
            numbered: row.tableName === null && row.tableNumber !== null,
            amountMinor: row.amountMinor,
            currency: row.currency,
            state: row.dispute ?? '',
            serviceDate: row.serviceDate,
            openedAt,
            dueAt: row.disputeDueAt,
          },
        ]
      }),
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
  /** The provider's kind (`payments.provider_kind`), for the screen to name it. */
  readonly providerKind: string
  /** The refunds the venue made at the provider, oldest first; empty for a reader who sees no tips. */
  readonly refunds: readonly PaymentRefundLine[]
  /** Where a dispute stands, with its times; null for none. */
  readonly dispute: {
    readonly state: string
    readonly openedAt: Date | null
    readonly dueAt: Date | null
    readonly closedAt: Date | null
  } | null
  /**
   * The "Dispute evidence" of the payment: for `money.follow_up` only (it holds the provider's
   * payment id), else null. The text is `disputeEvidenceText` of it.
   */
  readonly evidence: DisputeEvidenceInput | null
}

/** One refund of a payment in its sheet. */
export interface PaymentRefundLine {
  readonly refundId: string
  readonly amountMinor: number
  readonly seenAt: Date
  readonly failed: boolean
  readonly storno: { readonly who: Who; readonly via: string | null; readonly at: Date } | null
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
    const [extra] = await tx
      .select({
        providerPaymentRef: payments.providerPaymentRef,
        threeDsResult: payments.threeDsResult,
        authorisationCode: payments.authorisationCode,
        fiscalMemoryNumber: payments.fiscalMemoryNumber,
        disputeOpenedAt: payments.disputeOpenedAt,
        disputeClosedAt: payments.disputeClosedAt,
        disputeDueAt: payments.disputeDueAt,
        providerKind: payments.providerKind,
      })
      .from(payments)
      .where(eq(payments.id, row.id))
    const refundRows = full
      ? await tx
          .select({
            refundId: paymentRefunds.id,
            amountMinor: paymentRefunds.amountMinor,
            seenAt: paymentRefunds.seenAt,
            failedAt: paymentRefunds.failedAt,
            stornoAt: paymentRefunds.stornoAt,
            stornoBy: paymentRefunds.stornoBy,
          })
          .from(paymentRefunds)
          .where(eq(paymentRefunds.paymentId, row.id))
          .orderBy(asc(paymentRefunds.seenAt), asc(paymentRefunds.id))
      : []
    const names = await whoOf(tx, [
      ...steps.map((step) => step.actor),
      ...refundRows.flatMap((refund) => (refund.stornoBy === null ? [] : [refund.stornoBy])),
    ])
    const stornoVias =
      refundRows.length === 0
        ? []
        : await tx
            .select({ details: logEntries.details, via: logEntries.via })
            .from(logEntries)
            .where(
              and(
                eq(logEntries.venueId, reader.venue.id),
                eq(logEntries.paymentId, row.id),
                eq(logEntries.kind, 'payment.storno'),
                eq(logEntries.toState, 'done'),
              ),
            )
            .orderBy(asc(logEntries.seq))
    const viaOf = (refundId: string) =>
      stornoVias.filter((entry) => entry.details.refundId === refundId).at(-1)?.via ?? null
    const stepViews = steps.map((step) => ({
      at: step.at,
      kind: step.kind as PaymentStep['kind'],
      toState: step.toState,
      reason: step.reason,
      who: names.get(step.actor) ?? RESTRO,
      via: step.via,
    }))
    const refunds = refundRows.map(
      (refund): PaymentRefundLine => ({
        refundId: refund.refundId,
        amountMinor: refund.amountMinor,
        seenAt: refund.seenAt,
        failed: refund.failedAt !== null,
        storno:
          refund.stornoAt === null || refund.stornoBy === null
            ? null
            : {
                who: names.get(refund.stornoBy) ?? RESTRO,
                via: viaOf(refund.refundId),
                at: refund.stornoAt,
              },
      }),
    )
    const payment = rowOf(row, full)
    const dispute =
      row.dispute === null
        ? null
        : {
            state: row.dispute,
            openedAt: extra?.disputeOpenedAt ?? null,
            dueAt: extra?.disputeDueAt ?? null,
            closedAt: extra?.disputeClosedAt ?? null,
          }
    const evidenceWho = (by: Who): EvidenceWho => by
    // The text that goes to the bank carries the true charge, tip included: only for a reader of
    // the whole night who answers money (#222).
    const evidence: DisputeEvidenceInput | null =
      mayRead('money.follow_up') && full
        ? {
            paymentNumber: paymentNumberOf(row.id),
            serviceDate: row.serviceDate,
            timeZone: reader.venue.timezone,
            currency: row.currency as DisputeEvidenceInput['currency'],
            amountMinor: payment.amountMinor,
            tipMinor: payment.tipMinor ?? 0,
            capturedMinor: payment.capturedMinor,
            table: payment.table,
            tableNumbered: payment.numbered,
            payTable: payment.payTable,
            payTableNumbered: row.payTableName === null && row.payTableNumber !== null,
            bar: payment.bar,
            lines: lines.map((line) => ({
              name: line.name,
              quantity: line.quantity,
              amountMinor: line.amountMinor,
            })),
            steps: stepViews.map((step) => ({ ...step, who: evidenceWho(step.who) })),
            threeDs: extra?.threeDsResult ?? null,
            providerPaymentRef: extra?.providerPaymentRef ?? null,
            authorisationCode: extra?.authorisationCode ?? null,
            receiptNumber: row.receiptNumber,
            fiscalMemoryNumber: extra?.fiscalMemoryNumber ?? null,
            dispute:
              dispute === null
                ? null
                : {
                    state: dispute.state as 'open' | 'won' | 'lost',
                    openedAt: dispute.openedAt,
                    dueAt: dispute.dueAt,
                    closedAt: dispute.closedAt,
                  },
            refunds: refunds.map((refund) => ({
              amountMinor: refund.amountMinor,
              seenAt: refund.seenAt,
              failed: refund.failed,
              storno:
                refund.storno === null
                  ? null
                  : { who: evidenceWho(refund.storno.who), at: refund.storno.at },
            })),
          }
        : null
    return {
      ok: true,
      access: accessOf(reader),
      detail: {
        payment,
        number: paymentNumberOf(row.id),
        lines,
        steps: stepViews,
        providerKind: extra?.providerKind ?? row.kind,
        refunds,
        dispute,
        evidence,
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
    /** The payment number, for the receipts not brought. */
    readonly paymentNumber?: string
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
    const notBrought = (await receiptsNotBrought(tx, input.venueId, input.day)).rows
    const stornoNotDone = await refundsToDo(tx, input.venueId)
    return {
      taken: Number(taken?.n ?? 0),
      fix: [
        ...rows.flatMap((row) => {
          const problem = problemOf(row)
          if (problem === null) return []
          // The group may hold staff, who are not shown these rows: counts of the rest only.
          if (problem === 'capture_failed' || problem === 'expired') return []
          const what: NightPayWhat =
            problem === 'unconfirmed' && questionOf(row.reason) === 'lines_not_back'
              ? 'lines_not_back'
              : problem
          // A payment with no receipt number carries its payment number, so a reader sees it is the
          // same payment as its "receipt not brought" line.
          return [
            {
              name: row.tableName,
              number: row.tableNumber,
              what,
              ...(what === 'no_receipt' ? { paymentNumber: paymentNumberOf(row.id) } : {}),
            },
          ]
        }),
        ...notBrought.map((row) => ({
          name: row.name,
          number: row.number,
          what: 'receipt_not_brought' as const,
          paymentNumber: row.paymentNumber,
        })),
        // A refund with no storno, from any day, without its amount (decision log 5.8, 5.17).
        ...stornoNotDone.map((refund) => ({
          name: refund.name,
          number: refund.number,
          what: 'storno_not_done' as const,
        })),
      ],
    }
  })
}
