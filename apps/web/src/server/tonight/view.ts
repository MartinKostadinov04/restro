// What the Tonight screen draws (#85, plan `docs/deliverables/2026-10-21-tonight-screen-1-plan.md`),
// made from core's `readTonight` by one pure function so the ordering of "Needs you", the tile of
// each table and the pause banners can be tested without a database. Plain data, safe to send to
// the browser: our ids and public fields only (rule 3), times as text in the venue's zone.
import type { CallWaiterKind } from '@restro/core'
import type { Tonight } from '@restro/core/service'

/**
 * The rows of "Needs you", most costly to leave first (plan §4; paying plan 2026-10-29): a payment
 * question, a card not charged after the bill closed, items stuck on a payment table, then part 1's
 * sent order to check, approval, paused table and waiter call, and last a payment stopped before
 * closing (shown under "Later"). The to-dos come last of the rows that need a person now: a
 * receipt to bring (#200), the storno of a refund and an open card dispute (#222).
 */
export const ROW_RANK = {
  pay: 0,
  failed: 0.3,
  stuck: 0.6,
  check: 1,
  approval: 2,
  paused: 3,
  call: 4,
  receipt: 5,
  storno: 5,
  dispute: 5,
  refund_failed: 5,
  stopped: 6,
} as const

/** What a row of "Needs you" is. */
export type RowKind = keyof typeof ROW_RANK

/** One row of "Needs you". */
export interface ActionRow {
  readonly id: string
  readonly kind: RowKind
  readonly tableId: string
  readonly table: string
  /** The table is named by its number only: the screen words it "Table 7". */
  readonly numbered: boolean
  /** When it was raised (ISO), for "N min ago" and the order within a rank. */
  readonly at: string
  /** A sent order the POS never confirmed (D116): what a waiter needs at the till. */
  readonly check?: {
    readonly alertId: string
    readonly sentOrderId: string
    readonly reference: string
    readonly items: readonly {
      readonly name: string
      readonly options: readonly string[]
      readonly qty: number
    }[]
    readonly sentAt: string | null
    readonly billBeforeMinor: number | null
    /** When Restro found it on the bill by itself (#135), `HH:mm` in the venue's zone; staff still answer. */
    readonly landedAt: string | null
  }
  /** A payment's question or money alert (#115). */
  readonly money?: MoneyRow
  readonly waiterCallId?: string
  /** A captured payment's paper receipt to bring (#200). */
  readonly receipt?: {
    readonly paymentId: string
    /** The number the guest shows the waiter. */
    readonly paymentNumber: string
    /** The POS's receipt number, when the close gave one. */
    readonly receiptNumber: string | null
    /** What was charged, tip included. */
    readonly amountMinor: number
  }
  /** A refund the venue made in its provider's dashboard that waits for a storno (#222). */
  readonly storno?: {
    readonly refundId: string
    readonly paymentId: string
    readonly paymentNumber: string
    /** The refund's amount, without the tip for a reader who sees none. */
    readonly amountMinor: number
    /** The refund's true amount: the manager's PIN sheet alone shows it. */
    readonly chargeMinor: number
    /** The payment's service day, `YYYY-MM-DD`. */
    readonly serviceDate: string
    /** What the storno at the till asks for; null where the POS gave none. */
    readonly receiptNumber: string | null
    /** The receipt's day and time in the venue's zone, `YYYY-MM-DD HH:mm`. */
    readonly receiptTime: string | null
    readonly fiscalMemoryNumber: string | null
  }
  /** A card dispute still open (#222). */
  readonly dispute?: {
    readonly paymentId: string
    readonly paymentNumber: string
    readonly amountMinor: number | null
    readonly serviceDate: string
    /** The provider's answer-by date, in the venue's zone; null where it gave none. */
    readonly due: { readonly date: string; readonly time: string } | null
  }
  /** A refund that did not go through after its storno was made: the accountant is asked (#222). */
  readonly refundFailed?: {
    readonly refundId: string
    readonly paymentId: string
    readonly amountMinor: number
  }
  /** A waiter call's requests (#180), in the venue's list order. */
  readonly callKinds?: readonly CallWaiterKind[]
}

