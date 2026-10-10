// The web app can seal barsy credentials but never open them (D55, brief S2-03a): it never
// declares or reads the sealing private key. The dependency-cruiser rule
// `seal-open-only-from-worker` keeps it from importing the opening code.
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { ServerEnvSchema } from './env'

// Built from two halves so that this file does not match its own search.
const PRIVATE_KEY_VARIABLE = ['SEAL', 'PRIVATE', 'KEY'].join('_')
const WEB_ROOT = fileURLToPath(new URL('../../', import.meta.url))
const SKIPPED = new Set(['node_modules', '.next', 'test-results', 'playwright-report'])

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    if (SKIPPED.has(name)) return []
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return sourceFiles(path)
    return /\.(ts|tsx|js|mjs|cjs|json)$/.test(name) ? [path] : []
  })
}

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

  it('no file of the web app names it', () => {
    const files = sourceFiles(WEB_ROOT)
    expect(files.length).toBeGreaterThan(20)
    const naming = files.filter((file) => readFileSync(file, 'utf8').includes(PRIVATE_KEY_VARIABLE))
    expect(naming).toEqual([])
  })
})
