// The guest API's handlers (#75) with core's guest module stubbed: a missing or misshapen code is
// a 401 before the database is asked, a body past 8 KB a 413, a body of the wrong shape a 400; a
// rate trip is a 429 with Retry-After; every answer is no-store and no-referrer, and nothing the
// phone sent reaches the log. #76: a command needs the phone value header; the pass travels in its
// header both ways and comes back in the answer; a body that fails its schema is logged by its
// paths only; a limit's trip is a 429 with Retry-After; a guard's trip is one line with the venue
// and the table. #110: the payment handle travels only in `X-Restro-Payment`, back in a pay
// command's answer, and `GET /api/guest/payment` answers only a handle of the right shape. The
// module itself is tested on Postgres in core (`guest.test.ts`, `guest-location.test.ts`,
// `pay.test.ts`).
import { newId } from '@restro/core'
import type { DbPool } from '@restro/db'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const core = vi.hoisted(() => ({ guestState: vi.fn(), guestAct: vi.fn(), guestPayment: vi.fn() }))
const log = vi.hoisted(() => ({ logError: vi.fn(), logInfo: vi.fn(), logWarn: vi.fn() }))

vi.mock('@restro/core/service', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@restro/core/service')>()),
  guestState: core.guestState,
  guestAct: core.guestAct,
  guestPayment: core.guestPayment,
}))
vi.mock('./log', () => log)

const { ForbiddenValueError } = await import('@restro/core/service')
type GuestActInput = import('@restro/core/service').GuestActInput
const { handleGuestAction, handleGuestPayment, handleGuestState, readCapped, tableCodeOf } =
  await import('./guest-api')

const CODE = 'table-code-1234'
const PHONE = 'phone-value-aaaaaaaaaa'
const PASS = 'eyJ2IjoxfQ.c2VhbA'
const HANDLE = 'aaaaaaaaaaaaaaaaaaaaaA'
/** Only the stubbed module gets the pool, so a refusal that never calls it never asked the database. */
const pool = { sentinel: 'pool' } as unknown as DbPool
const humanCheck = vi.fn(async () => 'passed' as const)
const deps = { pool, queueReading: vi.fn(async () => {}), passKey: 'k'.repeat(40), humanCheck }

function state(version = 1) {
  return {
    unchanged: false,
    version,
    next: 2_000,
    table: { label: '7' },
    ordering: { state: 'on', notesAndOptions: false },
    location: { state: 'held', passSeconds: 600, dayEndsInSeconds: 3_600, venueName: 'Club' },
    order: { lines: [], removed: [], earlier: null },
    sentOrders: [],
    waiterCall: null,
    bill: null,
  }
}

const get = (
  query = '',
  auth: string | null = `Table ${CODE}`,
  extra: Record<string, string> = {},
) =>
  new Request(`http://localhost/api/guest/state${query}`, {
    headers: { ...(auth === null ? {} : { Authorization: auth }), ...extra },
  })

const post = (
  body: unknown,
  auth: string | null = `Table ${CODE}`,
  extra: Record<string, string> = { 'X-Restro-Phone': PHONE },
) =>
  new Request('http://localhost/api/guest/actions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(auth === null ? {} : { Authorization: auth }),
      ...extra,
    },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })

const add = (actionId = crypto.randomUUID()) => ({
  command: { kind: 'order.add', actionId, itemId: newId('nd'), optionIds: [], qty: 1, note: '' },
  ageMs: 120,
})

function expectGuestHeaders(response: Response) {
  expect(response.headers.get('cache-control')).toBe('no-store')
  expect(response.headers.get('referrer-policy')).toBe('no-referrer')
  expect(response.headers.get('x-content-type-options')).toBe('nosniff')
}

beforeEach(() => {
  core.guestState.mockReset()
  core.guestAct.mockReset()
  core.guestPayment.mockReset()
  log.logError.mockReset()
  log.logInfo.mockReset()
  log.logWarn.mockReset()
  humanCheck.mockClear()
})

describe('the table code header', () => {
  it('takes only `Table <code>` with a code of the right shape', () => {
    expect(tableCodeOf(get())).toBe(CODE)
    for (const auth of [null, `Bearer ${CODE}`, 'Table', `Table ${CODE} more`, 'Table no']) {
      expect(tableCodeOf(get('', auth))).toBeNull()
    }
  })

  it('answers a missing or misshapen code 401 without asking the database', async () => {
    for (const response of [
      await handleGuestState(get('', null), deps),
      await handleGuestAction(post(add(), 'Table x'), deps),
    ]) {
      expect(response.status).toBe(401)
      expect(await response.json()).toEqual({ code: 'code_retired' })
      expectGuestHeaders(response)
    }
    expect(core.guestState).not.toHaveBeenCalled()
    expect(core.guestAct).not.toHaveBeenCalled()
  })
})