/** What a money row asks: a payment question, or one of the alerts that only need acknowledging. */
export type MoneyVariant =
  | 'question'
  | 'stuck'
  | 'stopped'
  | 'capture_failed'
  | 'hold_expired'
  | 'release_refused'

/** The facts of a money row (`ActionRow.money`), from its alert; plain data, our ids only. */
export interface MoneyRow {
  readonly variant: MoneyVariant
  readonly alertId: string
  readonly paymentId: string
  /** Which question a `question` variant asks (a pay-first round asks about the till). */
  readonly question: 'close' | 'till' | 'lines_not_back' | null
  /** The amount the row shows: without the tip for staff (decision log 3.4). */
  readonly amountMinor: number | null
  /**
   * What the guest's card will really bear, tip included: only for who may confirm the answer (a
   * manager's PIN on the shared tablet), for the confirmation alone (Martin 10-29). Null: use
   * `amountMinor`.
   */
  readonly chargeMinor: number | null
  /** A pay-first round's order reference. */
  readonly reference: string | null
  /** Until when the card's hold lasts, in the venue's zone; null when not known. */
  readonly holdUntil: { readonly date: string; readonly time: string } | null
  /** The hold's end as a timestamp, to put the soonest first. */
  readonly holdAt: number | null
  /** The service day it was raised on, when that is not tonight. */
  readonly earlier: string | null
  /** A refused release of a card that was charged after all. */
  readonly charged: boolean
}

/** The words a table's tile can show, in the order they win (plan §5; `payment` is red, #115). */
export type TileState = 'closed' | 'open' | 'paused' | 'check' | 'approval' | 'call' | 'payment'

/** One table's tile. */
export interface TableTile {
  readonly id: string
  readonly label: string
  readonly numbered: boolean
  readonly state: TileState
  /** When its sitting opened, as `HH:mm` in the venue's zone; null while closed. */
  readonly since: string | null
  /** Sent orders of its open sitting. */
  readonly sentOrders: number
  readonly sittingId: string | null
}

/** The tables of one bar (or of no bar). */
export interface BarGroup {
  readonly barId: string | null
  readonly name: string | null
  readonly paused: boolean
  readonly tables: readonly TableTile[]
}

/** One banner of the page's state (plan §3, §12 B). */
export interface PauseBanner {
  readonly id: string
  /** Restro's own pause has no button; a staff pause can be resumed. */
  readonly kind: 'restro' | 'staff'
  /** The bar a staff pause covers; null for every bar. */
  readonly barId: string | null
  readonly barName: string | null
  readonly who: string | null
  readonly at: string
}

/** What the signed-in actor may do here: the screen draws no control the server would refuse. */
export interface Can {
  readonly openClose: boolean
  readonly resume: boolean
  readonly pause: boolean
  readonly lift: boolean
  readonly answer: boolean
  /** `money.follow_up`: answers the payment questions and the owners' money alerts (#115). */
  readonly followUp: boolean
}

/** Everything the Tonight screen draws. */
export interface TonightView {
  readonly venueId: string
  /** The POS' name for `{source}`. */
  readonly source: string
  /** The venue's currency, for the amounts a row shows. */
  readonly currency: string
  /** The payment provider's name for `{provider}`, or null when it is not known. */
  readonly provider: string | null
  readonly device: boolean
  /** Restro's admin team, on their own session: a Restro pause has their button (D120). */
  readonly operator: boolean
  readonly can: Can
  readonly banners: readonly PauseBanner[]
  /**
   * Why card payments in the app are stopped, for every role; null while they flow and while
   * Restro's own connection pause shows (a venue pause already stops paying, D120).
   */
  readonly paying: {
    readonly state: 'paused' | 'lost' | 'restricted'
    /** The person holds `settings.connect_payments`: "Reconnect" is offered. */
    readonly canReconnect: boolean
  } | null
  readonly rows: readonly ActionRow[]
  /** Items the POS says ran out, in the order they ran out; empty for none (plan §12 A). */
  readonly outOfStock: readonly string[]
  readonly groups: readonly BarGroup[]
  readonly openCount: number
  readonly tableCount: number
  /** The bars a new pause can name (those not already paused), by name. */
  readonly pausableBars: readonly { readonly id: string; readonly name: string }[]
  /** Whether a pause of every bar can be started (none is active). */
  readonly canPauseAll: boolean
  /** The server's clock when this was made (ISO). */
  readonly now: string
  /** The venue's time zone, for the times the screen words itself (the offline line). */
  readonly timezone: string
}

