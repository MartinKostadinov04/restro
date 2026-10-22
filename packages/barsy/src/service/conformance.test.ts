import { join } from 'node:path'

import { type PosCall, serviceReadSuite } from '@restro/core/connectors/testing'
import { delay, HttpResponse, http } from 'msw'
import { pino } from 'pino'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { createBarsyClient } from '../client.ts'
import { FIXTURES_ROOT, readFixture } from '../fixture-files.ts'
import { isBarsyReadMethod } from '../read-methods.ts'
import { createBarsyMockServer } from '../testing/mock-server.ts'
import * as write from '../write/index.ts'
import { createBarsyServiceReader } from './reader.ts'
import { BARSY_WAITER_ACTIONS } from './waiter-actions.ts'

// The connector conformance kit's read checks on barsy's recordings (ticket #65). MSW answers
// from fixtures/demo/; every POS call is seen on the wire, so "the probe writes nothing" is
// checked on what was actually sent. Nothing here reaches the network.

const DEMO = join(FIXTURES_ROOT, 'demo')
const healthy = await Promise.all(
  ['misc-ping-user.json', 'places-bid10.json'].map((name) => readFixture(join(DEMO, name))),
)
const unauthorised = await readFixture(join(DEMO, 'ping-user-unauthorised.json'))
const places = healthy[1]
if (places === undefined) throw new Error('the places recording is missing')

const mock = createBarsyMockServer(healthy)
const ANY = `https://${mock.host}/endpoints/json/*`

// Every request as it starts, before any handler: a stalled or failed call is seen too. A
// multi-method call is a write unless every method in its body is on the read allowlist.
const calls: PosCall[] = []
mock.server.events.on('request:start', ({ request }) => {
  const method = new URL(request.url).pathname.split('/').pop() ?? ''
  if (method !== '') {
    calls.push({ name: method, write: !isBarsyReadMethod(method) })
    return
  }
  const entry: { name: string; write: boolean } = { name: 'multi-method call', write: true }
  calls.push(entry)
  void request
    .clone()
    .json()
    .then((body: unknown) => {
      const names = body !== null && typeof body === 'object' ? Object.keys(body) : []
      entry.name = names.join(',')
      entry.write = names.length === 0 || !names.every(isBarsyReadMethod)
    })
    .catch(() => {})
})

beforeAll(() => mock.listen())
afterAll(() => mock.close())

const client = createBarsyClient(
  {
    host: 'https://demo.barsyonline.com',
    user: 'demo',
    password: 'test-password-not-a-real-one',
    env: 'test',
    // The client's own bound stays above the kit's timings, so only the context can end a call
    // quickly: the kit then proves the connector takes its timings from the platform.
    timeoutMs: 5_000,
  },
  { logger: pino({ level: 'silent' }) },
)
const connector = createBarsyServiceReader({ client, bid: places.bid ?? 10 })

serviceReadSuite({
  name: 'barsy',
  connector,
  pos: {
    reset() {
      mock.reset()
      calls.length = 0
    },
    calls: () => calls,
  },
  faults: {
    stall() {
      mock.server.use(
        http.post(ANY, async () => {
          await delay('infinite')
          return new HttpResponse(null, { status: 204 })
        }),
      )
    },
    failReadsFrom(n) {
      // Counts the calls from now on; a call before the nth falls through to the recordings.
      let seen = 0
      mock.server.use(
        http.post(ANY, () => {
          seen += 1
          if (seen >= n) return new HttpResponse('internal error', { status: 500 })
          return undefined
        }),
      )
    },
    refuseLogin() {
      mock.setFixtures([unauthorised, places])
    },
  },
  table: {
    none: 'barsy reads no table yet: Accounts_getlist is not on the read allowlist and has no recording (#47)',
  },
  writeModule: write,
  waiterActions: BARSY_WAITER_ACTIONS,
})

describe('barsy floor on the demo recording', () => {
  it('lists every place as a table, labelled by place_num, in its hall, with no bar', async () => {
    mock.reset()
    const reading = await connector.readFloor({
      now: () => new Date(),
      timings: {
        probeBudgetMs: 3_000,
        readTimeoutMs: 3_000,
        writeTimeoutMs: 3_000,
        readBackWindowMs: 60_000,
      },
    })
    expect(reading.complete).toBe(true)
    if (!reading.complete) return
    const recorded = JSON.parse(places.body) as {
      place_id: number
      place_num: string
      salon_name: string
    }[]
    expect(reading.value.bars).toStrictEqual([])
    expect(reading.value.tables).toHaveLength(new Set(recorded.map((p) => p.place_id)).size)
    const first = recorded.find((p) => p.place_id === 1344)
    expect(reading.value.tables.find((t) => t.ref.pos === '1344')).toStrictEqual({
      ref: { pos: '1344' },
      name: first?.place_num,
      area: first?.salon_name,
      bar: null,
      paymentTable: null,
    })
  })
})
