// The guest page's services client (#75), driven without a page: its fetch, clock and timers are
// the test's. It polls with `since` at the server's cadence and backs off when polls fail; an
// order edit is drawn at once and taken back when refused or lost (D72: no local success); a 429
// waits its Retry-After and a 401 stops the table for good. The location check (#76): the consent
// screen the first time, the edit sent again with the position after "Allow", the pass kept and
// sent back, "Not now" remembered, a failed check offered; Turnstile's token at Send.
import { type GuestPosition, LOCATION_CONSENT_VERSION, newId, orderLineIdFor } from '@restro/core'
import type { GuestCommand, GuestTableState } from '@restro/shell'
import { describe, expect, it } from 'vitest'

import {
  CONSENT_KEY,
  createTableServices,
  newPhoneValue,
  OFFLINE_AFTER_MS,
  PASS_KEY,
  POLL_BACKOFF_MS,
  type TableServicesDeps,
} from './services-client'

const ITEM = newId('nd')

type Lines = NonNullable<GuestTableState['order']>['lines']
type LocationState = GuestTableState['location']['state']

const PHONE = 'phone-value-aaaaaaaaaa'

function tableState(version: number, lines: Lines = [], location: LocationState = 'off') {
  return {
    unchanged: false,
    version,
    next: lines.length > 0 ? 2_000 : 10_000,
    table: { label: '7' },
    ordering: { state: 'on' },
    location: {
      state: location,
      passSeconds: location === 'held' ? 7_000 : null,
      dayEndsInSeconds: 3_600,
      venueName: 'Club',
    },
    order: location === 'needed' ? null : { lines, removed: [], earlier: null },
    sentOrders: [],
    waiterCall: null,
    bill: null,
  } satisfies GuestTableState
}

function line(id: string, qty: number): Lines[number] {
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
function harness(
  answer: (url: string, init: RequestInit) => Response | Promise<Response>,
  more: Partial<TableServicesDeps> = {},
) {
  let clock = 1_000_000
  const timers: { run: () => void; ms: number; cancelled: boolean }[] = []
  const calls: { url: string; init: RequestInit }[] = []
  const client = createTableServices({
    code: 'table-code-123',
    phone: PHONE,
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
    ...more,
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
        pass: null,
        handle: null,
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
        pass: null,
        handle: null,
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

  it('shows the table’s waiter call as a request, and sends the face’s request as it is', async () => {
    const callId = newId('wc')
    const call = (state: 'open' | 'done' | 'lapsed') => ({
      ...tableState(2),
      waiterCall: { id: callId, state, calledAgoSeconds: 4 },
    })
    let answered: unknown = tableState(1)
    const h = harness((url) =>
      url.endsWith('/actions')
        ? json(200, {
            result: {
              actionId: crypto.randomUUID(),
              status: 'accepted',
              code: null,
              subjectId: null,
              ref: null,
            },
            state: call('open'),
            pass: null,
            handle: null,
          })
        : json(200, answered),
    )
    h.client.start()
    await h.tick()
    expect(h.client.getState().requests).toEqual([])
    const actionId = crypto.randomUUID()
    await h.client.dispatch({ kind: 'service.request', actionId, request: 'waiter', note: '' })
    expect(JSON.parse(String(h.calls.at(-1)?.init.body)).command).toEqual({
      kind: 'service.request',
      actionId,
      request: 'waiter',
      note: '',
    })
    expect(h.client.getState().requests).toEqual([
      { id: callId, actionId: callId, kind: 'waiter', status: 'sent', note: '' },
    ])
    for (const [server, status] of [
      ['done', 'done'],
      ['lapsed', 'rejected'],
    ] as const) {
      answered = { ...call(server), version: 3 }
      await h.tick()
      expect(h.client.getState().requests).toMatchObject([{ id: callId, status }])
    }
    answered = { ...tableState(4) }
    await h.tick()
    expect(h.client.getState().requests).toEqual([])
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
        result: { actionId, status: 'rejected', code: 'order_empty', subjectId: null, ref: null },
        state: null,
        pass: null,
        handle: null,
      }),
    )
    expect(await sent).toMatchObject({ status: 'rejected', code: 'order_empty' })
  })

  it('shows "Sending…" only on the phone whose Send made the sent order (#77)', async () => {
    const sentId = newId('so')
    const sent = (state: 'sending' | 'added') => ({
      ...tableState(2),
      sentOrders: [
        {
          id: sentId,
          state,
          reason: null,
          ref: 'K7Q',
          lines: [{ itemId: ITEM, optionIds: [], qty: 2 }],
          sentAgoSeconds: 30,
        },
      ],
    })
    const answer = (url: string, init: RequestInit) =>
      url.endsWith('/actions')
        ? json(200, {
            result: {
              actionId: JSON.parse(String(init.body)).command.actionId,
              status: 'accepted',
              code: null,
              subjectId: sentId,
              ref: 'K7Q',
            },
            state: sent('sending'),
            pass: null,
            handle: null,
          })
        : json(200, sent('sending'))
    const mine = harness(answer)
    mine.client.start()
    await mine.tick()
    const result = await mine.client.dispatch({
      kind: 'order.send',
      actionId: crypto.randomUUID(),
      lines: [{ itemId: ITEM, optionIds: [], qty: 2, note: '' }],
    })
    expect(result).toMatchObject({ status: 'accepted', ref: 'K7Q', subjectId: sentId })
    expect(mine.client.getState().sentOrders).toEqual([
      {
        id: sentId,
        state: 'sending',
        reason: null,
        ref: 'K7Q',
        lines: [{ itemId: ITEM, optionIds: [], qty: 2 }],
        sentAt: 1_000_000 - 30_000,
        mine: true,
      },
    ])

    const other = harness(answer)
    other.client.start()
    await other.tick()
    expect(other.client.getState().sentOrders).toMatchObject([{ id: sentId, mine: false }])
  })
})

