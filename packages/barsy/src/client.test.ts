import { delay, HttpResponse, http } from 'msw'
import { pino } from 'pino'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'

import { createBarsyClient } from './client.ts'
import {
  BarsyAuthError,
  BarsyConfigError,
  BarsyHostNotAllowedError,
  BarsyHttpError,
  BarsyMethodNotAllowedError,
  BarsyNetworkError,
  BarsyResponseError,
  BarsyTimeoutError,
} from './errors.ts'
import { type BarsyFixture, fixtureSchema } from './fixture.ts'
import { decimalStringSchema } from './json.ts'
import { createBarsyLogger } from './logger.ts'
import { createBarsyMockServer } from './testing/mock-server.ts'

// Everything here runs against MSW with handmade fixtures. No test can reach the real network:
// the harness fails any request it has no handler for.

const PASSWORD = 'test-password-not-a-real-one'
const CONFIG = {
  host: 'https://demo.barsyonline.com',
  user: 'demo',
  password: PASSWORD,
  env: 'test',
} as const
const BASIC = `Basic ${Buffer.from(`demo:${PASSWORD}`).toString('base64')}`

function fixture(overrides: Partial<BarsyFixture> & Pick<BarsyFixture, 'method'>): BarsyFixture {
  return fixtureSchema.parse({
    params: {},
    bid: null,
    recordedAt: null,
    status: 200,
    requestId: '1:108914',
    body: '1',
    handmade: true,
    ...overrides,
  })
}

const PING = fixture({ method: 'Misc_ping' })
const PING_USER = fixture({ method: 'Misc_ping_user' })

const mock = createBarsyMockServer([PING, PING_USER])
beforeAll(() => mock.listen())
afterEach(() => mock.reset())
afterAll(() => mock.close())

function captureLogger() {
  const lines: Record<string, unknown>[] = []
  const logger = pino(
    { level: 'debug' },
    {
      write(chunk: string) {
        lines.push(JSON.parse(chunk) as Record<string, unknown>)
      },
    },
  )
  return { logger, lines }
}

let logs: ReturnType<typeof captureLogger>
beforeEach(() => {
  logs = captureLogger()
})

function newClient(overrides: Partial<Parameters<typeof createBarsyClient>[0]> = {}) {
  return createBarsyClient({ ...CONFIG, ...overrides }, { logger: logs.logger })
}

describe('ping and pingUser', () => {
  it('ping() posts to /endpoints/json/Misc_ping with a JSON body and no credentials', async () => {
    const result = await newClient().ping()
    expect(result).toMatchObject({ data: 1, status: 200, requestId: '1:108914' })
    expect(result.durationMs).toBeGreaterThanOrEqual(0)
    expect(mock.requests).toHaveLength(1)
    const [request] = mock.requests
    expect(request).toMatchObject({
      url: 'https://demo.barsyonline.com/endpoints/json/Misc_ping',
      methods: ['Misc_ping'],
      multi: false,
      bid: null,
      authorization: null,
      contentType: 'application/json',
      params: {},
    })
  })

  it('pingUser() sends HTTP Basic credentials', async () => {
    const result = await newClient().pingUser()
    expect(result).toMatchObject({ data: 1, status: 200 })
    expect(mock.requests[0]).toMatchObject({
      url: 'https://demo.barsyonline.com/endpoints/json/Misc_ping_user',
      authorization: BASIC,
    })
  })

  it('sends the venue as ?bid= when given, as a number or a string, and omits it otherwise', async () => {
    const client = newClient()
    await client.ping({ bid: 1 })
    await client.ping({ bid: '12' })
    await client.ping()
    expect(mock.requests.map((request) => request.url)).toStrictEqual([
      'https://demo.barsyonline.com/endpoints/json/Misc_ping?bid=1',
      'https://demo.barsyonline.com/endpoints/json/Misc_ping?bid=12',
      'https://demo.barsyonline.com/endpoints/json/Misc_ping',
    ])
    expect(mock.requests.map((request) => request.bid)).toStrictEqual(['1', '12', null])
  })

  it('refuses a malformed bid before sending anything', async () => {
    const client = newClient()
    await expect(client.ping({ bid: '' })).rejects.toBeInstanceOf(BarsyConfigError)
    await expect(client.ping({ bid: -1 })).rejects.toBeInstanceOf(BarsyConfigError)
    await expect(client.ping({ bid: 1.5 })).rejects.toBeInstanceOf(BarsyConfigError)
    expect(mock.requests).toHaveLength(0)
  })

  it('reads the request id from BARSY_REQUEST_ID and tolerates its absence', async () => {
    mock.setFixtures([fixture({ method: 'Misc_ping', requestId: null }), PING_USER])
    const result = await newClient().ping()
    expect(result.requestId).toBeNull()
  })
})

