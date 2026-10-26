// The guest API's handlers (#75) with core's guest module stubbed: a missing or misshapen code is
// a 401 before the database is asked, a body past 8 KB a 413, a body of the wrong shape a 400; a
// rate trip is a 429 with Retry-After; every answer is no-store and no-referrer, and nothing the
// phone sent reaches the log. The module itself is tested on Postgres in core (`guest.test.ts`).
import { newId } from '@restro/core'
import type { DbPool } from '@restro/db'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const core = vi.hoisted(() => ({ guestState: vi.fn(), guestAct: vi.fn() }))
const log = vi.hoisted(() => ({ logError: vi.fn() }))

vi.mock('@restro/core/service', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@restro/core/service')>()),
  guestState: core.guestState,
  guestAct: core.guestAct,
}))
vi.mock('./log', () => log)

const { ForbiddenValueError } = await import('@restro/core/service')
const { handleGuestAction, handleGuestState, readCapped, tableCodeOf } = await import('./guest-api')

const CODE = 'table-code-1234'
/** Only the stubbed module gets the pool, so a refusal that never calls it never asked the database. */
const pool = { sentinel: 'pool' } as unknown as DbPool
const deps = { pool, queueReading: vi.fn(async () => {}) }

function state(version = 1) {
  return {
    unchanged: false,
    version,
    next: 2_000,
    table: { label: '7' },
    ordering: { state: 'on' },
    order: { lines: [], removed: [], earlier: null },
    sentOrders: [],
    bill: null,
  }
}

const get = (query = '', auth: string | null = `Table ${CODE}`) =>
  new Request(`http://localhost/api/guest/state${query}`, {
    headers: auth === null ? {} : { Authorization: auth },
  })

const post = (body: unknown, auth: string | null = `Table ${CODE}`) =>
  new Request('http://localhost/api/guest/actions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(auth === null ? {} : { Authorization: auth }),
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
  log.logError.mockReset()
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
      expect.objectContaining({ code: CODE, since: 4, view: 'order' }),
    )
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
    core.guestAct.mockResolvedValue({ ok: true, result, state: state(2), retryAfter: null })
    const response = await handleGuestAction(post(request), deps)
    expect(response.status).toBe(200)
    expectGuestHeaders(response)
    expect(await response.json()).toEqual({ result, state: state(2) })
    const { kind, ...fields } = request.command
    expect(core.guestAct).toHaveBeenCalledWith(pool, {
      code: CODE,
      command: { type: kind, ...fields },
      ageMs: 120,
      view: 'order',
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
