// The positive control of the tenancy attack (tenancy-actions.test.ts): the same calls, made by an
// organisation's owner on its own ids. An attack refused for its shape would prove nothing, and a
// fingerprint that cannot see a write would prove nothing either; this shows both work. A call that
// moved anything gets a fresh organisation for the next one.
import { appendFileSync } from 'node:fs'

import type { DbPool } from '@restro/db'
import type pg from 'pg'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import { getPool } from '../db'
import { hasDatabase, openOwnerPool, useTestServerEnvironment } from '../test-database'
import { asked, refusingFetch, seen } from './attack-session'
import { ATTACKS, MIXED } from './attack-table'
import { changedTables, fingerprint, removeOrgs, type SeededOrg, seedOrg } from './attack-world'

vi.mock('@/server/session', async () => (await import('./attack-session')).sessionModule)
vi.mock('next/cache', async () => (await import('./attack-session')).cacheModule)
vi.mock('next/headers', async () => (await import('./attack-session')).headersModule)
vi.mock('next-intl/server', async () => (await import('./attack-session')).intlModule)
vi.mock('@/server/jobs', async () => (await import('./attack-session')).jobsModule)
vi.mock('@/server/log', async () => (await import('./attack-session')).logModule)

/** Calls that answer `invalid` on one's own ids for a reason of their own, not their shape. */
const INVALID_ON_OWN_IDS = new Set<string>([
  // 'sim' is not a POS kind the web app offers.
  'all: addInstanceAction',
  // Pay first is off at the seeded venue, so the row is not on the screen.
  'all: setItemPaymentModeAction',
  'mixed: setItemPaymentModeAction',
  // 'sim' is not a POS kind the web app offers a venue from.
  "all: createVenueAction (the victim's POS venue)",
  // The tag already exists: the id is the point of this attack.
  "mixed: createTagAction (with the victim's tag id)",
])

describe.skipIf(!hasDatabase)("the attack calls, on the caller's own ids", () => {
  let owner: pg.Pool
  let app: DbPool
  const orgs: SeededOrg[] = []
  let org: SeededOrg
  let writes = 0

  beforeAll(async () => {
    useTestServerEnvironment()
    process.env.WORKER_REVEAL_URL = 'http://localhost:9/attack-no-worker'
    process.env.REVEAL_SERVICE_TOKEN = 'attack-test-token-attack-test-token-000'
    vi.stubGlobal('fetch', refusingFetch)
    owner = openOwnerPool()
    app = getPool()
    org = await seedOrg(app, owner, 'CONTROL')
    orgs.push(org)
  }, 60_000)

  afterAll(async () => {
    vi.unstubAllGlobals()
    await removeOrgs(owner, orgs)
    await owner?.end()
  }, 120_000)

  for (const [table, entries] of [
    ['all', ATTACKS],
    ['mixed', MIXED],
  ] as const) {
    for (const entry of entries) {
      const label = `${table}: ${entry.action}${entry.how === undefined ? '' : ` (${entry.how})`}`
      it(label, async () => {
        asked.person = {
          userId: org.ownerId,
          tenantId: org.tenantId,
          role: 'owner',
          sessionId: `s-${org.ownerId}`,
        }
        seen.reset()
        const before = await fingerprint(owner, org.tenantId)
        let answer: unknown
        try {
          answer = await entry.call(org, org)
        } catch (error) {
          answer = { thrown: error instanceof Error ? error.message : String(error) }
        }
        const moved = changedTables(before, await fingerprint(owner, org.tenantId))
        if (process.env.ATTACK_DUMP) {
          appendFileSync(
            process.env.ATTACK_DUMP,
            `${label} => ${JSON.stringify(answer ?? null)?.slice(0, 140)} | moved=${moved} | errors=${seen.errors.join(';').slice(0, 160)}\n`,
          )
        }
        if (moved.length > 0) {
          writes += 1
          org = await seedOrg(app, owner, 'CONTROL')
          orgs.push(org)
        }
        const refusedByShape =
          typeof answer === 'object' &&
          answer !== null &&
          (answer as { error?: unknown }).error === 'invalid' &&
          !INVALID_ON_OWN_IDS.has(label)
        expect(refusedByShape, `answered ${JSON.stringify(answer)}`).toBe(false)
      }, 30_000)
    }
  }

  it('saw writes, so a fingerprint can see one', () => {
    expect(writes).toBeGreaterThan(50)
  })
})
