import { join } from 'node:path'

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import { createBarsyClient } from '../client.ts'
import { type BarsyFixture, fixtureSchema } from '../fixture.ts'
import { FIXTURES_ROOT, readFixture } from '../fixture-files.ts'
import { createBarsyMockServer } from './mock-server.ts'

function fixture(overrides: Partial<BarsyFixture> & Pick<BarsyFixture, 'method'>): BarsyFixture {
  return fixtureSchema.parse({
    params: {},
    bid: null,
    recordedAt: '2026-10-08T17:00:00.000Z',
    status: 200,
    requestId: '1:1',
    body: '1',
    ...overrides,
  })
}

const BASE = 'https://demo.barsyonline.com/endpoints/json/'
const post = (path: string, body: unknown = {}) =>
  fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

describe('createBarsyMockServer', () => {
  const mock = createBarsyMockServer([
    fixture({ method: 'Misc_ping' }),
    fixture({
      method: 'Articles_getlist',
      body: '{"actual_price": 2.40, "big": 12345678901234567890}',
    }),
    fixture({ method: 'Misc_ping_user', status: 401, body: '', requestId: '1:2' }),
  ])
  beforeAll(() => mock.listen())
  afterEach(() => mock.reset())
  afterAll(() => mock.close())

  it('serves a single call with the recorded status, request id and body text', async () => {
    const response = await post('Articles_getlist?bid=1')
    expect(response.status).toBe(200)
    expect(response.headers.get('BARSY_REQUEST_ID')).toBe('1:1')
    expect(await response.text()).toBe('{"actual_price": 2.40, "big": 12345678901234567890}')
    expect(mock.requests[0]).toMatchObject({
      methods: ['Articles_getlist'],
      multi: false,
      bid: '1',
    })
  })

  it('serves a recorded 401 with no body at all', async () => {
    const response = await post('Misc_ping_user')
    expect(response.status).toBe(401)
    expect(response.headers.get('BARSY_REQUEST_ID')).toBe('1:2')
    expect(await response.text()).toBe('')
  })

  it('answers a multi-method call with an object keyed by method name, bodies spliced in untouched', async () => {
    const response = await post('?bid=3', { Articles_getlist: {}, Misc_ping: {} })
    expect(response.status).toBe(200)
    // The text is assembled, not re-serialised: 2.40 stays 2.40.
    expect(await response.text()).toBe(
      '{"Articles_getlist":{"actual_price": 2.40, "big": 12345678901234567890},"Misc_ping":1}',
    )
    expect(mock.requests[0]).toMatchObject({
      methods: ['Articles_getlist', 'Misc_ping'],
      multi: true,
      bid: '3',
    })
  })

  it('answers 501 when there is no fixture for a method', async () => {
    const single = await post('Currencies_getlist')
    expect(single.status).toBe(501)
    expect(await single.text()).toContain('no fixture for method Currencies_getlist')
    const multi = await post('', { Misc_ping: {}, Currencies_getlist: {} })
    expect(multi.status).toBe(501)
  })

  it('refuses to invent how barsy reports a failure inside a multi-method call', async () => {
    const response = await post('', { Misc_ping: {}, Misc_ping_user: {} })
    expect(response.status).toBe(501)
    expect(await response.text()).toContain('undocumented')
  })

  it('answers 400 to a multi-method body that is not an object', async () => {
    expect((await post('', [1])).status).toBe(400)
  })

  it('setFixtures swaps the answers and reset restores the originals', async () => {
    mock.setFixtures([fixture({ method: 'Misc_ping', body: '2' })])
    expect(await (await post('Misc_ping')).text()).toBe('2')
    expect(mock.requests).toHaveLength(1)
    mock.reset()
    expect(mock.requests).toHaveLength(0)
    expect(await (await post('Misc_ping')).text()).toBe('1')
  })

  it('never lets a request reach the real network: other hosts and paths fail the call', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    try {
      await expect(fetch('https://example.com/')).rejects.toThrow()
      await expect(fetch('https://demo.barsyonline.com/other')).rejects.toThrow()
      await expect(fetch(`${BASE}Misc_ping`)).rejects.toThrow() // GET, not POST
    } finally {
      errors.mockRestore()
    }
  })
})

describe('createBarsyMockServer options', () => {
  it('refuses two fixtures for one method', () => {
    expect(() =>
      createBarsyMockServer([fixture({ method: 'Misc_ping' }), fixture({ method: 'Misc_ping' })]),
    ).toThrow(/two fixtures for Misc_ping/)
  })

  it('answers for another host when asked to', async () => {
    const other = createBarsyMockServer([fixture({ method: 'Misc_ping' })], {
      host: 'club.example.bg',
    })
    other.listen()
    try {
      const client = createBarsyClient(
        {
          host: 'club.example.bg',
          user: 'u',
          password: 'p',
          env: 'test',
          allowedHosts: 'club.example.bg',
        },
        { logger: (await import('pino')).pino({ level: 'silent' }) },
      )
      expect((await client.ping()).data).toBe(1)
      expect(other.requests[0]?.url).toBe('https://club.example.bg/endpoints/json/Misc_ping')
    } finally {
      other.close()
    }
  })

  it('serves the committed handmade fixtures to the client', async () => {
    const dir = join(FIXTURES_ROOT, 'handmade')
    const ping = await readFixture(join(dir, 'ping-ok.json'))
    const pingUser401 = await readFixture(join(dir, 'ping-user-unauthorised.json'))
    const handmade = createBarsyMockServer([ping, pingUser401])
    handmade.listen()
    try {
      const response = await post('Misc_ping_user')
      expect(response.status).toBe(401)
      expect(await (await post('Misc_ping')).text()).toBe('1')
    } finally {
      handmade.close()
    }
  })
})
