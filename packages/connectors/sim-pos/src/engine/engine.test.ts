import { describe, expect, it, vi } from 'vitest'

import { switchesOf } from '../switches'
import type { RowIn, SimCall } from './calls'
import { ManualClock } from './clock'
import { type Credentials, SimEngine } from './engine'
import { SimSetupError, UndefinedBehaviour } from './errors'
import type { SimFault } from './faults'
import { idShape } from './ids'
import { SIM_PASSWORD } from './scenario'

const RESTRO: Credentials = { user: 'restro bar 1', password: SIM_PASSWORD }
const TABLE_8 = 'T 8 hall'

function sim(
  changes: Parameters<typeof switchesOf>[1] = {},
  base: 'cautious' | 'pilot' = 'cautious',
) {
  const clock = new ManualClock()
  return { clock, engine: new SimEngine({ switches: switchesOf(base, changes), clock }) }
}

function must<T>(value: T | undefined): T {
  if (value === undefined) throw new Error('expected a value')
  return value
}

const row = (article: string, quantity = '1'): RowIn => ({
  article,
  quantity,
  note: null,
  options: [],
  ref: null,
  amountMinor: null,
})

function billOf(engine: SimEngine, table: string) {
  return must(engine.state.bills.find((bill) => bill.table === table && bill.state === 'open'))
}

function addToTable8(engine: SimEngine, rows: readonly RowIn[] = [row('1001', '2')]): SimCall {
  return { method: 'addRows', table: TABLE_8, bill: billOf(engine, TABLE_8).id, rows, ref: null }
}

describe('undefined behaviour is loud (#51 design §2.3)', () => {
  it('a call the switches leave undefined answers 501 undefined_behaviour', () => {
    const { engine } = sim()
    const plan = engine.call(RESTRO, { method: 'listBars', page: 1 })
    expect(plan.answer).toMatchObject({ ok: false, status: 501, code: 'undefined_behaviour' })
  })

  it('an undefined write changes nothing', () => {
    const { engine } = sim()
    const before = engine.digest()
    const plan = engine.call(RESTRO, {
      method: 'moveRows',
      bill: billOf(engine, TABLE_8).id,
      rows: [{ row: must(billOf(engine, TABLE_8).rows[0]).id, quantity: null }],
      to: { table: '39001', bill: null },
    })
    expect(plan.answer).toMatchObject({ status: 501 })
    expect(engine.digest()).toBe(before)
  })

  it('a write in training mode is undefined, and the ping says the mode (Q27)', () => {
    const { engine } = sim({ trainingMode: true, startsInTrainingMode: true })
    expect(engine.call(RESTRO, { method: 'ping' }).answer).toEqual({
      ok: true,
      value: { ok: true, mode: 'training' },
    })
    expect(engine.call(RESTRO, addToTable8(engine)).answer).toMatchObject({ status: 501 })
    engine.waiter.setTrainingMode(false)
    expect(engine.call(RESTRO, addToTable8(engine)).answer).toMatchObject({ ok: true })
  })

  it("a waiter's action outside the switches throws too", () => {
    const { engine } = sim()
    expect(() => engine.waiter.splitBill(billOf(engine, TABLE_8).id, [])).toThrow(
      UndefinedBehaviour,
    )
    expect(() => engine.waiter.setTrainingMode(true)).toThrow(SimSetupError)
  })
})

describe('ids vary in shape (#51 design §7 risk 1)', () => {
  it('new bills and rows take numbers, text with spaces and uuids in turn', () => {
    const { engine } = sim()
    const ids: string[] = []
    for (const table of ['30007', '30012', 'G 14']) {
      const added = engine.waiter.addRound(table, [{ article: '1001' }, { article: 'gin tonic' }])
      ids.push(added.bill, ...added.rows)
    }
    const shapes = new Set(ids.map(idShape))
    expect(shapes).toEqual(new Set(['number', 'spaced', 'uuid']))
  })

  it('the scenario mixes the shapes too', () => {
    const { engine } = sim()
    const shapes = new Set(engine.state.tables.map((table) => idShape(table.id)))
    expect(shapes).toEqual(new Set(['number', 'spaced', 'uuid']))
  })

  it('ids keep counting across a reset', () => {
    const { engine } = sim()
    const first = engine.waiter.addRound('30007', [{ article: '1001' }]).bill
    engine.reset()
    expect(engine.waiter.addRound('30007', [{ article: '1001' }]).bill).not.toBe(first)
  })
})

