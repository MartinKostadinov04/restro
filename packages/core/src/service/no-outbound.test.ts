// Nothing inside a service transaction calls a POS or a payment provider (D117, design §2.3;
// ticket #69): those calls are worker jobs outside any transaction, so a row lock is held for
// milliseconds, never for a POS's timeout. This static check keeps the service path free of any
// way out: no connector, no fetch, no HTTP client. Only tightens (D67).
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const root = fileURLToPath(new URL('.', import.meta.url))

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return sourceFiles(path)
    return entry.name.endsWith('.ts') && !/\.(test|spec)\.ts$/.test(entry.name) ? [path] : []
  })
}

/** What would let a service transaction reach outside the database. */
const OUTBOUND: readonly RegExp[] = [
  /\bfetch\s*\(/,
  /from\s+['"](node:)?(http|https|net|tls|dgram)['"]/,
  /from\s+['"](undici|axios|got|ky)['"]/,
  // Of the workspace packages, the service path imports only the database's.
  /from\s+['"]@restro\/(?!db['"/])/,
  /from\s+['"][./]*connectors\//,
  /\bServiceConnector\b/,
]

describe('the service path calls no POS and no provider', () => {
  const files = sourceFiles(root)

  it('finds the service files (the guard is looking at real files)', () => {
    expect(files.length).toBeGreaterThan(5)
  })

  it('no service file can reach a POS, a provider or the network', () => {
    const found = files.flatMap((file) => {
      const text = readFileSync(file, 'utf8')
      return OUTBOUND.filter((pattern) => pattern.test(text)).map(
        (pattern) => `${relative(root, file)}: ${pattern}`,
      )
    })
    expect(found).toEqual([])
  })

  it('catches what it is meant to catch (self-test on text)', () => {
    const hit = (text: string) => OUTBOUND.some((pattern) => pattern.test(text))
    expect(hit('await fetch(url)')).toBe(true)
    expect(hit("import { request } from 'node:https'")).toBe(true)
    expect(hit("import { readTable } from '../connectors/service/connector'")).toBe(true)
    expect(hit("import { engine } from '@restro/sim-pos'")).toBe(true)
    expect(hit("import { locks } from '@restro/db'")).toBe(false)
    expect(hit('await tx.select().from(locks)')).toBe(false)
  })
})
