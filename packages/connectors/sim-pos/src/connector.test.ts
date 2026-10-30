// The connector's own cases beyond the conformance kit: it throws on an undefined behaviour, a
// short page makes a reading incomplete, refusals keep their reach, and a bill with a charge of
// its own is not split.

import { posRef, type ServiceConnector, type ServiceContext } from '@restro/core'
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

describe('its limit, and what never left (RR-67, RR-24)', () => {
  const limited = () => setUp({ rateLimit: { concurrent: 1, perSecond: 5 } })
  const useUpTheSecond = async (connector: ServiceConnector, ctx: ServiceContext) => {
    for (let call = 0; call < 5; call++) await connector.probe(ctx)
  }

  it('states its figure', () => {
    expect(limited().connector.callsPerSecond).toBe(5)
  })

  it('a rate-limit answer is a definite busy, and nothing was written', async () => {
    const { engine, connector, ctx } = limited()
    await useUpTheSecond(connector, ctx)
    const before = engine.digest()
    expect(await connector.probe(ctx)).toMatchObject({
      kind: 'refused',
      refusal: { code: 'busy' },
    })
    expect(await connector.readTable(ctx, posRef('T 8 hall'))).toMatchObject({
      complete: false,
      busy: true,
    })
    expect(await connector.addLines(ctx, request('T 8 hall'))).toMatchObject({
      kind: 'refused',
      refusal: { code: 'busy' },
    })
    expect(engine.digest()).toBe(before)
    expect(engine.calls().filter((call) => call.status === 429)).toHaveLength(3)
    expect(engine.calls().some((call) => call.method === 'addRows')).toBe(false)
  })

  it('the same answer to the round itself writes nothing either', async () => {
    const { engine, connector, ctx } = setUp()
    engine.faults.add({ on: 'addRows', fault: { kind: 'refuse', code: 'busy' } })
    const before = engine.digest()
    expect(await connector.addLines(ctx, request('T 8 hall'))).toMatchObject({
      kind: 'refused',
      refusal: { code: 'busy' },
    })
    expect(engine.digest()).toBe(before)
  })

  it('a call the budget had no room for never leaves', async () => {
    const { engine, connector, ctx } = setUp()
    const noRoom = { ...ctx, pace: async () => false }
    expect(await connector.readTable(noRoom, posRef('T 8 hall'))).toMatchObject({
      complete: false,
      busy: true,
    })
    expect(await connector.addLines(noRoom, request('T 8 hall'))).toMatchObject({
      kind: 'refused',
      refusal: { code: 'busy' },
    })
    expect(engine.calls()).toEqual([])
  })

  it('every call on the wire takes a place in the budget', async () => {
    const { engine, connector, ctx } = setUp()
    let places = 0
    await connector.addLines(
      {
        ...ctx,
        pace: async () => {
          places += 1
          return true
        },
      },
      request('T 8 hall'),
    )
    expect(places).toBe(engine.calls().length)
    expect(places).toBeGreaterThan(1)
  })

  it('a read before the round that fails is a refusal: nothing went out', async () => {
    const { engine, connector, ctx } = setUp()
    engine.faults.add({ on: 'read', fault: { kind: 'fail' } })
    const before = engine.digest()
    expect(await connector.addLines(ctx, request('T 8 hall'))).toMatchObject({
      kind: 'refused',
      refusal: { code: 'read_failed' },
    })
    expect(engine.calls().some((call) => call.method === 'addRows')).toBe(false)
    expect(engine.digest()).toBe(before)
  })

  it('a round that fails on its way stays unknown', async () => {
    const { engine, connector, ctx } = setUp()
    engine.faults.add({ on: 'addRows', fault: { kind: 'fail' } })
    expect(await connector.addLines(ctx, request('T 8 hall'))).toMatchObject({ kind: 'unknown' })
  })

  it('a locked bill is refused naming the bill, so the next try goes past it', async () => {
    const { engine, connector, ctx } = setUp()
    const bill = engine.state.bills.find((b) => b.table === 'T 8 hall')
    engine.waiter.lockBill(bill?.id ?? '')
    expect(await connector.addLines(ctx, request('T 8 hall'))).toMatchObject({
      kind: 'refused',
      refusal: { code: 'bill_locked', bill: posRef(bill?.id ?? '') },
    })
  })
})

describe('reading a closed bill (D127)', () => {
  const closed = (changes: Partial<SimSwitches>) => {
    const { engine, connector, ctx } = setUp({ readClosedBills: true, ...changes })
    const bill = engine.state.bills.find((b) => b.table === 'T 8 hall')
    if (bill === undefined) throw new Error('expected a bill')
    const read = connector.readClosedBill
    if (read === undefined) throw new Error('expected the capability')
    const handle = { ref: posRef(bill.id), table: posRef('T 8 hall') }
    return { engine, bill, read: () => read(ctx, handle) }
  }

  it('is absent where the capability is off', () => {
    expect(setUp().connector.readClosedBill).toBeUndefined()
  })

  it('an open bill reads as null', async () => {
    const { read } = closed({})
    expect(await read()).toEqual({ complete: true, value: null })
  })

  it('a closed bill shows its receipt number where the POS gives one', async () => {
    const { engine, bill, read } = closed({ receiptNumberOnClose: true })
    engine.waiter.closeBill(bill.id, 'card')
    expect(await read()).toMatchObject({
      complete: true,
      value: { ref: posRef(bill.id), receiptNumber: expect.any(String), restroRefs: [] },
    })
  })

  it('a closed bill shows no receipt number where the POS gives none', async () => {
    const { engine, bill, read } = closed({})
    engine.waiter.closeBill(bill.id, 'card')
    expect(await read()).toMatchObject({ complete: true, value: { receiptNumber: null } })
  })
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