/** A tab's session storage in a map. */
function memory(seed: Record<string, string> = {}) {
  const kept = new Map(Object.entries(seed))
  return {
    kept,
    get: (key: string) => kept.get(key) ?? null,
    set: (key: string, value: string) => void kept.set(key, value),
    remove: (key: string) => void kept.delete(key),
  }
}

const AT_THE_BAR: GuestPosition = { lat: 42.6977, lng: 23.3219, accuracyM: 20 }

/**
 * A server where the venue checks location: a command without a position is `location_needed`;
 * with one it is accepted (and hands out `pass-1`) unless `failed`. Records each command's body.
 */
function checkingServer(failed = false) {
  const bodies: { command: GuestCommand; check?: Record<string, unknown> }[] = []
  const headers: Record<string, string>[] = []
  const answer = (url: string, init: RequestInit): Response => {
    headers.push(init.headers as Record<string, string>)
    if (!url.endsWith('/actions')) {
      const held = (init.headers as Record<string, string>)['X-Restro-Pass'] === 'pass-1'
      return json(200, tableState(1, [], held ? 'held' : 'needed'))
    }
    const body = JSON.parse(String(init.body))
    bodies.push(body)
    const result = (status: string, code: string | null) => ({
      actionId: body.command.actionId,
      status,
      code,
      subjectId: null,
      ref: null,
    })
    if (body.check?.location === undefined) {
      return json(200, {
        result: result('rejected', 'location_needed'),
        state: null,
        pass: null,
        handle: null,
      })
    }
    if (failed) {
      return json(200, {
        result: result('rejected', 'location_failed'),
        state: null,
        pass: null,
        handle: null,
      })
    }
    return json(200, {
      result: result('accepted', null),
      state: tableState(2, [], 'held'),
      pass: 'pass-1',
      handle: null,
    })
  }
  return { bodies, headers, answer }
}

