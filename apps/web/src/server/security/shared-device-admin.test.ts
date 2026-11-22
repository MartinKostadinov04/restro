// RR-84 (D122 §7 and §9): a PIN unlocks Tonight's actions only, never settings, and a shared tablet
// is a device at every venue of its organisation. Two holes, attacked on a real Postgres as
// restro_app, through the real actions, as the owner's account on a shared device, with no PIN:
//
// - the actions that check only the organisation's role: tables and areas, codes, POS instances,
//   venues and the organisation. Each must ask whether this sign-in is a device.
// - everything else, from venue 2's tablet at venue 1: the engine looked for a device at this venue
//   alone, so venue 2's tablet held every permission at venue 1.
import { randomUUID } from 'node:crypto'

import type { DbPool } from '@restro/db'
import type pg from 'pg'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import { GET as qrFile } from '../../../app/api/tables/[tableId]/qr/route'
import { getPool } from '../db'
import * as design from '../design/actions'
import * as integration from '../integration/actions'
import * as organization from '../organization-actions'
import * as tables from '../tables/actions'
import { hasDatabase, openOwnerPool, useTestServerEnvironment } from '../test-database'
import * as venues from '../venues-actions'
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
// Counts the QR route's way into the codes, so the test sees the tablet stopped before it (C3).
const qrBuilt = vi.hoisted(() => ({ calls: 0 }))
vi.mock('@/server/tables/download', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/server/tables/download')>()
  return {
    ...real,
    buildQrDownload: (...args: Parameters<typeof real.buildQrDownload>) => {
      qrBuilt.calls += 1
      return real.buildQrDownload(...args)
    },
  }
})

/**
 * Every action of these five files: none of them is Tonight's, or the tablet's landing's. The design
 * ones are here since #177: a Style is the organisation's, not a venue's, so they take no venue to
 * aim at and only the device check can refuse them on a shared tablet.
 */
const ADMIN_ACTIONS: ReadonlySet<string> = new Set([
  ...Object.keys(tables),
  ...Object.keys(integration),
  ...Object.keys(venues),
  ...Object.keys(organization),
  ...Object.keys(design),
])

const refused = (answer: unknown) =>
  answer === null ||
  answer === undefined ||
  (answer as { ok?: unknown }).ok === false ||
  (answer as { entries?: unknown[]; nextBefore?: unknown }).nextBefore === null

