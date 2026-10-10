import { describe, expect, it } from 'vitest'

import type { BarsyPolicy } from '../config'
import { SyncError } from './errors'
import { assertSyncHost } from './host-policy'

const policy = (overrides: Partial<BarsyPolicy> = {}): BarsyPolicy => ({
  env: 'staging',
  allowedHostSuffixes: ['.barsyonline.com'],
  productionHosts: ['live-club.barsyonline.com'],
  ...overrides,
})

const refusal = (host: string, p = policy()) => {
  try {
    assertSyncHost(host, p)
  } catch (error) {
    if (error instanceof SyncError) return error
    throw error
  }
  throw new Error(`${host} was accepted`)
}

describe('assertSyncHost', () => {
  it('accepts a host under an allowed suffix, normalised', () => {
    expect(assertSyncHost('demo.barsyonline.com', policy())).toBe('demo.barsyonline.com')
    expect(assertSyncHost('  Demo.BarsyOnline.com ', policy())).toBe('demo.barsyonline.com')
    expect(assertSyncHost('https://demo.barsyonline.com/', policy())).toBe('demo.barsyonline.com')
  })

  it('refuses any host outside the suffixes, however it is dressed up', () => {
    for (const host of [
      'evil.example.com',
      'barsyonline.com',
      '.barsyonline.com',
      'demo.barsyonline.com.evil.example.com',
      'xbarsyonline.com',
      'demo.barsyonline.co',
      'localhost',
      '127.0.0.1',
    ]) {
      expect(refusal(host).code, host).toBe('host_refused')
    }
  })

  it('refuses a host that is not a plain https host name', () => {
    for (const host of [
      'http://demo.barsyonline.com',
      'demo.barsyonline.com:8443',
      'demo.barsyonline.com/path',
      'user@demo.barsyonline.com',
      'demo.barsyonline.com?x=1',
      '',
    ]) {
      expect(refusal(host).code, host).toBe('host_refused')
    }
  })

  it('every environment but production refuses the listed production hosts (rule 9)', () => {
    for (const env of ['development', 'test', 'staging'] as const) {
      expect(refusal('live-club.barsyonline.com', policy({ env })).message).toContain('production')
    }
    expect(assertSyncHost('live-club.barsyonline.com', policy({ env: 'production' }))).toBe(
      'live-club.barsyonline.com',
    )
  })

  it('the suffixes are configurable', () => {
    const custom = policy({ allowedHostSuffixes: ['.barsy.test', '.pilot.example.org'] })
    expect(assertSyncHost('club.barsy.test', custom)).toBe('club.barsy.test')
    expect(refusal('demo.barsyonline.com', custom).code).toBe('host_refused')
  })

  it('error texts hold no host, so nothing leaks into status details', () => {
    expect(refusal('secret-club.evil.example.com').message).not.toContain('secret-club')
  })
})
