// The read side of the service path (design §2.1): `readTableState` for the guest API and
// `readTonight` for the staff screen, both read-only on `withTenant`. Neither calls a POS.
// - `readTableState` gives the server's view of one table: its version, its open sitting, the
//   order, the sitting's sent orders, the leases and pauses that hold it, and its bill as the
//   latest reading shows it (#74), with the lines being paid (#110). The guest API turns it into
//   the phone's `TableState` (#75) and runs the forbidden-values walk (`billBackendValues`,
//   `forbiddenPaths`); nothing here is a POS id or a provider value (rule 3).
// - `readTonight` gives Tonight's contents, filtered by what the actor holds at the venue: alerts
//   by their permission, waiter calls to those who answer them, the Log to `log.view`.

import {
  alerts,
  areas,
  bars,
  billReadings,
  type DbPool,
  locks,
  logEntries,
  pauses,
  paymentLines,
  payments,
  type ReadTx,
  sentOrders,
  sittings,
  staffMembers,
  tableOrders,
  venues,
  venueTables,
  waiterCalls,
  withTenant,
} from '@restro/db'
import { and, asc, desc, eq, inArray, isNotNull, isNull, or, sql } from 'drizzle-orm'

import type { AreaId, BarId, TableId } from '../ids'
import { PAID_LINES_MAX } from '../paid-lines'
import { payFirstApplies, readPayFirstSettings } from '../pay-first-settings'
import { CARD_FLOOR_MINOR, readPayingSettings, smallestCardMinor } from '../paying-settings'
import { serviceDate } from '../service-day'
import { nextOrderChangeAt, orderFromRow } from '../table-order'
import type { CallWaiterKind } from '../theme'
import { PAYMENT_LINES_NOT_BACK_KIND, PAYMENT_UNCONFIRMED_KIND } from './alert-rules'
import { type BillView, billBackendValues, billView, parseStoredBills } from './bill'
import type { ServiceActor } from './context'
import { resolveGrants } from './grants'
import type { LeaseScope } from './leases'
import { activePausesOfTable, pausesOfVenue } from './pause-scope'
import {
  type PayFirstState,
  type PayingState,
  payFirstItems,
  payFirstState,
  payingOffer,
} from './pay-first'
import { payingPausedAt } from './paying-pause'
import { loadPayingConnection } from './payment-connection'
import type { Permission } from './permissions'
import { type ReceiptToBring, receiptsToBring } from './receipt-rows'
import { sentOrderLinesOf } from './send'
import { readTableCapabilities } from './table-capabilities'
import { orderedKinds } from './waiter-call'

/** The sent order states that still hold the table's attention (D116). */
const OPEN_SENT_ORDER_STATES = [
  'waiting',
  'sending',
  'checking',
  'awaiting_approval',
  'unconfirmed',
]

/** The table's version: the highest of its orders' versions, 0 before its first sitting. */
async function tableVersion(tx: ReadTx, tableId: string): Promise<number> {
  const [row] = await tx
    .select({ version: sql<string>`coalesce(max(${tableOrders.version}), 0)::text` })
    .from(tableOrders)
    .where(eq(tableOrders.tableId, tableId))
  return Number(row?.version ?? 0)
}

/** A lease as a phone or Tonight may see it: what holds it and for how long. */
export interface LeaseView {
  readonly scope: LeaseScope
  readonly holder: string
  readonly secondsLeft: number
}

/** An active pause that stops the table's ordering. */
export interface PauseView {
  readonly id: string
  readonly scope: string
  readonly cause: string
  readonly restroStarted: boolean
  readonly startedAt: Date
}