describe.skipIf(!hasDatabase)('the shared tablet and the admin writes (RR-84)', () => {
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

  const asOwner = (org: SeededOrg, sessionId: string) => {
    asked.person = { userId: org.ownerId, tenantId: org.tenantId, role: 'owner', sessionId }
  }

  it('every admin action has an attack in the table', () => {
    const attacked = new Set(ATTACKS.map((attack) => attack.action))
    expect([...ADMIN_ACTIONS].filter((action) => !attacked.has(action))).toEqual([])
    expect(ADMIN_ACTIONS.size).toBeGreaterThan(30)
  })

  describe("on the venue's own tablet", () => {
    for (const entry of ATTACKS.filter((attack) => ADMIN_ACTIONS.has(attack.action))) {
      it(`${entry.action}: refused, nothing moved`, async () => {
        const org = await seedOrg(app, owner, `ADM${randomUUID().slice(0, 6).toUpperCase()}`)
        try {
          asOwner(org, org.venues[0].deviceSession)
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
  })

  describe("at venue 1, from venue 2's tablet", () => {
    let org: SeededOrg

    beforeAll(async () => {
      org = await seedOrg(app, owner, 'ADMOTHER')
    }, 120_000)

    afterAll(async () => {
      await removeOrgs(owner, [org])
    }, 60_000)

    // Settings and Tonight, its quick answers included. The menu's and the admin's own actions are
    // refused by the sign-in, as above, wherever they aim.
    for (const entry of ATTACKS.filter(
      (attack) => attack.ownOrganisation !== true && !ADMIN_ACTIONS.has(attack.action),
    )) {
      it(`${entry.action}${entry.how === undefined ? '' : ` (${entry.how})`}: refused, nothing moved`, async () => {
        asOwner(org, org.venues[1].deviceSession)
        seen.reset()
        const before = await fingerprint(owner, org.tenantId)
        const answer = await entry.call(org, org)
        const moved = changedTables(before, await fingerprint(owner, org.tenantId))
        expect(moved, `moved, answering ${JSON.stringify(answer)}`).toEqual([])
        expect(refused(answer), `answered ${JSON.stringify(answer)}`).toBe(true)
        expect(seen.jobs).toEqual([])
      }, 60_000)
    }
  })

  // D122 §7 (lane 5 X1): settings that change who can reach the venue or what its codes are ask
  // for the password again 15 minutes after it was typed, on the person's own sign-in too.
  describe('on a personal sign-in older than 15 minutes', () => {
    const FRESH_ACTIONS: ReadonlySet<string> = new Set([
      'createAllCodesAction',
      'issueCodeAction',
      'turnOffCodeAction',
      'deleteAreaAction',
      'deleteTableAction',
      'saveSystemsAction',
      'addInstanceAction',
      'saveConnectionAction',
      'removeInstanceAction',
      'renameVenueSlugAction',
      'renameVenueAction',
      'deleteVenueAction',
      'unpublishVenueAction',
      'purgeVenueAction',
      'updateOrganizationAction',
    ])
    let org: SeededOrg

    beforeAll(async () => {
      org = await seedOrg(app, owner, 'ADMSTALE')
    }, 120_000)

    afterAll(async () => {
      await removeOrgs(owner, [org])
    }, 60_000)

    it('every such action has an attack in the table', () => {
      const attacked = new Set(ATTACKS.map((attack) => attack.action))
      expect([...FRESH_ACTIONS].filter((action) => !attacked.has(action))).toEqual([])
    })

    for (const entry of ATTACKS.filter(
      (attack) => attack.ownOrganisation !== true && FRESH_ACTIONS.has(attack.action),
    )) {
      it(`${entry.action}${entry.how === undefined ? '' : ` (${entry.how})`}: asks again, nothing moved`, async () => {
        asked.person = {
          userId: org.ownerId,
          tenantId: org.tenantId,
          role: 'owner',
          sessionId: `personal-${randomUUID()}`,
          signedInAt: new Date(Date.now() - 16 * 60_000),
        }
        seen.reset()
        const before = await fingerprint(owner, org.tenantId)
        const answer = await entry.call(org, org)
        expect(changedTables(before, await fingerprint(owner, org.tenantId))).toEqual([])
        expect(answer).toEqual({ ok: false, error: 'sign_in_again' })
        expect(seen.jobs).toEqual([])
        expect(seen.revalidated).toEqual([])
      }, 60_000)
    }
  })

  describe('what must keep working', () => {
    let org: SeededOrg

    beforeAll(async () => {
      org = await seedOrg(app, owner, 'ADMKEEP')
    }, 120_000)

    afterAll(async () => {
      await removeOrgs(owner, [org])
    }, 60_000)

    const attack = (action: string) => {
      const entry = ATTACKS.find((one) => one.action === action)
      if (entry === undefined) throw new Error(`no attack for ${action}`)
      return entry
    }

    it('the same account on a personal sign-in still adds an area', async () => {
      asOwner(org, `personal-${randomUUID()}`)
      const before = await fingerprint(owner, org.tenantId)
      expect(await attack('createAreaAction').call(org, org)).toMatchObject({ ok: true })
      expect(changedTables(before, await fingerprint(owner, org.tenantId))).toContain('areas')
    }, 60_000)

    it('the QR download looks for the code on a personal sign-in, and never from the tablet (C3)', async () => {
      const table = org.venues[0].table
      const download = () =>
        qrFile(new Request(`http://localhost/api/tables/${table}/qr?format=svg`), {
          params: Promise.resolve({ tableId: table }),
        })
      asOwner(org, `personal-${randomUUID()}`)
      qrBuilt.calls = 0
      await download()
      expect(qrBuilt.calls).toBe(1)
      asOwner(org, org.venues[0].deviceSession)
      qrBuilt.calls = 0
      seen.reset()
      expect((await download()).status).toBe(404)
      expect(qrBuilt.calls).toBe(0)
      expect(seen.fetches).toEqual([])
    }, 60_000)

    it("the tablet still reads its own venue's Tonight", async () => {
      asOwner(org, org.venues[0].deviceSession)
      expect(await attack('sentOrdersAction').call(org, org)).toMatchObject({ ok: true })
    }, 60_000)

    it("the tablet still answers quickly at its own venue: Tonight's actions go through the engine", async () => {
      asOwner(org, org.venues[0].deviceSession)
      const before = await fingerprint(owner, org.tenantId)
      expect(await attack('openTableAction').call(org, org)).toMatchObject({ ok: true })
      expect(changedTables(before, await fingerprint(owner, org.tenantId))).toContain('sittings')
    }, 60_000)
  })
})
