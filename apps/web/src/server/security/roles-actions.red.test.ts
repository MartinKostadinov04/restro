// RED by design (the repair-review's A7). What a plain member of the organisation, or a role at one
// venue, can do at the pin and should not, on a real Postgres as restro_app. When one goes green,
// move it into roles-actions.test.ts.
//
// RR-A7-1: a plain member writes the composer. RR-A7-2: the night's table sheet reads any table's
// bill, for anyone signed in. RR-A7-3: the composer's item writes aren't bound to the venue in the
// call, so venue 1's scope reaches venue 2's items.
import { randomUUID } from 'node:crypto'

import { applyService } from '@restro/core/service'
import type { DbPool } from '@restro/db'
import type pg from 'pg'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import { tableBillAction } from '@/server/tonight/actions'

import { getPool } from '../db'
import { hasDatabase, openOwnerPool, useTestServerEnvironment } from '../test-database'
import { asked, refusingFetch } from './attack-session'
import { ATTACKS, MIXED } from './attack-table'
import {
  changedTables,
  fingerprint,
  fingerprintMentioning,
  idsOfVenue,
  removeOrgs,
  type SeededOrg,
  seedOrg,
} from './attack-world'

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

const ITEM_WRITES_ACROSS_VENUES = [
  'placeItemAction',
  'setItemHiddenAction',
  'saveItemFieldAction',
  'saveItemTranslationAction',
  'setItemsSoldOutAction',
  'setItemSoldOutAction',
] as const

const refused = (answer: unknown) =>
  answer === null || answer === undefined || (answer as { ok?: unknown }).ok === false

describe.skipIf(!hasDatabase)('roles, the gaps (as restro_app)', () => {
  let owner: pg.Pool
  let app: DbPool
  let org: SeededOrg

  const asMember = () => {
    asked.person = {
      userId: org.memberId,
      tenantId: org.tenantId,
      role: 'member',
      sessionId: `s-${org.memberId}`,
    }
  }
  const asOwner = () => {
    asked.person = {
      userId: org.ownerId,
      tenantId: org.tenantId,
      role: 'owner',
      sessionId: `s-${org.ownerId}`,
    }
  }

  beforeAll(async () => {
    useTestServerEnvironment()
    process.env.WORKER_REVEAL_URL = 'http://localhost:9/attack-no-worker'
    process.env.REVEAL_SERVICE_TOKEN = 'attack-test-token-attack-test-token-000'
    vi.stubGlobal('fetch', refusingFetch)
    owner = openOwnerPool()
    app = getPool()
    org = await seedOrg(app, owner, 'REDROLES')
    // A reading on the second venue's table, so that its bill is there to read.
    const second = org.venues[1]
    const { result } = await applyService(
      app,
      {
        type: 'reading.record',
        tableId: second.table,
        reading: {
          complete: true,
          currency: 'EUR',
          bills: [
            {
              pos: 'B1',
              totalMinor: 4321,
              paidMinor: 0,
              openedAt: '2026-10-26T20:00:00.000Z',
              openedByRestro: false,
              paymentInFlight: false,
              lines: [
                {
                  pos: 'L1',
                  itemPos: null,
                  posName: 'till name',
                  quantity: '1',
                  amountMinor: 4321,
                  enteredBy: 'staff',
                  enteredAt: null,
                  restroRef: null,
                },
              ],
            },
          ],
        },
      } as never,
      {
        tenantId: org.tenantId,
        venueId: second.id,
        origin: 'worker',
        actor: { kind: 'integration', integrationId: org.integration },
        jobId: `table-read-${randomUUID()}`,
      },
      { billIdKey: 'attack-test-key-'.padEnd(48, 'x') },
    )
    if (result.status !== 'accepted') throw new Error(`refused: ${JSON.stringify(result)}`)
  }, 60_000)

  afterAll(async () => {
    vi.unstubAllGlobals()
    await removeOrgs(owner, [org])
    await owner?.end()
  }, 120_000)

  describe('RR-A7-1: a plain member (a waiter account) must not write the menu', () => {
    for (const action of COMPOSER_WRITES) {
      it(`${action} is refused, nothing moved`, async () => {
        asMember()
        const entry = ATTACKS.find((attack) => attack.action === action)
        if (entry === undefined) throw new Error(`no attack for ${action}`)
        const before = await fingerprint(owner, org.tenantId)
        const answer = await entry.call(org, org)
        const moved = changedTables(before, await fingerprint(owner, org.tenantId))
        expect(refused(answer), `answered ${JSON.stringify(answer)}`).toBe(true)
        expect(moved).toEqual([])
      }, 30_000)
    }
  })

  describe('RR-A7-2: the bill of a table', () => {
    it('a plain member must not read it', async () => {
      asMember()
      const second = org.venues[1]
      const answer = await tableBillAction({ venueId: second.id, tableId: second.table })
      expect(JSON.stringify(answer)).not.toContain('4321')
    }, 30_000)

    it("venue 1's scope must not read venue 2's table", async () => {
      asOwner()
      const answer = await tableBillAction({
        venueId: org.venues[0].id,
        tableId: org.venues[1].table,
      })
      expect(JSON.stringify(answer)).not.toContain('4321')
    }, 30_000)
  })

  describe("RR-A7-3: venue 1 in the call, venue 2's item", () => {
    const secondAsVictim = (): SeededOrg => ({
      ...org,
      venues: [org.venues[1], org.venues[0]],
    })
    for (const action of ITEM_WRITES_ACROSS_VENUES) {
      it(`${action}: venue 2 did not move`, async () => {
        asOwner()
        const entry = MIXED.find((attack) => attack.action === action)
        if (entry === undefined) throw new Error(`no attack for ${action}`)
        const ids = idsOfVenue(org.venues[1])
        const before = await fingerprintMentioning(owner, org.tenantId, ids)
        const answer = await entry.call(secondAsVictim(), org)
        const moved = changedTables(before, await fingerprintMentioning(owner, org.tenantId, ids))
        expect(moved, `moved, answering ${JSON.stringify(answer)}`).toEqual([])
      }, 30_000)
    }
  })
})
