// Who edits the menu (RR-70, Martin 11-06: "owner and admin"), as a role matrix on a real Postgres
// as restro_app: the owner and an admin of the organisation write; a manager and a staff member of
// the venue (plain members of the organisation with a role at the venue), a plain member and the
// bar tablet (an owner's account on a shared device) are refused before anything moves. One write
// of each door: the composer, its tags, the item sheet and the photo upload.
import { DEFAULT_ROLE_PERMISSIONS } from '@restro/core/service'
import type { DbPool } from '@restro/db'
import type pg from 'pg'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import { POST as upload } from '../../../app/api/assets/route'
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

/** One write through each door of the menu. */
const WRITES = [
  'setItemHiddenAction',
  'createTagAction',
  'saveItemTranslationAction',
  'setItemTagsAction',
] as const

type Who = 'owner' | 'admin' | 'manager' | 'member' | 'staff' | 'tablet'

const refused = (answer: unknown) =>
  answer === null || answer === undefined || (answer as { ok?: unknown }).ok === false

describe.skipIf(!hasDatabase)('who edits the menu (as restro_app; RR-70)', () => {
  let owner: pg.Pool
  let app: DbPool
  const orgs: SeededOrg[] = []

  /** An organisation where the member's account holds `kind`'s default rights at the first venue. */
  async function orgWith(kind: 'manager' | 'staff' | null): Promise<SeededOrg> {
    const org = await seedOrg(app, owner, 'EDITORS')
    orgs.push(org)
    if (kind !== null) {
      await owner.query('update restro.staff_members set user_id = $2 where id = $1', [
        org.venues[0].staff,
        org.memberId,
      ])
      await owner.query('update restro.venue_roles set permissions = $2::jsonb where id = $1', [
        org.venues[0].role,
        JSON.stringify(DEFAULT_ROLE_PERMISSIONS[kind]),
      ])
    }
    return org
  }

  function as(org: SeededOrg, who: Who): void {
    const userId =
      who === 'owner' || who === 'tablet'
        ? org.ownerId
        : who === 'admin'
          ? org.adminId
          : org.memberId
    const role =
      who === 'owner' || who === 'tablet' ? 'owner' : who === 'admin' ? 'admin' : 'member'
    asked.person = {
      userId,
      tenantId: org.tenantId,
      role,
      // The bar tablet: the owner's account on the venue's shared device.
      sessionId: who === 'tablet' ? org.venues[0].deviceSession : `s-${userId}`,
    }
  }

  const call = (org: SeededOrg, action: (typeof WRITES)[number]) => {
    const entry = ATTACKS.find((attack) => attack.action === action)
    if (entry === undefined) throw new Error(`no attack for ${action}`)
    return entry.call(org, org)
  }

  const photo = () => {
    const body = new FormData()
    body.set('file', new Blob([new Uint8Array(10)], { type: 'image/png' }), 'x.png')
    return new Request('http://localhost/api/assets', {
      method: 'POST',
      headers: { origin: 'http://localhost', host: 'localhost' },
      body,
    })
  }

  beforeAll(() => {
    useTestServerEnvironment()
    vi.stubGlobal('fetch', refusingFetch)
    owner = openOwnerPool()
    app = getPool()
  }, 60_000)

  afterAll(async () => {
    vi.unstubAllGlobals()
    await removeOrgs(owner, orgs)
    await owner?.end()
  }, 120_000)

  const REFUSED: readonly [Who, 'manager' | 'staff' | null][] = [
    ['manager', 'manager'],
    ['staff', 'staff'],
    ['member', null],
    ['tablet', null],
  ]

  for (const [who, kind] of REFUSED) {
    it(`${who}: every menu write is refused and nothing moves`, async () => {
      const org = await orgWith(kind)
      as(org, who)
      const before = await fingerprint(owner, org.tenantId)
      for (const action of WRITES) {
        const answer = await call(org, action)
        expect(refused(answer), `${action} answered ${JSON.stringify(answer)}`).toBe(true)
      }
      const answer = await upload(photo())
      expect(answer.status).toBe(403)
      expect(changedTables(before, await fingerprint(owner, org.tenantId))).toEqual([])
    }, 60_000)
  }

  for (const who of ['owner', 'admin'] as const) {
    it(`${who}: the menu writes go through`, async () => {
      const org = await orgWith(null)
      as(org, who)
      for (const action of WRITES) {
        const answer = await call(org, action)
        expect(answer, action).toMatchObject({ ok: true })
      }
      // Past the role's door: the ten bytes are no picture.
      expect((await upload(photo())).status).toBe(415)
    }, 60_000)
  }
})