/** The server's view of one table. */
export interface TableStateRead {
  readonly unchanged: false
  readonly version: number
  /** The database's clock at the read: what Undo windows and idle times are measured against. */
  readonly now: Date
  /** When time alone next changes the order (an Undo closing, the idle time); null for never. */
  readonly nextChangeAt: Date | null
  readonly table: {
    readonly id: string
    readonly venueId: string
    /** Our name over it, else its number. */
    readonly label: string
    readonly barId: string | null
    readonly isPaymentTable: boolean
    readonly codeGeneration: number
  }
  /** The open sitting, or null when the table is not open for phones. */
  readonly sitting: { readonly id: string; readonly openedAt: Date } | null
  /** The open sitting's order, or null before its first write. Lines are the guest API's shape. */
  readonly order: {
    readonly lines: readonly unknown[]
    readonly earlier: readonly unknown[] | null
    readonly earlierAt: Date | null
    readonly idleExpiresAt: Date | null
  } | null
  /** The open sitting's sent orders, newest first, without their lines' backend references. */
  readonly sentOrders: readonly {
    readonly id: string
    readonly kind: string
    readonly state: string
    readonly reason: string | null
    readonly reference: string
    readonly createdAt: Date
    readonly settledAt: Date | null
    /**
     * A pay-first round on the POS whose payment a manager ended "No receipt" (#113, #114): the
     * round is ordered and the card was not charged, so the phone says "Ordered, not paid".
     */
    readonly unpaid: boolean
    /** What was sent: our item and option ids and the quantity, never the stored names. */
    readonly lines: readonly {
      readonly itemId: string
      readonly optionIds: readonly string[]
      readonly qty: number
      /** The POS said this item ran out, so the order ended Not sent (#80). */
      readonly outOfStock?: true
    }[]
  }[]
  /**
   * The open sitting's latest waiter call (#81), open or ended; null when it has none. `endedAt` is
   * when it was handled or lapsed. Never who handled it (rule 3).
   */
  readonly waiterCall: {
    readonly id: string
    readonly state: 'open' | 'done' | 'lapsed'
    readonly kinds: readonly CallWaiterKind[]
    readonly calledAt: Date
    readonly endedAt: Date | null
  } | null
  /** Leases held on the table or its sitting, by the database's clock. */
  readonly leases: readonly LeaseView[]
  /** Active pauses of the table, its bar or the venue. */
  readonly pauses: readonly PauseView[]
  /**
   * Notes and options reach the POS's ticket, as the table's POS declared (#78): else the phone
   * draws no note field and items that must have options are ordered from the waiter.
   */
  readonly notesAndOptions: boolean
  /** A tip can be given when paying here: the table's POS records it on the receipt (D127). */
  readonly tips: boolean
  /**
   * Pay-first items at the table (#113, #114): whether they are offered now, and the items of the
   * table's menu that are paid first (none where pay-first doesn't apply at the table).
   */
  readonly payFirst: { readonly state: PayFirstState; readonly items: ReadonlySet<string> }
  /**
   * Paying on the bill (#114): whether it is offered at the venue now, and the smallest card
   * payment the venue asks (its own floor, else the platform's; minor units).
   */
  readonly paying: {
    readonly state: PayingState
    /** The provider's kind (a public word), or null while none is connected. */
    readonly provider: string | null
    readonly minCardMinor: number
  }
  /** When the table's bill was last read, or null. */
  readonly reading: {
    readonly readSeq: number
    readonly readAt: Date
    readonly complete: boolean
  } | null
  /**
   * The open sitting's bill, as the last complete reading showed it (`complete` false when a later
   * one failed); null when the table is closed or not read since its sitting opened. Our ids and
   * names only: the POS's references stay in the row.
   */
  readonly bill: BillView | null
  /**
   * *Backend*: every POS reference and POS text of the stored reading, for the forbidden-values
   * walk over what the phone is answered (rule 3). Never sent.
   */
  readonly backendValues: ReadonlySet<string>
}

/** "Nothing changed since `since`": what most polls get. */
export interface TableStateUnchanged {
  readonly unchanged: true
  readonly version: number
  readonly now: Date
  /** When time alone next changes the open sitting's order (an Undo closing, the idle time). */
  readonly nextChangeAt: Date | null
  /** Whether the table has an open sitting. */
  readonly open: boolean
  /**
   * When the open sitting's bill was last read, as `TableStateRead.bill.readAt`: null when the
   * table is closed or not read since its sitting opened. A reading that found the same bill
   * leaves the version as it was, so a poll on the bill learns its age here (#75, D111).
   */
  readonly billReadAt: Date | null
}

/** The database's clock, to the millisecond. */
async function databaseNow(tx: ReadTx): Promise<Date> {
  const clock = await tx.execute<{ ms: string }>(
    sql`select floor(extract(epoch from now()) * 1000)::text as ms`,
  )
  return new Date(Number(clock.rows[0]?.ms))
}

