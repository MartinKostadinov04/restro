// The simulated POS in the web app's registry (#71): the systems picker offers it in development,
// test and staging and hides it in production (and wherever the environment says nothing); an
// existing `sim` instance has no tab in production; its host is a bare host with an optional port.
// The worker's own refusal in production is pinned in apps/worker (service-connectors.test.ts and
// tests/floor-read.test.ts).
import { describe, expect, it } from 'vitest'

import { connectorServer, simOffered, systemKinds } from './server'
import { parseSimHost } from './sim/server'

describe('the simulated POS in the systems picker', () => {
  it.each(['development', 'test', 'staging', ' Staging '])(
    'is offered when BARSY_ENV is %s',
    (label) => {
      const env = { BARSY_ENV: label }
      expect(simOffered(env)).toBe(true)
      expect(systemKinds(env)).toEqual(['barsy', 'sim'])
      expect(connectorServer('sim', env)?.kind).toBe('sim')
    },
  )

  it.each([
    ['production', { BARSY_ENV: 'production' }],
    ['PRODUCTION', { BARSY_ENV: 'PRODUCTION' }],
    ['no label at all', {}],
    ['an empty label', { BARSY_ENV: '' }],
    ['a label nobody knows', { BARSY_ENV: 'prod-ish' }],
  ])('is hidden for %s', (_name, env) => {
    expect(simOffered(env)).toBe(false)
    expect(systemKinds(env)).toEqual(['barsy'])
    // An existing sim instance has no connector, so no tab to show it in.
    expect(connectorServer('sim', env)).toBeNull()
    // The real system is unaffected.
    expect(connectorServer('barsy', env)?.kind).toBe('barsy')
  })

  it('never offers a kind it does not know', () => {
    expect(connectorServer('mistral', { BARSY_ENV: 'development' })).toBeNull()
  })
})

describe('the simulated POS host', () => {
  it('takes a bare host with an optional port, in lower case', () => {
    expect(parseSimHost('localhost:4010')).toEqual({ ok: true, host: 'localhost:4010' })
    expect(parseSimHost(' 127.0.0.1:4010 ')).toEqual({ ok: true, host: '127.0.0.1:4010' })
    expect(parseSimHost('Demo.Sim.Example')).toEqual({ ok: true, host: 'demo.sim.example' })
  })

  it.each([
    '',
    'http://localhost:4010',
    'localhost:4010/api',
    'user@localhost',
    'localhost:0',
    'localhost:70000',
    'local host',
    '-bad.example',
  ])('refuses %j', (input) => {
    expect(parseSimHost(input)).toEqual({ ok: false })
  })
})
