// What the Tonight screen draws (#85, plan `docs/deliverables/2026-10-21-tonight-screen-1-plan.md`),
// made from core's `readTonight` by one pure function so the ordering of "Needs you", the tile of
// each table and the pause banners can be tested without a database. Plain data, safe to send to
// the browser: our ids and public fields only (rule 3), times as text in the venue's zone.
import type { CallWaiterKind } from '@restro/core'
import type { Tonight } from '@restro/core/service'

/**
 * The rows of "Needs you", most costly to leave first (plan §4): a money alert (part 2, #115,
 * rank 0), a sent order to check, an approval, a paused table, a waiter call, then the to-dos
 * (storno, dispute, receipts to bring: part 2, rank 5). A row of part 2 slots in by its rank.
 */
export const ROW_RANK = { check: 1, approval: 2, paused: 3, call: 4 } as const

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
  readonly waiterCallId?: string
  /** A waiter call's requests (#180), in the venue's list order. */
  readonly callKinds?: readonly CallWaiterKind[]
}

/** The words a table's tile can show, in the order they win (plan §5; money is part 2's). */
export type TileState = 'closed' | 'open' | 'paused' | 'check' | 'approval' | 'call'

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
}

/** Everything the Tonight screen draws. */
export interface TonightView {
  readonly venueId: string
  /** The POS' name for `{source}`. */
  readonly source: string
  /** The venue's currency, for the amounts a row shows. */
  readonly currency: string
  readonly device: boolean
  readonly can: Can
  readonly banners: readonly PauseBanner[]
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
}

const ORDER_UNCONFIRMED = 'order_unconfirmed'
const OUT_OF_STOCK = 'item_out_of_stock'
const STAFF_CAUSE = 'staff'
const GUARD_CAUSE = 'guard_tripped'
const UNCONFIRMED_CAUSE = 'order_unconfirmed'

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
    const rank = (s: TileState) => ['open', 'call', 'paused', 'approval', 'check'].indexOf(s)
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
  rows.sort(
    (a, b) =>
      ROW_RANK[a.kind] - ROW_RANK[b.kind] || a.at.localeCompare(b.at) || a.id.localeCompare(b.id),
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
    device: tonight.device,
    can,
    banners,
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
  }
}