const ORDER_UNCONFIRMED = 'order_unconfirmed'
const OUT_OF_STOCK = 'item_out_of_stock'
const STAFF_CAUSE = 'staff'
const GUARD_CAUSE = 'guard_tripped'
const UNCONFIRMED_CAUSE = 'order_unconfirmed'

const MONEY_ROW_KIND = {
  question: 'pay',
  capture_failed: 'failed',
  hold_expired: 'failed',
  release_refused: 'failed',
  stuck: 'stuck',
  stopped: 'stopped',
} as const satisfies Record<MoneyVariant, keyof typeof ROW_RANK>

/** The money row each payment alert kind is; undefined for any other alert. */
export const MONEY_VARIANT: Readonly<Record<string, MoneyVariant>> = {
  payment_unconfirmed: 'question',
  payment_lines_not_back: 'question',
  payment_stranded: 'stuck',
  payment_check_failed: 'stopped',
  payment_capture_failed: 'capture_failed',
  payment_hold_expired: 'hold_expired',
  payment_release_refused: 'release_refused',
}

/** Until when a card's hold lasts, as a day and a time in the venue's zone; null when unknown. */
export function holdOf(
  before: Date | null,
  timezone: string,
): { readonly date: string; readonly time: string } | null {
  if (before === null || Number.isNaN(before.getTime())) return null
  return {
    date: new Intl.DateTimeFormat('en-CA', { timeZone: timezone }).format(before),
    time: new Intl.DateTimeFormat('en-GB', {
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
      timeZone: timezone,
    }).format(before),
  }
}

/** `YYYY-MM-DD HH:mm` of an instant in the venue's zone: the receipt's day and time. */
function receiptStamp(at: Date, timezone: string): string | null {
  const stamp = holdOf(at, timezone)
  return stamp === null ? null : `${stamp.date} ${stamp.time}`
}

