// The guest page's services client (#75), driven without a page: its fetch, clock and timers are
// the test's. It polls with `since` at the server's cadence and backs off when polls fail; an
// order edit is drawn at once and taken back when refused or lost (D72: no local success); a 429
// waits its Retry-After and a 401 stops the table for good.
import { newId, orderLineIdFor } from '@restro/core'
import type { GuestCommand, GuestTableState } from '@restro/shell'
import { describe, expect, it } from 'vitest'

import { createTableServices, OFFLINE_AFTER_MS, POLL_BACKOFF_MS } from './services-client'

const ITEM = newId('nd')

function tableState(version: number, lines: GuestTableState['order']['lines'] = []) {
  return {
    unchanged: false,
    version,
    next: lines.length > 0 ? 2_000 : 10_000,
    table: { label: '7' },
    ordering: { state: 'on' },
    order: { lines, removed: [], earlier: null },
    sentOrders: [],
    bill: null,
  } satisfies GuestTableState
}

function line(id: string, qty: number): GuestTableState['order']['lines'][number] {
  return {
    id: id as never,
    itemId: ITEM,
    optionIds: [],
    qty,
    note: '',
    rev: 1,
    mode: 'on_bill',
    held: null,
  }
}

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  })

/** A client on a fake clock, fetch and timers. `answer` decides each response. */
function harness(answer: (url: string, init: RequestInit) => Response | Promise<Response>) {
  let clock = 1_000_000
  const timers: { run: () => void; ms: number; cancelled: boolean }[] = []
  const calls: { url: string; init: RequestInit }[] = []
  const client = createTableServices({
    code: 'table-code-123',
    now: () => clock,
    random: () => 0.5,
    fetch: async (url, init) => {
      calls.push({ url, init })
      return answer(url, init)
    },
    setTimer(run, ms) {
      const timer = { run, ms, cancelled: false }
      timers.push(timer)
      return () => {
        timer.cancelled = true
      }
    },
  })
  return {
    client,
    calls,
    advance(ms: number) {
      clock += ms
    },
    /** The wait of the timer due next. */
    nextWait: () => timers.filter((timer) => !timer.cancelled).at(-1)?.ms,
    /** Runs the live timer and lets its fetch settle. */
    async tick() {
      const timer = timers.filter((t) => !t.cancelled).at(-1)
      if (timer === undefined) throw new Error('no timer')
      timer.cancelled = true
      timer.run()
      await new Promise((resolve) => setTimeout(resolve, 0))
    },
  }
}

const add = (actionId = crypto.randomUUID()): GuestCommand => ({
  kind: 'order.add',
  actionId,
  itemId: ITEM,
  optionIds: [],
  qty: 1,
  note: '',
})