/** When time alone next changes an order row, or null. */
function nextChangeOf(
  order: {
    readonly lines: unknown
    readonly earlier: unknown
    readonly earlierAt: Date | null
    readonly idleExpiresAt: Date | null
  } | null,
): Date | null {
  if (order === null) return null
  const at = nextOrderChangeAt(orderFromRow(order))
  return at === null ? null : new Date(at)
}

/**
 * Reads one table's state. With `since` equal to the table's version it answers `unchanged`
 * after one indexed read. Null when the tenant has no such table, or it was deleted; with
 * `tableCodeHash` (the guest API's read, D121) also when the code is no longer the table's or the
 * table lost its guest page, checked in the same transaction.
 */
export async function readTableState(
  pool: DbPool,
  input: {
    readonly tenantId: string
    readonly tableId: string
    readonly since?: number
    readonly tableCodeHash?: string
  },
): Promise<TableStateRead | TableStateUnchanged | null> {
  return withTenant(pool, input.tenantId, async (tx) => {
    if (input.tableCodeHash !== undefined) {
      const [page] = await tx
        .select({ id: venueTables.id })
        .from(venueTables)
        .innerJoin(areas, eq(areas.id, venueTables.areaId))
        .where(
          and(
            eq(venueTables.id, input.tableId),
            eq(venueTables.qrCodeHash, input.tableCodeHash),
            isNull(venueTables.archivedAt),
            eq(venueTables.isPaymentTable, false),
            eq(venueTables.hidden, false),
            eq(areas.hidden, false),
            isNull(areas.archivedAt),
          ),
        )
      if (page === undefined) return null
    }
    const version = await tableVersion(tx, input.tableId)
    if (input.since !== undefined && input.since === version) {
      const [open] = await tx
        .select({
          openedAt: sittings.openedAt,
          readAt: billReadings.readAt,
          lines: tableOrders.lines,
          earlier: tableOrders.earlier,
          earlierAt: tableOrders.earlierAt,
          idleExpiresAt: tableOrders.idleExpiresAt,
        })
        .from(sittings)
        .leftJoin(tableOrders, eq(tableOrders.sittingId, sittings.id))
        .leftJoin(billReadings, eq(billReadings.tableId, sittings.tableId))
        .where(and(eq(sittings.tableId, input.tableId), isNull(sittings.endedAt)))
      return {
        unchanged: true,
        version,
        now: await databaseNow(tx),
        nextChangeAt:
          open === undefined || open.lines === null
            ? null
            : nextChangeOf({
                lines: open.lines,
                earlier: open.earlier,
                earlierAt: open.earlierAt,
                idleExpiresAt: open.idleExpiresAt,
              }),
        open: open !== undefined,
        billReadAt:
          open === undefined || open.readAt === null || open.readAt < open.openedAt
            ? null
            : open.readAt,
      }
    }

    const [table] = await tx
      .select()
      .from(venueTables)
      .where(and(eq(venueTables.id, input.tableId), isNull(venueTables.archivedAt)))
    if (table === undefined) return null

    const [sitting] = await tx
      .select({ id: sittings.id, openedAt: sittings.openedAt })
      .from(sittings)
      .where(and(eq(sittings.tableId, table.id), isNull(sittings.endedAt)))
    const [order] =
      sitting === undefined
        ? []
        : await tx.select().from(tableOrders).where(eq(tableOrders.sittingId, sitting.id))
    const sent =
      sitting === undefined
        ? []
        : await tx
            .select({
              id: sentOrders.id,
              kind: sentOrders.kind,
              state: sentOrders.state,
              reason: sentOrders.reason,
              reference: sentOrders.reference,
              createdAt: sentOrders.createdAt,
              settledAt: sentOrders.settledAt,
              lines: sentOrders.lines,
            })
            .from(sentOrders)
            .where(eq(sentOrders.sittingId, sitting.id))
            .orderBy(desc(sentOrders.createdAt))
    const payFirstIds = sent.filter((row) => row.kind === 'pay_first').map((row) => row.id)
    const unpaid = new Set(
      payFirstIds.length === 0
        ? []
        : (
            await tx
              .select({ sentOrderId: payments.sentOrderId })
              .from(payments)
              .where(
                and(
                  inArray(payments.sentOrderId, payFirstIds),
                  eq(payments.state, 'released'),
                  eq(payments.reason, 'no_receipt'),
                ),
              )
          ).flatMap((row) => (row.sentOrderId === null ? [] : [row.sentOrderId])),
    )

    const [call] =
      sitting === undefined
        ? []
        : await tx
            .select({
              id: waiterCalls.id,
              state: waiterCalls.state,
              kinds: waiterCalls.kinds,
              calledAt: waiterCalls.calledAt,
              doneAt: waiterCalls.doneAt,
              updatedAt: waiterCalls.updatedAt,
            })
            .from(waiterCalls)
            .where(eq(waiterCalls.sittingId, sitting.id))
            .orderBy(desc(waiterCalls.calledAt))
            .limit(1)

    const leaseKeys = [table.id, ...(sitting === undefined ? [] : [sitting.id])]
    const leases = await tx
      .select({
        scope: locks.scope,
        holder: locks.holder,
        secondsLeft: sql<string>`ceil(extract(epoch from (${locks.deadline} - now())))::text`,
      })
      .from(locks)
      .where(
        and(
          inArray(locks.key, leaseKeys),
          sql`${locks.holder} is not null and ${locks.deadline} > now()`,
        ),
      )

    const active = await tx
      .select({
        id: pauses.id,
        scope: pauses.scope,
        cause: pauses.cause,
        restroStarted: pauses.restroStarted,
        startedAt: pauses.startedAt,
      })
      .from(pauses)
      .where(activePausesOfTable(table))

    const [reading] = await tx
      .select({
        readSeq: billReadings.readSeq,
        readAt: billReadings.readAt,
        complete: billReadings.complete,
        bills: billReadings.bills,
      })
      .from(billReadings)
      .where(eq(billReadings.tableId, table.id))

    const stored = reading === undefined ? [] : parseStoredBills(reading.bills)
    // The table's payments that aren't final (#110): their lines read `beingPaid`, and their
    // provider values join the walk, so no other answer can carry them (rule 3).
    const open = await tx
      .select({ id: payments.id, ref: payments.providerPaymentRef, form: payments.formValues })
      .from(payments)
      .where(and(eq(payments.tableId, table.id), isNull(payments.settledAt)))
    const greyed =
      open.length === 0
        ? []
        : await tx
            .select({ ref: paymentLines.posLineRef })
            .from(paymentLines)
            .where(
              and(
                inArray(
                  paymentLines.paymentId,
                  open.map((payment) => payment.id),
                ),
                eq(paymentLines.open, true),
              ),
            )
    const beingPaid = new Set(greyed.flatMap((line) => (line.ref === null ? [] : [line.ref])))
    // The lines paid in the app in this sitting (D127 1.2): the lines the POS closed on the
    // captured payments, at what it closed them for (#197), oldest payment first. They name no
    // payer: the payment's handle and provider values stay behind.
    const paidRows =
      sitting === undefined
        ? []
        : await tx
            .select({
              name: paymentLines.name,
              quantity: paymentLines.closedQuantity,
              amountMinor: paymentLines.closedMinor,
            })
            .from(paymentLines)
            .innerJoin(
              payments,
              and(
                eq(payments.tenantId, paymentLines.tenantId),
                eq(payments.id, paymentLines.paymentId),
              ),
            )
            .where(
              and(
                eq(payments.tableId, table.id),
                eq(payments.sittingId, sitting.id),
                eq(payments.state, 'captured'),
                isNotNull(paymentLines.closedMinor),
              ),
            )
            .orderBy(asc(payments.settledAt), asc(payments.id), asc(paymentLines.position))
            .limit(PAID_LINES_MAX)
    const paidLines = paidRows.flatMap((row) =>
      row.quantity === null || row.amountMinor === null
        ? []
        : [{ name: row.name, quantity: row.quantity, amountMinor: row.amountMinor }],
    )
    const backendValues = billBackendValues(stored)
    for (const payment of open) {
      if (payment.ref !== null) backendValues.add(payment.ref)
      for (const value of Object.values(payment.form ?? {})) {
        if (typeof value === 'string') backendValues.add(value)
      }
    }
    const capabilities = await readTableCapabilities(tx, table.id)
    const [venue] = await tx
      .select({ settings: venues.settings })
      .from(venues)
      .where(eq(venues.id, table.venueId))
    const payFirstSettings = readPayFirstSettings(venue?.settings ?? {})
    const payFirst = payFirstApplies(payFirstSettings, {
      tableId: table.id as TableId,
      barId: table.barId as BarId | null,
      areaId: table.areaId as AreaId,
    })
      ? {
          state: await payFirstState(tx, {
            venueId: table.venueId,
            tableId: table.id,
            paused: active.length > 0,
          }),
          items: await payFirstItems(tx, {
            venueId: table.venueId,
            tableId: table.id,
            itemMode: payFirstSettings.itemMode,
          }),
        }
      : { state: 'off' as const, items: new Set<string>() }
    const offer = await payingOffer(tx, { venueId: table.venueId, paused: active.length > 0 })
    const paying = {
      ...offer,
      minCardMinor: smallestCardMinor(readPayingSettings(venue?.settings ?? {}), CARD_FLOOR_MINOR),
    }
    return {
      unchanged: false,
      version,
      now: await databaseNow(tx),
      nextChangeAt: nextChangeOf(order ?? null),
      table: {
        id: table.id,
        venueId: table.venueId,
        label: table.name ?? table.number ?? '',
        barId: table.barId,
        isPaymentTable: table.isPaymentTable,
        codeGeneration: table.codeGeneration,
      },
      sitting: sitting ?? null,
      order:
        order === undefined
          ? null
          : {
              lines: order.lines,
              earlier: order.earlier,
              earlierAt: order.earlierAt,
              idleExpiresAt: order.idleExpiresAt,
            },
      sentOrders: sent.map(({ lines, ...row }) => ({
        ...row,
        unpaid: unpaid.has(row.id),
        lines: sentOrderLinesOf(lines).map((line) => ({
          itemId: line.itemId,
          optionIds: line.optionIds,
          qty: line.qty,
          ...(line.outOfStock === true ? { outOfStock: true } : {}),
        })),
      })),
      waiterCall:
        call === undefined
          ? null
          : {
              id: call.id,
              state: call.state as 'open' | 'done' | 'lapsed',
              kinds: orderedKinds(call.kinds),
              calledAt: call.calledAt,
              endedAt: call.state === 'open' ? null : (call.doneAt ?? call.updatedAt),
            },
      leases: leases.flatMap((lease) =>
        lease.holder === null
          ? []
          : [
              {
                scope: lease.scope as LeaseScope,
                holder: lease.holder,
                secondsLeft: Math.max(0, Number(lease.secondsLeft)),
              },
            ],
      ),
      pauses: active,
      notesAndOptions: capabilities.notesReachTicket,
      tips: capabilities.recordTipOnClose,
      payFirst,
      paying,
      reading:
        reading === undefined
          ? null
          : { readSeq: reading.readSeq, readAt: reading.readAt, complete: reading.complete },
      bill:
        reading === undefined || sitting === undefined || reading.readAt < sitting.openedAt
          ? null
          : billView({
              readAt: reading.readAt,
              complete: reading.complete,
              bills: stored,
              beingPaid,
              paidLines,
            }),
      backendValues,
    }
  })
}

