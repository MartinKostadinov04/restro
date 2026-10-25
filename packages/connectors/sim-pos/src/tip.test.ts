// A tip on close (#105, D127): the tip lands as one row of the tip article on the same bill, the
// closed bill's total is the lines plus the tip in minor units (rule 8, through the money
// module), and a tip row left by a close that failed is never moved back onto the guest's table.

import {
  addMinor,
  type IsolatedHandle,
  type PosRef,
  posRef,
  type ServiceConnector,
  type ServiceContext,
} from '@restro/core'
import { kitContext, type WriteHarness } from '@restro/core/connectors/testing'
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'

import type { SimTransport } from './client'
import { createSimPosConnector } from './connector'
import { ManualClock } from './engine/clock'
import { billTotal, SimEngine } from './engine/engine'
import { quantityText } from './engine/units'
import { buildEngine, loadScenarioFile } from './scenario-file'
import { switchesOf } from './switches'
import { inProcessTransport, STEP_MS, simPosHarness } from './testing'

/** The default scenario's articles a guest can order (the tip article is not one). */
const ARTICLES = ['1001', 'gin tonic', 'a3e0c6d2-5b14-4e89-9f70-c2d41b8e6a37', '1004', 'shot 5']

function tipHarness(): WriteHarness & { readonly engine: SimEngine } {
  const clock = new ManualClock()
  const engine = new SimEngine({ switches: switchesOf('pilot', { tipAsLine: true }), clock })
  const harness = simPosHarness({
    name: 'tip',
    engine,
    clock,
    transport: inProcessTransport(engine),
  })
  return { ...harness, engine }
}

/** The engine in process, its clock moved on by each call as the platform's queue paces them. */
function paced(engine: SimEngine, clock: ManualClock): SimTransport {
  const transport = inProcessTransport(engine)
  return (request) => {
    clock.advance(STEP_MS)
    return transport(request)
  }
}

/** Moves every line of the table's one bill to a free payment table. */
async function isolateAll(
  connector: ServiceConnector,
  ctx: ServiceContext,
  table: PosRef,
  paymentTable: PosRef,
): Promise<IsolatedHandle> {
  const reading = await connector.readTable(ctx, table)
  if (!reading.complete) throw new Error(`incomplete: ${reading.reason}`)
  const bill = reading.value.bills[0]
  if (bill === undefined) throw new Error('no bill on the table')
  const isolated = await connector.isolateLines(ctx, {
    table,
    picks: bill.lines.map((line) => ({ bill: bill.ref, line: line.ref, quantity: line.quantity })),
    paymentTable,
    ref: 'tip-isolate',
  })
  if (isolated.kind !== 'done') throw new Error(`isolating came back ${isolated.kind}`)
  return isolated.result.isolated
}

