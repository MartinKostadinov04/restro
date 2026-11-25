import { describe, expect, it } from 'vitest'

import { ManualClock } from '../engine/clock'
import { SimEngine } from '../engine/engine'
import { SIM_PASSWORD } from '../engine/scenario'
import { switchesOf } from '../switches'
import { basicAuthHeader, serveWire, type WireRequest } from './serve'

const AUTH = { authorization: basicAuthHeader('restro bar 1', SIM_PASSWORD) }
const BASE = 'http://sim-pos.localhost'

function engineOf(changes: Parameters<typeof switchesOf>[1] = {}) {
  return new SimEngine({ switches: switchesOf('cautious', changes), clock: new ManualClock() })
}

const get = (path: string, headers: WireRequest['headers'] = AUTH): WireRequest => ({
  method: 'GET',
  url: `${BASE}${path}`,
  headers,
  body: null,
})

describe('the wire', () => {
  it('sends a number-shaped id as a JSON number, any other id as text', async () => {
    const answer = await serveWire(engineOf(), get('/api/tables?page=1'))
    expect(answer.status).toBe(200)
    expect(answer.body).toContain('"id":30007')
    expect(answer.body).toContain('"id":"T 8 hall"')
  })

  it('sends money as JSON floats, or as decimal text with the switch off', async () => {
    const path = (engine: SimEngine) => {
      const bill = engine.state.bills.find((b) => b.table === 'T 8 hall')
      return `/api/bills/${encodeURIComponent(bill?.id ?? '')}/rows?page=1`
    }
    const floats = engineOf()
    expect((await serveWire(floats, get(path(floats)))).body).toContain('"price":4.5,')
    const text = engineOf({ pricesAsJsonFloats: false })
    expect((await serveWire(text, get(path(text)))).body).toContain('"price":"4.50"')
  })

  it('refuses a missing or wrong login with 401', async () => {
    expect((await serveWire(engineOf(), get('/api/ping', {}))).status).toBe(401)
    const wrong = { authorization: basicAuthHeader('restro bar 1', 'nope') }
    expect((await serveWire(engineOf(), get('/api/ping', wrong))).status).toBe(401)
  })

  it('answers 404 for a path the POS does not have and 400 for a malformed body', async () => {
    expect((await serveWire(engineOf(), get('/api/prices'))).status).toBe(404)
    const bad = await serveWire(engineOf(), {
      method: 'POST',
      url: `${BASE}/api/tables/30007/rows`,
      headers: AUTH,
      body: '{"bill":"new","rows":[{"article":"1001","quantity":"1","price":1}]}',
    })
    expect(bad.status).toBe(400)
  })

  it('answers an undefined behaviour with 501', async () => {
    const answer = await serveWire(engineOf(), get('/api/bars?page=1'))
    expect(answer.status).toBe(501)
    expect(JSON.parse(answer.body)).toMatchObject({ error: 'undefined_behaviour' })
  })
})
