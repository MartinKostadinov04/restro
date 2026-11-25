// The waiter control (#71): every operation of #51 §2.5 through its name, the control calls of the
// standalone server (token, scenario loading, the wire beside them), and the CLI's flags.

import { afterEach, describe, expect, it } from 'vitest'

import { ManualClock } from '../engine/clock'
import type { SimEngine } from '../engine/engine'
import { UndefinedBehaviour } from '../engine/errors'
import { buildEngine, loadScenarioFile } from '../scenario-file'
import { basicAuthHeader } from '../wire/serve'
import { parseFlags } from './flags'
import { runWaiterOp, WAITER_OP_NAMES, WaiterOpError } from './ops'
import { createSimServer, type SimServer, TOKEN_HEADER } from './server'
import { controlView } from './view'

const quiet = () => buildEngine(loadScenarioFile('quiet-night'), { clock: new ManualClock() })

function openBillOf(engine: SimEngine, number: string) {
  const table = engine.state.tables.find((t) => t.number === number)
  return engine.state.bills.find((bill) => bill.table === table?.id && bill.state === 'open')
}

describe('the waiter operations', () => {
  it('lists every operation of #51 §2.5', () => {
    expect(WAITER_OP_NAMES).toEqual(
      expect.arrayContaining([
        'put-first-item',
        'add-round',
        'void-line',
        'move-lines',
        'close-bill',
        'lock-bill',
        'unlock-bill',
        'split-bill',
        'merge-bills',
        'sold-out',
        'offline',
        'online',
      ]),
    )
  })

  it('puts a first item on a table (opens its bill) and refuses when it already has one', () => {
    const engine = quiet()
    expect(openBillOf(engine, '2')).toBeUndefined()
    runWaiterOp(engine, 'put-first-item', { table: '2', items: '2101:2' })
    expect(openBillOf(engine, '2')?.rows).toHaveLength(1)
    expect(() => runWaiterOp(engine, 'put-first-item', { table: '2', items: '2101' })).toThrow(
      WaiterOpError,
    )
  })

  it('adds a round by table number, with quantities and several articles', () => {
    const engine = quiet()
    const before = openBillOf(engine, '7')?.rows.length ?? 0
    runWaiterOp(engine, 'add-round', { table: '7', items: ['2501:0.5', '2503'] })
    const bill = openBillOf(engine, '7')
    expect(bill?.rows).toHaveLength(before + 2)
    expect(bill?.rows.find((row) => row.article === '2501')?.quantity).toBe(500)
  })

  it('voids a line, and part of one', () => {
    const engine = quiet()
    const bill = openBillOf(engine, '7')
    const row = bill?.rows.find((r) => r.article === '2102')
    if (bill === undefined || row === undefined) throw new Error('no row')
    runWaiterOp(engine, 'void-line', { table: '7', row: row.id, quantity: '1' })
    expect(openBillOf(engine, '7')?.rows.find((r) => r.id === row.id)?.quantity).toBe(1000)
    runWaiterOp(engine, 'void-line', { bill: bill.id, row: row.id })
    expect(openBillOf(engine, '7')?.rows.find((r) => r.id === row.id)).toBeUndefined()
  })

  it('moves rows to a payment table (pilot profile), by number', () => {
    const engine = quiet()
    const bill = openBillOf(engine, '7')
    const row = bill?.rows[0]
    if (bill === undefined || row === undefined) throw new Error('no row')
    const moved = runWaiterOp(engine, 'move-lines', { table: '7', rows: row.id, to: 'PU1' })
    expect(moved).toMatchObject({ from: bill.id })
    expect(openBillOf(engine, 'PU1')?.rows).toHaveLength(1)
  })

  it('closes a bill with cash or card, and refuses a second close', () => {
    const engine = quiet()
    runWaiterOp(engine, 'close-bill', { table: '7', kind: 'card' })
    expect(openBillOf(engine, '7')).toBeUndefined()
    expect(() => runWaiterOp(engine, 'close-bill', { table: '7' })).toThrow(WaiterOpError)
  })

  it('locks and unlocks a bill', () => {
    const engine = quiet()
    runWaiterOp(engine, 'lock-bill', { table: '7' })
    expect(openBillOf(engine, '7')?.lockedBy).not.toBeNull()
    runWaiterOp(engine, 'unlock-bill', { table: '7' })
    expect(openBillOf(engine, '7')?.lockedBy).toBeNull()
  })

  it('answers split and merge on a one-bill POS as an undefined behaviour (Q10), never a guess', () => {
    const engine = quiet()
    const bill = openBillOf(engine, '7')
    const row = bill?.rows[0]
    if (bill === undefined || row === undefined) throw new Error('no row')
    expect(() => runWaiterOp(engine, 'split-bill', { table: '7', rows: row.id })).toThrow(
      UndefinedBehaviour,
    )
    expect(() => runWaiterOp(engine, 'merge-bills', { from: bill.id, into: bill.id })).toThrow(
      UndefinedBehaviour,
    )
  })

  it('marks an article sold out and puts it back', () => {
    const engine = quiet()
    runWaiterOp(engine, 'sold-out', { article: '2001' })
    expect(engine.state.articles.find((a) => a.id === '2001')?.soldOut).toBe(true)
    runWaiterOp(engine, 'sold-out', { article: '2001', soldOut: 'false' })
    expect(engine.state.articles.find((a) => a.id === '2001')?.soldOut).toBe(false)
  })

  it('takes a login offline and brings it back', () => {
    const engine = quiet()
    runWaiterOp(engine, 'offline', { login: 'restro' })
    expect(engine.state.offline).toContain('restro')
    runWaiterOp(engine, 'online', { login: 'restro' })
    expect(engine.state.offline).not.toContain('restro')
  })

  it('names what went wrong: an unknown operation, an unknown table, missing arguments', () => {
    const engine = quiet()
    expect(() => runWaiterOp(engine, 'dance', {})).toThrow(/no operation "dance"/)
    expect(() => runWaiterOp(engine, 'close-bill', { table: '99' })).toThrow(/no table "99"/)
    expect(() => runWaiterOp(engine, 'close-bill', {})).toThrow(/name a bill/)
    expect(() => runWaiterOp(engine, 'add-round', { table: '7' })).toThrow(WaiterOpError)
    expect(() => runWaiterOp(engine, 'add-round', { table: '7', items: '2001', extra: 1 })).toThrow(
      WaiterOpError,
    )
  })

  it('shows tickets per bar and the call log in the control view', async () => {
    const engine = quiet()
    runWaiterOp(engine, 'add-round', { table: '7', items: '2001' })
    const view = controlView(engine, {
      name: 'quiet-night',
      description: '',
      profile: 'pilot',
      scenarios: [],
      chaosSeed: null,
    })
    const upstairs = view.bars.find((bar) => bar.name === 'Upstairs')
    expect(upstairs?.tickets[0]).toMatchObject({ table: '7', kind: 'order' })
    expect(view.tables.find((t) => t.number === '7')?.bills[0]?.totalMinor).toBe(4600 + 1050)
    expect(view.ops.length).toBe(WAITER_OP_NAMES.length)
    expect(Array.isArray(view.calls)).toBe(true)
  })
})