describe('GET /api/guest/state', () => {
  it('passes since and view on, and answers the checked state', async () => {
    core.guestState.mockResolvedValue({ ok: true, answer: state(5) })
    const response = await handleGuestState(get('?since=4&view=order'), deps)
    expect(response.status).toBe(200)
    expectGuestHeaders(response)
    expect(await response.json()).toEqual(state(5))
    expect(core.guestState).toHaveBeenCalledWith(
      pool,
      expect.objectContaining({ code: CODE, since: 4, view: 'order', passKey: deps.passKey }),
    )
  })

  it('hands core the pass from its header, and ignores one too long to be ours', async () => {
    core.guestState.mockResolvedValue({ ok: true, answer: state(5) })
    await handleGuestState(get('', `Table ${CODE}`, { 'X-Restro-Pass': PASS }), deps)
    expect(core.guestState).toHaveBeenLastCalledWith(pool, expect.objectContaining({ pass: PASS }))
    await handleGuestState(get('', `Table ${CODE}`, { 'X-Restro-Pass': 'x'.repeat(2_000) }), deps)
    expect(core.guestState.mock.lastCall?.[1]).not.toHaveProperty('pass')
  })

  it('answers a table code past its request rate 429 with Retry-After', async () => {
    core.guestState.mockResolvedValue({ ok: false, code: 'rate_limited', retryAfter: 1 })
    const response = await handleGuestState(get(), deps)
    expect(response.status).toBe(429)
    expect(response.headers.get('retry-after')).toBe('1')
  })

  it('refuses an unknown query parameter or view with 400', async () => {
    for (const query of ['?view=kitchen', '?since=-1', '?table=tb_1']) {
      const response = await handleGuestState(get(query), deps)
      expect(response.status).toBe(400)
      expect(await response.json()).toEqual({ code: 'invalid_request' })
    }
    expect(core.guestState).not.toHaveBeenCalled()
  })

  it('answers a code that is no longer the table’s 401', async () => {
    core.guestState.mockResolvedValue({ ok: false, code: 'code_retired' })
    expect((await handleGuestState(get(), deps)).status).toBe(401)
  })

  it('answers a forbidden value 500, logging neither the values nor their paths', async () => {
    core.guestState.mockRejectedValue(new ForbiddenValueError(['order.lines.0.posId']))
    const response = await handleGuestState(get(), deps)
    expect(response.status).toBe(500)
    expect(JSON.stringify(log.logError.mock.calls)).not.toContain('posId')
  })
})

