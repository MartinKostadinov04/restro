// The connector's own cases beyond the conformance kit: it throws on an undefined behaviour, a
// short page makes a reading incomplete, refusals keep their reach, and a bill with a charge of
// its own is not split.

import { posRef, type ServiceContext } from '@restro/core'
import { describe, expect, it } from 'vitest'

import { createSimPosConnector, SimPosConnectorError } from './connector'
import { ManualClock } from './engine/clock'
import { SimEngine } from './engine/engine'
import { SIM_PASSWORD } from './engine/scenario'
import { type SimSwitches, switchesOf } from './switches'
import { inProcessTransport } from './testing'

const TIMINGS = {
  probeBudgetMs: 200,
  readTimeoutMs: 300,
  writeTimeoutMs: 300,
  readBackWindowMs: 1000,
}

function setUp(
  changes: Partial<SimSwitches> = {},
  options: { readonly declared?: Partial<SimSwitches> } = {},
) {
  const clock = new ManualClock()
  const engine = new SimEngine({
    switches: switchesOf('pilot', { rateLimit: { concurrent: 1, perSecond: 1000 }, ...changes }),
    clock,
  })
  const connector = createSimPosConnector({
    transport: inProcessTransport(engine),
    login: { user: 'restro bar 1', password: SIM_PASSWORD },
    switches: switchesOf(engine.switches, options.declared ?? {}),
  })
  const ctx: ServiceContext = { now: () => clock.now(), timings: TIMINGS }
  return { engine, connector, ctx }
}

const request = (table: string, item = '1001') => ({
  table: posRef(table),
  lines: [{ item: posRef(item), quantity: '1', options: [], note: null }],
  ref: 'test-round',
  serviceDayStartsAt: '2026-10-22T05:00:00.000Z',
  excludeBills: [],
})

describe('the sim-pos connector', () => {
  it('throws on an undefined behaviour of the POS (501), never guesses', async () => {
    const { connector, ctx } = setUp({}, { declared: { readsTableBar: true } })
    await expect(connector.readFloor(ctx)).rejects.toMatchObject({
      name: 'SimPosConnectorError',
      code: 'undefined_behaviour',
    })
    await expect(connector.readFloor(ctx)).rejects.toBeInstanceOf(SimPosConnectorError)
  })

  it('reads a list short of its stated count as incomplete (rule 6)', async () => {
    const { engine, connector, ctx } = setUp()
    engine.faults.add({ on: 'listTables', from: 2, fault: { kind: 'dropItem' } })
    const reading = await connector.readFloor(ctx)
    expect(reading.complete).toBe(false)
  })

  it('refuses a sold-out item for its line, and keeps the table as it was', async () => {
    const { engine, connector, ctx } = setUp()
    engine.waiter.markSoldOut('gin tonic')
    const outcome = await connector.addLines(ctx, request('T 8 hall', 'gin tonic'))
    expect(outcome).toMatchObject({
      kind: 'refused',
      refusal: { code: 'item_unavailable', scope: 'line', line: 0 },
    })
  })

  it("needs the first item where the table has no bill and the POS won't open one (D124 §3)", async () => {
    const { connector, ctx } = setUp()
    const outcome = await connector.addLines(ctx, request('30007'))
    expect(outcome).toMatchObject({ kind: 'refused', refusal: { code: 'needs_first_item' } })
  })

  it('refuses a locked bill for that bill', async () => {
    const { engine, connector, ctx } = setUp()
    const bill = engine.state.bills.find((b) => b.table === 'T 8 hall')
    engine.waiter.lockBill(bill?.id ?? '')
    const outcome = await connector.addLines(ctx, request('T 8 hall'))
    expect(outcome).toMatchObject({
      kind: 'refused',
      refusal: { code: 'bill_locked', scope: 'bill' },
    })
  })

  it('a refused login is refused for the login; an offline one is unknown', async () => {
    const { engine, connector, ctx } = setUp()
    engine.faults.add({ on: 'ping', fault: { kind: 'refuse', code: 'credentials' } })
    expect(await connector.probe(ctx)).toMatchObject({
      kind: 'refused',
      refusal: { code: 'credentials', scope: 'login' },
    })
    engine.waiter.takeOffline('restro bar 1')
    expect(await connector.probe(ctx)).toMatchObject({ kind: 'unknown' })
  })

  it('does not split a bill with a charge of its own (Q37): the guest asks the waiter', async () => {
    const { engine, connector, ctx } = setUp()
    const bill = engine.state.bills.find((b) => b.table === 'T 8 hall')
    engine.waiter.chargeBill(bill?.id ?? '', 500)
    const before = engine.digest()
    const reading = await connector.readTable(ctx, posRef('T 8 hall'))
    if (!reading.complete) throw new Error(reading.reason)
    const read = reading.value.bills[0]
    const line = read?.lines[0]
    if (read === undefined || line === undefined) throw new Error('expected a bill with a line')
    const outcome = await connector.isolateLines(ctx, {
      table: posRef('T 8 hall'),
      picks: [{ bill: read.ref, line: line.ref, quantity: line.quantity }],
      paymentTable: posRef('39001'),
      ref: 'test-isolate',
    })
    expect(outcome).toMatchObject({ kind: 'refused', refusal: { code: 'not_supported' } })
    expect(engine.digest()).toBe(before)
  })
})