/** One table as Tonight lists it. */
export interface TonightTable {
  readonly id: string
  readonly label: string
  /** True when the label is only the table's number (no name of ours over it): a screen words it "Table 7". */
  readonly numbered: boolean
  readonly barId: string | null
  readonly isPaymentTable: boolean
  /** The open sitting, or null: the table is open for phones exactly while it has one. */
  readonly sitting: {
    readonly id: string
    readonly openedAt: Date
    readonly openedHow: string
  } | null
}

/** An active pause as Tonight lists it: where it applies and who started it. */
export interface TonightPause extends PauseView {
  /** Our id of what is paused: a venue, bar, table or the POS connection. */
  readonly targetId: string
  /** Who started a staff pause: a staff member's name, or null when no person is named. */
  readonly startedBy: string | null
}

/** What Tonight shows the actor. Parts the actor may not see are left out, not emptied. */
export interface Tonight {
  readonly serviceDate: string
  /** What the actor holds here; the screen hides what the server would refuse anyway. */
  readonly permissions: readonly Permission[]
  /**
   * True when the actor is a shared device's own account: it reads Tonight with what Staff hold,
   * and a person's PIN names who answers (D122 §7).
   */
  readonly device: boolean
  /** The venue's bars, by name; a table's `barId` is one of them. */
  readonly bars: readonly { readonly id: string; readonly name: string }[]
  readonly tables: readonly TonightTable[]
  /** Tonight's sent orders, newest first. */
  readonly sentOrders: readonly {
    readonly id: string
    readonly tableId: string
    readonly kind: string
    readonly state: string
    readonly reason: string | null
    readonly reference: string
    readonly totalMinor: number
    readonly createdAt: Date
    readonly settledAt: Date | null
  }[]
  /**
   * Open alerts the actor may answer (or that need no permission). A shared device also sees the
   * money alerts and the managers' to-dos, answered with a manager's PIN (plan §5), but never a tip.
   */
  readonly alerts: readonly {
    readonly id: string
    readonly kind: string
    readonly subjectId: string
    readonly permission: string | null
    readonly raisedAt: Date
    /** The service day it was raised on: a payment question may outlive its night (#162). */
    readonly serviceDate: string
    readonly details: Record<string, unknown>
  }[]
  /**
   * Why card payments in the app are stopped at the venue, or null while they flow (or were never
   * offered): the provider's breaker (`paused`), access to the account lost (`lost`) or the account
   * unable to take card payments (`restricted`). Every role that sees Tonight reads it (#115).
   */
  readonly paying: 'paused' | 'lost' | 'restricted' | null
  /** The venue's payment provider (its kind), for the words that name it; null with no account. */
  readonly payingProvider: string | null
  /**
   * When Restro found an Unconfirmed sent order on the bill by itself (#135, the Log's
   * `sent_order.landed_late`). It changes nothing: staff still answer (D116).
   */
  readonly landedLate: readonly { readonly sentOrderId: string; readonly at: Date }[]
  /**
   * Paper receipts of tonight's card payments still to be brought (#200), for those who mark them
   * Brought (`alerts.answer`); null otherwise.
   */
  readonly receipts: readonly ReceiptToBring[] | null
  /** Open waiter calls, for those who answer them (`alerts.answer`); null otherwise. */
  readonly waiterCalls:
    | readonly {
        readonly id: string
        readonly tableId: string
        readonly kinds: readonly CallWaiterKind[]
        readonly calledAt: Date
      }[]
    | null
  readonly pauses: readonly TonightPause[]
  /** Tonight's Log, newest first, for `log.view`; null otherwise. */
  readonly log:
    | readonly {
        readonly seq: number
        readonly at: Date
        readonly kind: string
        readonly tableId: string | null
        readonly sentOrderId: string | null
        readonly fromState: string | null
        readonly toState: string | null
        readonly reason: string | null
        readonly actor: string
        readonly via: string | null
      }[]
    | null
}

