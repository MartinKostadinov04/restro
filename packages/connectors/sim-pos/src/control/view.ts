// What the control page shows (#71): the simulated POS's own screen, as JSON. Tickets per bar (what
// printed at each bar, for the ticket-reprint risk of #51 design §2.4), every table with its bill
// and rows, the logins, the articles, and the call log. It reads the engine's state and nothing
// else, so it holds no guest data and no Restro data (design §7 risk 4).

import { addMinor } from '@restro/core'

import { billTotal, type SimEngine } from '../engine/engine'
import { quantityText } from '../engine/units'
import { WAITER_OPS } from './ops'

/** Most printed tickets shown per bar, and calls shown in the log. */
export const TICKETS_SHOWN = 15
export const CALLS_SHOWN = 100

export interface ControlScenarioInfo {
  readonly name: string
  readonly description: string
  readonly profile: string
  readonly scenarios: readonly string[]
  readonly chaosSeed: number | null
}

/** The page's whole state in one answer. */
export function controlView(engine: SimEngine, info: ControlScenarioInfo) {
  const state = engine.state
  const articles = new Map(state.articles.map((article) => [article.id, article]))
  return {
    scenario: info,
    now: engine.clock.now().toISOString(),
    day: state.day,
    training: state.training,
    printerDown: state.printerDown,
    pendingLateWrites: engine.pendingLateWrites(),
    logins: state.logins.map((login) => ({
      id: login.id,
      name: login.name,
      kind: login.kind,
      bars: login.bars,
      offline: state.offline.includes(login.id),
    })),
    bars: state.bars.map((bar) => ({
      id: bar.id,
      name: bar.name,
      tickets: state.tickets
        .filter((ticket) => ticket.bar === bar.id)
        .slice(-TICKETS_SHOWN)
        .reverse()
        .map((ticket) => ({
          at: ticket.at,
          table: state.tables.find((table) => table.id === ticket.table)?.number ?? ticket.table,
          bill: ticket.bill,
          kind: ticket.kind,
          by: ticket.by,
          rows: ticket.rows,
        })),
    })),
    tables: state.tables.map((table) => ({
      id: table.id,
      number: table.number,
      hall: table.hall,
      bar: table.bar,
      payment: table.payment,
      bills: state.bills
        .filter((bill) => bill.table === table.id && bill.state === 'open')
        .map((bill) => ({
          id: bill.id,
          openedBy: bill.openedBy,
          openedAt: bill.openedAt,
          lockedBy: bill.lockedBy,
          chargeMinor: bill.chargeMinor,
          totalMinor: billTotal(bill),
          paidMinor: bill.payments.reduce((sum, payment) => addMinor(sum, payment.amountMinor), 0),
          rows: bill.rows.map((row) => ({
            id: row.id,
            article: row.article,
            name: articles.get(row.article)?.name ?? row.name,
            quantity: quantityText(row.quantity),
            amountMinor: row.amountMinor,
            by: row.by,
            pending: row.pending,
          })),
        })),
    })),
    articles: state.articles.map((article) => ({
      id: article.id,
      name: article.name,
      priceMinor: article.priceMinor,
      soldOut: article.soldOut,
      tip: article.tip,
    })),
    calls: engine.calls().slice(-CALLS_SHOWN).reverse(),
    ops: WAITER_OPS.map((op) => ({ name: op.name, summary: op.summary, params: op.params })),
  }
}

/** The view's type. */
export type ControlView = ReturnType<typeof controlView>
