// Fuzz on every Zod boundary (the repair-review's A7), with fast-check, on a real Postgres as
// restro_app. Every server action takes arbitrary JSON, and JSON that holds the org's real ids under
// the names the actions use: none may throw, or let a bad value reach the database. The guest API
// takes mutated bodies and never answers a 5xx.
import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'

import type { DbPool } from '@restro/db'
import fc from 'fast-check'
import type pg from 'pg'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import { getPool } from '../db'
import { handleGuestAction, handleGuestState } from '../guest-api'
import { hasDatabase, openOwnerPool, useTestServerEnvironment } from '../test-database'
import { asked, refusingFetch, seen } from './attack-session'
import { removeOrgs, type SeededOrg, seedOrg } from './attack-world'

vi.mock('@/server/session', async () => (await import('./attack-session')).sessionModule)
vi.mock('next/cache', async () => (await import('./attack-session')).cacheModule)
vi.mock('next/headers', async () => (await import('./attack-session')).headersModule)
vi.mock('next-intl/server', async () => (await import('./attack-session')).intlModule)
vi.mock('@/server/jobs', async () => (await import('./attack-session')).jobsModule)
vi.mock('@/server/log', async () => (await import('./attack-session')).logModule)

/** Every `export async function` of every 'use server' file. */
function serverActions(): readonly [string, string][] {
  const root = path.resolve(__dirname, '../..')
  const files: string[] = []
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const full = path.join(dir, name)
      if (statSync(full).isDirectory()) walk(full)
      else if (/\.tsx?$/.test(name) && !name.includes('.test.')) files.push(full)
    }
  }
  walk(root)
  const found: [string, string][] = []
  for (const file of files) {
    const text = readFileSync(file, 'utf8')
    if (!/^\s*(\/\/.*\n\s*)*['"]use server['"]/.test(text)) continue
    for (const match of text.matchAll(/^export async function (\w+)/gm)) {
      if (match[1] !== undefined) found.push([file, match[1]])
    }
  }
  return found
}

/** Text a validator should refuse, with the ones that reach a query if it does not. */
const hostileText = fc.constantFrom(
  "'; drop table restro.venues; --",
  '<script>alert(1)</script>',
  '\u0000',
  '../../etc/passwd',
  'x'.repeat(100_000),
  '__proto__',
  '\ud800',
  '٠١٢',
  'NaN',
  '-1',
)
const hostile = fc.oneof(
  hostileText,
  fc.jsonValue({ maxDepth: 2 }),
  fc.constantFrom(-1, 2 ** 53, Number.NaN, Number.POSITIVE_INFINITY, 1.5, null, true, [], {}),
)

describe.skipIf(!hasDatabase)('fuzz (as restro_app)', () => {
  let owner: pg.Pool
  let app: DbPool
  let org: SeededOrg
  const actions = serverActions()

  const dbErrors = () =>
    seen.errors.filter((line) => /Failed query|violates|invalid input|out of range/.test(line))

  beforeAll(async () => {
    useTestServerEnvironment()
    process.env.WORKER_REVEAL_URL = 'http://localhost:9/attack-no-worker'
    process.env.REVEAL_SERVICE_TOKEN = 'attack-test-token-attack-test-token-000'
    vi.stubGlobal('fetch', refusingFetch)
    owner = openOwnerPool()
    app = getPool()
    org = await seedOrg(app, owner, 'FUZZ')
    asked.person = {
      userId: org.ownerId,
      tenantId: org.tenantId,
      role: 'owner',
      sessionId: `s-${org.ownerId}`,
    }
  }, 120_000)

  afterAll(async () => {
    vi.unstubAllGlobals()
    await removeOrgs(owner, [org])
    await owner?.end()
  }, 120_000)

  it('finds the actions', () => {
    expect(actions.length).toBeGreaterThan(100)
  })

  describe('every server action', () => {
    for (const [file, name] of actions) {
      it(`${name}: arbitrary and id-holding hostile input never throws or reaches a query`, async () => {
        const module = (await import(/* @vite-ignore */ file)) as Record<
          string,
          (...args: unknown[]) => Promise<unknown>
        >
        const action = module[name]
        if (action === undefined) throw new Error(`no ${name}`)
        const venue = org.venues[0]
        // Real ids under the names actions use, so a value gets past the id checks and on to the
        // rest of the schema; everything else hostile.
        const shaped = fc.record(
          {
            venueId: fc.constant<unknown>(venue.id),
            menuId: fc.constant<unknown>(venue.menu),
            itemId: fc.constant<unknown>(venue.item),
            sectionId: fc.constant<unknown>(venue.section),
            tableId: fc.constant<unknown>(venue.table),
            areaId: fc.constant<unknown>(venue.area),
            name: hostile,
            title: hostile,
            label: hostile,
            value: hostile,
            sortKey: hostile,
            keys: hostile,
            id: hostile,
          },
          { requiredKeys: ['venueId'] },
        )
        const input = fc.oneof(fc.jsonValue({ maxDepth: 3 }), shaped)
        seen.reset()
        await fc.assert(
          fc.asyncProperty(input, input, async (first, second) => {
            try {
              await action(first, second)
            } catch (error) {
              // A Next.js redirect or not-found is an answer, not a crash.
              if (error instanceof Error && 'digest' in error) return
              throw error
            }
          }),
          { numRuns: 8, seed: 20261030, endOnFailure: true },
        )
        expect(dbErrors(), 'a bad value got past the schema to the database').toEqual([])
      }, 120_000)
    }
  })

  describe('the guest API', () => {
    const deps = () => ({
      pool: app,
      queueReading: async () => {},
      passKey: null,
      humanCheck: async () => 'passed' as const,
      queueSend: async () => {},
      queuePayment: async () => {},
    })
    const kinds = [
      'order.add',
      'order.change',
      'order.remove',
      'order.undo',
      'order.restore',
      'order.tidy',
      'order.send',
      'waiter.call',
      'pay.start',
      'pay.returned',
      'pay.cancel',
    ]
    it('a mutated body never answers a 5xx', async () => {
      const body = fc.oneof(
        fc.jsonValue({ maxDepth: 4 }),
        fc.record({
          command: fc.record({
            kind: fc.constantFrom(...kinds),
            actionId: fc.oneof(fc.uuid(), hostile),
            itemId: fc.oneof(fc.constant<unknown>(org.venues[0].item), hostile),
            optionIds: fc.oneof(fc.constant<unknown>([]), hostile),
            qty: fc.oneof(fc.constant<unknown>(1), hostile),
            note: fc.oneof(fc.constant<unknown>(''), hostile),
            lineId: hostile,
            request: hostile,
            pick: hostile,
            seen: hostile,
          }),
          ageMs: fc.oneof(fc.constant<unknown>(1), hostile),
          view: fc.oneof(fc.constant<unknown>('order'), hostile),
          check: hostile,
        }),
      )
      seen.reset()
      await fc.assert(
        fc.asyncProperty(body, async (value) => {
          const answer = await handleGuestAction(
            new Request('http://localhost/api/guest/actions', {
              method: 'POST',
              headers: {
                'content-type': 'application/json',
                authorization: `Table ${org.venues[0].tableCode}`,
                'x-restro-phone': 'attack-phone-aaaaaaaaa',
              },
              body: JSON.stringify(value),
            }),
            deps(),
          )
          expect(answer.status).toBeLessThan(500)
        }),
        { numRuns: 300, seed: 20261030, endOnFailure: true },
      )
      expect(dbErrors()).toEqual([])
    }, 300_000)

    it('a mutated query and header never answer a 5xx', async () => {
      await fc.assert(
        fc.asyncProperty(fc.string(), fc.string(), async (since, view) => {
          const query = new URLSearchParams({ since, view })
          const answer = await handleGuestState(
            new Request(`http://localhost/api/guest/state?${query}`, {
              headers: { authorization: `Table ${org.venues[0].tableCode}` },
            }),
            deps(),
          )
          expect(answer.status).toBeLessThan(500)
        }),
        { numRuns: 200, seed: 20261030, endOnFailure: true },
      )
    }, 120_000)
  })
})