describe('a tip on close (D127, rule 8)', () => {
  it('the closed bill totals its lines plus the tip, for any lines and tip', async () => {
    const harness = tipHarness()
    const { connector, engine, waiter } = harness
    const ctx = kitContext(harness)
    await fc.assert(
      fc.asyncProperty(
        fc.array(
          fc.record({
            article: fc.nat(ARTICLES.length - 1),
            thousandths: fc.integer({ min: 1, max: 5000 }),
          }),
          { minLength: 1, maxLength: 6 },
        ),
        fc.integer({ min: 0, max: 1_000_000 }),
        async (rows, tipMinor) => {
          await harness.pos.reset()
          const table = await waiter.emptyTable()
          const paymentTable = await waiter.paymentTable()
          if (paymentTable === null) throw new Error('the pilot profile moves rows')
          const opened = engine.waiter.addRound(
            table.pos,
            rows.map((row) => ({
              article: ARTICLES[row.article] ?? '1001',
              quantity: quantityText(row.thousandths),
            })),
          )
          const linesMinor = engine.state.bills
            .filter((bill) => bill.id === opened.bill)
            .reduce((sum, bill) => addMinor(sum, billTotal(bill)), 0)
          const handle = await isolateAll(connector, ctx, table, paymentTable)
          const outcome = await connector.payAndClose(ctx, {
            isolated: handle,
            amountMinor: addMinor(linesMinor, tipMinor),
            tipMinor,
            paymentType: null,
            ref: 'tip-close',
          })
          expect(outcome.kind).toBe('done')
          const closed = await waiter.closedBill?.(handle.ref)
          expect(closed?.totalMinor).toBe(addMinor(linesMinor, tipMinor))
          const tips = closed?.lines.filter((line) => line.item?.pos === '1099') ?? []
          expect(tips.map((line) => line.amountMinor)).toStrictEqual(tipMinor > 0 ? [tipMinor] : [])
          const paid = engine.state.bills
            .find((bill) => bill.id === handle.ref.pos)
            ?.payments.reduce((sum, payment) => addMinor(sum, payment.amountMinor), 0)
          expect(paid).toBe(addMinor(linesMinor, tipMinor))
        },
      ),
      { numRuns: 60 },
    )
  })

  it('a tip row left by a close that failed is not moved back onto the guest table', async () => {
    const harness = tipHarness()
    const { connector, engine, waiter } = harness
    const ctx = kitContext(harness)
    await harness.pos.reset()
    const table = await waiter.emptyTable()
    const paymentTable = await waiter.paymentTable()
    if (paymentTable === null) throw new Error('the pilot profile moves rows')
    engine.waiter.addRound(table.pos, [{ article: '1001', quantity: '2' }])
    const handle = await isolateAll(connector, ctx, table, paymentTable)
    engine.faults.add({ on: 'closeBill', times: 1, fault: { kind: 'refuse', code: 'bill_locked' } })
    const close = await connector.payAndClose(ctx, {
      isolated: handle,
      amountMinor: 900 + 150,
      tipMinor: 150,
      paymentType: null,
      ref: 'tip-close',
    })
    expect(close).toMatchObject({ kind: 'refused', refusal: { code: 'bill_locked' } })
    const undo = await connector.undoIsolate(ctx, { isolated: handle, table, ref: 'tip-undo' })
    expect(undo).toMatchObject({ kind: 'refused', refusal: { code: 'not_supported' } })
    const reading = await connector.readTable(ctx, table)
    expect(reading.complete && reading.value.bills).toStrictEqual([])
  })

  it('a close whose amount is not the bill plus the tip writes no tip row', async () => {
    const harness = tipHarness()
    const { connector, engine, waiter } = harness
    const ctx = kitContext(harness)
    await harness.pos.reset()
    const table = await waiter.emptyTable()
    const paymentTable = await waiter.paymentTable()
    if (paymentTable === null) throw new Error('the pilot profile moves rows')
    engine.waiter.addRound(table.pos, [{ article: '1001', quantity: '2' }])
    const handle = await isolateAll(connector, ctx, table, paymentTable)
    const writes = () => harness.pos.calls().filter((call) => call.write).length
    const before = writes()
    const close = await connector.payAndClose(ctx, {
      isolated: handle,
      amountMinor: 900,
      tipMinor: 150,
      paymentType: null,
      ref: 'tip-close',
    })
    expect(close).toMatchObject({ kind: 'refused', refusal: { code: 'amount_mismatch' } })
    expect(writes()).toBe(before)
  })
})

describe('the tip-on-close scenario', () => {
  it('pays Table 7 with a tip, which closes as one Tip row on the same bill', async () => {
    const clock = new ManualClock()
    const resolved = loadScenarioFile('tip-on-close')
    const engine = buildEngine(resolved, { clock })
    const login = engine.apiLogins()[0]
    const tip = engine.state.articles.find((article) => article.tip)
    if (login === undefined || tip === undefined) throw new Error('no login or no tip article')
    const connector = createSimPosConnector({
      transport: paced(engine, clock),
      login: { user: login.id, password: login.password },
      switches: engine.switches,
      tipItem: tip.id,
    })
    expect(connector.capabilities.recordTipOnClose).toBe(true)
    const ctx = kitContext({ now: () => clock.now() })
    const handle = await isolateAll(connector, ctx, posRef('up 7'), posRef('39001'))
    const outcome = await connector.payAndClose(ctx, {
      isolated: handle,
      amountMinor: 4600 + 460,
      tipMinor: 460,
      paymentType: null,
      ref: 'tip-close',
    })
    expect(outcome.kind).toBe('done')
    const closed = engine.state.bills.find((bill) => bill.id === handle.ref.pos)
    expect(closed?.state).toBe('closed')
    expect(closed === undefined ? null : billTotal(closed)).toBe(5060)
    expect(
      closed?.rows.filter((row) => row.article === tip.id).map((row) => row.amountMinor),
    ).toEqual([460])
  })

  it('without the tip article the connector does not claim the tip, and refuses one', async () => {
    const clock = new ManualClock()
    const engine = buildEngine(loadScenarioFile('tip-on-close'), { clock })
    const login = engine.apiLogins()[0]
    if (login === undefined) throw new Error('no API login')
    const connector = createSimPosConnector({
      transport: inProcessTransport(engine),
      login: { user: login.id, password: login.password },
      switches: engine.switches,
    })
    expect(connector.capabilities.recordTipOnClose).toBe(false)
    const outcome = await connector.payAndClose(kitContext({ now: () => clock.now() }), {
      isolated: { ref: posRef('any'), table: posRef('39001') },
      amountMinor: 500,
      tipMinor: 100,
      paymentType: null,
      ref: 'tip-close',
    })
    expect(outcome).toMatchObject({ kind: 'refused', refusal: { code: 'not_supported' } })
    expect(engine.calls()).toStrictEqual([])
  })
})
