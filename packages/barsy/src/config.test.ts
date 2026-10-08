import { describe, expect, it } from 'vitest'

import { BARSY_TIMEOUT_MS, loadBarsyConfig, parseClientConfig } from './config.ts'
import { BarsyConfigError } from './errors.ts'

const SECRET = 'correct-horse-battery-staple'

const validEnv = {
  BARSY_HOST: 'https://demo.barsyonline.com',
  BARSY_USER: 'demo',
  BARSY_PASSWORD: SECRET,
  BARSY_ENV: 'development',
}

describe('loadBarsyConfig', () => {
  it('reads the five variables', () => {
    const config = loadBarsyConfig({
      ...validEnv,
      BARSY_ALLOWED_HOSTS: 'club.example.bg, other.example.bg',
    })
    expect(config).toStrictEqual({
      host: 'https://demo.barsyonline.com',
      user: 'demo',
      password: SECRET,
      env: 'development',
      allowedHosts: ['club.example.bg', 'other.example.bg'],
      timeoutMs: BARSY_TIMEOUT_MS,
    })
  })

  it('treats BARSY_ALLOWED_HOSTS as optional', () => {
    expect(loadBarsyConfig(validEnv).allowedHosts).toStrictEqual([])
  })

  it('names every missing or empty variable and never a value', () => {
    expect.assertions(4)
    try {
      loadBarsyConfig({
        BARSY_HOST: 'demo.barsyonline.com',
        BARSY_USER: '',
        BARSY_PASSWORD: SECRET,
      })
    } catch (error) {
      expect(error).toBeInstanceOf(BarsyConfigError)
      const message = (error as Error).message
      expect(message).toContain('BARSY_USER')
      expect(message).toContain('BARSY_ENV')
      expect(message).not.toContain(SECRET)
    }
  })

  it('refuses an unknown BARSY_ENV without echoing it', () => {
    expect.assertions(3)
    try {
      loadBarsyConfig({ ...validEnv, BARSY_ENV: 'prod-ish-secret-value' })
    } catch (error) {
      const message = (error as Error).message
      expect(message).toContain('BARSY_ENV')
      expect(message).not.toContain('prod-ish-secret-value')
      expect(message).not.toContain(SECRET)
    }
  })

  it('refuses a user name with a colon (HTTP Basic cannot carry it)', () => {
    expect(() => loadBarsyConfig({ ...validEnv, BARSY_USER: 'a:b' })).toThrow(/BARSY_USER/)
  })

  it('names BARSY_ALLOWED_HOSTS when an entry is malformed', () => {
    expect(() =>
      loadBarsyConfig({ ...validEnv, BARSY_ALLOWED_HOSTS: 'http://insecure.example.bg' }),
    ).toThrow(/BARSY_ALLOWED_HOSTS/)
  })
})

describe('parseClientConfig', () => {
  it('fills the defaults', () => {
    const config = parseClientConfig({
      host: 'demo.barsyonline.com',
      user: 'demo',
      password: SECRET,
      env: 'test',
    })
    expect(config.timeoutMs).toBe(30_000)
    expect(config.allowedHosts).toStrictEqual([])
  })

  it('rejects unknown keys, so a typo cannot silently drop a setting', () => {
    expect(() =>
      parseClientConfig({
        host: 'demo.barsyonline.com',
        user: 'demo',
        password: SECRET,
        env: 'test',
        allowedHost: ['x'],
      }),
    ).toThrow(BarsyConfigError)
  })

  it('rejects a non-positive timeout', () => {
    expect(() =>
      parseClientConfig({
        host: 'demo.barsyonline.com',
        user: 'demo',
        password: SECRET,
        env: 'test',
        timeoutMs: 0,
      }),
    ).toThrow(BarsyConfigError)
  })
})