describe('the services client', () => {
  it('polls with the table code in a header, then with since at the server’s cadence', async () => {
    const h = harness(() => json(200, tableState(4)))
    h.client.start()
    expect(h.nextWait()).toBe(0)
    await h.tick()
    const first = h.calls[0]
    expect(first?.url).toBe('/api/guest/state?view=menu')
    expect(first?.init.headers).toEqual({ Authorization: 'Table table-code-123' })
    expect(first?.init.referrerPolicy).toBe('no-referrer')
    expect(h.client.getState().order).toEqual({ lines: [], removed: [], earlier: null })
    expect(h.client.getState().ordering).toEqual({ state: 'on' })
    expect(h.nextWait()).toBe(10_000)
    await h.tick()
    expect(h.calls[1]?.url).toBe('/api/guest/state?view=menu&since=4')
  })

  it('backs off 4, 8, 16 then 30 s when polls fail, and says offline after 10 s', async () => {
    const h = harness(() => json(503, {}))
    h.client.start()
    const waits: (number | undefined)[] = []
    for (let n = 0; n < 5; n += 1) {
      await h.tick()
      waits.push(h.nextWait())
      h.advance(OFFLINE_AFTER_MS / 2 + 1)
    }
    // random() = 0.5 is the middle of the ±20% jitter.
    expect(waits).toEqual([...POLL_BACKOFF_MS, 30_000])
    expect(h.client.getState().offline).toBe(true)
  })

  it('draws an edit at once and replaces it with the server’s state when accepted', async () => {
    const actionId = crypto.randomUUID()
    const lineId = orderLineIdFor(actionId)
    let release: (response: Response) => void = () => {}
    const h = harness((url) =>
      url.endsWith('/actions')
        ? new Promise<Response>((resolve) => {
            release = resolve
          })
        : json(200, tableState(1)),
    )
    h.client.start()
    await h.tick()
    const sent = h.client.dispatch(add(actionId))
    expect(h.client.getState().order?.lines).toMatchObject([{ id: lineId, qty: 1, pending: true }])
    const body = JSON.parse(String(h.calls.at(-1)?.init.body))
    expect(body).toMatchObject({ command: { kind: 'order.add', actionId }, view: 'order' })
    expect(body.ageMs).toBeGreaterThanOrEqual(0)
    release(
      json(200, {
        result: { actionId, status: 'accepted', code: null, subjectId: lineId, ref: null },
        state: tableState(2, [line(lineId, 1)]),
      }),
    )
    expect(await sent).toMatchObject({ status: 'accepted', subjectId: lineId })
    expect(h.client.getState().order?.lines).toMatchObject([{ id: lineId, qty: 1, pending: false }])
  })

  it('takes a refused edit back and keeps the server’s order', async () => {
    const lineId = orderLineIdFor(crypto.randomUUID())
    const h = harness((url, init) => {
      if (!url.endsWith('/actions')) return json(200, tableState(3, [line(lineId, 2)]))
      const { command } = JSON.parse(String(init.body))
      return json(200, {
        result: {
          actionId: command.actionId,
          status: 'rejected',
          code: 'line_held',
          subjectId: null,
          ref: null,
        },
        state: tableState(3, [line(lineId, 2)]),
      })
    })
    h.client.start()
    await h.tick()
    const result = await h.client.dispatch({
      kind: 'order.change',
      actionId: crypto.randomUUID(),
      lineId: lineId as never,
      delta: 1,
    })
    expect(result).toMatchObject({ status: 'rejected', code: 'line_held' })
    expect(h.client.getState().order?.lines).toMatchObject([{ id: lineId, qty: 2 }])
  })

  it('takes an edit back when its answer is lost, and polls at once to see what happened', async () => {
    const h = harness((url) => {
      if (url.endsWith('/actions')) throw new TypeError('network')
      return json(200, tableState(1))
    })
    h.client.start()
    await h.tick()
    const result = await h.client.dispatch(add())
    expect(result.status).toBe('pending')
    expect(h.client.getState().order?.lines).toEqual([])
    expect(h.nextWait()).toBe(0)
  })

  it('answers a 429 as rate_limited and waits its Retry-After before polling', async () => {
    const h = harness((url) =>
      url.endsWith('/actions')
        ? json(429, { code: 'rate_limited' }, { 'Retry-After': '10' })
        : json(200, tableState(1)),
    )
    h.client.start()
    await h.tick()
    expect(await h.client.dispatch(add())).toMatchObject({
      status: 'rejected',
      code: 'rate_limited',
    })
    expect(h.client.getState().order?.lines).toEqual([])
    expect(h.nextWait()).toBe(10_000)
  })

  it('stops for good on a 401: the table is closed and no edit is sent', async () => {
    const h = harness(() => json(401, { code: 'code_retired' }))
    h.client.start()
    await h.tick()
    expect(h.client.getState().ordering).toEqual({ state: 'closed' })
    expect(h.nextWait()).toBeUndefined()
    const calls = h.calls.length
    expect(await h.client.dispatch(add())).toMatchObject({
      status: 'rejected',
      code: 'code_retired',
    })
    expect(h.calls).toHaveLength(calls)
  })

  it('never draws a Send before the server answers', async () => {
    let release: (response: Response) => void = () => {}
    const h = harness((url) =>
      url.endsWith('/actions')
        ? new Promise<Response>((resolve) => {
            release = resolve
          })
        : json(200, tableState(1, [line(orderLineIdFor(crypto.randomUUID()), 1)])),
    )
    h.client.start()
    await h.tick()
    const before = h.client.getState()
    const actionId = crypto.randomUUID()
    const sent = h.client.dispatch({ kind: 'order.send', actionId, lines: [] })
    expect(h.client.getState()).toBe(before)
    release(
      json(200, {
        result: { actionId, status: 'rejected', code: 'not_built', subjectId: null, ref: null },
        state: null,
      }),
    )
    expect(await sent).toMatchObject({ status: 'rejected', code: 'not_built' })
  })
})