describe('fault plans (#51 design §2.6)', () => {
  const withFault = (fault: SimFault, changes: Parameters<typeof switchesOf>[1] = {}) => {
    const s = sim(changes, 'pilot')
    s.engine.faults.add({ on: 'write', fault })
    return s
  }

  it('apply from the n-th matching call, as many times as asked', () => {
    const { engine } = sim()
    engine.faults.add({ on: 'ping', from: 2, times: 2, fault: { kind: 'fail' } })
    const statuses = [1, 2, 3, 4].map(() => {
      const plan = engine.call(RESTRO, { method: 'ping' })
      return plan.answer.ok ? 200 : plan.answer.status
    })
    expect(statuses).toEqual([200, 500, 500, 200])
  })

  it('hang: nothing lands and no answer comes', () => {
    const { engine } = withFault({ kind: 'hang' })
    const before = engine.digest()
    expect(engine.call(RESTRO, addToTable8(engine)).hang).toBe(true)
    expect(engine.digest()).toBe(before)
  })

  it('landsThenHangs: the round lands, the answer never comes', () => {
    const { engine } = withFault({ kind: 'landsThenHangs' })
    const rows = billOf(engine, TABLE_8).rows.length
    expect(engine.call(RESTRO, addToTable8(engine)).hang).toBe(true)
    expect(billOf(engine, TABLE_8).rows.length).toBe(rows + 1)
  })

  it('landsPartly: only a prefix of the rows lands (Q15)', () => {
    const { engine } = withFault({ kind: 'landsPartly', rows: 1 })
    const rows = billOf(engine, TABLE_8).rows.length
    const call = addToTable8(engine, [row('1001'), row('gin tonic'), row('1004')])
    expect(engine.call(RESTRO, call).hang).toBe(true)
    expect(billOf(engine, TABLE_8).rows.length).toBe(rows + 1)
  })

  it('landsPartly refuses a POS whose add is all or nothing', () => {
    const { engine } = withFault({ kind: 'landsPartly' }, { addIsAllOrNothing: true })
    expect(() => engine.call(RESTRO, addToTable8(engine))).toThrow(SimSetupError)
  })

  it('landsLate: the round lands after lateLandingMs on the engine clock', () => {
    const { engine, clock } = withFault({ kind: 'landsLate' })
    const rows = billOf(engine, TABLE_8).rows.length
    expect(engine.call(RESTRO, addToTable8(engine)).hang).toBe(true)
    expect(billOf(engine, TABLE_8).rows.length).toBe(rows)
    expect(engine.pendingLateWrites()).toBe(1)
    clock.advance(engine.switches.lateLandingMs)
    engine.call(RESTRO, { method: 'ping' })
    expect(billOf(engine, TABLE_8).rows.length).toBe(rows + 1)
    expect(engine.pendingLateWrites()).toBe(0)
  })

  it('fail and refuse answer at once and change nothing', () => {
    for (const [fault, status] of [
      [{ kind: 'fail' }, 500],
      [{ kind: 'refuse', code: 'bill_locked' }, 409],
      [{ kind: 'refuse', code: 'sold_out', line: 0 }, 422],
    ] as const) {
      const { engine } = withFault(fault)
      const before = engine.digest()
      expect(engine.call(RESTRO, addToTable8(engine)).answer).toMatchObject({ ok: false, status })
      expect(engine.digest()).toBe(before)
    }
  })

  it('dropItem: a list answers one item fewer than the count it states', () => {
    const { engine } = sim()
    engine.faults.add({ on: 'listTables', fault: { kind: 'dropItem' } })
    const answer = engine.call(RESTRO, { method: 'listTables', page: 1 }).answer
    if (!answer.ok) throw new Error('expected an answer')
    const value = answer.value as { count: number; items: unknown[] }
    expect(value.items.length).toBe(engine.pageSize - 1)
    expect(value.count).toBeGreaterThan(value.items.length)
  })

  it('slow: the answer waits, and holds the login meanwhile (Q28)', () => {
    const { engine } = sim()
    engine.faults.add({ on: 'ping', fault: { kind: 'slow', ms: 50 } })
    const slow = engine.call(RESTRO, { method: 'ping' })
    expect(slow).toMatchObject({ delayMs: 50, login: RESTRO.user })
    expect(engine.call(RESTRO, { method: 'ping' }).answer).toMatchObject({
      status: 429,
      code: 'busy',
    })
    engine.release(RESTRO.user)
    expect(engine.call(RESTRO, { method: 'ping' }).answer).toMatchObject({ ok: true })
  })

  it('loginOffline: every later call of the login fails until it is back', () => {
    const { engine } = sim()
    engine.faults.add({ on: 'ping', fault: { kind: 'loginOffline' } })
    for (let i = 0; i < 3; i += 1) {
      expect(engine.call(RESTRO, { method: 'ping' }).answer).toMatchObject({ status: 503 })
    }
    engine.waiter.bringOnline(RESTRO.user)
    expect(engine.call(RESTRO, { method: 'ping' }).answer).toMatchObject({ ok: true })
  })

  it("waiterRoundSlipsIn: a waiter's identical round lands just before Restro's", () => {
    const { engine } = withFault({ kind: 'waiterRoundSlipsIn', identical: true })
    const rows = billOf(engine, TABLE_8).rows.length
    engine.call(RESTRO, addToTable8(engine, [row('shot 5', '3')]))
    const added = billOf(engine, TABLE_8).rows.slice(rows)
    expect(added.map((r) => [r.article, r.quantity, r.by])).toEqual([
      ['shot 5', 3000, 'maria'],
      ['shot 5', 3000, RESTRO.user],
    ])
  })

  it('waiterVoidsLine: the last row is voided before the call', () => {
    const { engine } = withFault({ kind: 'waiterVoidsLine' })
    const last = must(billOf(engine, TABLE_8).rows.at(-1)).id
    engine.call(RESTRO, addToTable8(engine))
    expect(billOf(engine, TABLE_8).rows.some((r) => r.id === last)).toBe(false)
  })

  it('waiterClosesBill: the bill closes before the call, which is refused bill_closed', () => {
    const { engine } = withFault({ kind: 'waiterClosesBill' })
    const call = addToTable8(engine)
    expect(engine.call(RESTRO, call).answer).toMatchObject({ status: 409, code: 'bill_closed' })
  })

  it('noReceipt: the close succeeds with no receipt, or is refused where it cannot (Q25)', () => {
    const closeCall = (engine: SimEngine): SimCall => {
      const bill = billOf(engine, TABLE_8)
      const total = bill.rows.reduce((sum, r) => sum + r.amountMinor, bill.chargeMinor)
      return {
        method: 'closeBill',
        bill: bill.id,
        payments: [{ type: null, amountMinor: total }],
        note: null,
        receiptEmail: null,
      }
    }
    const lenient = withFault({ kind: 'noReceipt' }, { receiptNumberOnClose: true })
    expect(lenient.engine.call(RESTRO, closeCall(lenient.engine)).answer).toEqual({
      ok: true,
      value: { bill: billOf(sim().engine, TABLE_8).id },
    })
    const strict = withFault({ kind: 'noReceipt' }, { closeSucceedsWithoutPrinter: false })
    expect(strict.engine.call(RESTRO, closeCall(strict.engine)).answer).toMatchObject({
      status: 422,
      code: 'fiscal_device',
    })
    expect(billOf(strict.engine, TABLE_8).state).toBe('open')
  })
})

