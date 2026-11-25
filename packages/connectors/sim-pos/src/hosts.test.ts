import { describe, expect, it } from 'vitest'

import { checkSimHost, SimHostNotAllowedError } from './hosts'

describe('the host guard (rule 9)', () => {
  it('allows local development hosts and listed hosts outside production', () => {
    for (const url of [
      'http://localhost:4010',
      'http://127.0.0.1:4010',
      'http://[::1]:4010',
      'http://pilot.sim-pos.localhost',
      'https://sim.restro.test',
    ]) {
      expect(checkSimHost(url, { env: 'development' }).href).toContain('/')
    }
    expect(
      checkSimHost('https://sim.staging.example.com', {
        env: 'staging',
        allowHosts: ['sim.staging.example.com'],
      }).hostname,
    ).toBe('sim.staging.example.com')
  })

  it('refuses any other host, odd URLs, and production altogether', () => {
    const refused = (url: string, env: 'test' | 'production' = 'test') =>
      expect(() => checkSimHost(url, { env, allowHosts: ['sim.example.com'] })).toThrow(
        SimHostNotAllowedError,
      )
    refused('https://pos.example.com')
    refused('ftp://localhost')
    refused('http://user:pw@localhost')
    refused('http://localhost?x=1')
    refused('not a url')
    refused('http://localhost', 'production')
    refused('https://sim.example.com', 'production')
  })
})
