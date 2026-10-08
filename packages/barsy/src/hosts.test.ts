import fc from 'fast-check'
import { describe, expect, it } from 'vitest'

import { BarsyConfigError, BarsyHostNotAllowedError } from './errors.ts'
import {
  assertHostAllowed,
  BARSY_DEMO_HOST,
  type BarsyEnv,
  normaliseHost,
  parseAllowedHosts,
} from './hosts.ts'

const NON_PRODUCTION: BarsyEnv[] = ['development', 'test', 'staging']
const ALL_ENVS: BarsyEnv[] = [...NON_PRODUCTION, 'production']

describe('normaliseHost', () => {
  it.each([
    ['demo.barsyonline.com', 'demo.barsyonline.com'],
    ['https://demo.barsyonline.com', 'demo.barsyonline.com'],
    ['https://demo.barsyonline.com/', 'demo.barsyonline.com'],
    ['HTTPS://Demo.BarsyOnline.com', 'demo.barsyonline.com'],
    ['  demo.barsyonline.com  ', 'demo.barsyonline.com'],
    ['club.example.bg', 'club.example.bg'],
  ])('accepts %j', (input, expected) => {
    expect(normaliseHost(input)).toBe(expected)
  })

  it.each([
    '',
    '   ',
    'http://demo.barsyonline.com',
    'ftp://demo.barsyonline.com',
    'demo.barsyonline.com:8443',
    'https://demo.barsyonline.com:8443',
    'https://user@demo.barsyonline.com',
    'https://user:pw@demo.barsyonline.com',
    'demo.barsyonline.com/endpoints/json/',
    'https://demo.barsyonline.com/x',
    'https://demo.barsyonline.com?x=1',
    'https://demo.barsyonline.com?',
    'https://demo.barsyonline.com#top',
    'https://demo.barsyonline.com\\@evil.example',
    'demo.barsyonline.com evil.example',
    'demo.barsyonline.com\nevil.example',
    'https://',
  ])('refuses %j', (input) => {
    expect(() => normaliseHost(input)).toThrow(BarsyConfigError)
  })
})

describe('parseAllowedHosts', () => {
  it('splits a comma-separated list, trims, drops empty entries and normalises', () => {
    expect(parseAllowedHosts(' Club.Example.bg , https://other.example.bg/ ,, ')).toStrictEqual([
      'club.example.bg',
      'other.example.bg',
    ])
  })

  it('accepts a list and an absent value', () => {
    expect(parseAllowedHosts(['club.example.bg'])).toStrictEqual(['club.example.bg'])
    expect(parseAllowedHosts(undefined)).toStrictEqual([])
    expect(parseAllowedHosts('')).toStrictEqual([])
  })

  it('refuses a malformed entry instead of skipping it', () => {
    expect(() => parseAllowedHosts('club.example.bg,http://insecure.example.bg')).toThrow(
      BarsyConfigError,
    )
  })
})

describe('assertHostAllowed (CLAUDE.md rule 9)', () => {
  describe.each(NON_PRODUCTION)('in %s', (env) => {
    it('allows the demo installation without any allowlist', () => {
      expect(assertHostAllowed(BARSY_DEMO_HOST, env)).toBe(BARSY_DEMO_HOST)
      expect(assertHostAllowed('https://demo.barsyonline.com/', env)).toBe(BARSY_DEMO_HOST)
    })

    it('allows a host that is in the allowlist (string or list, any case)', () => {
      expect(assertHostAllowed('club.example.bg', env, 'club.example.bg')).toBe('club.example.bg')
      expect(assertHostAllowed('Club.Example.bg', env, ['x.example.bg', 'club.example.bg'])).toBe(
        'club.example.bg',
      )
      expect(
        assertHostAllowed('club.example.bg', env, 'a.example.bg, https://club.example.bg'),
      ).toBe('club.example.bg')
    })

    it('refuses a host that is neither the demo nor in the allowlist', () => {
      expect(() => assertHostAllowed('club.example.bg', env)).toThrow(BarsyHostNotAllowedError)
      expect(() => assertHostAllowed('club.example.bg', env, 'other.example.bg')).toThrow(
        BarsyHostNotAllowedError,
      )
    })

    it('refuses look-alikes of an allowed host', () => {
      for (const lookalike of [
        'demo.barsyonline.com.evil.example',
        'evil-demo.barsyonline.com',
        'xdemo.barsyonline.com',
        'demo.barsyonline.com.',
        'sub.demo.barsyonline.com',
      ]) {
        expect(() => assertHostAllowed(lookalike, env), lookalike).toThrow(BarsyHostNotAllowedError)
      }
    })
  })

  describe('in production', () => {
    it('refuses everything when no allowlist is set, the demo installation included', () => {
      expect(() => assertHostAllowed('club.example.bg', 'production')).toThrow(
        BarsyHostNotAllowedError,
      )
      expect(() => assertHostAllowed(BARSY_DEMO_HOST, 'production')).toThrow(
        BarsyHostNotAllowedError,
      )
      expect(() => assertHostAllowed('club.example.bg', 'production', '')).toThrow(
        /explicit BARSY_ALLOWED_HOSTS/,
      )
      expect(() => assertHostAllowed('club.example.bg', 'production', [])).toThrow(
        BarsyHostNotAllowedError,
      )
    })

    it('allows only hosts that are listed', () => {
      expect(assertHostAllowed('club.example.bg', 'production', 'club.example.bg')).toBe(
        'club.example.bg',
      )
      expect(() => assertHostAllowed('other.example.bg', 'production', 'club.example.bg')).toThrow(
        BarsyHostNotAllowedError,
      )
    })

    it('gives the demo installation no exception', () => {
      expect(() => assertHostAllowed(BARSY_DEMO_HOST, 'production', 'club.example.bg')).toThrow(
        BarsyHostNotAllowedError,
      )
      expect(assertHostAllowed(BARSY_DEMO_HOST, 'production', BARSY_DEMO_HOST)).toBe(
        BARSY_DEMO_HOST,
      )
    })
  })

  it('carries the host and environment on the error and nothing else', () => {
    try {
      assertHostAllowed('club.example.bg', 'staging', 'x.example.bg')
      expect.unreachable()
    } catch (error) {
      expect(error).toBeInstanceOf(BarsyHostNotAllowedError)
      const refused = error as BarsyHostNotAllowedError
      expect(refused.host).toBe('club.example.bg')
      expect(refused.env).toBe('staging')
    }
  })

  it('property: outside production a host is allowed exactly when it is the demo or listed; in production exactly when listed', () => {
    fc.assert(
      fc.property(
        fc.domain(),
        fc.array(fc.domain(), { maxLength: 4 }),
        fc.constantFrom(...ALL_ENVS),
        fc.boolean(),
        (host, listed, env, includeHost) => {
          const allowlist = includeHost
            ? [...listed, host]
            : listed.filter((entry) => entry !== host)
          const isListed = allowlist.includes(host)
          const allowed = env === 'production' ? isListed : isListed || host === BARSY_DEMO_HOST
          const attempt = () => assertHostAllowed(host, env, allowlist.join(','))
          if (allowed) {
            expect(attempt()).toBe(host)
          } else {
            expect(attempt).toThrow(BarsyHostNotAllowedError)
          }
        },
      ),
      { numRuns: 300 },
    )
  })
})
