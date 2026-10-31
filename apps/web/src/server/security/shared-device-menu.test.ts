// RR-83 (D122 §7): a shared tablet works Tonight and gets a person's PIN for anything else. Its
// session belongs to an account that may hold everything, so the actions that check only the
// organisation's role must ask whether this sign-in is a device. On a real Postgres as restro_app,
// through the real actions, as the owner's account on the venue's shared device, with no PIN.
import { randomUUID } from 'node:crypto'

import type { DbPool } from '@restro/db'
import type pg from 'pg'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import { getPool } from '../db'
import { onSharedDevice } from '../staff/shared-device'
import { hasDatabase, openOwnerPool, useTestServerEnvironment } from '../test-database'
import { asked, refusingFetch, seen } from './attack-session'
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

/** Every action of the composer, its tags, the item sheet, the design, the menus and the publishing. */
const MENU_ACTIONS: ReadonlySet<string> = new Set([
  'placeItemAction',
  'moveSectionAction',
  'createSectionAction',
  'createItemAction',
  'setItemHiddenAction',
  'setSectionHiddenAction',
  'setSectionLayoutAction',
  'renameSectionAction',
  'deleteSectionAction',
  'renameItemAction',
  'deleteItemAction',
  'setItemsSoldOutAction',
  'setItemPaymentModeAction',
  'createTagAction',
  'updateTagAction',
  'moveTagAction',
  'setTagArchivedAction',
  'setItemTagsAction',
  'saveGuestFeaturesAction',
  'saveDesignAction',
  'loadItemSheetAction',
  'loadItemHistoryAction',
  'saveItemFieldAction',
  'revertItemFieldAction',
  'keepItemOverrideAction',
  'saveItemTranslationAction',
  'setItemImageAction',
  'removeItemImageAction',
  'setItemSoldOutAction',
  'createMenuAction',
  'renameMenuAction',
  'moveMenuAction',
  'deleteMenuAction',
  'restoreMenuAction',
  'setLiveMenuAction',
  'importMenuAction',
  'listImportSourcesAction',
  'publishNowAction',
  'approveHeldAction',
  'rejectHeldAction',
  'rollbackAction',
  'saveAutomationAction',
  'resumeAutoPublishAction',
  'previewDraftAction',
])

const refused = (answer: unknown) =>
  answer === null ||
  answer === undefined ||
  (answer as { ok?: unknown }).ok === false ||
  (answer as { entries?: unknown[]; nextBefore?: unknown }).nextBefore === null

describe.skipIf(!hasDatabase)('the shared tablet and the menu (RR-83)', () => {
  let owner: pg.Pool
  let app: DbPool

  beforeAll(() => {
    useTestServerEnvironment()
    vi.stubGlobal('fetch', refusingFetch)
    owner = openOwnerPool()
    app = getPool()
  })

  afterAll(async () => {
    vi.unstubAllGlobals()
    await owner?.end()
  }, 60_000)

  const onDevice = (org: SeededOrg) => {
    asked.person = {
      userId: org.ownerId,
      tenantId: org.tenantId,
      role: 'owner',
      sessionId: org.venues[0].deviceSession,
    }
  }

  it('every menu action has an attack in the table', () => {
    const attacked = new Set(ATTACKS.map((attack) => attack.action))
    const missing = [...MENU_ACTIONS].filter((action) => !attacked.has(action))
    expect(missing).toEqual([])
  })

  for (const entry of ATTACKS.filter((attack) => MENU_ACTIONS.has(attack.action))) {
    it(`${entry.action}: refused on the device, nothing moved`, async () => {
      const org = await seedOrg(app, owner, `DEV${randomUUID().slice(0, 6).toUpperCase()}`)
      try {
        onDevice(org)
        seen.reset()
        const before = await fingerprint(owner, org.tenantId)
        const answer = await entry.call(org, org)
        const moved = changedTables(before, await fingerprint(owner, org.tenantId))
        expect(moved, `moved, answering ${JSON.stringify(answer)}`).toEqual([])
        expect(refused(answer), `answered ${JSON.stringify(answer)}`).toBe(true)
        expect(seen.jobs).toEqual([])
      } finally {
        await removeOrgs(owner, [org])
      }
    }, 60_000)
  }

  describe('what must keep working', () => {
    let org: SeededOrg

    beforeAll(async () => {
      org = await seedOrg(app, owner, 'DEVKEEP')
    }, 120_000)

    afterAll(async () => {
      await removeOrgs(owner, [org])
    }, 60_000)

    it('the same account on a personal sign-in still edits the menu', async () => {
      asked.person = {
        userId: org.ownerId,
        tenantId: org.tenantId,
        role: 'owner',
        sessionId: `personal-${randomUUID()}`,
      }
      const entry = ATTACKS.find((attack) => attack.action === 'placeItemAction')
      if (entry === undefined) throw new Error('no attack')
      const before = await fingerprint(owner, org.tenantId)
      const answer = await entry.call(org, org)
      expect(answer).toMatchObject({ ok: true })
      expect(changedTables(before, await fingerprint(owner, org.tenantId))).toContain('placements')
    }, 60_000)

    it('the session of a revoked device is a personal sign-in again', async () => {
      const venue = org.venues[1]
      expect(await onSharedDevice({ tenantId: org.tenantId, sessionId: venue.deviceSession })).toBe(
        true,
      )
      await owner.query('update restro.shared_devices set revoked_at = now() where id = $1', [
        venue.device,
      ])
      expect(await onSharedDevice({ tenantId: org.tenantId, sessionId: venue.deviceSession })).toBe(
        false,
      )
    }, 30_000)

    it('a tablet of venue 1 is a device at venue 2 too', async () => {
      expect(
        await onSharedDevice({ tenantId: org.tenantId, sessionId: org.venues[0].deviceSession }),
      ).toBe(true)
    }, 30_000)
  })
})