describe('call', () => {
  it('sends the parameters as a JSON object body', async () => {
    await newClient().call('Misc_ping', { length: '1000', extra_properties: { common: '1' } })
    expect(mock.requests[0]?.params).toStrictEqual({
      length: '1000',
      extra_properties: { common: '1' },
    })
  })

  it('keeps decimal numbers lossless all the way to the caller', async () => {
    mock.setFixtures([
      fixture({
        method: 'Misc_ping',
        body: '{"actual_price": 2.40, "stock": 12, "big": 12345678901234567890}',
      }),
    ])
    const schema = z.object({
      actual_price: decimalStringSchema,
      stock: z.number(),
      big: decimalStringSchema,
    })
    const { data } = await newClient().call('Misc_ping', undefined, { schema })
    expect(data).toStrictEqual({
      actual_price: '2.40',
      stock: 12,
      big: '12345678901234567890',
    })
  })

  it('returns the parsed value untyped when no schema is given', async () => {
    mock.setFixtures([fixture({ method: 'Misc_ping', body: '[1, 2.50]' })])
    const { data } = await newClient().call('Misc_ping')
    expect(data).toStrictEqual([1, '2.50'])
  })

  it('refuses a method that is not on the read allowlist, before any request', async () => {
    const client = newClient()
    for (const method of [
      'Accounts_place',
      'Poses_register',
      'Webhooks_subscribe',
      'Articledetails_setdetailvalue',
      'constructor',
      '__proto__',
      '',
    ]) {
      await expect(client.call(method as never), method).rejects.toBeInstanceOf(
        BarsyMethodNotAllowedError,
      )
    }
    expect(mock.requests).toHaveLength(0)
  })
})

