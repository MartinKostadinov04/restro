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
  LOCATION_BLOCKED,
  locateWith,
  newPhoneValue,
  OFFLINE_AFTER_MS,
  PASS_KEY,
  PAY_HANDLE_KEY,
  PAY_RECENT_KEY,
  PAY_RETURNED_KEY,
  POLL_BACKOFF_MS,
  payEmailKey,
  payHandleKey,
  payRecentKey,
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
    ordering: {
      state: 'on',
      notesAndOptions: false,
      payFirst: 'off',
      paying: 'off',
      payingProvider: null,
      payingLegal: null,
      minCardMinor: 50,
      tips: false,
      receiptEmail: false,
      night: { state: 'open', at: null },
    },
    location: {
      state: location,
      passSeconds: location === 'held' ? 7_000 : null,
      dayEndsInSeconds: 3_600,
      venueName: 'Club',
      privacyUrl: 'https://club.example/privacy',
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
  const timers: { run: () => void; ms: number; cancelled: boolean; guard: boolean; at: number }[] =
    []
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
    setTimer(run, ms, kind) {
      const timer = { run, ms, cancelled: false, guard: kind === 'guard', at: clock + ms }
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
    /** The wait of the poll timer due next (the guards, a request's timeout and the offline watch, are no polls). */
    nextWait: () => timers.filter((timer) => !timer.cancelled && !timer.guard).at(-1)?.ms,
    /** Lets `ms` pass and runs the guard timers that come due, in order. */
    async elapse(ms: number) {
      const until = clock + ms
      for (;;) {
        const due = timers
          .filter((t) => !t.cancelled && t.guard && t.at <= until)
          .sort((a, b) => a.at - b.at)[0]
        if (due === undefined) break
        clock = Math.max(clock, due.at)
        due.cancelled = true
        due.run()
        await new Promise((resolve) => setTimeout(resolve, 0))
      }
      clock = until
    },
    /** Runs the live timer and lets its fetch settle. */
    async tick() {
      const timer = timers.filter((t) => !t.cancelled && !t.guard).at(-1)
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
    expect(h.client.getState().ordering).toEqual({
      state: 'on',
      notesAndOptions: false,
      payFirst: 'off',
      tips: false,
      night: { state: 'open', at: null },
    })
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
      waiterCall: { id: callId, state, kinds: ['waiter'] as const, calledAgoSeconds: 4 },
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
      { id: `${callId}:waiter`, actionId: callId, kind: 'waiter', status: 'sent', note: '' },
    ])
    for (const [server, status] of [
      ['done', 'done'],
      ['lapsed', 'rejected'],
    ] as const) {
      answered = { ...call(server), version: 3 }
      await h.tick()
      expect(h.client.getState().requests).toMatchObject([{ id: `${callId}:waiter`, status }])
    }
    answered = { ...tableState(4) }
    await h.tick()
    expect(h.client.getState().requests).toEqual([])
  })

  it('shows one request per kind of the table’s one waiter call (#180)', async () => {
    const callId = newId('wc')
    const h = harness(() =>
      json(200, {
        ...tableState(2),
        waiterCall: { id: callId, state: 'open', kinds: ['ice', 'water'], calledAgoSeconds: 4 },
      }),
    )
    h.client.start()
    await h.tick()
    expect(h.client.getState().requests).toEqual([
      { id: `${callId}:ice`, actionId: callId, kind: 'ice', status: 'sent', note: '' },
      { id: `${callId}:water`, actionId: callId, kind: 'water', status: 'sent', note: '' },
    ])
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
    // Closed for good, and the face can say why: the code is no longer in use (D121, RR-58).
    expect(h.client.getState().ordering).toEqual({ state: 'closed', retired: true })
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
          sentClock: '19:42',
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
        sentClock: '19:42',
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
      privacyUrl: 'https://club.example/privacy',
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
    expect(kept.kept.get(`${CONSENT_KEY}:Club`)).toMatch(/^allowed:v1:\d+$/)
    // The pass goes back on the next poll, never in the address.
    await h.tick()
    expect(server.headers.at(-1)).toMatchObject({ 'X-Restro-Pass': 'pass-1' })
    expect(h.calls.at(-1)?.url).not.toContain('pass')
  })

  it('locates without asking once the guest allowed it today', async () => {
    const server = checkingServer()
    const dayEnds = 1_000_000 + 3_600_000
    const h = harness(server.answer, {
      memory: memory({ [`${CONSENT_KEY}:Club`]: `allowed:${LOCATION_CONSENT_VERSION}:${dayEnds}` }),
      locate: async () => AT_THE_BAR,
    })
    h.client.start()
    await h.tick()
    expect(await h.client.dispatch(add())).toMatchObject({ status: 'accepted' })
    expect(server.bodies).toHaveLength(2)
  })

  it('asks again for consent to an older text, or after the service day ended', async () => {
    for (const seed of [`allowed:v0:${2_000_000}`, `allowed:${LOCATION_CONSENT_VERSION}:999999`]) {
      const h = harness(checkingServer().answer, {
        memory: memory({ [`${CONSENT_KEY}:Club`]: seed }),
      })
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

  describe('the answer lasts per phone per service day (RR-58, D119)', () => {
    const allowedToday = `allowed:${LOCATION_CONSENT_VERSION}:${1_000_000 + 3_600_000}`

    it('is not asked again in a new tab, whose pass starts empty', async () => {
      const durable = memory()
      const first = harness(checkingServer().answer, {
        memory: memory(),
        durable,
        locate: async () => AT_THE_BAR,
      })
      first.client.start()
      await first.tick()
      await first.client.dispatch(add())
      await first.client.location.allow()
      expect(durable.kept.get(`${CONSENT_KEY}:Club`)).toMatch(/^allowed:/)
      // The pass stays the tab's; only the answer outlives it.
      expect(durable.kept.has(PASS_KEY)).toBe(false)

      const server = checkingServer()
      const tab = harness(server.answer, {
        memory: memory(),
        durable,
        locate: async () => AT_THE_BAR,
      })
      tab.client.start()
      await tab.tick()
      expect(tab.client.getState().location).toMatchObject({ prompt: 'none', consent: 'allowed' })
      expect(await tab.client.dispatch(add())).toMatchObject({ status: 'accepted' })
      expect(tab.client.getState().location?.prompt).toBe('none')
    })

    it('keeps "Not now" for the new tab too', async () => {
      const durable = memory()
      const first = harness(checkingServer().answer, { memory: memory(), durable })
      first.client.start()
      await first.tick()
      await first.client.dispatch(add())
      first.client.location.decline()
      const tab = harness(checkingServer().answer, { memory: memory(), durable })
      tab.client.start()
      await tab.tick()
      expect(await tab.client.dispatch(add())).toMatchObject({ code: 'location_needed' })
      expect(tab.client.getState().location).toMatchObject({ prompt: 'none', consent: 'declined' })
    })

    it('never carries one venue’s answer to another: the consent names the venue', async () => {
      const durable = memory({ [`${CONSENT_KEY}:Another club`]: allowedToday })
      const h = harness(checkingServer().answer, { memory: memory(), durable })
      h.client.start()
      await h.tick()
      await h.client.dispatch(add())
      expect(h.client.getState().location).toMatchObject({ prompt: 'consent', consent: 'unknown' })
    })

    it('forgets the answer once the service day has ended', async () => {
      const key = `${CONSENT_KEY}:Club`
      const durable = memory({ [key]: `allowed:${LOCATION_CONSENT_VERSION}:999999` })
      const h = harness(checkingServer().answer, { memory: memory(), durable })
      h.client.start()
      await h.tick()
      expect(h.client.getState().location?.consent).toBe('unknown')
      expect(durable.kept.has(key)).toBe(false)
    })

    it('counts a browser that blocks location as a refusal, and only the guest’s tap asks again', async () => {
      const asked: string[] = []
      const durable = memory()
      const h = harness(checkingServer().answer, {
        memory: memory(),
        durable,
        locate: async () => {
          asked.push('browser')
          return LOCATION_BLOCKED
        },
      })
      h.client.start()
      await h.tick()
      await h.client.dispatch(add())
      expect(await h.client.location.allow()).toMatchObject({ code: 'location_failed' })
      expect(asked).toHaveLength(1)
      // The failed screen this once, with the refusal remembered.
      expect(h.client.getState().location).toMatchObject({ prompt: 'failed', consent: 'declined' })
      h.client.location.dismiss()

      // A later edit doesn't ask the browser, nor the guest; nor does a new tab.
      expect(await h.client.dispatch(add())).toMatchObject({ code: 'location_needed' })
      expect(asked).toHaveLength(1)
      expect(h.client.getState().location?.prompt).toBe('none')
      const tab = harness(checkingServer().answer, {
        memory: memory(),
        durable,
        locate: async () => {
          asked.push('browser')
          return LOCATION_BLOCKED
        },
      })
      tab.client.start()
      await tab.tick()
      expect(await tab.client.dispatch(add())).toMatchObject({ code: 'location_needed' })
      expect(asked).toHaveLength(1)

      // The guest's own "Allow location" tap does ask, and is refused again.
      h.client.location.reopen()
      await h.client.location.allow()
      expect(asked).toHaveLength(2)
      expect(h.client.getState().location).toMatchObject({ prompt: 'failed', consent: 'declined' })
    })

    it('doesn’t take a slow or missing fix for a refusal: the next edit tries again', async () => {
      const asked: string[] = []
      const durable = memory({ [`${CONSENT_KEY}:Club`]: allowedToday })
      const h = harness(checkingServer().answer, {
        memory: memory(),
        durable,
        locate: async () => {
          asked.push('browser')
          return null
        },
      })
      h.client.start()
      await h.tick()
      expect(await h.client.dispatch(add())).toMatchObject({ code: 'location_failed' })
      expect(h.client.getState().location).toMatchObject({ prompt: 'failed', consent: 'allowed' })
      h.client.location.dismiss()
      await h.client.dispatch(add())
      expect(asked).toHaveLength(2)
    })

    it('reads the browser’s answer: denied or no API is blocked, anything else says nothing', async () => {
      const denied = { code: 1, PERMISSION_DENIED: 1 } as GeolocationPositionError
      const timedOut = { code: 3, PERMISSION_DENIED: 1 } as GeolocationPositionError
      const failing = (error: GeolocationPositionError) => ({
        getCurrentPosition: (_ok: PositionCallback, fail?: PositionErrorCallback | null) =>
          fail?.(error),
      })
      expect(await locateWith(undefined)).toBe(LOCATION_BLOCKED)
      expect(await locateWith(failing(denied))).toBe(LOCATION_BLOCKED)
      expect(await locateWith(failing(timedOut))).toBeNull()
      const coords = { latitude: 42.6977, longitude: 23.3219, accuracy: 20 }
      const found = {
        getCurrentPosition: (ok: PositionCallback) => ok({ coords } as GeolocationPosition),
      }
      expect(await locateWith(found)).toEqual(AT_THE_BAR)
    })
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
        : json(200, {
            unchanged: true,
            version: 4,
            next: 10_000,
            location: 'needed',
            night: 'open',
          })
    })
    h.client.start()
    await h.tick()
    await h.tick()
    expect(h.calls[1]?.url).toContain('since=4')
    expect(h.nextWait()).toBe(0)
    await h.tick()
    expect(h.calls[2]?.url).toBe('/api/guest/state?view=menu')
  })

  it('asks for the whole state when an unchanged answer’s night differs (#82)', async () => {
    let n = 0
    const h = harness(() => {
      n += 1
      return n === 1
        ? json(200, tableState(4))
        : json(200, {
            unchanged: true,
            version: 4,
            next: 10_000,
            location: 'off',
            night: 'last_orders',
          })
    })
    h.client.start()
    await h.tick()
    await h.tick()
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

describe('paying (#110, #114, D127)', () => {
  it('RR-2: a poll with a higher version moves the phone to the paused state and the new details', async () => {
    const legal = {
      name: 'Nova Club EOOD',
      eik: '123456789',
      address: 'Sofia, 1 Vitosha Blvd',
      privacyUrl: 'https://club.example/privacy',
    }
    const before = tableState(5)
    before.ordering = {
      ...before.ordering,
      paying: 'on',
      payingProvider: 'stripe',
      payingLegal: legal,
    } as never
    const after = tableState(6)
    after.ordering = {
      ...after.ordering,
      paying: 'paused',
      payingProvider: 'stripe',
      payingLegal: { ...legal, name: 'Nova Club 2 EOOD' },
    } as never
    let answer: unknown = before
    const h = harness(() => json(200, answer))
    h.client.start()
    await h.tick()
    expect(h.client.getState().paying?.state).toBe('on')

    answer = after
    await h.tick()
    expect(h.client.getState().paying?.state).toBe('paused')
    expect(h.client.getState().paying?.legal?.name).toBe('Nova Club 2 EOOD')

    // An "unchanged" for that version leaves what the phone has.
    answer = { unchanged: true, version: 6, next: 10_000 }
    await h.tick()
    expect(h.client.getState().paying?.state).toBe('paused')
  })

  const BN = `bn_${'0'.repeat(21)}1` as const
  const PY = newId('py')
  const HANDLE = 'AbCdEfGhIjKlMnOpQrStUv'

  /** A table state with a bill, paying on and the provider named. */
  const payingTable = (version = 1) => ({
    ...tableState(version),
    ordering: {
      ...tableState(version).ordering,
      paying: 'on' as const,
      payingProvider: 'stripe',
      payingLegal: {
        name: 'Nova Club EOOD',
        eik: '123456789',
        address: 'Sofia, 1 Vitosha Blvd',
        privacyUrl: 'https://club.example/privacy',
      },
      tips: true,
    },
    bill: {
      readAgoSeconds: 3,
      complete: true,
      currency: 'EUR',
      totalMinor: 2250,
      paidMinor: 0,
      owedMinor: 2250,
      parts: [
        {
          id: 'bill-1',
          beingPaid: false,
          totalMinor: 2250,
          paidMinor: 0,
          lines: [
            {
              id: BN,
              name: { en_US: 'House wine' },
              quantity: '1',
              amountMinor: 2250,
              beingPaid: true,
            },
          ],
        },
      ],
      paidLines: [],
    },
  })

  const payment = (changes: Record<string, unknown> = {}) => ({
    id: PY,
    mode: 'bill',
    number: 'K7Q4M',
    state: 'awaiting_guest',
    reason: null,
    currency: 'EUR',
    amountMinor: 2250,
    tipMinor: 0,
    lines: [{ name: { en_US: 'House wine' }, quantity: '1', amountMinor: 2250 }],
    paidAt: null,
    receiptEmailed: null,
    timeZone: 'Europe/Sofia',
    form: {
      provider: 'stripe',
      values: { clientSecret: 'pi_x_secret_y', account: 'acct_1A' },
      confirmSeconds: 120,
    },
    next: 2_000,
    ...changes,
  })

  const start = (actionId = crypto.randomUUID()): GuestCommand => ({
    kind: 'pay.start',
    actionId,
    pick: { kind: 'lines', lines: [{ lineId: BN, quantity: '1' }] },
    seen: [{ lineId: BN, quantity: '1', amountMinor: 2250 }],
    tipMinor: null,
    tipPercent: 10,
  })

  const CODE = 'table-code-123'
  /** The browser's local storage, holding this table's handle until the day ends. */
  function local(handle: string, until = 1_000_000 + 3_600_000) {
    return memory({ [payHandleKey(CODE)]: `${handle}|${until}` })
  }

  /** A tab's session storage. */
  function memory(initial: Record<string, string> = {}) {
    const store = new Map(Object.entries(initial))
    return {
      store,
      get: (key: string) => store.get(key) ?? null,
      set: (key: string, value: string) => void store.set(key, value),
      remove: (key: string) => void store.delete(key),
    }
  }

  /** A server that has a table with a bill and, once told, a payment. */
  function server(over: { payment?: () => Response } = {}) {
    return (url: string, init: RequestInit) => {
      if (url.endsWith('/actions')) {
        const { command } = JSON.parse(String(init.body))
        return json(200, {
          result: {
            actionId: command.actionId,
            status: 'accepted',
            code: null,
            subjectId: null,
            ref: null,
          },
          state: payingTable(2),
          pass: null,
          // The server gives a handle to a Pay and to a Send with pay-first lines (#113).
          handle:
            command.kind === 'pay.start' ||
            (command.kind === 'order.send' && command.payFirst !== undefined)
              ? HANDLE
              : null,
        })
      }
      if (url.endsWith('/payment')) return over.payment?.() ?? json(200, payment())
      return json(200, payingTable(1))
    }
  }

  const headerOf = (init: RequestInit | undefined, name: string) =>
    (init?.headers as Record<string, string> | undefined)?.[name]

  it('draws the table’s bill, the greyed line and paying with who processes it', async () => {
    const h = harness(server())
    h.client.start()
    await h.tick()
    const state = h.client.getState()
    expect(state.paying).toEqual({
      state: 'on',
      minCardMinor: 50,
      processor: 'Stripe',
      venueName: 'Club',
      legal: {
        name: 'Nova Club EOOD',
        eik: '123456789',
        address: 'Sofia, 1 Vitosha Blvd',
        privacyUrl: 'https://club.example/privacy',
      },
      electronicReceipt: false,
      recent: null,
    })
    expect(state.tableBill).toMatchObject({
      owedMinor: 2250,
      currency: 'EUR',
      parts: [{ lines: [{ id: BN, amountMinor: 2250, beingPaid: true }] }],
    })
    expect(state.payment).toBeNull()
  })

  it('asks Turnstile for the pay action, keeps the handle in the tab and reads the payment with it', async () => {
    const actions: string[] = []
    const mem = memory()
    const session = memory()
    const h = harness(server(), {
      memory: session,
      durable: mem,
      humanToken: async (action) => {
        actions.push(action)
        return 'token'
      },
    })
    h.client.start()
    await h.tick()
    const result = await h.client.dispatch(start())
    expect(result).toMatchObject({ status: 'accepted' })
    expect(actions).toEqual(['pay_start'])
    const post = h.calls.find((call) => call.url.endsWith('/actions'))
    expect(JSON.parse(String(post?.init.body)).check.humanToken).toBe('token')
    // The handle is the tab's, never in an address or a body.
    expect(mem.store.get(payHandleKey(CODE))?.startsWith(`${HANDLE}|`)).toBe(true)
    // Not in the tab's session storage: it outlives the tab for the sitting (D127 log 2.2).
    expect(session.store.has(payHandleKey(CODE))).toBe(false)
    expect(session.store.has(PAY_HANDLE_KEY)).toBe(false)
    expect(h.calls.every((call) => !call.url.includes(HANDLE))).toBe(true)
    expect(String(post?.init.body)).not.toContain(HANDLE)
    await h.tick()
    const read = h.calls.findLast((call) => call.url.endsWith('/payment'))
    expect(headerOf(read?.init, 'X-Restro-Payment')).toBe(HANDLE)
    expect(h.client.getState().payment).toMatchObject({
      number: 'K7Q4M',
      state: 'awaiting_guest',
      form: { confirmSeconds: 120 },
    })
    // The face never sees the provider's values; the page asks for them.
    expect(JSON.stringify(h.client.getState())).not.toContain('pi_x_secret_y')
    expect(h.client.formValues()).toEqual({
      provider: 'stripe',
      values: { clientSecret: 'pi_x_secret_y', account: 'acct_1A' },
    })
  })

  describe('a Send with pay-first lines (#258, D113)', () => {
    const line = { itemId: newId('nd'), optionIds: [], qty: 1, note: '' }
    const send = (payFirst?: {
      tipMinor: number | null
      tipPercent: number | null
    }): GuestCommand => ({
      kind: 'order.send',
      actionId: crypto.randomUUID(),
      lines: payFirst === undefined ? [line] : [],
      ...(payFirst === undefined ? {} : { payFirst: { lines: [line], ...payFirst } }),
    })

    it('keeps the payment handle the Send’s answer gives and reads the payment with it, under the Send’s Turnstile token', async () => {
      const actions: string[] = []
      const mem = memory()
      const h = harness(server(), {
        durable: mem,
        humanToken: async (action) => {
          actions.push(action)
          return 'token'
        },
      })
      h.client.start()
      await h.tick()
      const result = await h.client.dispatch(send({ tipMinor: null, tipPercent: 10 }))
      expect(result).toMatchObject({ status: 'accepted' })
      // One token for the one request: the Send's own action, the host checks it as a Send.
      expect(actions).toEqual(['order_send'])
      expect(mem.store.get(payHandleKey(CODE))?.startsWith(`${HANDLE}|`)).toBe(true)
      const post = h.calls.find((call) => call.url.endsWith('/actions'))
      expect(JSON.parse(String(post?.init.body)).command.payFirst).toMatchObject({ tipPercent: 10 })
      expect(String(post?.init.body)).not.toContain(HANDLE)
      expect(h.calls.every((call) => !call.url.includes(HANDLE))).toBe(true)
      await h.tick()
      const read = h.calls.findLast((call) => call.url.endsWith('/payment'))
      expect(headerOf(read?.init, 'X-Restro-Payment')).toBe(HANDLE)
      expect(h.client.getState().payment).toMatchObject({ state: 'awaiting_guest' })
      expect(h.client.formValues()).toMatchObject({ provider: 'stripe' })
    })

    it('keeps no handle for a Send of bill lines alone, and no receipt address for a pay-first one', async () => {
      const mem = memory()
      const h = harness(server(), { durable: mem })
      h.client.start()
      await h.tick()
      await h.client.dispatch(send())
      expect(mem.store.has(payHandleKey(CODE))).toBe(false)
      await h.client.dispatch(send({ tipMinor: 250, tipPercent: null }))
      expect(mem.store.get(payHandleKey(CODE))?.startsWith(`${HANDLE}|`)).toBe(true)
      expect(mem.store.has(payEmailKey(CODE))).toBe(false)
    })
  })

  it('keeps the address given for the venue’s electronic receipt with the handle, names it on the paid screen, and forgets it with the handle (#186)', async () => {
    const mem = memory()
    const paid = payment({
      state: 'captured',
      form: null,
      receiptEmailed: 'sent',
      paidAt: '2026-10-29T19:42:00.000Z',
    })
    const h = harness(server({ payment: () => json(200, paid) }), {
      memory: memory(),
      durable: mem,
    })
    h.client.start()
    await h.tick()
    const result = await h.client.dispatch({
      ...(start() as Extract<GuestCommand, { kind: 'pay.start' }>),
      receiptEmail: 'ana@example.com',
    })
    expect(result).toMatchObject({ status: 'accepted' })
    // The address went to the server in the command, once; here it waits for the Paid screen.
    expect(mem.store.get(payEmailKey(CODE))).toBe('ana@example.com')
    await h.tick()
    expect(h.client.getState().payment).toMatchObject({
      state: 'captured',
      receiptEmailed: 'sent',
      receiptEmail: 'ana@example.com',
    })
    // The payment's reads never carry the address back to the server.
    for (const call of h.calls.filter((c) => c.url.endsWith('/payment'))) {
      expect(String(call.init.body ?? '')).not.toContain('ana@example.com')
      expect(call.url).not.toContain('ana@example.com')
    }
    // Forgetting the payment forgets the address with it.
    h.client.dismissPayment()
    expect(mem.store.has(payHandleKey(CODE))).toBe(false)
    expect(mem.store.has(payEmailKey(CODE))).toBe(false)
  })

  it('forgets an address whose handle expired or never held, at startup (#186)', () => {
    const mem = memory({
      [payHandleKey(CODE)]: `${HANDLE}|${1_000_000 - 1}`,
      [payEmailKey(CODE)]: 'ana@example.com',
    })
    harness(server(), { memory: memory(), durable: mem })
    expect(mem.store.has(payHandleKey(CODE))).toBe(false)
    expect(mem.store.has(payEmailKey(CODE))).toBe(false)
    const none = memory({ [payEmailKey(CODE)]: 'bo@example.com' })
    harness(server(), { memory: memory(), durable: none })
    expect(none.store.has(payEmailKey(CODE))).toBe(false)
    // A live handle keeps its address.
    const live = memory({
      [payHandleKey(CODE)]: `${HANDLE}|${1_000_000 + 3_600_000}`,
      [payEmailKey(CODE)]: 'cy@example.com',
    })
    harness(server(), { memory: memory(), durable: live })
    expect(live.store.get(payEmailKey(CODE))).toBe('cy@example.com')
  })

  it('pays without an address: nothing is kept, and a page reloaded finds the payment with none', async () => {
    const mem = memory()
    const h = harness(server(), { memory: memory(), durable: mem })
    h.client.start()
    await h.tick()
    await h.client.dispatch(start())
    expect(mem.store.has(payEmailKey(CODE))).toBe(false)
    await h.tick()
    expect(h.client.getState().payment).toMatchObject({ receiptEmail: null })
  })

  it('sends pay.returned and pay.cancel with the handle, and rejects them locally without one', async () => {
    const h = harness(server(), { memory: memory() })
    h.client.start()
    await h.tick()
    const before = h.calls.length
    const none = await h.client.dispatch({ kind: 'pay.cancel', actionId: crypto.randomUUID() })
    expect(none).toMatchObject({ status: 'rejected', code: 'unknown_payment' })
    expect(h.calls).toHaveLength(before)
    await h.client.dispatch(start())
    await h.client.dispatch({ kind: 'pay.returned', actionId: crypto.randomUUID() })
    const returned = h.calls.findLast((call) => call.url.endsWith('/actions'))
    expect(headerOf(returned?.init, 'X-Restro-Payment')).toBe(HANDLE)
    expect(JSON.parse(String(returned?.init.body)).command.kind).toBe('pay.returned')
    const first = h.calls.find((call) => call.url.endsWith('/actions'))
    expect(headerOf(first?.init, 'X-Restro-Payment')).toBeUndefined()
  })

  it('polls the payment until it is final, then stops', async () => {
    const answers = [
      payment(),
      payment({ state: 'held', form: null }),
      payment({ state: 'captured', form: null }),
    ]
    const h = harness(
      server({
        payment: () => json(200, answers.shift() ?? payment({ state: 'captured', form: null })),
      }),
      { memory: memory() },
    )
    h.client.start()
    await h.tick()
    await h.client.dispatch(start())
    await h.tick()
    expect(h.client.getState().payment?.state).toBe('awaiting_guest')
    await h.tick()
    expect(h.client.getState().payment).toMatchObject({ state: 'held', form: null })
    expect(h.client.formValues()).toBeNull()
    await h.tick()
    expect(h.client.getState().payment?.state).toBe('captured')
    const reads = h.calls.filter((call) => call.url.endsWith('/payment')).length
    // Final: the next live timer is the table's poll, not the payment's.
    await h.tick()
    expect(h.calls.filter((call) => call.url.endsWith('/payment')).length).toBe(reads)
  })

  it('comes back to where the payment stands after a reload, and forgets one the server does not know', async () => {
    const mem = local(HANDLE)
    const h = harness(
      server({ payment: () => json(200, payment({ state: 'captured', form: null })) }),
      { durable: mem },
    )
    h.client.start()
    await h.tick()
    await h.tick()
    expect(h.client.getState().payment).toMatchObject({ state: 'captured' })

    const gone = harness(server({ payment: () => json(404, { code: 'unknown_payment' }) }), {
      durable: mem,
    })
    gone.client.start()
    await gone.tick()
    await gone.tick()
    expect(gone.client.getState().payment).toBeNull()
    expect(mem.store.has(payHandleKey(CODE))).toBe(false)
  })

  it('sends pay.returned once after a redirect brought the guest back, then forgets the marker', async () => {
    const mem = memory({ [PAY_RETURNED_KEY]: '1' })
    const h = harness(server(), { memory: mem, durable: local(HANDLE) })
    h.client.start()
    await h.tick()
    await new Promise((resolve) => setTimeout(resolve, 0))
    const returned = h.calls.filter(
      (call) =>
        call.url.endsWith('/actions') &&
        JSON.parse(String(call.init.body)).command.kind === 'pay.returned',
    )
    expect(returned).toHaveLength(1)
    expect(mem.store.has(PAY_RETURNED_KEY)).toBe(false)
  })

  it('"Back to the bill" forgets the payment and its handle', async () => {
    const mem = local(HANDLE)
    const h = harness(
      server({ payment: () => json(200, payment({ state: 'captured', form: null })) }),
      { durable: mem },
    )
    h.client.start()
    await h.tick()
    await h.tick()
    h.client.dismissPayment()
    expect(h.client.getState().payment).toBeNull()
    expect(mem.store.has(payHandleKey(CODE))).toBe(false)
  })

  it('remembers a paid payment for the "same amount" check, and not one that only held the card', async () => {
    const mem = local(HANDLE)
    const h = harness(
      server({ payment: () => json(200, payment({ state: 'held', form: null })) }),
      { durable: mem },
    )
    h.client.start()
    await h.tick()
    await h.tick()
    expect(mem.store.has(payRecentKey(CODE))).toBe(false)
    const paid = harness(
      server({ payment: () => json(200, payment({ state: 'captured', form: null })) }),
      { durable: mem },
    )
    paid.client.start()
    await paid.tick()
    await paid.tick()
    expect(mem.store.has(payRecentKey(CODE))).toBe(true)
    h.advance(240_000)
    h.client.dismissPayment()
    await h.tick()
    expect(h.client.getState().paying?.recent).toEqual({ amountMinor: 2250, agoSeconds: 240 })
  })

  it('ignores a handle kept past the service day, and forgets it', async () => {
    const mem = local(HANDLE, 1_000_000 - 1)
    const h = harness(server(), { durable: mem })
    h.client.start()
    await h.tick()
    expect(h.calls.some((call) => call.url.endsWith('/payment'))).toBe(false)
    expect(mem.store.has(payHandleKey(CODE))).toBe(false)
  })

  it('keeps the handle until the service day ends, from the server’s own day end', async () => {
    const mem = memory()
    const h = harness(server(), { durable: mem })
    h.client.start()
    await h.tick()
    await h.client.dispatch(start())
    // tableState: dayEndsInSeconds 3_600 from the clock at 1_000_000.
    expect(mem.store.get(payHandleKey(CODE))).toBe(`${HANDLE}|${1_000_000 + 3_600_000}`)
  })

  it('reads an unconfirmed payment on, and lets "Back to the bill" go without deleting the handle', async () => {
    const answers = [
      payment({ state: 'unconfirmed', form: null }),
      payment({ state: 'unconfirmed', form: null }),
      payment({ state: 'unconfirmed', form: null }),
      payment({ state: 'captured', form: null }),
    ]
    const mem = local(HANDLE)
    const h = harness(
      server({
        payment: () => json(200, answers.shift() ?? payment({ state: 'captured', form: null })),
      }),
      { durable: mem },
    )
    h.client.start()
    await h.tick()
    await h.tick()
    expect(h.client.getState().payment?.state).toBe('unconfirmed')
    // Not final: the next read is already due, at the server's pace.
    expect(h.nextWait()).toBe(2_000)
    h.client.dismissPayment()
    expect(h.client.getState().payment).toBeNull()
    expect(mem.store.has(payHandleKey(CODE))).toBe(true)
    // Still unconfirmed on the next read: the screen stays away.
    await h.tick()
    expect(h.client.getState().payment).toBeNull()
    // The manager's answer moves it on: the paid screen comes back.
    await h.tick()
    expect(h.client.getState().payment?.state).toBe('captured')
    h.client.dismissPayment()
    expect(mem.store.has(payHandleKey(CODE))).toBe(false)
  })

  it('keeps the return marker and the location pass in the tab, not in local storage', async () => {
    const session = memory({ [PAY_RETURNED_KEY]: '1' })
    const mem = local(HANDLE)
    const h = harness(server(), { memory: session, durable: mem })
    h.client.start()
    await h.tick()
    expect(session.store.has(PAY_RETURNED_KEY)).toBe(false)
    expect(mem.store.has(PAY_RETURNED_KEY)).toBe(false)
    expect(mem.store.has(PAY_RECENT_KEY)).toBe(false)
  })
})

describe('a stalled connection (RR-51, D121)', () => {
  const never = () => new Promise<Response>(() => {})
  const send = (actionId = crypto.randomUUID()): GuestCommand => ({
    kind: 'order.send',
    actionId,
    lines: [{ itemId: ITEM, optionIds: [], qty: 1, note: '' }],
  })
  const pay = (): GuestCommand => ({
    kind: 'pay.start',
    actionId: crypto.randomUUID(),
    pick: { kind: 'whole' },
    seen: [{ lineId: `bn_${'0'.repeat(21)}1`, quantity: '1', amountMinor: 100 }],
    tipMinor: null,
    tipPercent: null,
  })

  it('aborts a request that never settles at about 10 s and says offline at once', async () => {
    const signals: (AbortSignal | null | undefined)[] = []
    const h = harness((_url, init) => {
      signals.push(init.signal)
      return never()
    })
    h.client.start()
    await h.tick()
    expect(h.client.getState().offline).not.toBe(true)
    await h.elapse(OFFLINE_AFTER_MS + 1)
    expect(h.client.getState().offline).toBe(true)
    expect(signals[0]?.aborted).toBe(true)
    // It keeps trying, quietly: the next poll waits the back-off and goes out.
    expect(h.nextWait()).toBe(POLL_BACKOFF_MS[0])
    await h.tick()
    expect(h.calls).toHaveLength(2)
  })

  it('says offline when nothing settles and no request ends (the watch, not a request, turns it on)', async () => {
    // A server that answered once, then every later request stalls and ignores the abort.
    let answered = false
    const h = harness(() => {
      if (answered) return never()
      answered = true
      return json(200, tableState(1))
    })
    h.client.start()
    await h.tick()
    expect(h.client.getState().offline).toBe(false)
    // The next poll goes out at the server's cadence and then stalls.
    await h.elapse(10_000)
    expect(h.client.getState().offline).toBe(false)
    await h.tick()
    await h.elapse(OFFLINE_AFTER_MS - 1)
    expect(h.client.getState().offline).toBe(false)
    await h.elapse(2)
    expect(h.client.getState().offline).toBe(true)
  })

  it('never says offline to a healthy phone on the 10 s cadence, however its requests wait', async () => {
    const waiting: ((response: Response) => void)[] = []
    const h = harness(
      () =>
        new Promise<Response>((resolve) => {
          waiting.push(resolve)
        }),
    )
    h.client.start()
    await h.tick()
    waiting.shift()?.(json(200, tableState(1)))
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(h.nextWait()).toBe(10_000)
    for (let n = 0; n < 4; n += 1) {
      // The idle gap before the next poll is no silence: nothing is outstanding.
      await h.elapse(10_000)
      expect(h.client.getState().offline).toBe(false)
      await h.tick()
      // The request is out for a moment, across the old 10 001 ms mark.
      await h.elapse(1)
      expect(h.client.getState().offline).toBe(false)
      await h.elapse(300)
      expect(h.client.getState().offline).toBe(false)
      waiting.shift()?.(json(200, tableState(2 + n)))
      await new Promise((resolve) => setTimeout(resolve, 0))
      expect(h.client.getState().offline).toBe(false)
    }
    // And a request that stalls from here on does turn it on.
    await h.elapse(10_000)
    await h.tick()
    await h.elapse(OFFLINE_AFTER_MS + 1)
    expect(h.client.getState().offline).toBe(true)
  })

  it('refuses Send and Pay while offline and queues nothing, and clears when a request answers', async () => {
    let up = false
    const h = harness(() => (up ? json(200, tableState(1)) : never()))
    h.client.start()
    await h.tick()
    await h.elapse(OFFLINE_AFTER_MS + 1)
    expect(h.client.getState().offline).toBe(true)
    const before = h.calls.length
    expect(await h.client.dispatch(send())).toMatchObject({ status: 'rejected', code: 'offline' })
    expect(await h.client.dispatch(pay())).toMatchObject({ status: 'rejected', code: 'offline' })
    expect(h.calls).toHaveLength(before)
    // The bag stays editable: an edit still goes out.
    void h.client.dispatch(add())
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(h.calls.at(-1)?.url).toBe('/api/guest/actions')
    // A later request answers: the state clears, and a Send is let through again.
    up = true
    await h.elapse(OFFLINE_AFTER_MS + 1)
    await h.tick()
    expect(h.client.getState().offline).toBe(false)
    const calls = h.calls.length
    void h.client.dispatch(send())
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(h.calls).toHaveLength(calls + 1)
  })

  it('aborts a stalled action at about 10 s and takes the edit back', async () => {
    const h = harness((url) => (url.endsWith('/actions') ? never() : json(200, tableState(1))))
    h.client.start()
    await h.tick()
    const edit = h.client.dispatch(add())
    expect(h.client.getState().order?.lines).toHaveLength(1)
    await h.elapse(OFFLINE_AFTER_MS)
    expect(await edit).toMatchObject({ status: 'pending' })
    expect(h.client.getState().order?.lines).toEqual([])
  })
})

describe('a Send whose answer was lost (RR-50, D120)', () => {
  const sendCommand = (): GuestCommand => ({
    kind: 'order.send',
    actionId: crypto.randomUUID(),
    lines: [{ itemId: ITEM, optionIds: [], qty: 1, note: '' }],
  })
  const sentOrder = (id: string) => ({
    id,
    state: 'sending' as const,
    reason: null,
    ref: 'K7Q',
    lines: [{ itemId: ITEM, optionIds: [], qty: 1 }],
    sentAgoSeconds: 1,
    sentClock: '19:42',
  })

  it('answers a Send that threw as lost, and the state says so, with no reference to show', async () => {
    const h = harness((url) => {
      if (url.endsWith('/actions')) throw new TypeError('network')
      return json(200, tableState(1))
    })
    h.client.start()
    await h.tick()
    expect(h.client.getState().sendLost).toBeNull()
    const result = await h.client.dispatch(sendCommand())
    expect(result).toMatchObject({ status: 'pending', code: 'answer_lost', ref: null })
    expect(h.client.getState().sendLost).toEqual({ ref: null })
  })

  it('treats a 5xx and an unreadable answer to a Send as lost too', async () => {
    for (const reply of [() => json(502, {}), () => json(200, { nonsense: true })]) {
      const h = harness((url) => (url.endsWith('/actions') ? reply() : json(200, tableState(1))))
      h.client.start()
      await h.tick()
      expect(await h.client.dispatch(sendCommand())).toMatchObject({ code: 'answer_lost' })
      expect(h.client.getState().sendLost).toEqual({ ref: null })
    }
  })

  it('does not call an edit’s lost answer a lost Send', async () => {
    const h = harness((url) => {
      if (url.endsWith('/actions')) throw new TypeError('network')
      return json(200, tableState(1))
    })
    h.client.start()
    await h.tick()
    await h.client.dispatch(add())
    expect(h.client.getState().sendLost).toBeNull()
  })

  it('offers no immediate re-send, and another phone’s order does not let go of it', async () => {
    let other = false
    let version = 1
    const h = harness((url) => {
      if (url.endsWith('/actions')) throw new TypeError('network')
      version += 1
      return json(200, {
        ...tableState(version),
        sentOrders: other ? [sentOrder(newId('so'))] : [],
      })
    })
    h.client.start()
    await h.tick()
    await h.client.dispatch(sendCommand())
    const calls = h.calls.length
    // A second Send is not made: the answer is the same lost line, and nothing goes out.
    expect(await h.client.dispatch(sendCommand())).toMatchObject({ code: 'answer_lost' })
    expect(h.calls).toHaveLength(calls)
    // A poll that finds nothing new does not let go yet.
    await h.tick()
    expect(h.client.getState().sendLost).toEqual({ ref: null })
    // Someone else's order at the table (sent orders carry no action id, so this phone's cannot be
    // told apart): the hold is the time limit alone, and the line stays.
    other = true
    await h.tick()
    expect(h.client.getState().sendLost).toEqual({ ref: null })
    await h.tick()
    expect(h.client.getState().sendLost).toEqual({ ref: null })
  })

  it('a whole state after the phone had no pass (nothing listed at the loss) does not let go either', async () => {
    let version = 1
    let theirs = false
    const h = harness((url) => {
      if (url.endsWith('/actions')) throw new TypeError('network')
      version += 1
      return json(200, {
        ...tableState(version),
        sentOrders: theirs ? [sentOrder(newId('so'))] : [],
      })
    })
    h.client.start()
    await h.tick()
    await h.client.dispatch(sendCommand())
    h.client.location.stop?.()
    theirs = true
    await h.tick()
    expect(h.client.getState().sendLost).toEqual({ ref: null })
  })

  it('lets go after a few minutes of polls that answered and found nothing', async () => {
    const h = harness((url) => {
      if (url.endsWith('/actions')) throw new TypeError('network')
      return json(200, tableState(1))
    })
    h.client.start()
    await h.tick()
    await h.client.dispatch(sendCommand())
    h.advance(60_000)
    await h.tick()
    expect(h.client.getState().sendLost).toEqual({ ref: null })
    h.advance(3 * 60_000)
    await h.tick()
    expect(h.client.getState().sendLost).toBeNull()
  })
})

describe('Stop location check (RR-49, D119)', () => {
  it('drops the pass, remembers the choice, takes an on-the-bill edit down the refused path, and the guest’s own tap brings consent back', async () => {
    const server = checkingServer()
    const kept = memory()
    const h = harness(server.answer, { memory: kept, locate: async () => AT_THE_BAR })
    h.client.start()
    await h.tick()
    await h.client.dispatch(add())
    await h.client.location.allow()
    expect(kept.kept.get(PASS_KEY)).toBe('pass-1')
    await h.tick()
    expect(h.client.getState().location).toMatchObject({ state: 'held', consent: 'allowed' })

    h.client.location.stop?.()
    expect(kept.kept.has(PASS_KEY)).toBe(false)
    expect(h.client.getState().location).toMatchObject({
      state: 'needed',
      prompt: 'none',
      consent: 'declined',
    })
    expect(h.client.getState().order).toBeNull()
    // The next poll goes without the pass, at once, for the whole state.
    expect(h.nextWait()).toBe(0)
    await h.tick()
    expect(h.client.getState().location?.state).toBe('needed')

    // The refused path: no consent screen, no position asked for, the refusal comes back.
    const located = server.bodies.filter((body) => body.check?.location !== undefined).length
    expect(await h.client.dispatch(add())).toMatchObject({ code: 'location_needed' })
    expect(h.client.getState().location?.prompt).toBe('none')
    expect(server.bodies.filter((body) => body.check?.location !== undefined)).toHaveLength(located)

    h.client.location.reopen()
    expect(h.client.getState().location?.prompt).toBe('consent')
  })
})

describe('Stop location check with a poll in flight (RR-49)', () => {
  it('discards the answer of a poll that went out before the stop', async () => {
    const row = line(orderLineIdFor(crypto.randomUUID()), 1)
    let release: (response: Response) => void = () => {}
    let hold = false
    const h = harness(() => {
      if (!hold) return json(200, tableState(1, [row], 'held'))
      return new Promise<Response>((resolve) => {
        release = resolve
      })
    })
    h.client.start()
    await h.tick()
    expect(h.client.getState().order?.lines).toHaveLength(1)
    hold = true
    await h.tick()
    h.client.location.stop?.()
    expect(h.client.getState().order).toBeNull()
    release(json(200, tableState(2, [row], 'held')))
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(h.client.getState().order).toBeNull()
    expect(h.client.getState().location?.state).toBe('needed')
  })
})

describe('the screen the face has open (RR-52, D121)', () => {
  it('asks for the bill’s state when the face says the bill is open, at once, and the bag’s on the bag', async () => {
    const h = harness(() => json(200, tableState(1)))
    h.client.start()
    await h.tick()
    expect(h.calls.at(-1)?.url).toBe('/api/guest/state?view=menu')
    h.client.setScreen('bill')
    expect(h.nextWait()).toBe(0)
    await h.tick()
    expect(h.calls.at(-1)?.url).toBe('/api/guest/state?view=bill&since=1')
    h.client.setScreen('bag')
    await h.tick()
    expect(h.calls.at(-1)?.url).toBe('/api/guest/state?view=order&since=1')
    h.client.setScreen('menu')
    await h.tick()
    expect(h.calls.at(-1)?.url).toBe('/api/guest/state?view=menu&since=1')
  })

  it('sends the open screen with an action too, and an empty bag on the bill is the bill', async () => {
    const h = harness((url) =>
      url.endsWith('/actions') ? json(500, {}) : json(200, tableState(1)),
    )
    h.client.start()
    await h.tick()
    h.client.setScreen('bill')
    await h.client.dispatch(add())
    const body = JSON.parse(String(h.calls.at(-1)?.init.body))
    expect(body.view).toBe('bill')
  })
})