/** Why Tonight was refused. */
export type TonightRefusal =
  | 'origin_not_allowed'
  | 'permission_denied'
  | 'pin_required'
  | 'actor_unknown'
  | 'venue_missing'
  | 'venue_archived'

/** The payment questions every role that sees Tonight reads, though only a manager answers. */
const PAYMENT_QUESTION_KINDS: readonly string[] = [
  PAYMENT_UNCONFIRMED_KIND,
  PAYMENT_LINES_NOT_BACK_KIND,
]

/** An alert's details without the tips: Staff, and so a shared device, never see them. */
function withoutTips(details: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(details).filter(([key]) => !key.startsWith('tip')))
}

/** How many Log entries Tonight shows at once. */
export const TONIGHT_LOG_LIMIT = 200

/**
 * Reads Tonight for a staff actor (a signed-in account, a PIN's person or Restro's admin team).
 * Refused for anyone else, and for an actor who holds no permission at the venue.
 */
export async function readTonight(
  pool: DbPool,
  input: {
    readonly tenantId: string
    readonly venueId: string
    readonly actor: ServiceActor
    readonly now?: Date
  },
): Promise<
  | { readonly ok: true; readonly tonight: Tonight }
  | { readonly ok: false; readonly code: TonightRefusal }
> {
  const { actor } = input
  if (actor.kind !== 'user' && actor.kind !== 'staff' && actor.kind !== 'operator') {
    return { ok: false, code: 'origin_not_allowed' }
  }
  return withTenant(pool, input.tenantId, async (tx) => {
    const [venue] = await tx.select().from(venues).where(eq(venues.id, input.venueId))
    if (venue === undefined) return { ok: false, code: 'venue_missing' } as const
    if (venue.archivedAt !== null) return { ok: false, code: 'venue_archived' } as const

    // Reading is a quick answer: a shared device's own account sees Tonight without a PIN.
    const grants = await resolveGrants(tx, input.tenantId, venue.id, actor, { quick: true })
    if (!grants.ok) return { ok: false, code: grants.code } as const
    if (grants.permissions.size === 0) return { ok: false, code: 'permission_denied' } as const
    const held = grants.permissions

    const day = serviceDate(input.now ?? new Date(), venue.timezone, venue.serviceDayEndsAt)

    const tables = await tx
      .select({
        id: venueTables.id,
        name: venueTables.name,
        number: venueTables.number,
        barId: venueTables.barId,
        isPaymentTable: venueTables.isPaymentTable,
        sittingId: sittings.id,
        openedAt: sittings.openedAt,
        openedHow: sittings.openedHow,
      })
      .from(venueTables)
      .leftJoin(sittings, and(eq(sittings.tableId, venueTables.id), isNull(sittings.endedAt)))
      .where(and(eq(venueTables.venueId, venue.id), isNull(venueTables.archivedAt)))
      .orderBy(venueTables.sortKey, venueTables.id)

    const sent = await tx
      .select({
        id: sentOrders.id,
        tableId: sentOrders.tableId,
        kind: sentOrders.kind,
        state: sentOrders.state,
        reason: sentOrders.reason,
        reference: sentOrders.reference,
        totalMinor: sentOrders.totalMinor,
        createdAt: sentOrders.createdAt,
        settledAt: sentOrders.settledAt,
      })
      .from(sentOrders)
      .where(
        and(
          eq(sentOrders.venueId, venue.id),
          or(eq(sentOrders.serviceDate, day), inArray(sentOrders.state, OPEN_SENT_ORDER_STATES)),
        ),
      )
      .orderBy(desc(sentOrders.createdAt))

    const audiences = actor.kind === 'operator' ? ['venue', 'restro'] : ['venue']
    const openAlerts = await tx
      .select({
        id: alerts.id,
        kind: alerts.kind,
        subjectId: alerts.subjectId,
        permission: alerts.permission,
        raisedAt: alerts.raisedAt,
        serviceDate: alerts.serviceDate,
        details: alerts.details,
      })
      .from(alerts)
      .where(
        and(
          eq(alerts.venueId, venue.id),
          isNull(alerts.doneAt),
          inArray(alerts.audience, audiences),
        ),
      )
      .orderBy(alerts.raisedAt)

    // The Log is read here for one fact only, whatever the actor's `log.view`: the time of a late
    // landing, which the Unconfirmed row shows.
    const unconfirmedIds = openAlerts.flatMap((alert) =>
      alert.kind === 'order_unconfirmed' && typeof alert.details.sentOrderId === 'string'
        ? [alert.details.sentOrderId]
        : [],
    )
    const landed =
      unconfirmedIds.length === 0
        ? []
        : await tx
            .select({ sentOrderId: logEntries.sentOrderId, at: logEntries.at })
            .from(logEntries)
            .where(
              and(
                eq(logEntries.venueId, venue.id),
                eq(logEntries.kind, 'sent_order.landed_late'),
                inArray(logEntries.sentOrderId, unconfirmedIds),
              ),
            )
            .orderBy(logEntries.at)

    const calls = held.has('alerts.answer')
      ? await tx
          .select({
            id: waiterCalls.id,
            tableId: waiterCalls.tableId,
            kinds: waiterCalls.kinds,
            calledAt: waiterCalls.calledAt,
          })
          .from(waiterCalls)
          .where(and(eq(waiterCalls.venueId, venue.id), eq(waiterCalls.state, 'open')))
          .orderBy(waiterCalls.calledAt)
      : null

    const receipts = held.has('alerts.answer') ? await receiptsToBring(tx, venue.id, day) : null

    const active = await tx
      .select({
        id: pauses.id,
        scope: pauses.scope,
        cause: pauses.cause,
        restroStarted: pauses.restroStarted,
        startedAt: pauses.startedAt,
        targetId: pauses.targetId,
        actor: pauses.actor,
      })
      .from(pauses)
      .where(and(pausesOfVenue(venue.id), isNull(pauses.liftedAt)))
      .orderBy(pauses.startedAt)

    const venueBars = await tx
      .select({ id: bars.id, name: bars.name })
      .from(bars)
      .where(and(eq(bars.venueId, venue.id), isNull(bars.archivedAt)))
      .orderBy(bars.name, bars.id)

    // A staff pause names the person who started it: a PIN's staff member, or the staff member
    // the signed-in account is linked to. Anyone else (a shared device's account) is not named.
    const starters = [...new Set(active.filter((p) => !p.restroStarted).map((p) => p.actor))]
    const memberIds = starters.flatMap((a) => (a.startsWith('staff:') ? [a.slice(6)] : []))
    const accountIds = starters.flatMap((a) => (a.startsWith('user:') ? [a.slice(5)] : []))
    const named = new Map<string, string>()
    if (memberIds.length > 0 || accountIds.length > 0) {
      const people = await tx
        .select({
          id: staffMembers.id,
          userId: staffMembers.userId,
          name: staffMembers.displayName,
        })
        .from(staffMembers)
        .where(
          or(
            memberIds.length > 0 ? inArray(staffMembers.id, memberIds) : undefined,
            accountIds.length > 0 ? inArray(staffMembers.userId, accountIds) : undefined,
          ),
        )
      for (const person of people) {
        named.set(`staff:${person.id}`, person.name)
        if (person.userId !== null) named.set(`user:${person.userId}`, person.name)
      }
    }

    const log = held.has('log.view')
      ? await tx
          .select({
            seq: logEntries.seq,
            at: logEntries.at,
            kind: logEntries.kind,
            tableId: logEntries.tableId,
            sentOrderId: logEntries.sentOrderId,
            fromState: logEntries.fromState,
            toState: logEntries.toState,
            reason: logEntries.reason,
            actor: logEntries.actor,
            via: logEntries.via,
          })
          .from(logEntries)
          .where(and(eq(logEntries.venueId, venue.id), eq(logEntries.serviceDate, day)))
          .orderBy(desc(logEntries.seq))
          .limit(TONIGHT_LOG_LIMIT)
      : null

    // Why paying is stopped, for every role (the guest's phone already says "Ask your waiter").
    const connection = await loadPayingConnection(tx, venue.id)
    const paying: Tonight['paying'] =
      connection.state === 'lost_access'
        ? connection.checks.lostReason === 'account_restricted'
          ? 'restricted'
          : 'lost'
        : connection.state === 'connected' && (await payingPausedAt(tx, venue.id))
          ? 'paused'
          : null

    const tonight: Tonight = {
      serviceDate: day,
      permissions: [...held],
      device: grants.device === true,
      bars: venueBars,
      tables: tables.map((row) => ({
        id: row.id,
        label: row.name ?? row.number ?? '',
        numbered: row.name === null && row.number !== null,
        barId: row.barId,
        isPaymentTable: row.isPaymentTable,
        sitting:
          row.sittingId === null || row.openedAt === null || row.openedHow === null
            ? null
            : { id: row.sittingId, openedAt: row.openedAt, openedHow: row.openedHow },
      })),
      sentOrders: sent,
      alerts: openAlerts
        .filter(
          (alert) =>
            alert.permission === null ||
            held.has(alert.permission as Permission) ||
            (grants.device === true && alert.permission === 'money.follow_up') ||
            // A waiter sees that a payment waits on a manager, with no way to answer (#115 P4).
            PAYMENT_QUESTION_KINDS.includes(alert.kind),
        )
        .map((alert) =>
          // A tip is for those who answer the alert: not a shared device, not a waiter who only
          // sees that a payment question waits (#115).
          grants.device === true ||
          (alert.permission !== null && !held.has(alert.permission as Permission))
            ? { ...alert, details: withoutTips(alert.details) }
            : alert,
        ),
      landedLate: landed.flatMap((row) =>
        row.sentOrderId === null ? [] : [{ sentOrderId: row.sentOrderId, at: row.at }],
      ),
      receipts,
      waiterCalls:
        calls === null ? null : calls.map((call) => ({ ...call, kinds: orderedKinds(call.kinds) })),
      paying,
      payingProvider: connection.providerKind,
      pauses: active.map(({ actor: starter, ...pause }) => ({
        ...pause,
        startedBy: pause.restroStarted ? null : (named.get(starter) ?? null),
      })),
      log,
    }
    return { ok: true, tonight } as const
  })
}
