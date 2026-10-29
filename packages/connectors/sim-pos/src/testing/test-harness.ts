// The conformance kit's harness for the simulated POS (#51 design §5): the connector over a
// transport, the engine as the POS (its call log and state digest), the kit's faults as fault
// plans, and the engine's waiter side as the waiter driver.
//
// Each wire call moves the engine's clock on by `STEP_MS`, as the platform's queue paces a
// connection's calls (D122 §8): the POS's rate limit (Q28) is met by pacing, not by luck.

import { type PosBill, posRef, type TableBills } from '@restro/core'
import type { WriteHarness } from '@restro/core/connectors/testing'

import type { SimTransport } from '../client'
import { createSimPosConnector } from '../connector'
import type { ManualClock } from '../engine/clock'
import { billTotal, type SimEngine } from '../engine/engine'
import type { SimBill } from '../engine/state'
import { quantityText } from '../engine/units'
import { capabilitiesOf } from '../switches'
import { SIM_WAITER_ACTIONS } from '../waiter-actions'
import * as write from '../write'

/** Milliseconds of engine time each wire call takes. */
export const STEP_MS = 200

/** The table the kit reads, already open by a waiter (the default scenario's Table 8). */
export const READ_TABLE = 'T 8 hall'

/** The charge a bill carries beside its rows where `billTotalDiffersFromLines` is on (Q37). */
export const READ_TABLE_CHARGE = 300

export interface SimHarnessOptions {
  readonly name: string
  readonly engine: SimEngine
  /** The engine's clock. */
  readonly clock: ManualClock
  readonly transport: SimTransport
  /** The API login to use. Default: the first the engine has (one per bar, or one for all). */
  readonly login?: string
}

export function simPosHarness(options: SimHarnessOptions): WriteHarness {
  const { engine, clock } = options
  const login =
    options.login === undefined
      ? engine.apiLogins()[0]
      : engine.apiLogins().find((l) => l.id === options.login)
  if (login === undefined) throw new Error('the engine has no such API login')
  const serves = (bar: string) => login.bars.length === 0 || login.bars.includes(bar)
  const capabilities = capabilitiesOf(engine.switches)

  const stepping: SimTransport = (request) => {
    clock.advance(STEP_MS)
    return options.transport(request)
  }
  const connector = createSimPosConnector({
    transport: stepping,
    login: { user: login.id, password: login.password },
    switches: engine.switches,
    tipItem: engine.state.articles.find((article) => article.tip)?.id,
  })

  const reset = () => {
    engine.reset()
    if (engine.switches.billTotalDiffersFromLines) {
      const bill = engine.state.bills.find((b) => b.table === READ_TABLE && b.state === 'open')
      if (bill !== undefined) engine.waiter.chargeBill(bill.id, READ_TABLE_CHARGE)
    }
  }
  reset()

  const freeTable = (payment: boolean) => {
    const table = engine.state.tables.find(
      (t) =>
        t.payment === payment &&
        t.id !== READ_TABLE &&
        serves(t.bar) &&
        !engine.state.bills.some((b) => b.table === t.id && b.state === 'open'),
    )
    if (table === undefined) throw new Error(`no free ${payment ? 'payment ' : ''}table`)
    return posRef(table.id)
  }

  return {
    name: options.name,
    connector,
    now: () => clock.now(),
    pos: {
      reset,
      calls: () => engine.calls().map((call) => ({ name: call.method, write: call.write })),
      digest: () => engine.digest(),
    },
    faults: {
      stall: () => engine.faults.add({ on: 'any', times: Infinity, fault: { kind: 'hang' } }),
      failReadsFrom: (n) =>
        engine.faults.add({ on: 'read', from: n, times: Infinity, fault: { kind: 'fail' } }),
      refuseLogin: () =>
        engine.faults.add({
          on: 'any',
          times: Infinity,
          fault: { kind: 'refuse', code: 'credentials' },
        }),
      stallWrites: () =>
        engine.faults.add({ on: 'write', times: Infinity, fault: { kind: 'landsThenHangs' } }),
      stallNextWrite: () =>
        engine.faults.add({ on: 'write', times: 1, fault: { kind: 'landsThenHangs' } }),
    },
    table: { ref: posRef(READ_TABLE), expected: expectedReading(engine, login.id) },
    writeModule: write,
    waiterActions: SIM_WAITER_ACTIONS,
    waiter: {
      emptyTable: async () => freeTable(false),
      sellableItem: async () => posRef('1001'),
      openBill: async (table, { openedAt, byRestro }) => {
        const opened = engine.waiter.addRound(table.pos, [{ article: '1004' }], {
          at: openedAt,
          bill: 'new',
          ...(byRestro ? { by: login.id } : {}),
        })
        return posRef(opened.bill)
      },
      paymentTable: async () => (capabilities.moveLinesToTable ? freeTable(true) : null),
      closeBillBeforeNextWrite: (bill) =>
        engine.faults.add({ on: 'write', fault: { kind: 'waiterClosesBill', bill: bill.pos } }),
      closedBill: async (ref) => {
        const bill = engine.state.bills.find((b) => b.id === ref.pos && b.state === 'closed')
        return bill === undefined ? null : billOf(engine, bill, login.id)
      },
    },
  }
}

/** A bill as the engine holds it, in the seam's shape through the declaration. */
function billOf(engine: SimEngine, bill: SimBill, restroLogin: string): PosBill {
  const capabilities = capabilitiesOf(engine.switches)
  return {
    ref: posRef(bill.id),
    totalMinor: billTotal(bill),
    paidMinor: 0,
    openedAt: null,
    openedByRestro: null,
    paymentInFlight: false,
    lines: bill.rows
      .filter((row) => !row.pending)
      .map((row) => ({
        ref: posRef(row.id),
        item: posRef(row.article),
        name: row.name,
        quantity: quantityText(row.quantity),
        amountMinor: row.amountMinor,
        enteredBy: capabilities.whoEnteredLine
          ? row.by === restroLogin
            ? ('restro' as const)
            : ('staff' as const)
          : null,
        enteredAt: capabilities.whoEnteredLine ? row.at : null,
        restroRef: capabilities.ownLineReference ? row.ref : null,
      })),
  }
}

/** What reading the kit's table must give: the engine's own state, through the declaration. */
function expectedReading(engine: SimEngine, restroLogin: string): TableBills {
  const bills = engine.state.bills
    .filter((bill) => bill.table === READ_TABLE && bill.state === 'open')
    .map((bill) => billOf(engine, bill, restroLogin))
  return { table: posRef(READ_TABLE), currency: 'EUR', bills }
}