describe('errors', () => {
  it('401 and 403 are BarsyAuthError with the status and request id', async () => {
    for (const status of [401, 403]) {
      mock.setFixtures([PING, fixture({ method: 'Misc_ping_user', status, body: '' })])
      const error = await newClient()
        .pingUser()
        .catch((e: unknown) => e)
      expect(error).toBeInstanceOf(BarsyAuthError)
      expect(error).toMatchObject({
        status,
        method: 'Misc_ping_user',
        bid: null,
        requestId: '1:108914',
      })
      expect((error as Error).message).toContain('1:108914')
    }
  })

  it('other non-2xx statuses are BarsyHttpError with the status and request id', async () => {
    for (const status of [400, 404, 500, 502, 503]) {
      mock.setFixtures([
        fixture({ method: 'Misc_ping', status, body: 'upstream says no' }),
        PING_USER,
      ])
      const error = await newClient()
        .ping({ bid: 3 })
        .catch((e: unknown) => e)
      expect(error).toBeInstanceOf(BarsyHttpError)
      expect(error).toMatchObject({ status, method: 'Misc_ping', bid: '3', requestId: '1:108914' })
      // The body is never copied into the error: it may carry personal data.
      expect((error as Error).message).not.toContain('upstream says no')
    }
  })

  it('does not follow a redirect: it is a BarsyHttpError', async () => {
    mock.server.use(
      http.post(
        'https://demo.barsyonline.com/endpoints/json/Misc_ping',
        () =>
          new HttpResponse(null, {
            status: 307,
            headers: { Location: 'https://demo.barsyonline.com/endpoints/json/Misc_ping_user' },
          }),
      ),
    )
    const error = await newClient()
      .ping()
      .catch((e: unknown) => e)
    expect(error).toBeInstanceOf(BarsyHttpError)
    expect(error).toMatchObject({ status: 307 })
    // The redirect target was never requested, so the credentials never followed it.
    expect(mock.requests).toHaveLength(0)
  })

  it('a body that is not JSON is a BarsyResponseError', async () => {
    for (const body of ['', 'oops', '{"a":']) {
      mock.setFixtures([fixture({ method: 'Misc_ping', body }), PING_USER])
      const error = await newClient()
        .ping()
        .catch((e: unknown) => e)
      expect(error, JSON.stringify(body)).toBeInstanceOf(BarsyResponseError)
      expect((error as BarsyResponseError).issues).toStrictEqual([
        { path: '', code: 'invalid_json' },
      ])
    }
  })

  it('a body that fails the schema is a BarsyResponseError naming the path, not the value', async () => {
    mock.setFixtures([fixture({ method: 'Misc_ping', body: '2' }), PING_USER])
    const error = await newClient()
      .ping()
      .catch((e: unknown) => e)
    expect(error).toBeInstanceOf(BarsyResponseError)
    expect((error as BarsyResponseError).issues).toHaveLength(1)
    expect((error as BarsyResponseError).issues[0]).toMatchObject({ path: '' })
    expect(error).toMatchObject({ method: 'Misc_ping', requestId: '1:108914' })
  })

  it('a response that never arrives within the limit is a BarsyTimeoutError', async () => {
    mock.server.use(
      http.post('https://demo.barsyonline.com/endpoints/json/Misc_ping', async () => {
        await delay(2_000)
        return HttpResponse.text('1')
      }),
    )
    const started = Date.now()
    const error = await newClient({ timeoutMs: 50 })
      .ping()
      .catch((e: unknown) => e)
    expect(error).toBeInstanceOf(BarsyTimeoutError)
    expect(error).toMatchObject({ timeoutMs: 50, method: 'Misc_ping', requestId: null })
    expect(Date.now() - started).toBeLessThan(1_500)
  })

  it('the default limit is the 30 seconds barsy enforces, applied with AbortSignal.timeout', async () => {
    const spy = vi.spyOn(AbortSignal, 'timeout')
    try {
      await newClient().ping()
      expect(spy).toHaveBeenCalledTimes(1)
      expect(spy).toHaveBeenCalledWith(30_000)
    } finally {
      spy.mockRestore()
    }
  })

  it('a failure to connect is a BarsyNetworkError', async () => {
    mock.server.use(
      http.post('https://demo.barsyonline.com/endpoints/json/Misc_ping', () =>
        HttpResponse.error(),
      ),
    )
    const error = await newClient()
      .ping()
      .catch((e: unknown) => e)
    expect(error).toBeInstanceOf(BarsyNetworkError)
    expect(error).toMatchObject({ method: 'Misc_ping' })
  })
})