describe('POST /api/guest/actions', () => {
  it('refuses a body past 8 KB with 413 before parsing it', async () => {
    const response = await handleGuestAction(post('x'.repeat(8 * 1024 + 1)), deps)
    expect(response.status).toBe(413)
    expect(await response.json()).toEqual({ code: 'too_large' })
    expect(core.guestAct).not.toHaveBeenCalled()
  })

  it('cuts a stream that grows past the cap even without a length', async () => {
    const chunk = new Uint8Array(3_000)
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(chunk)
      },
    })
    const request = new Request('http://localhost/api/guest/actions', {
      method: 'POST',
      body: stream,
      duplex: 'half',
    } as RequestInit)
    expect(await readCapped(request)).toEqual({ ok: false })
  })

  it('refuses JSON that is not JSON, an unknown field or a wrong command with 400', async () => {
    for (const body of [
      '{not json',
      { ...add(), extra: 1 },
      { ...add(), command: { ...add().command, qty: 0 } },
      { ...add(), command: { kind: 'order.change', actionId: crypto.randomUUID(), delta: 0 } },
    ]) {
      const response = await handleGuestAction(post(body), deps)
      expect(response.status).toBe(400)
    }
    expect(core.guestAct).not.toHaveBeenCalled()
  })

  it('hands core the command with its tap’s age, and answers the result and the state', async () => {
    const request = add()
    const result = {
      actionId: request.command.actionId,
      status: 'accepted',
      code: null,
      subjectId: newId('ol'),
      ref: null,
    }
    core.guestAct.mockResolvedValue({
      ok: true,
      result,
      state: state(2),
      pass: 'fresh-pass',
      handle: null,
      retryAfter: null,
    })
    const response = await handleGuestAction(post(request), deps)
    expect(response.status).toBe(200)
    expectGuestHeaders(response)
    expect(await response.json()).toEqual({
      result,
      state: state(2),
      pass: 'fresh-pass',
      handle: null,
    })
    const { kind, ...fields } = request.command
    expect(core.guestAct).toHaveBeenCalledWith(pool, {
      code: CODE,
      command: { type: kind, ...fields },
      ageMs: 120,
      view: 'order',
      phone: PHONE,
      passKey: deps.passKey,
      humanCheck,
      queueSend: expect.any(Function),
      onGuard: expect.any(Function),
    })
  })

  it('answers an accepted Send even when its job could not be queued (the sweep queues it, #77)', async () => {
    const request = add()
    const target = { tenantId: newId('tn'), venueId: newId('vn'), tableId: newId('tb') }
    const result = {
      actionId: request.command.actionId,
      status: 'accepted',
      code: null,
      subjectId: newId('so'),
      ref: 'K7Q',
    }
    core.guestAct.mockImplementation(async (_pool: unknown, input: GuestActInput) => {
      await input.queueSend?.(target)
      return { ok: true, result, state: state(2), pass: null, handle: null, retryAfter: null }
    })
    const queueSend = vi.fn(async () => {
      throw new Error('the queue is down')
    })
    const response = await handleGuestAction(post(request), { ...deps, queueSend })
    expect(response.status).toBe(200)
    expect(queueSend).toHaveBeenCalledWith(target)
    expect((await response.json()).result).toEqual(result)
  })

  it('refuses a command without a phone value of the right shape with 400', async () => {
    const bad: Record<string, string>[] = [
      {},
      { 'X-Restro-Phone': 'short' },
      { 'X-Restro-Phone': `${PHONE}!` },
    ]
    for (const extra of bad) {
      expect((await handleGuestAction(post(add(), `Table ${CODE}`, extra), deps)).status).toBe(400)
    }
    expect(core.guestAct).not.toHaveBeenCalled()
  })

  it('hands core the pass, the position and the token, and logs a bad position by path only', async () => {
    core.guestAct.mockResolvedValue({
      ok: true,
      result: {
        actionId: null,
        status: 'rejected',
        code: 'location_failed',
        subjectId: null,
        ref: null,
      },
      state: null,
      pass: null,
      handle: null,
      retryAfter: null,
    })
    const check = {
      location: { lat: 42.6977, lng: 23.3219, accuracyM: 12 },
      consentVersion: 'v1',
      humanToken: 'token',
    }
    const headers = { 'X-Restro-Phone': PHONE, 'X-Restro-Pass': PASS }
    await handleGuestAction(post({ ...add(), check }, `Table ${CODE}`, headers), deps)
    expect(core.guestAct).toHaveBeenCalledWith(pool, expect.objectContaining({ pass: PASS, check }))

    const bad = { ...check, location: { lat: 142.6977, lng: 23.3219, accuracyM: 12 } }
    const response = await handleGuestAction(post({ ...add(), check: bad }), deps)
    expect(response.status).toBe(400)
    expect(log.logWarn).toHaveBeenCalledWith('guest_action_invalid', {
      paths: 'check.location.lat',
    })
    expect(JSON.stringify(log.logWarn.mock.calls)).not.toContain('142')
  })

  it('logs a guard’s trip with the venue and the table only', async () => {
    core.guestAct.mockImplementation(async (_pool, input: GuestActInput) => {
      input.onGuard?.({ kind: 'location_failed', venueId: 'vn_1', tableId: 'tb_1' })
      return { ok: false, code: 'rate_limited', retryAfter: 7 }
    })
    const response = await handleGuestAction(post(add()), deps)
    expect(response.status).toBe(429)
    expect(response.headers.get('retry-after')).toBe('7')
    expect(log.logInfo).toHaveBeenCalledWith('guest_guard', {
      guard: 'location_failed',
      venueId: 'vn_1',
      tableId: 'tb_1',
    })
  })

  it('answers a rate trip 429 with Retry-After', async () => {
    core.guestAct.mockResolvedValue({
      ok: true,
      result: {
        actionId: null,
        status: 'rejected',
        code: 'rate_limited',
        subjectId: null,
        ref: null,
      },
      state: null,
      pass: null,
      handle: null,
      retryAfter: 10,
    })
    const response = await handleGuestAction(post(add()), deps)
    expect(response.status).toBe(429)
    expect(response.headers.get('retry-after')).toBe('10')
    expect(await response.json()).toEqual({ code: 'rate_limited' })
  })

  it('logs a failure without the code or the body', async () => {
    core.guestAct.mockRejectedValue(new Error('boom'))
    const response = await handleGuestAction(post(add()), deps)
    expect(response.status).toBe(500)
    expect(JSON.stringify(log.logError.mock.calls)).not.toContain(CODE)
  })
})

