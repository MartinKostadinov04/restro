// Who makes a browser the bar tablet (RR-O35, Martin 11-06: "a staff-only account"), as a role
// matrix on a real Postgres as restro_app, through the real action: a staff member of the venue
// (a plain member of the organisation with the Staff role there) does; the owner, an admin and a
// manager are told which account to use; a plain member holds nothing at the venue; the bar
// tablet itself is a shared device already. No refusal leaves a device behind.
import { DEFAULT_ROLE_PERMISSIONS } from '@restro/core/service'
import type { DbPool } from '@restro/db'
import type pg from 'pg'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import { getPool } from '../db'
import { markSharedDeviceAction } from '../settings/staff-actions'
import { hasDatabase, openOwnerPool, useTestServerEnvironment } from '../test-database'
import { asked, refusingFetch } from './attack-session'
import { removeOrgs, type SeededOrg, seedOrg } from './tests/attack-world'

vi.mock('@/server/session', async () => (await import('./attack-session')).sessionModule)
vi.mock('next/cache', async () => (await import('./attack-session')).cacheModule)
vi.mock('next/headers', async () => (await import('./attack-session')).headersModule)
vi.mock('next-intl/server', async () => (await import('./attack-session')).intlModule)
vi.mock('@/server/jobs', async () => (await import('./attack-session')).jobsModule)
vi.mock('@/server/log', async () => (await import('./attack-session')).logModule)

type Who = 'owner' | 'admin' | 'manager' | 'member' | 'staff' | 'tablet'

describe.skipIf(!hasDatabase)('who makes a browser the bar tablet (as restro_app; RR-O35)', () => {
  let owner: pg.Pool
  let app: DbPool
  const orgs: SeededOrg[] = []

  /** An organisation where the member's account holds `kind`'s default rights at the first venue. */
  async function orgWith(kind: 'manager' | 'staff' | null): Promise<SeededOrg> {
    const org = await seedOrg(app, owner, 'TABLET')
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
      sessionId: who === 'tablet' ? org.venues[0].deviceSession : `s-${userId}-${who}`,
    }
  }

  const devices = async (org: SeededOrg) =>
    (
      await owner.query<{ n: number }>(
        'select count(*)::int as n from restro.shared_devices where tenant_id = $1',
        [org.tenantId],
      )
    ).rows[0]?.n ?? 0

  const mark = (org: SeededOrg) =>
    markSharedDeviceAction({ venueId: org.venues[0].id, name: 'Bar tablet' })

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

  const CASES: readonly [Who, 'manager' | 'staff' | null, string | null][] = [
    ['owner', null, 'staff_account_required'],
    ['admin', null, 'staff_account_required'],
    ['manager', 'manager', 'staff_account_required'],
    ['member', null, 'permission_denied'],
    ['tablet', null, null],
  ]

  for (const [who, kind, code] of CASES) {
    it(`${who}: refused${code === null ? '' : ` (${code})`}, and no device is made`, async () => {
      const org = await orgWith(kind)
      as(org, who)
      const before = await devices(org)
      const answer = await mark(org)
      expect(answer.ok).toBe(false)
      if (code !== null) expect(answer).toMatchObject({ ok: false, error: code })
      expect(await devices(org)).toBe(before)
    }, 60_000)
  }

  it('staff: this browser becomes the bar tablet', async () => {
    const org = await orgWith('staff')
    as(org, 'staff')
    const before = await devices(org)
    expect(await mark(org)).toMatchObject({ ok: true })
    expect(await devices(org)).toBe(before + 1)
    // Once is enough: the same browser again is already shared.
    expect((await mark(org)).ok).toBe(false)
  }, 60_000)
})
