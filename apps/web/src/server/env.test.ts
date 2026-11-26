// The web app can seal barsy credentials but never open them (D55, brief S2-03a): it never
// declares or reads the sealing private key. The dependency-cruiser rule
// `seal-open-only-from-worker` keeps it from importing the opening code.
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { bookingFrameAncestors, defaultQrBaseUrl, ServerEnvSchema, webPushPublicKey } from './env'

// Built from two halves so that this file does not match its own search.
const PRIVATE_KEY_VARIABLE = ['SEAL', 'PRIVATE', 'KEY'].join('_')
const WEB_ROOT = fileURLToPath(new URL('../../', import.meta.url))
// No exemption for `playwright.config.ts`: it blanks every sealing key it finds without naming one.
const SKIPPED = new Set(['node_modules', '.next', 'test-results', 'playwright-report'])

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    if (SKIPPED.has(name)) return []
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return sourceFiles(path)
    return /\.(ts|tsx|js|mjs|cjs|json)$/.test(name) ? [path] : []
  })
}

describe('the web app and the Web Push keys (RR-86)', () => {
  const base = {
    DATABASE_URL: 'postgres://restro_app:x@localhost:54329/restro',
    BETTER_AUTH_SECRET: 'x'.repeat(32),
  }
  const PUBLIC_KEY = `B${'p'.repeat(86)}`
  // Built from two halves so that this file does not match its own search.
  const PRIVATE_PUSH_KEY = ['VAPID', 'PRIVATE', 'KEY'].join('_')

  it('declares the public key: unset, empty or misshapen means no control, and nothing throws', () => {
    expect(webPushPublicKey(ServerEnvSchema.parse(base))).toBeUndefined()
    expect(
      webPushPublicKey(ServerEnvSchema.parse({ ...base, VAPID_PUBLIC_KEY: ' ' })),
    ).toBeUndefined()
    expect(
      webPushPublicKey(ServerEnvSchema.parse({ ...base, VAPID_PUBLIC_KEY: 'not a key' })),
    ).toBeUndefined()
    expect(
      webPushPublicKey(ServerEnvSchema.parse({ ...base, VAPID_PUBLIC_KEY: ` ${PUBLIC_KEY} ` })),
    ).toBe(PUBLIC_KEY)
  })

  it('never reads the private key, which the worker alone holds', () => {
    expect(Object.keys(ServerEnvSchema.shape)).not.toContain(PRIVATE_PUSH_KEY)
    const parsed = ServerEnvSchema.parse({ ...base, [PRIVATE_PUSH_KEY]: 'should-never-be-kept' })
    expect(Object.keys(parsed)).not.toContain(PRIVATE_PUSH_KEY)
    const named = sourceFiles(WEB_ROOT).filter((file) =>
      readFileSync(file, 'utf8').includes(PRIVATE_PUSH_KEY),
    )
    expect(named).toEqual([])
  })
})