describe('the services client and the location check', () => {
  it('makes a phone value of 22 base64url characters, and sends it on every command', async () => {
    expect(newPhoneValue(new Uint8Array(16).fill(255))).toBe('_____________________w')
    const server = checkingServer()
    const h = harness(server.answer, { memory: memory() })
    h.client.start()
    await h.tick()
    await h.client.dispatch(add())
    expect(server.headers.at(-1)).toMatchObject({ 'X-Restro-Phone': PHONE })
    expect(server.headers[0]).not.toHaveProperty('X-Restro-Phone')
  })

  it('asks for consent the first time, then sends the kept edit with the position', async () => {
    const server = checkingServer()
    const kept = memory()
    const located: string[] = []
    const h = harness(server.answer, {
      memory: kept,
      locate: async () => {
        located.push('asked')
        return AT_THE_BAR
      },
    })
    h.client.start()
    await h.tick()
    expect(h.client.getState().location).toEqual({
      state: 'needed',
      prompt: 'none',
      consent: 'unknown',
      venueName: 'Club',
    })
    const command = add()
    expect(await h.client.dispatch(command)).toMatchObject({ code: 'location_needed' })
    expect(located).toEqual([])
    expect(h.client.getState().location?.prompt).toBe('consent')

    const allowed = await h.client.location.allow()
    expect(allowed).toMatchObject({ status: 'accepted', actionId: command.actionId })
    expect(server.bodies.at(-1)).toMatchObject({
      command: { actionId: command.actionId },
      check: { location: AT_THE_BAR, consentVersion: LOCATION_CONSENT_VERSION },
    })
    expect(h.client.getState().location).toMatchObject({
      state: 'held',
      prompt: 'none',
      consent: 'allowed',
    })
    expect(kept.kept.get(PASS_KEY)).toBe('pass-1')
    expect(kept.kept.get(CONSENT_KEY)).toMatch(/^allowed:v1:\d+$/)
    // The pass goes back on the next poll, never in the address.
    await h.tick()
    expect(server.headers.at(-1)).toMatchObject({ 'X-Restro-Pass': 'pass-1' })
    expect(h.calls.at(-1)?.url).not.toContain('pass')
  })

  it('locates without asking once the guest allowed it today', async () => {
    const server = checkingServer()
    const dayEnds = 1_000_000 + 3_600_000
    const h = harness(server.answer, {
      memory: memory({ [CONSENT_KEY]: `allowed:${LOCATION_CONSENT_VERSION}:${dayEnds}` }),
      locate: async () => AT_THE_BAR,
    })
    h.client.start()
    await h.tick()
    expect(await h.client.dispatch(add())).toMatchObject({ status: 'accepted' })
    expect(server.bodies).toHaveLength(2)
  })

  it('asks again for consent to an older text, or after the service day ended', async () => {
    for (const seed of [`allowed:v0:${2_000_000}`, `allowed:${LOCATION_CONSENT_VERSION}:999999`]) {
      const h = harness(checkingServer().answer, { memory: memory({ [CONSENT_KEY]: seed }) })
      h.client.start()
      await h.tick()
      await h.client.dispatch(add())
      expect(h.client.getState().location).toMatchObject({ prompt: 'consent', consent: 'unknown' })
    }
  })

  it('offers the failed check when the phone gives no position or is elsewhere, and Cancel', async () => {
    for (const [failed, locate] of [
      [false, async () => null],
      [true, async () => AT_THE_BAR],
    ] as const) {
      const h = harness(checkingServer(failed).answer, { memory: memory(), locate })
      h.client.start()
      await h.tick()
      await h.client.dispatch(add())
      expect(await h.client.location.allow()).toMatchObject({ code: 'location_failed' })
      expect(h.client.getState().location?.prompt).toBe('failed')
      h.client.location.dismiss()
      expect(h.client.getState().location?.prompt).toBe('none')
    }
  })

  it('remembers "Not now" for the day, and asks again only on the guest’s own tap', async () => {
    const kept = memory()
    const h = harness(checkingServer().answer, { memory: kept, locate: async () => AT_THE_BAR })
    h.client.start()
    await h.tick()
    await h.client.dispatch(add())
    h.client.location.decline()
    expect(h.client.getState().location).toMatchObject({ prompt: 'none', consent: 'declined' })
    expect(await h.client.dispatch(add())).toMatchObject({ code: 'location_needed' })
    expect(h.client.getState().location?.prompt).toBe('none')
    h.client.location.reopen()
    expect(h.client.getState().location?.prompt).toBe('consent')
    // Nothing waits: "Allow" gets the pass with the phone's own check.
    expect(await h.client.location.allow()).toBeNull()
    expect(kept.kept.get(PASS_KEY)).toBe('pass-1')
  })

  it('drops a kept pass the server no longer holds', async () => {
    const kept = memory({ [PASS_KEY]: 'pass-old' })
    const h = harness(() => json(200, tableState(1, [], 'needed')), { memory: kept })
    h.client.start()
    await h.tick()
    expect(h.calls[0]?.init.headers).toMatchObject({ 'X-Restro-Pass': 'pass-old' })
    expect(kept.kept.has(PASS_KEY)).toBe(false)
  })

  it('asks for the whole state when an unchanged answer’s location differs', async () => {
    let n = 0
    const h = harness(() => {
      n += 1
      return n === 1
        ? json(200, tableState(4, [], 'held'))
        : json(200, { unchanged: true, version: 4, next: 10_000, location: 'needed' })
    })
    h.client.start()
    await h.tick()
    await h.tick()
    expect(h.calls[1]?.url).toContain('since=4')
    expect(h.nextWait()).toBe(0)
    await h.tick()
    expect(h.calls[2]?.url).toBe('/api/guest/state?view=menu')
  })

  it('sends Turnstile’s token with a Send', async () => {
    const h = harness(
      (url, init) =>
        url.endsWith('/actions')
          ? json(200, {
              result: {
                actionId: JSON.parse(String(init.body)).command.actionId,
                status: 'rejected',
                code: 'human_check',
                subjectId: null,
                ref: null,
              },
              state: null,
              pass: null,
              handle: null,
            })
          : json(200, tableState(1)),
      { humanToken: async () => 'token-1' },
    )
    h.client.start()
    await h.tick()
    await h.client.dispatch({ kind: 'order.send', actionId: crypto.randomUUID(), lines: [] })
    expect(JSON.parse(String(h.calls.at(-1)?.init.body))).toMatchObject({
      check: { humanToken: 'token-1' },
    })
  })
})