describe('the payment handle', () => {
  const returned = () => ({
    command: { kind: 'pay.returned', actionId: crypto.randomUUID() },
    ageMs: 50,
  })
  const answered = (handle: string | null) => ({
    ok: true,
    result: { actionId: null, status: 'accepted', code: null, subjectId: newId('py'), ref: null },
    state: state(3),
    pass: null,
    handle,
    retryAfter: null,
  })
  const payment = (auth: string | null = `Table ${CODE}`, extra: Record<string, string> = {}) =>
    new Request('http://localhost/api/guest/payment', {
      headers: { ...(auth === null ? {} : { Authorization: auth }), ...extra },
    })

  it('hands core the handle from its header, and only one of the right shape', async () => {
    core.guestAct.mockResolvedValue(answered(null))
    const headers = { 'X-Restro-Phone': PHONE, 'X-Restro-Payment': HANDLE }
    await handleGuestAction(post(returned(), `Table ${CODE}`, headers), deps)
    expect(core.guestAct).toHaveBeenLastCalledWith(
      pool,
      expect.objectContaining({ handle: HANDLE }),
    )
    for (const bad of ['short', `${HANDLE}x`, `${HANDLE.slice(1)}!`]) {
      const extra = { 'X-Restro-Phone': PHONE, 'X-Restro-Payment': bad }
      await handleGuestAction(post(returned(), `Table ${CODE}`, extra), deps)
      expect(core.guestAct.mock.lastCall?.[1]).not.toHaveProperty('handle')
    }
  })

  it('answers a new handle in the body, and never logs it', async () => {
    core.guestAct.mockResolvedValue(answered(HANDLE))
    const response = await handleGuestAction(post(returned()), deps)
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ handle: HANDLE })
    expect(JSON.stringify([log.logInfo.mock.calls, log.logWarn.mock.calls])).not.toContain(HANDLE)
  })

  it('queues the payment’s step through the app’s queue, and logs a queue that fails', async () => {
    const queuePayment = vi.fn(async () => {
      throw new Error('queue down')
    })
    const target = { tenantId: newId('tn'), venueId: newId('vn'), paymentId: newId('py') }
    core.guestAct.mockImplementation(async (_pool, input: GuestActInput) => {
      await input.queuePayment?.(target, 'prepare')
      return answered(null)
    })
    const response = await handleGuestAction(post(returned()), { ...deps, queuePayment })
    expect(response.status).toBe(200)
    expect(queuePayment).toHaveBeenCalledWith(target, 'prepare')
    expect(log.logError).toHaveBeenCalledWith('guest_payment_not_queued', expect.any(Error))
  })

  it('answers GET /api/guest/payment 401 without a code and 404 without a handle', async () => {
    const noCode = await handleGuestPayment(payment(null, { 'X-Restro-Payment': HANDLE }), deps)
    expect(noCode.status).toBe(401)
    for (const extra of [{}, { 'X-Restro-Payment': 'short' }] as Record<string, string>[]) {
      const response = await handleGuestPayment(payment(`Table ${CODE}`, extra), deps)
      expect(response.status).toBe(404)
      expect(await response.json()).toEqual({ code: 'unknown_payment' })
      expectGuestHeaders(response)
    }
    expect(core.guestPayment).not.toHaveBeenCalled()
  })

  it('answers the paying phone its payment, and 404 a handle core does not know', async () => {
    const answer = {
      id: newId('py'),
      state: 'awaiting_guest',
      reason: null,
      currency: 'EUR',
      amountMinor: 1_430,
      tipMinor: 130,
      lines: [{ name: 'Gin tonic', quantity: '2', amountMinor: 1_000 }],
      form: { provider: 'sim', values: { clientSecret: 'secret' }, confirmSeconds: 120 },
      next: 1_000,
    }
    core.guestPayment.mockResolvedValue({ ok: true, answer })
    const response = await handleGuestPayment(
      payment(`Table ${CODE}`, { 'X-Restro-Payment': HANDLE }),
      deps,
    )
    expect(response.status).toBe(200)
    expectGuestHeaders(response)
    expect(await response.json()).toEqual(answer)
    expect(core.guestPayment).toHaveBeenCalledWith(
      pool,
      expect.objectContaining({ code: CODE, handle: HANDLE }),
    )

    core.guestPayment.mockResolvedValue({ ok: false, code: 'unknown_payment' })
    const unknown = await handleGuestPayment(
      payment(`Table ${CODE}`, { 'X-Restro-Payment': HANDLE }),
      deps,
    )
    expect(unknown.status).toBe(404)
  })
})