describe('callMany', () => {
  it('posts one object keyed by method name to /endpoints/json/ and returns each result by name', async () => {
    const result = await newClient().callMany(
      { Misc_ping: { schema: z.literal(1) }, Misc_ping_user: { params: {} } },
      { bid: 2 },
    )
    expect(result.data).toStrictEqual({ Misc_ping: 1, Misc_ping_user: 1 })
    expect(result.status).toBe(200)
    expect(result.requestId).toBe('1:108914')
    expect(mock.requests).toHaveLength(1)
    expect(mock.requests[0]).toMatchObject({
      url: 'https://demo.barsyonline.com/endpoints/json/?bid=2',
      multi: true,
      methods: ['Misc_ping', 'Misc_ping_user'],
      bid: '2',
      authorization: BASIC,
      contentType: 'application/json',
      params: { Misc_ping: {}, Misc_ping_user: {} },
    })
  })

  it('sends no credentials when every method in it is anonymous', async () => {
    await newClient().callMany({ Misc_ping: {} })
    expect(mock.requests[0]?.authorization).toBeNull()
  })

  it('validates each result against its own schema and prefixes the issue path with the method', async () => {
    mock.setFixtures([PING, fixture({ method: 'Misc_ping_user', body: '7' })])
    const error = await newClient()
      .callMany({ Misc_ping: { schema: z.literal(1) }, Misc_ping_user: { schema: z.literal(1) } })
      .catch((e: unknown) => e)
    expect(error).toBeInstanceOf(BarsyResponseError)
    expect((error as BarsyResponseError).issues[0]).toMatchObject({ path: 'Misc_ping_user' })
    expect(error).toMatchObject({ method: 'Misc_ping,Misc_ping_user' })
  })

  it('treats a missing method in the response as a BarsyResponseError', async () => {
    mock.server.use(
      http.post('https://demo.barsyonline.com/endpoints/json/', () =>
        HttpResponse.text('{"Misc_ping":1}'),
      ),
    )
    const error = await newClient()
      .callMany({ Misc_ping: {}, Misc_ping_user: {} })
      .catch((e: unknown) => e)
    expect(error).toBeInstanceOf(BarsyResponseError)
    expect((error as BarsyResponseError).issues).toStrictEqual([
      { path: 'Misc_ping_user', code: 'missing_method_result' },
    ])
  })

  it('treats a response that is not an object as a BarsyResponseError', async () => {
    mock.server.use(
      http.post('https://demo.barsyonline.com/endpoints/json/', () => HttpResponse.text('[1]')),
    )
    await expect(newClient().callMany({ Misc_ping: {} })).rejects.toBeInstanceOf(BarsyResponseError)
  })

  it('refuses an empty call and any method off the allowlist, before any request', async () => {
    const client = newClient()
    await expect(client.callMany({})).rejects.toBeInstanceOf(BarsyConfigError)
    await expect(client.callMany({ Accounts_place: {} } as never)).rejects.toBeInstanceOf(
      BarsyMethodNotAllowedError,
    )
    await expect(
      client.callMany({ Misc_ping: {}, Accounts_place: {} } as never),
    ).rejects.toBeInstanceOf(BarsyMethodNotAllowedError)
    expect(mock.requests).toHaveLength(0)
  })

  it('maps a non-2xx answer like a single call', async () => {
    mock.server.use(
      http.post(
        'https://demo.barsyonline.com/endpoints/json/',
        () => new HttpResponse(null, { status: 401, headers: { BARSY_REQUEST_ID: '1:5' } }),
      ),
    )
    const error = await newClient()
      .callMany({ Misc_ping_user: {} })
      .catch((e: unknown) => e)
    expect(error).toBeInstanceOf(BarsyAuthError)
    expect(error).toMatchObject({ requestId: '1:5', method: 'Misc_ping_user' })
  })
})

describe('callRaw', () => {
  it('returns status, request id and the body text without interpreting them', async () => {
    mock.setFixtures([PING, fixture({ method: 'Misc_ping_user', status: 401, body: 'denied' })])
    const raw = await newClient().callRaw('Misc_ping_user', undefined, { bid: 4 })
    expect(raw).toMatchObject({
      method: 'Misc_ping_user',
      bid: '4',
      status: 401,
      requestId: '1:108914',
      body: 'denied',
    })
  })

  it('still refuses methods off the allowlist', async () => {
    await expect(newClient().callRaw('Accounts_place' as never)).rejects.toBeInstanceOf(
      BarsyMethodNotAllowedError,
    )
  })
})

describe('host guard (CLAUDE.md rule 9)', () => {
  it('createBarsyClient refuses a host the environment may not use, before any request', () => {
    expect(() => createBarsyClient({ ...CONFIG, host: 'club.example.bg', env: 'staging' })).toThrow(
      BarsyHostNotAllowedError,
    )
    expect(() => createBarsyClient({ ...CONFIG, env: 'production' })).toThrow(
      BarsyHostNotAllowedError,
    )
    expect(mock.requests).toHaveLength(0)
  })

  it('createBarsyClient accepts an allowlisted host and exposes the normalised host', () => {
    const client = createBarsyClient({
      ...CONFIG,
      host: 'https://Club.Example.bg/',
      env: 'production',
      allowedHosts: 'club.example.bg',
    })
    expect(client.host).toBe('club.example.bg')
    expect(client.env).toBe('production')
  })

  it('a bad configuration is a BarsyConfigError that never repeats the password', () => {
    expect.assertions(2)
    try {
      createBarsyClient({ ...CONFIG, user: '' })
    } catch (error) {
      expect(error).toBeInstanceOf(BarsyConfigError)
      expect((error as Error).message).not.toContain(PASSWORD)
    }
  })
})

