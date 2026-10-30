// Tenancy, attacked (the repair-review's A7): every server action called by the owner of
// organisation B against organisation A's ids, on a real Postgres as restro_app. A refusal must
// come from the action, not from an error RLS caused; A's rows must not move; A's names must not
// come back; no job or outside call may name A. A completeness check fails when a new action is
// not in the table, so a template or a branch that adds one has to add its attack.
import { appendFileSync, readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'

import type { DbPool } from '@restro/db'
import type pg from 'pg'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import * as composer from '@/composer/actions'

import { getPool } from '../db'
import { hasDatabase, openOwnerPool, useTestServerEnvironment } from '../test-database'
import { asked, refusingFetch, seen } from './attack-session'
import { ATTACKS, type Attack, MIXED } from './attack-table'
import {
  changedTables,
  fingerprint,
  idsOf,
  removeOrgs,
  rowsMentioning,
  type SeededOrg,
  seedOrg,
} from './tests/attack-world'

vi.mock('@/server/session', async () => (await import('./attack-session')).sessionModule)
vi.mock('next/cache', async () => (await import('./attack-session')).cacheModule)
vi.mock('next/headers', async () => (await import('./attack-session')).headersModule)
vi.mock('next-intl/server', async () => (await import('./attack-session')).intlModule)
vi.mock('@/server/jobs', async () => (await import('./attack-session')).jobsModule)
vi.mock('@/server/log', async () => (await import('./attack-session')).logModule)

/** What a failed statement logs: the database stopped it, so the action's checks did not. */
const DATABASE_REFUSAL = /Failed query|violates|permission denied|row-level security/

/** A refusal the action gave itself, in any of the shapes the actions answer with. */
function isRefusal(answer: unknown): boolean {
  if (answer === null || answer === undefined) return true
  if (typeof answer !== 'object') return false
  // The item sheet's history answers an unknown item with an empty page.
  const page = answer as { entries?: unknown[]; nextBefore?: unknown }
  if (Array.isArray(page.entries) && page.entries.length === 0) return true
  return (answer as { ok?: unknown }).ok === false
}

describe.skipIf(!hasDatabase)('organisation B against organisation A (as restro_app)', () => {
  let owner: pg.Pool
  let app: DbPool
  let victim: SeededOrg
  let attacker: SeededOrg

  async function attack(entry: Attack) {
    if (attacker === undefined) throw new Error('no world')
    asked.person = {
      userId: attacker.ownerId,
      tenantId: attacker.tenantId,
      role: 'owner',
      sessionId: `s-${attacker.ownerId}`,
    }
    seen.reset()
    const before = await fingerprint(owner, victim.tenantId)
    let answer: unknown
    let thrown: string | null = null
    try {
      answer = await entry.call(victim, attacker)
    } catch (error) {
      thrown = error instanceof Error ? error.message : String(error)
    }
    const after = await fingerprint(owner, victim.tenantId)
    const text = JSON.stringify(answer ?? null)
    if (process.env.ATTACK_DUMP) {
      const label = `${entry.action}${entry.how ? ` (${entry.how})` : ''}`
      appendFileSync(
        process.env.ATTACK_DUMP,
        `${label} => ${text?.slice(0, 200)} | thrown=${thrown} | moved=${changedTables(before, after)} | errors=${seen.errors.join(';').slice(0, 200)} | fetch=${seen.fetches.length} jobs=${seen.jobs.length}
`,
      )
    }
    return {
      answer,
      thrown,
      changed: changedTables(before, after),
      leaked: text.includes(victim.marker),
      jobs: seen.jobs.filter((job) => JSON.stringify(job.data).includes(victim.tenantId)),
      fetches: [...seen.fetches],
      errors: [...seen.errors],
    }
  }

  beforeAll(async () => {
    useTestServerEnvironment()
    process.env.WORKER_REVEAL_URL = 'http://localhost:9/attack-no-worker'
    process.env.REVEAL_SERVICE_TOKEN = 'attack-test-token-attack-test-token-000'
    vi.stubGlobal('fetch', refusingFetch)
    owner = openOwnerPool()
    app = getPool()
    victim = await seedOrg(app, owner, 'VICTIMSECRET')
    attacker = await seedOrg(app, owner, 'ATTACKER')
  }, 60_000)

  afterAll(async () => {
    vi.unstubAllGlobals()
    if (victim !== undefined && attacker !== undefined) {
      await removeOrgs(owner, [victim, attacker])
    }
    await owner?.end()
  }, 60_000)

  beforeEach(() => {
    seen.reset()
  })

  describe('every action, with all of the victim ids', () => {
    for (const entry of ATTACKS) {
      const name = entry.how === undefined ? entry.action : `${entry.action} (${entry.how})`
      it(`${name}: refused, nothing moved, nothing shown`, async () => {
        const result = await attack(entry)
        expect(result.thrown, 'it threw instead of refusing').toBeNull()
        expect(result.changed, "the victim's rows moved").toEqual([])
        expect(result.leaked, "the victim's names came back").toBe(false)
        expect(result.jobs, 'a job named the victim').toEqual([])
        expect(result.fetches, 'it went outside').toEqual([])
        if (entry.ownOrganisation !== true) {
          expect(isRefusal(result.answer), `answered ${JSON.stringify(result.answer)}`).toBe(true)
          expect(result.errors, 'the database refused it, not the action').toEqual([])
        }
      })
    }
  })

  describe("the attacker's own venue, the victim's child ids", () => {
    for (const entry of MIXED) {
      const name = entry.how === undefined ? entry.action : `${entry.action} (${entry.how})`
      it(`${name}: nothing moved, nothing shown, nothing mixed`, async () => {
        const result = await attack(entry)
        expect(result.thrown, 'it threw instead of refusing').toBeNull()
        expect(result.changed, "the victim's rows moved").toEqual([])
        expect(result.leaked, "the victim's names came back").toBe(false)
        expect(result.jobs, 'a job named the victim').toEqual([])
        // Two actions ask the worker before any id check; the worker's own attack test covers them.
        if (entry.action !== 'linkPersonAction' && entry.action !== 'revealPinAction') {
          expect(result.fetches, 'it went outside').toEqual([])
        }
        expect(
          await rowsMentioning(owner, attacker.tenantId, idsOf(victim)),
          "the attacker's rows now name the victim's ids",
        ).toEqual([])
        expect(
          result.errors.filter((line) => DATABASE_REFUSAL.test(line)),
          'the database refused it, not the action',
        ).toEqual([])
      })
    }
  })

  // RR-O8: a client-chosen id that another organisation holds trips the global primary key. The
  // caller learns that the id exists, which needs the id already; accepted unless the lead says
  // otherwise, kept here so a change shows.
  describe('a new id that another organisation holds (RR-O8)', () => {
    const tries: readonly [string, (v: SeededOrg, a: SeededOrg) => Promise<unknown>][] = [
      [
        'createSectionAction',
        (v, a) =>
          composer.createSectionAction({
            venueId: a.venues[0].id,
            menuId: a.venues[0].menu,
            id: v.venues[0].section,
            parentId: null,
            title: { bg_BG: 'attack' },
            sortKey: 'a7',
          }),
      ],
      [
        'createItemAction',
        (v, a) =>
          composer.createItemAction({
            venueId: a.venues[0].id,
            menuId: a.venues[0].menu,
            id: v.venues[0].item,
            sectionId: null,
            name: { bg_BG: 'attack' },
            sortKey: 'a7',
          }),
      ],
    ]
    for (const [name, call] of tries) {
      it(`${name} refuses, moves nothing, shows nothing, and only tells the id is taken`, async () => {
        const result = await attack({ action: name, call })
        expect(result.answer).toEqual({ ok: false, error: 'failed' })
        expect(result.changed).toEqual([])
        expect(result.leaked).toBe(false)
        expect(await rowsMentioning(owner, attacker.tenantId, idsOf(victim))).toEqual([])
      })
    }
  })

  it('has an attack for every exported server action', () => {
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
    const exported: string[] = []
    for (const file of files) {
      const text = readFileSync(file, 'utf8')
      if (!/^\s*(\/\/.*\n\s*)*['"]use server['"]/.test(text)) continue
      for (const match of text.matchAll(/^export async function (\w+)/gm)) {
        if (match[1] !== undefined) exported.push(match[1])
      }
    }
    const attacked = new Set(ATTACKS.map((entry) => entry.action))
    expect(exported.filter((name) => !attacked.has(name))).toEqual([])
    expect(exported.length).toBeGreaterThan(100)
  })
})
