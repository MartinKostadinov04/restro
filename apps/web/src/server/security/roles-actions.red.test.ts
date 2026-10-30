// RED by design: RR-70 (the repair-review's RR-A7-1), which is Martin's call and not fixed yet. A
// plain member of the organisation, a waiter's account, writes the menu at the pin. Each `it.fails`
// says what should hold; when the row is settled, drop the `.fails` and move it into
// roles-actions.test.ts. On a real Postgres as restro_app.
import type { DbPool } from '@restro/db'
import type pg from 'pg'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import { getPool } from '../db'
import { hasDatabase, openOwnerPool, useTestServerEnvironment } from '../test-database'
import { asked, refusingFetch } from './attack-session'
import { ATTACKS } from './attack-table'
import {
  changedTables,
  fingerprint,
  removeOrgs,
  type SeededOrg,
  seedOrg,
} from './tests/attack-world'

vi.mock('@/server/session', async () => (await import('./attack-session')).sessionModule)
vi.mock('next/cache', async () => (await import('./attack-session')).cacheModule)
vi.mock('next/headers', async () => (await import('./attack-session')).headersModule)
vi.mock('next-intl/server', async () => (await import('./attack-session')).intlModule)
vi.mock('@/server/jobs', async () => (await import('./attack-session')).jobsModule)
vi.mock('@/server/log', async () => (await import('./attack-session')).logModule)

const COMPOSER_WRITES = [
  'placeItemAction',
  'moveSectionAction',
  'createSectionAction',
  'setItemHiddenAction',
  'setSectionHiddenAction',
  'setSectionLayoutAction',
  'renameSectionAction',
  'renameItemAction',
  'createTagAction',
  'updateTagAction',
  'moveTagAction',
  'setTagArchivedAction',
  'setItemTagsAction',
  'saveItemFieldAction',
  'saveItemTranslationAction',
  'removeItemImageAction',
] as const

const refused = (answer: unknown) =>
  answer === null || answer === undefined || (answer as { ok?: unknown }).ok === false

describe.skipIf(!hasDatabase)('roles, the gaps (as restro_app; RR-70)', () => {
  let owner: pg.Pool
  let app: DbPool

  beforeAll(() => {
    useTestServerEnvironment()
    vi.stubGlobal('fetch', refusingFetch)
    owner = openOwnerPool()
    app = getPool()
  }, 60_000)

  afterAll(async () => {
    vi.unstubAllGlobals()
    await owner?.end()
  }, 120_000)

  describe('RR-70: a plain member (a waiter account) must not write the menu', () => {
    for (const action of COMPOSER_WRITES) {
      // A fresh organisation each: an archived tag, say, would refuse the next action for its own
      // reason.
      it.fails(`RR-70: ${action} is refused, nothing moved`, async () => {
        const org: SeededOrg = await seedOrg(app, owner, 'REDROLES')
        try {
          asked.person = {
            userId: org.memberId,
            tenantId: org.tenantId,
            role: 'member',
            sessionId: `s-${org.memberId}`,
          }
          const entry = ATTACKS.find((attack) => attack.action === action)
          if (entry === undefined) throw new Error(`no attack for ${action}`)
          const before = await fingerprint(owner, org.tenantId)
          const answer = await entry.call(org, org)
          const moved = changedTables(before, await fingerprint(owner, org.tenantId))
          expect(refused(answer), `answered ${JSON.stringify(answer)}`).toBe(true)
          expect(moved).toEqual([])
        } finally {
          await removeOrgs(owner, [org])
        }
      }, 60_000)
    }
  })
})
