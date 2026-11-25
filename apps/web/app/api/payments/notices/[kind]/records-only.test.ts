// The notice route records and does nothing else (#108; D127 1.4). The web app and the worker
// share the restro_app role, so the database's grants cannot tell the route from the worker: this
// static check does. Of core/service the route and everything it reaches import only
// `recordProviderNotice` (`@restro/core/service/notices`; the dependency rule
// `notice-route-records-only` too); nothing they reach imports the database's write side, core's
// write paths or Drizzle, or calls a write; and of `@/server/db` the route takes only `getPool`.
// Only tightens (D67).
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const here = fileURLToPath(new URL('.', import.meta.url))
const webRoot = resolve(here, '../../../../..')
const srcRoot = join(webRoot, 'src')

/** Where the walk stops: the pool's module, checked for what the route takes from it. */
const POOL_MODULE = join(srcRoot, 'server', 'db.ts')

interface Import {
  readonly names: string
  readonly from: string
}

function importsOf(text: string): Import[] {
  return [
    ...text.matchAll(/^\s*(?:import|export)\s+(?:type\s+)?([\s\S]*?)\s*from\s+['"]([^'"]+)['"]/gm),
    ...text.matchAll(/^\s*import\s+['"]([^'"]+)['"]/gm),
  ].map((match) =>
    match[2] === undefined
      ? { names: '', from: match[1] ?? '' }
      : { names: match[1] ?? '', from: match[2] },
  )
}

function resolveLocal(fromFile: string, specifier: string): string | null {
  const base = specifier.startsWith('@/')
    ? join(srcRoot, specifier.slice(2))
    : specifier.startsWith('.')
      ? resolve(dirname(fromFile), specifier)
      : null
  if (base === null) return null
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, join(base, 'index.ts')]) {
    if (/\.tsx?$/.test(candidate) && existsSync(candidate)) {
      return candidate
    }
  }
  throw new Error(`cannot resolve ${specifier} from ${fromFile}`)
}

/** The route folder's files and every app file they reach, with the imports of each. */
function reached(): Map<string, Import[]> {
  const start = readdirSync(here)
    .filter((name) => /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name))
    .map((name) => join(here, name))
  const seen = new Map<string, Import[]>()
  const queue = [...start]
  while (queue.length > 0) {
    const file = queue.shift()
    if (file === undefined || seen.has(file)) continue
    const imports = importsOf(readFileSync(file, 'utf8'))
    seen.set(file, imports)
    if (file === POOL_MODULE) continue
    for (const { from } of imports) {
      const local = resolveLocal(file, from)
      if (local !== null) queue.push(local)
    }
  }
  // The registry finds the provider folders by glob, which no import names.
  for (const folder of readdirSync(join(srcRoot, 'connectors'), { withFileTypes: true })) {
    const notices = join(srcRoot, 'connectors', folder.name, 'notices.ts')
    if (folder.isDirectory() && existsSync(notices) && !seen.has(notices)) {
      const imports = importsOf(readFileSync(notices, 'utf8'))
      seen.set(notices, imports)
      for (const { from } of imports) {
        const local = resolveLocal(notices, from)
        if (local !== null && !seen.has(local)) {
          seen.set(local, importsOf(readFileSync(local, 'utf8')))
        }
      }
    }
  }
  return seen
}

const rel = (file: string) => relative(webRoot, file).replaceAll(sep, '/')

describe('the notice route records only', () => {
  const files = reached()

  it('reaches the route, its handler, the registry and every provider verifier', () => {
    const names = [...files.keys()].map(rel)
    for (const expected of [
      'app/api/payments/notices/[kind]/route.ts',
      'app/api/payments/notices/[kind]/handle.ts',
      'src/connectors/notices.ts',
      'src/connectors/sim-pay/notices.ts',
      'src/connectors/stripe/notices.ts',
      'src/connectors/signed-notices.ts',
    ]) {
      expect(names).toContain(expected)
    }
  })

  it('imports of core/service only recordProviderNotice, from its own module', () => {
    const found = [...files].flatMap(([file, imports]) =>
      imports
        .filter(({ from }) => from.startsWith('@restro/core/service'))
        .map(({ names, from }) => `${rel(file)}: ${names.replace(/\s+/g, ' ')} from ${from}`),
    )
    expect(found).toEqual([
      'app/api/payments/notices/[kind]/handle.ts: { RecordProviderNoticeInput } from @restro/core/service/notices',
      'app/api/payments/notices/[kind]/route.ts: { recordProviderNotice } from @restro/core/service/notices',
    ])
  })

  it('takes nothing else from the pool module, and reaches no write side', () => {
    const fromPool = [...files].flatMap(([file, imports]) =>
      imports
        .filter(({ from }) => from === '@/server/db')
        .map(({ names }) => `${rel(file)}: ${names.replace(/\s+/g, ' ')}`),
    )
    expect(fromPool).toEqual(['app/api/payments/notices/[kind]/route.ts: { getPool }'])
    const writes = [...files]
      .filter(([file]) => file !== POOL_MODULE)
      .flatMap(([file, imports]) => [
        ...imports
          .filter(({ from }) =>
            /^(@restro\/db|drizzle-orm|pg$|@restro\/core\/(apply|service$))/.test(from),
          )
          .map(({ from }) => `${rel(file)}: imports ${from}`),
        // A Drizzle write names its table: `.insert(table)` (an HMAC's `.update(text)` is no write).
        ...(/\.(insert|update|delete)\(\s*[A-Za-z_$][\w$]*\s*\)|\b(withSystem|withTenant|applyService)\b/.test(
          readFileSync(file, 'utf8'),
        )
          ? [`${rel(file)}: writes`]
          : []),
      ])
    expect(writes).toEqual([])
  })

  it('catches what it is meant to catch (self-test on text)', () => {
    expect(importsOf("import { applyService } from '@restro/core/service'")).toEqual([
      { names: '{ applyService }', from: '@restro/core/service' },
    ])
    expect(importsOf("import type { X } from '@restro/db'\nimport 'server-only'")).toEqual([
      { names: '{ X }', from: '@restro/db' },
      { names: '', from: 'server-only' },
    ])
  })
})