describe('the CLI flags', () => {
  it('reads --name value pairs and joins a repeated name with commas', () => {
    expect(parseFlags(['--table', '7', '--items', '2001:2', '--items', '2502'])).toEqual({
      table: '7',
      items: '2001:2,2502',
    })
  })

  it('refuses a bare word and a flag with no value', () => {
    expect(() => parseFlags(['table'])).toThrow(/arguments are --name value/)
    expect(() => parseFlags(['--table'])).toThrow(/needs a value/)
    expect(() => parseFlags(['--table', '--items', '1'])).toThrow(/needs a value/)
  })
})

describe('the standalone server', () => {
  let sim: SimServer | null = null
  afterEach(async () => {
    await sim?.close()
    sim = null
  })

  async function start(options: { token?: string | null } = {}) {
    sim = createSimServer({ scenario: 'quiet-night', ...options })
    const port = await sim.listen(0)
    return `http://127.0.0.1:${port}`
  }

  it('serves the POS-shaped wire at /api/ to a login with Basic authentication', async () => {
    const base = await start()
    const denied = await fetch(`${base}/api/tables?page=1`)
    expect(denied.status).toBe(401)
    const ok = await fetch(`${base}/api/tables?page=1`, {
      headers: { authorization: basicAuthHeader('restro', 'sim-pos-local') },
    })
    expect(ok.status).toBe(200)
    expect(((await ok.json()) as { count: number }).count).toBe(16)
  })

  it('serves the control page with no data and no token needed', async () => {
    const base = await start({ token: 'secret' })
    const page = await fetch(`${base}/control`)
    expect(page.status).toBe(200)
    expect(page.headers.get('content-type')).toContain('text/html')
    expect(page.headers.get('cache-control')).toBe('no-store')
    const html = await page.text()
    expect(html).toContain('Simulated POS')
    expect(html).not.toContain('secret')
  })

  it('needs the token for every control call when one is set', async () => {
    const base = await start({ token: 'secret' })
    expect((await fetch(`${base}/control/api/state`)).status).toBe(401)
    expect(
      (await fetch(`${base}/control/api/state`, { headers: { [TOKEN_HEADER]: 'wrong' } })).status,
    ).toBe(401)
    expect(
      (await fetch(`${base}/control/api/waiter/close-day`, { method: 'POST', body: '{}' })).status,
    ).toBe(401)
    const ok = await fetch(`${base}/control/api/state`, { headers: { [TOKEN_HEADER]: 'secret' } })
    expect(ok.status).toBe(200)
    expect(((await ok.json()) as { scenario: { name: string } }).scenario.name).toBe('quiet-night')
  })

  it('needs no token when none is set (local use)', async () => {
    const base = await start()
    expect((await fetch(`${base}/control/api/state`)).status).toBe(200)
  })

  it('acts as a waiter over the control call, and the wire sees it', async () => {
    const base = await start()
    const done = await fetch(`${base}/control/api/waiter/add-round`, {
      method: 'POST',
      body: JSON.stringify({ table: '7', items: '2001' }),
    })
    expect(done.status).toBe(200)
    const state = (await (await fetch(`${base}/control/api/state`)).json()) as {
      tables: { number: string; bills: { totalMinor: number }[] }[]
    }
    expect(state.tables.find((t) => t.number === '7')?.bills[0]?.totalMinor).toBe(5650)
  })

  it('answers a mistake as 400 and a POS rule as 409, and a call it does not have as 404', async () => {
    const base = await start()
    const post = (path: string, body: unknown) =>
      fetch(`${base}${path}`, { method: 'POST', body: JSON.stringify(body) })
    expect((await post('/control/api/waiter/dance', {})).status).toBe(400)
    expect((await post('/control/api/waiter/close-bill', { table: '1' })).status).toBe(400)
    expect((await post('/control/api/waiter/split-bill', { table: '7', rows: 'x' })).status).toBe(
      409,
    )
    expect((await fetch(`${base}/control/api/nothing`)).status).toBe(404)
    expect((await fetch(`${base}/elsewhere`)).status).toBe(404)
    const notJson = await fetch(`${base}/control/api/waiter/close-day`, {
      method: 'POST',
      body: '{',
    })
    expect(notJson.status).toBe(400)
  })

  it('loads a scenario by name: the state is rebuilt, faults and setup included', async () => {
    const base = await start()
    await fetch(`${base}/control/api/waiter/close-bill`, {
      method: 'POST',
      body: JSON.stringify({ table: '7' }),
    })
    const loaded = await fetch(`${base}/control/api/scenario`, {
      method: 'POST',
      body: JSON.stringify({ name: 'payment-trouble' }),
    })
    expect(loaded.status).toBe(200)
    const state = (await (await fetch(`${base}/control/api/state`)).json()) as {
      scenario: { name: string }
      tables: { number: string; bills: { lockedBy: string | null }[] }[]
    }
    expect(state.scenario.name).toBe('payment-trouble')
    expect(state.tables.find((t) => t.number === '7')?.bills).toHaveLength(1)
    expect(state.tables.find((t) => t.number === '8')?.bills[0]?.lockedBy).not.toBeNull()
    const unknown = await fetch(`${base}/control/api/scenario`, {
      method: 'POST',
      body: JSON.stringify({ name: 'no-such-night' }),
    })
    expect(unknown.status).toBe(400)
  })

  it('refuses to listen beyond this machine without a token', async () => {
    const open = createSimServer({ scenario: 'quiet-night' })
    await expect(open.listen(0, '0.0.0.0')).rejects.toThrow(/only with a control token/)
    const guarded = createSimServer({ scenario: 'quiet-night', token: 'secret' })
    const port = await guarded.listen(0, '0.0.0.0')
    expect(port).toBeGreaterThan(0)
    await guarded.close()
  })
})