describe('logging', () => {
  it('logs every success with method, bid, request id and duration', async () => {
    await newClient().ping({ bid: 7 })
    await newClient().callMany({ Misc_ping: {}, Misc_ping_user: {} })
    const calls = logs.lines.filter((line) => line.msg === 'barsy call completed')
    expect(calls).toHaveLength(2)
    expect(calls[0]).toMatchObject({
      method: 'Misc_ping',
      bid: '7',
      requestId: '1:108914',
      status: 200,
    })
    expect(calls[1]).toMatchObject({
      method: 'Misc_ping,Misc_ping_user',
      bid: null,
      requestId: '1:108914',
    })
    for (const line of calls) {
      expect(typeof line.durationMs).toBe('number')
    }
  })

  it('logs every failure with method, bid, request id and duration', async () => {
    mock.setFixtures([PING, fixture({ method: 'Misc_ping_user', status: 500, requestId: '1:77' })])
    await newClient()
      .pingUser({ bid: 9 })
      .catch(() => undefined)
    const failed = logs.lines.filter((line) => line.level === 50)
    expect(failed).toHaveLength(1)
    expect(failed[0]).toMatchObject({
      method: 'Misc_ping_user',
      bid: '9',
      requestId: '1:77',
      status: 500,
      errorType: 'BarsyHttpError',
    })
    expect(typeof failed[0]?.durationMs).toBe('number')
  })

  it('logs a timeout with no request id', async () => {
    mock.server.use(
      http.post('https://demo.barsyonline.com/endpoints/json/Misc_ping', async () => {
        await delay(2_000)
        return HttpResponse.text('1')
      }),
    )
    await newClient({ timeoutMs: 30 })
      .ping()
      .catch(() => undefined)
    expect(logs.lines.at(-1)).toMatchObject({
      method: 'Misc_ping',
      requestId: null,
      errorType: 'BarsyTimeoutError',
    })
  })

  it('never logs the password, the Authorization header, or a response body', async () => {
    mock.setFixtures([
      fixture({ method: 'Misc_ping', body: '"guest@example.com"' }),
      fixture({ method: 'Misc_ping_user', status: 401, body: 'name=Ivan Petrov' }),
    ])
    const client = newClient()
    await client.ping().catch(() => undefined)
    await client.pingUser().catch(() => undefined)
    await client.callRaw('Misc_ping_user').catch(() => undefined)
    const everything = JSON.stringify(logs.lines)
    expect(logs.lines.length).toBeGreaterThanOrEqual(3)
    expect(everything).not.toContain(PASSWORD)
    expect(everything).not.toContain(BASIC)
    expect(everything).not.toContain(Buffer.from(`demo:${PASSWORD}`).toString('base64'))
    expect(everything.toLowerCase()).not.toContain('authorization')
    expect(everything).not.toContain('guest@example.com')
    expect(everything).not.toContain('Ivan Petrov')
  })

  it('the default logger redacts credentials even if a caller adds them to a log object', () => {
    // The client itself never logs them; this guards the default logger's redact paths.
    const lines: string[] = []
    const logger = createBarsyLogger({ write: (chunk: string) => void lines.push(chunk) })
    logger.info(
      { password: PASSWORD, headers: { authorization: BASIC }, auth: { password: PASSWORD } },
      'x',
    )
    const written = lines.join('')
    expect(written).not.toContain(PASSWORD)
    expect(written).not.toContain(BASIC)
    expect(written).toContain('[redacted]')
  })
})