describe('the web app and the sealing private key', () => {
  it('the server settings do not declare it', () => {
    expect(Object.keys(ServerEnvSchema.shape)).not.toContain(PRIVATE_KEY_VARIABLE)
    const parsed = ServerEnvSchema.parse({
      DATABASE_URL: 'postgres://restro_app:x@localhost:54329/restro',
      BETTER_AUTH_SECRET: 'x'.repeat(32),
      [PRIVATE_KEY_VARIABLE]: 'should-never-be-kept',
    })
    expect(Object.keys(parsed)).not.toContain(PRIVATE_KEY_VARIABLE)
  })

  it('declares the public key, and treats an empty one as missing', () => {
    const base = {
      DATABASE_URL: 'postgres://restro_app:x@localhost:54329/restro',
      BETTER_AUTH_SECRET: 'x'.repeat(32),
    }
    expect(ServerEnvSchema.parse(base).SEAL_PUBLIC_KEY).toBeUndefined()
    expect(ServerEnvSchema.parse({ ...base, SEAL_PUBLIC_KEY: '' }).SEAL_PUBLIC_KEY).toBeUndefined()
    expect(ServerEnvSchema.parse({ ...base, SEAL_PUBLIC_KEY: '  MCow  ' }).SEAL_PUBLIC_KEY).toBe(
      'MCow',
    )
  })

  it('declares the PIN pepper (#72), and treats an empty one as missing', () => {
    const base = {
      DATABASE_URL: 'postgres://restro_app:x@localhost:54329/restro',
      BETTER_AUTH_SECRET: 'x'.repeat(32),
    }
    expect(ServerEnvSchema.parse(base).STAFF_PIN_PEPPER).toBeUndefined()
    expect(
      ServerEnvSchema.parse({ ...base, STAFF_PIN_PEPPER: ' ' }).STAFF_PIN_PEPPER,
    ).toBeUndefined()
    const pepper = 'p'.repeat(44)
    expect(ServerEnvSchema.parse({ ...base, STAFF_PIN_PEPPER: pepper }).STAFF_PIN_PEPPER).toBe(
      pepper,
    )
  })

  it('refuses a guest link key the worker would refuse (#579), at start-up, never naming it', () => {
    const base = {
      DATABASE_URL: 'postgres://restro_app:x@localhost:54329/restro',
      BETTER_AUTH_SECRET: 'x'.repeat(32),
    }
    expect(ServerEnvSchema.parse(base).GUEST_LINK_KEY).toBeUndefined()
    expect(ServerEnvSchema.parse({ ...base, GUEST_LINK_KEY: ' ' }).GUEST_LINK_KEY).toBeUndefined()
    const key = 'k'.repeat(32)
    expect(ServerEnvSchema.parse({ ...base, GUEST_LINK_KEY: ` ${key} ` }).GUEST_LINK_KEY).toBe(key)
    for (const bad of ['short-key', 'k'.repeat(257), `${'k'.repeat(20)} ${'k'.repeat(20)}`]) {
      const parsed = ServerEnvSchema.safeParse({ ...base, GUEST_LINK_KEY: bad })
      expect(parsed.success, bad).toBe(false)
      expect(JSON.stringify(parsed.error?.issues)).not.toContain(bad)
    }
  })

  it('knows the address QR codes are printed with by default (PUBLIC_BASE_URL, else BETTER_AUTH_URL)', () => {
    const base = {
      DATABASE_URL: 'postgres://restro_app:x@localhost:54329/restro',
      BETTER_AUTH_SECRET: 'x'.repeat(32),
    }
    const parse = (extra: Record<string, string>) => ServerEnvSchema.parse({ ...base, ...extra })
    expect(defaultQrBaseUrl(parse({}))).toBeNull()
    expect(defaultQrBaseUrl(parse({ BETTER_AUTH_URL: 'http://localhost:3000' }))).toBe(
      'http://localhost:3000',
    )
    expect(
      defaultQrBaseUrl(
        parse({
          BETTER_AUTH_URL: 'http://localhost:3000',
          PUBLIC_BASE_URL: 'https://menu.example',
        }),
      ),
    ).toBe('https://menu.example')
    // Empty counts as missing.
    expect(
      defaultQrBaseUrl(parse({ BETTER_AUTH_URL: 'http://localhost:3000', PUBLIC_BASE_URL: '  ' })),
    ).toBe('http://localhost:3000')
  })

  it('no file of the web app names it', () => {
    const files = sourceFiles(WEB_ROOT)
    expect(files.length).toBeGreaterThan(20)
    const naming = files.filter((file) => readFileSync(file, 'utf8').includes(PRIVATE_KEY_VARIABLE))
    expect(naming).toEqual([])
  })
})

describe('the sites that may frame the booking page (#581, D178)', () => {
  const read = (value: string | undefined) =>
    bookingFrameAncestors({ BOOKING_FRAME_ANCESTORS: value })

  it('is none when unset or empty', () => {
    expect(bookingFrameAncestors({})).toEqual([])
    expect(read('')).toEqual([])
    expect(read(' , ')).toEqual([])
  })

  it('takes one to three https origins, separated by commas, as the browser writes them', () => {
    expect(read('https://club.example')).toEqual(['https://club.example'])
    expect(
      read(' https://Club.Example/ , https://www.club.example:8443,https://a.b.example '),
    ).toEqual(['https://club.example', 'https://www.club.example:8443', 'https://a.b.example'])
    // The same site twice is named once.
    expect(read('https://club.example,https://club.example/')).toEqual(['https://club.example'])
  })

  it('takes plain http only for this PC and the local network', () => {
    expect(read('http://localhost:3104,http://127.0.0.1:3104,http://192.168.1.20:8080')).toEqual([
      'http://localhost:3104',
      'http://127.0.0.1:3104',
      'http://192.168.1.20:8080',
    ])
  })

  it.each([
    ['a path', 'https://club.example/booking'],
    ['a query', 'https://club.example?x=1'],
    ['a #part', 'https://club.example#top'],
    ['a public http address', 'http://club.example'],
    ['a public http address beside a good one', 'https://ok.example,http://club.example'],
    ['more than three', 'https://a.example,https://b.example,https://c.example,https://d.example'],
    ['a wildcard', 'https://*.club.example'],
    ['policy syntax', "https://club.example;script-src 'unsafe-inline'"],
    ['a keyword', "'self'"],
    ['a name and password', 'https://user:hunter2@club.example'],
    ['no scheme', 'club.example'],
    ['another scheme', 'ftp://club.example'],
  ])('refuses %s, naming the variable and never the value', (_case, value) => {
    let message = ''
    try {
      read(value)
    } catch (error) {
      message = (error as Error).message
    }
    expect(message).toContain('BOOKING_FRAME_ANCESTORS')
    expect(message).not.toContain(value)
    expect(message).not.toContain('club.example')
    expect(message).not.toContain('hunter2')
  })
})
