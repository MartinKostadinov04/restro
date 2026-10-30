// Roles, attacked (the repair-review's A7), on a real Postgres as restro_app. A plain member of the
// organisation against owner and admin actions, and a person with a role at one venue against the
// other venue, and the bill of a table and the composer's items bound to the venue in the call
// (RR-71, RR-72). What should hold and does is here; RR-70, which doesn't yet, is in
// roles-actions.red.test.ts.
import { randomUUID } from 'node:crypto'

import { applyService, PERMISSIONS } from '@restro/core/service'
import type { DbPool } from '@restro/db'
import type pg from 'pg'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import { loadItemHistoryAction, loadItemSheetAction } from '@/server/item-sheet/actions'
import { tableBillAction } from '@/server/tonight/actions'

import { getPool } from '../db'
import { hasDatabase, openOwnerPool, useTestServerEnvironment } from '../test-database'
import { asked, refusingFetch, seen } from './attack-session'
import { ATTACKS, type Attack, MIXED } from './attack-table'
import {
  changedTables,
  fingerprint,
  fingerprintMentioning,
  idsOfVenue,
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

const label = (entry: Attack) =>
  `${entry.action}${entry.how === undefined ? '' : ` (${entry.how})`}`

/** Open to a plain member at the pin: RR-70 in roles-actions.red.test.ts settles the writes. */
export const MEMBER_MAY_AT_THE_PIN: ReadonlySet<string> = new Set([
  // The composer's writes that are not `ownersOnly`.
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
  // Reads of the draft.
  'loadItemSheetAction',
  'loadItemHistoryAction',
  'previewDraftAction',
  // Tonight's staff need the bill (RR-71 below seeds a reading).
  'tableBillAction',
  // On one's own session.
  'setAdminLocale',
  'switchOrganization',
])

/** These ask the worker, which checks the person itself; see apps/worker's attack test. */
const ASKS_THE_WORKER: ReadonlySet<string> = new Set([
  'linkGroupAction',
  'linkPersonAction',
  'testTelegramAction',
  'startConnectionAction',
  'finishConnectionAction',
  'revealPinAction',
])

/** The answers of a refusal on the item sheet and the night reads. */
function refused(answer: unknown): boolean {
  if (answer === null || answer === undefined) return true
  return (answer as { ok?: unknown }).ok === false
}

/** What a person with a role only at venue 1 may do at venue 1 with venue 2's child ids. */
const CROSSES_VENUES: ReadonlySet<string> = new Set([
  // The organisation's people are the organisation's, at any of its venues (D122 §7).
  'assignRoleAction',
  'linkAccountAction',
  'setRecipientsAction',
  // Copying one venue's menu into another is what import is for (D88).
  'importMenuAction',
])

/** Item writes that took venue 2's item with venue 1 in the call, the row RR-72 is about. */
const ITEM_WRITES_ACROSS_VENUES = [
  'placeItemAction',
  'setItemHiddenAction',
  'saveItemFieldAction',
  'saveItemTranslationAction',
  'setItemsSoldOutAction',
  'setItemSoldOutAction',
  'setItemTagsAction',
  'setItemPaymentModeAction',
] as const

describe.skipIf(!hasDatabase)('roles (as restro_app)', () => {
  let owner: pg.Pool
  let app: DbPool
  const orgs: SeededOrg[] = []

  async function freshOrg(): Promise<SeededOrg> {
    const org = await seedOrg(app, owner, 'ROLES')
    orgs.push(org)
    return org
  }

  /** The member's account gets a staff row with every permission at the first venue only. */
  async function staffAtFirstVenue(org: SeededOrg): Promise<void> {
    await owner.query('update restro.staff_members set user_id = $2 where id = $1', [
      org.venues[0].staff,
      org.memberId,
    ])
    await owner.query('update restro.venue_roles set permissions = $2::jsonb where id = $1', [
      org.venues[0].role,
      JSON.stringify(PERMISSIONS),
    ])
  }

  /** The same organisation, seen with the second venue as the victim's first. */
  const secondAsVictim = (org: SeededOrg): SeededOrg => ({
    ...org,
    venues: [org.venues[1], org.venues[0]],
  })

  const asMember = (org: SeededOrg) => {
    asked.person = {
      userId: org.memberId,
      tenantId: org.tenantId,
      role: 'member',
      sessionId: `s-${org.memberId}`,
    }
  }

  beforeAll(async () => {
    useTestServerEnvironment()
    process.env.WORKER_REVEAL_URL = 'http://localhost:9/attack-no-worker'
    process.env.REVEAL_SERVICE_TOKEN = 'attack-test-token-attack-test-token-000'
    vi.stubGlobal('fetch', refusingFetch)
    owner = openOwnerPool()
    app = getPool()
  }, 60_000)

  afterAll(async () => {
    vi.unstubAllGlobals()
    await removeOrgs(owner, orgs)
    await owner?.end()
  }, 120_000)

  describe('a plain member, against everything an owner or admin does', () => {
    let org: SeededOrg
    beforeAll(async () => {
      org = await freshOrg()
    }, 60_000)
    for (const entry of ATTACKS.filter((attack) => !MEMBER_MAY_AT_THE_PIN.has(attack.action))) {
      it(`${label(entry)}: refused, nothing moved`, async () => {
        asMember(org)
        seen.reset()
        const before = await fingerprint(owner, org.tenantId)
        const answer = await entry.call(org, org)
        const moved = changedTables(before, await fingerprint(owner, org.tenantId))
        expect(moved, `moved, answering ${JSON.stringify(answer)}`).toEqual([])
        expect(refused(answer), `answered ${JSON.stringify(answer)}`).toBe(true)
        if (!ASKS_THE_WORKER.has(entry.action)) expect(seen.fetches).toEqual([])
        expect(seen.jobs).toEqual([])
      }, 30_000)
    }
  })

  describe("a role at venue 1 only, venue 1 in the call, venue 2's child ids", () => {
    let org: SeededOrg
    beforeAll(async () => {
      org = await freshOrg()
      await staffAtFirstVenue(org)
    }, 60_000)

    it('the positive control: the role does work at venue 1', async () => {
      asMember(org)
      const own = org.venues[0]
      const { handleWaiterCallAction } = await import('@/server/tonight/actions')
      const answer = await handleWaiterCallAction({ venueId: own.id, waiterCallId: own.waiterCall })
      expect(answer.ok, JSON.stringify(answer)).toBe(true)
    }, 30_000)

    for (const entry of MIXED.filter((attack) => !CROSSES_VENUES.has(attack.action))) {
      it(`${label(entry)}: venue 2 did not move`, async () => {
        asMember(org)
        seen.reset()
        const ids = idsOfVenue(org.venues[1])
        const before = await fingerprintMentioning(owner, org.tenantId, ids)
        const answer = await entry.call(secondAsVictim(org), org)
        const moved = changedTables(before, await fingerprintMentioning(owner, org.tenantId, ids))
        expect(moved, `moved, answering ${JSON.stringify(answer)}`).toEqual([])
      }, 30_000)
    }
  })

  describe("RR-72: the owner, venue 1 in the call, venue 2's item", () => {
    const asOwner = (org: SeededOrg) => {
      asked.person = {
        userId: org.ownerId,
        tenantId: org.tenantId,
        role: 'owner',
        sessionId: `s-${org.ownerId}`,
      }
    }

    // A fresh organisation each: an earlier write on the same item hid that the next action had no
    // check of its own (`setItemSoldOutAction`).
    for (const entry of MIXED.filter((attack) =>
      (ITEM_WRITES_ACROSS_VENUES as readonly string[]).includes(attack.action),
    )) {
      it(`${label(entry)}: refused, venue 2 did not move`, async () => {
        const org = await freshOrg()
        asOwner(org)
        const ids = idsOfVenue(org.venues[1])
        const before = await fingerprintMentioning(owner, org.tenantId, ids)
        const answer = await entry.call(secondAsVictim(org), org)
        const moved = changedTables(before, await fingerprintMentioning(owner, org.tenantId, ids))
        expect(moved, `moved, answering ${JSON.stringify(answer)}`).toEqual([])
        expect(refused(answer), `answered ${JSON.stringify(answer)}`).toBe(true)
      }, 60_000)
    }

    it("loadItemSheetAction: venue 2's item is not read through venue 1", async () => {
      const org = await freshOrg()
      asOwner(org)
      const [mine, theirs] = org.venues
      const scope = { venueId: mine.id, menuId: mine.menu }
      expect(await loadItemSheetAction(scope, theirs.item)).toBeNull()
      // The control: at its own venue it has a sheet.
      expect(
        await loadItemSheetAction({ venueId: theirs.id, menuId: theirs.menu }, theirs.item),
      ).not.toBeNull()
    }, 60_000)

    it("loadItemHistoryAction: venue 2's item is not read through venue 1", async () => {
      const org = await freshOrg()
      asOwner(org)
      const [mine, theirs] = org.venues
      const scope = { venueId: mine.id, menuId: mine.menu }
      expect((await loadItemHistoryAction(scope, theirs.item)).entries).toEqual([])
      // The control: at its own venue it has a history.
      const own = await loadItemHistoryAction(
        { venueId: theirs.id, menuId: theirs.menu },
        theirs.item,
      )
      expect(own.entries.length).toBeGreaterThan(0)
    }, 60_000)

    it('the control: the same owner, the same action, venue 1 and its own item', async () => {
      const org = await freshOrg()
      asOwner(org)
      const entry = ATTACKS.find((attack) => attack.action === 'setItemHiddenAction')
      if (entry === undefined) throw new Error('no attack')
      const before = await fingerprint(owner, org.tenantId)
      const answer = await entry.call(org, org)
      expect(answer).toMatchObject({ ok: true })
      expect(changedTables(before, await fingerprint(owner, org.tenantId))).toContain('nodes')
    }, 60_000)
  })

  describe('RR-71: the bill of a table', () => {
    let org: SeededOrg

    beforeAll(async () => {
      org = await freshOrg()
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

    it("venue 1 in the call doesn't read venue 2's table, whoever asks", async () => {
      for (const person of [org.ownerId, org.memberId]) {
        asked.person = {
          userId: person,
          tenantId: org.tenantId,
          role: person === org.ownerId ? 'owner' : 'member',
          sessionId: `s-${person}`,
        }
        const answer = await tableBillAction({
          venueId: org.venues[0].id,
          tableId: org.venues[1].table,
        })
        expect(answer).toEqual({ ok: true, bill: null })
      }
    }, 30_000)

    it("a plain member still reads their venue's table: Tonight's staff need the bill", async () => {
      asMember(org)
      const second = org.venues[1]
      const answer = await tableBillAction({ venueId: second.id, tableId: second.table })
      expect(answer).toMatchObject({ ok: true, bill: { totalMinor: 4321 } })
    }, 30_000)
  })
})