describe('chaos mode', () => {
  const run = (seed: number) => {
    const { engine } = sim({ rateLimit: { concurrent: 1, perSecond: 1000 } })
    const print = vi.fn()
    engine.faults.chaos({
      seed,
      rate: 0.5,
      faults: [{ kind: 'fail' }, { kind: 'dropItem' }, { kind: 'slow', ms: { min: 1, max: 9 } }],
      print,
    })
    for (let i = 0; i < 40; i += 1) {
      const plan = engine.call(RESTRO, { method: 'listTables', page: 1 })
      if (plan.login !== null) engine.release(plan.login)
    }
    return { print, faults: engine.calls().map((call) => call.faults.join('+')) }
  }

  it('prints its seed and replays exactly with the same seed', () => {
    const first = run(424242)
    expect(first.print).toHaveBeenCalledWith('sim-pos chaos seed 424242')
    expect(run(424242).faults).toEqual(first.faults)
    expect(run(7).faults).not.toEqual(first.faults)
    expect(first.faults.filter((kinds) => kinds !== '').length).toBeGreaterThan(5)
  })
})

describe('the rate limit (Q28)', () => {
  it('refuses the call beyond the per-second limit as busy, and frees up after a second', () => {
    const { engine, clock } = sim()
    const statuses = [1, 2, 3, 4, 5, 6].map(() => {
      const plan = engine.call(RESTRO, { method: 'ping' })
      return plan.answer.ok ? 200 : plan.answer.status
    })
    expect(statuses).toEqual([200, 200, 200, 200, 200, 429])
    clock.advance(1000)
    expect(engine.call(RESTRO, { method: 'ping' }).answer).toMatchObject({ ok: true })
  })
})

describe('the one-login-per-bar switch (Q19)', () => {
  it("a bar's login sees its bar's tables only, and is refused another bar's", () => {
    const { engine } = sim()
    const answer = engine.call(RESTRO, {
      method: 'listBills',
      table: '30012',
      state: 'open',
      page: 1,
    })
    expect(answer.answer).toMatchObject({ status: 403, code: 'no_rights' })
    expect(engine.apiLogins().map((login) => login.id)).toEqual(['restro bar 1', 'restro garden'])
    expect(
      sim({ oneLoginPerBar: false })
        .engine.apiLogins()
        .map((l) => l.id),
    ).toEqual(['restro'])
  })
})

describe('a charge of the bill its own (Q37, on in both profiles)', () => {
  it('makes the total differ from the rows, and moving rows off the bill undefined', () => {
    const { engine } = sim({}, 'pilot')
    const bill = billOf(engine, TABLE_8)
    engine.waiter.chargeBill(bill.id, 300)
    const listed = engine.call(RESTRO, {
      method: 'listBills',
      table: TABLE_8,
      state: 'open',
      page: 1,
    })
    if (!listed.answer.ok) throw new Error('expected an answer')
    const rowsTotal = bill.rows.reduce((sum, r) => sum + r.amountMinor, 0)
    expect(listed.answer.value).toMatchObject({ items: [{ total: rowsTotal + 300 }] })
    const move = engine.call(RESTRO, {
      method: 'moveRows',
      bill: bill.id,
      rows: [{ row: must(bill.rows[0]).id, quantity: null }],
      to: { table: '39001', bill: null },
    })
    expect(move.answer).toMatchObject({ status: 501 })
  })
})