/** The row of a payment alert, or null for any other alert. */
function moneyRowOf(
  alert: Tonight['alerts'][number],
  timezone: string,
  tonight: string,
): MoneyRow | null {
  const variant = MONEY_VARIANT[alert.kind]
  if (variant === undefined) return null
  const { details } = alert
  const before = typeof details.captureBefore === 'string' ? new Date(details.captureBefore) : null
  const hold = holdOf(before, timezone)
  const amount = details.amountMinor
  return {
    variant,
    alertId: alert.id,
    paymentId: alert.subjectId,
    question:
      variant !== 'question'
        ? null
        : alert.kind === 'payment_lines_not_back'
          ? 'lines_not_back'
          : details.question === 'till'
            ? 'till'
            : 'close',
    amountMinor: typeof amount === 'number' ? amount : null,
    chargeMinor: typeof details.chargeMinor === 'number' ? details.chargeMinor : null,
    reference: text(details.reference) || null,
    holdUntil: variant === 'question' ? hold : null,
    holdAt: variant === 'question' && before !== null ? before.getTime() : null,
    earlier: alert.serviceDate === tonight ? null : alert.serviceDate,
    charged: details.code === 'already_captured',
  }
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function items(value: unknown): NonNullable<ActionRow['check']>['items'] {
  if (!Array.isArray(value)) return []
  return value.flatMap((entry) => {
    if (typeof entry !== 'object' || entry === null) return []
    const item = entry as Record<string, unknown>
    return [
      {
        name: text(item.name),
        options: Array.isArray(item.options) ? item.options.map(text).filter((o) => o !== '') : [],
        qty: typeof item.qty === 'number' ? item.qty : 1,
      },
    ]
  })
}

/** Builds what the screen draws from core's reading of Tonight. */
export function buildTonightView(input: {
  readonly tonight: Tonight
  readonly venueId: string
  readonly timezone: string
  readonly source: string
  readonly currency: string
  readonly provider?: string | null
  readonly operator?: boolean
  readonly now: Date
}): TonightView {
  const { tonight, timezone } = input
  // The venue's own time, `HH:mm`, whatever the server's zone is (the CLAUDE.md time rule).
  const hours = new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZone: timezone,
  })
  const clock = (value: Date | string | null) =>
    value === null ? null : hours.format(new Date(value))
  const held = new Set<string>(tonight.permissions)
  const can: Can = {
    openClose: held.has('tables.open_close'),
    resume: held.has('tables.resume'),
    pause: held.has('ordering.pause'),
    lift: held.has('ordering.lift'),
    answer: held.has('alerts.answer'),
    followUp: held.has('money.follow_up'),
  }
  const labelOf = new Map(tonight.tables.map((table) => [table.id, table.label]))
  const numberedOf = new Set(
    tonight.tables.filter((table) => table.numbered).map((table) => table.id),
  )
  const barName = new Map(tonight.bars.map((bar) => [bar.id, bar.name]))

  // Pauses: Restro's connection pause decides alone; else every staff pause, a bar's hidden by an
  // all-bars one (plan §12 B).
  const restro = tonight.pauses.filter(
    (pause) => pause.restroStarted && (pause.scope === 'connection' || pause.scope === 'venue'),
  )
  const staff = tonight.pauses.filter(
    (pause) =>
      !pause.restroStarted &&
      pause.cause === STAFF_CAUSE &&
      (pause.scope === 'venue' || pause.scope === 'bar'),
  )
  const allBars = staff.some((pause) => pause.scope === 'venue')
  const banners: PauseBanner[] =
    restro.length > 0
      ? [
          {
            id: restro[0]?.id ?? 'restro',
            kind: 'restro',
            barId: null,
            barName: null,
            who: null,
            at: clock(restro[0]?.startedAt ?? null) ?? '',
          },
        ]
      : staff
          .filter((pause) => !allBars || pause.scope === 'venue')
          .map((pause) => ({
            id: pause.id,
            kind: 'staff' as const,
            barId: pause.scope === 'bar' ? pause.targetId : null,
            barName: pause.scope === 'bar' ? (barName.get(pause.targetId) ?? '') : null,
            who: pause.startedBy,
            at: clock(pause.startedAt) ?? '',
          }))
  const pausedBars = new Set(
    staff.filter((pause) => pause.scope === 'bar').map((pause) => pause.targetId),
  )

  // Table pauses: an Unconfirmed one is a sent order to check; a tripped guard is a paused table.
  const tablePause = new Map<string, (typeof tonight.pauses)[number]>()
  for (const pause of tonight.pauses) {
    if (pause.scope === 'table' && !tablePause.has(pause.targetId)) {
      tablePause.set(pause.targetId, pause)
    }
  }

  const rows: ActionRow[] = []
  const stateOf = new Map<string, TileState>()
  const raise = (tableId: string, state: TileState) => {
    const rank = (s: TileState) =>
      ['open', 'call', 'paused', 'approval', 'check', 'payment'].indexOf(s)
    const current = stateOf.get(tableId)
    if (current === undefined || rank(state) > rank(current)) stateOf.set(tableId, state)
  }

  const landedOf = new Map(tonight.landedLate.map((entry) => [entry.sentOrderId, entry.at]))
  const out: { readonly at: Date; readonly name: string }[] = []
  for (const alert of tonight.alerts) {
    if (alert.kind === OUT_OF_STOCK) {
      const name = text(alert.details.name)
      if (name !== '') out.push({ at: alert.raisedAt, name })
      continue
    }
    const money = moneyRowOf(alert, input.timezone, tonight.serviceDate)
    if (money !== null) {
      const moneyTable = text(alert.details.tableId)
      rows.push({
        id: alert.id,
        kind: MONEY_ROW_KIND[money.variant],
        tableId: moneyTable,
        table: labelOf.get(moneyTable) ?? '',
        numbered: numberedOf.has(moneyTable),
        at: alert.raisedAt.toISOString(),
        money,
      })
      // Only a question that waits for an answer turns the table's tile red.
      if (money.variant === 'question') raise(moneyTable, 'payment')
      continue
    }
    if (alert.kind !== ORDER_UNCONFIRMED) continue
    const tableId = text(alert.details.tableId)
    const billBefore = alert.details.billBeforeMinor
    rows.push({
      id: alert.id,
      kind: 'check',
      tableId,
      table: labelOf.get(tableId) ?? '',
      numbered: numberedOf.has(tableId),
      at: alert.raisedAt.toISOString(),
      check: {
        alertId: alert.id,
        sentOrderId: text(alert.details.sentOrderId),
        reference: text(alert.details.reference),
        items: items(alert.details.items),
        sentAt: clock(text(alert.details.sentAt) || null),
        billBeforeMinor: typeof billBefore === 'number' ? billBefore : null,
        landedAt: clock(landedOf.get(text(alert.details.sentOrderId)) ?? null),
      },
    })
    raise(tableId, 'check')
  }
  for (const [tableId, pause] of tablePause) {
    if (pause.cause === UNCONFIRMED_CAUSE) raise(tableId, 'check')
    else if (pause.cause === GUARD_CAUSE) {
      raise(tableId, 'paused')
      rows.push({
        id: pause.id,
        kind: 'paused',
        tableId,
        table: labelOf.get(tableId) ?? '',
        numbered: numberedOf.has(tableId),
        at: pause.startedAt.toISOString(),
      })
    } else raise(tableId, 'paused')
  }
  for (const order of tonight.sentOrders) {
    if (order.state !== 'awaiting_approval') continue
    rows.push({
      id: order.id,
      kind: 'approval',
      tableId: order.tableId,
      table: labelOf.get(order.tableId) ?? '',
      numbered: numberedOf.has(order.tableId),
      at: order.createdAt.toISOString(),
    })
    raise(order.tableId, 'approval')
  }
  for (const call of tonight.waiterCalls ?? []) {
    rows.push({
      // A later request changes the id, so the row is announced again with its new kind.
      id: `${call.id}@${call.kinds.join(',')}`,
      kind: 'call',
      tableId: call.tableId,
      table: labelOf.get(call.tableId) ?? '',
      numbered: numberedOf.has(call.tableId),
      at: call.calledAt.toISOString(),
      waiterCallId: call.id,
      callKinds: call.kinds,
    })
    raise(call.tableId, 'call')
  }
  for (const receipt of tonight.receipts ?? []) {
    rows.push({
      id: `receipt:${receipt.paymentId}`,
      kind: 'receipt',
      tableId: receipt.tableId,
      table: labelOf.get(receipt.tableId) ?? '',
      numbered: numberedOf.has(receipt.tableId),
      at: receipt.raisedAt.toISOString(),
      receipt: {
        paymentId: receipt.paymentId,
        paymentNumber: receipt.paymentNumber,
        receiptNumber: receipt.receiptNumber,
        amountMinor: receipt.amountMinor,
      },
    })
  }
  // The storno and dispute to-dos (#222): present only for those who may see them.
  for (const refund of tonight.refunds?.storno ?? []) {
    const stamp = refund.receiptAt === null ? null : receiptStamp(refund.receiptAt, timezone)
    rows.push({
      id: `storno:${refund.refundId}`,
      kind: 'storno',
      tableId: refund.tableId,
      table: refund.name ?? refund.number ?? '',
      numbered: refund.name === null && refund.number !== null,
      at: refund.seenAt.toISOString(),
      storno: {
        refundId: refund.refundId,
        paymentId: refund.paymentId,
        paymentNumber: refund.paymentNumber,
        amountMinor: refund.amountMinor,
        chargeMinor: refund.chargeMinor,
        serviceDate: refund.serviceDate,
        receiptNumber: refund.receiptNumber,
        receiptTime: stamp,
        fiscalMemoryNumber: refund.fiscalMemoryNumber,
      },
    })
  }
  for (const refund of tonight.refunds?.failed ?? []) {
    rows.push({
      id: `refund_failed:${refund.refundId}`,
      kind: 'refund_failed',
      tableId: refund.tableId,
      table: refund.name ?? refund.number ?? '',
      numbered: refund.name === null && refund.number !== null,
      at: refund.failedAt.toISOString(),
      refundFailed: {
        refundId: refund.refundId,
        paymentId: refund.paymentId,
        amountMinor: refund.amountMinor,
      },
    })
  }
  for (const dispute of tonight.refunds?.disputes ?? []) {
    rows.push({
      id: `dispute:${dispute.paymentId}`,
      kind: 'dispute',
      tableId: dispute.tableId,
      table: dispute.name ?? dispute.number ?? '',
      numbered: dispute.name === null && dispute.number !== null,
      at: (dispute.openedAt ?? input.now).toISOString(),
      dispute: {
        paymentId: dispute.paymentId,
        paymentNumber: dispute.paymentNumber,
        amountMinor: dispute.amountMinor,
        serviceDate: dispute.serviceDate,
        due: holdOf(dispute.dueAt, timezone),
      },
    })
  }
  rows.sort(
    (a, b) =>
      ROW_RANK[a.kind] - ROW_RANK[b.kind] ||
      // A payment question whose hold ends soonest comes first.
      (a.money?.holdAt ?? Number.POSITIVE_INFINITY) -
        (b.money?.holdAt ?? Number.POSITIVE_INFINITY) ||
      a.at.localeCompare(b.at) ||
      a.id.localeCompare(b.id),
  )

  const sentCount = new Map<string, number>()
  for (const order of tonight.sentOrders) {
    sentCount.set(order.tableId, (sentCount.get(order.tableId) ?? 0) + 1)
  }
  const tiles = tonight.tables.map((table): TableTile & { readonly barId: string | null } => {
    const open = table.sitting !== null
    const barPaused = allBars || (table.barId !== null && pausedBars.has(table.barId))
    return {
      id: table.id,
      label: table.label,
      numbered: table.numbered,
      barId: table.barId,
      state: !open ? 'closed' : (stateOf.get(table.id) ?? (barPaused ? 'paused' : 'open')),
      since: clock(table.sitting?.openedAt ?? null),
      sentOrders: open ? (sentCount.get(table.id) ?? 0) : 0,
      sittingId: table.sitting?.id ?? null,
    }
  })
  const group = (barId: string | null, name: string | null): BarGroup => ({
    barId,
    name,
    paused: allBars || (barId !== null && pausedBars.has(barId)),
    tables: tiles.filter((tile) =>
      barId === null ? !barName.has(tile.barId ?? '') : tile.barId === barId,
    ),
  })
  const groups = [...tonight.bars.map((bar) => group(bar.id, bar.name)), group(null, null)].filter(
    (entry) => entry.tables.length > 0,
  )

  return {
    venueId: input.venueId,
    source: input.source,
    currency: input.currency,
    provider: input.provider ?? null,
    device: tonight.device,
    operator: input.operator === true && !tonight.device,
    can,
    banners,
    paying:
      tonight.paying === null || restro.length > 0
        ? null
        : { state: tonight.paying, canReconnect: held.has('settings.connect_payments') },
    rows,
    outOfStock: out.sort((a, b) => a.at.getTime() - b.at.getTime()).map((entry) => entry.name),
    groups,
    openCount: tiles.filter((tile) => tile.state !== 'closed').length,
    tableCount: tiles.length,
    // Restro's own pause hides the button: a second pause adds nothing (plan §5).
    pausableBars:
      allBars || restro.length > 0 ? [] : tonight.bars.filter((bar) => !pausedBars.has(bar.id)),
    canPauseAll: !allBars && restro.length === 0,
    now: input.now.toISOString(),
    timezone,
  }
}
