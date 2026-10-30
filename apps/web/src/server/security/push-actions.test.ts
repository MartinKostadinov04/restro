// RR-86: a staff device gets into `push_subscriptions` through the real server actions and core, on
// a real Postgres as restro_app (D120, D122 §7). The bar tablet's account subscribes with no PIN and
// can't end it without one; a member of another organisation can't end anyone's device.
import { endpointHashOf } from '@restro/core/service'
import type { DbPool } from '@restro/db'
import type pg from 'pg'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { getPool } from '../db'
import { hasDatabase, openOwnerPool, useTestServerEnvironment } from '../test-database'
import { revokePushAction, subscribePushAction } from '../tonight/actions'
import { asked, seen } from './attack-session'
import { removeOrgs, type SeededOrg, seedOrg } from './tests/attack-world'

vi.mock('@/server/session', async () => (await import('./attack-session')).sessionModule)
vi.mock('next/cache', async () => (await import('./attack-session')).cacheModule)
vi.mock('next/headers', async () => (await import('./attack-session')).headersModule)
vi.mock('next-intl/server', async () => (await import('./attack-session')).intlModule)
vi.mock('@/server/jobs', async () => (await import('./attack-session')).jobsModule)
vi.mock('@/server/log', async () => (await import('./attack-session')).logModule)

/** What a browser's `subscription.toJSON()` holds, flattened as the screen sends it. */
const device = (name: string) => ({
  endpoint: `https://fcm.googleapis.com/fcm/send/${name}-${'x'.repeat(30)}`,
  p256dh: `B${'p'.repeat(86)}`,
  auth: 'a'.repeat(22),
})

describe.skipIf(!hasDatabase)('a staff device for push (RR-86)', () => {
  let owner: pg.Pool
  let app: DbPool
  let org: SeededOrg
  let other: SeededOrg

  const stored = async (endpoint: string) =>
    (
      await owner.query<{ tenant_id: string; user_id: string; revoked_at: Date | null }>(
        'select tenant_id, user_id, revoked_at from restro.push_subscriptions where endpoint_hash = $1',
        [endpointHashOf(endpoint)],
      )
    ).rows
  const as = (who: SeededOrg, userId: string, sessionId = `s-${userId}`) => {
    asked.person = { userId, tenantId: who.tenantId, role: 'owner', sessionId }
  }

  beforeAll(async () => {
    useTestServerEnvironment()
    owner = openOwnerPool()
    app = getPool()
    org = await seedOrg(app, owner, 'PUSHORG')
    other = await seedOrg(app, owner, 'PUSHOTHER')
  }, 120_000)

  afterAll(async () => {
    if (org !== undefined && other !== undefined) await removeOrgs(owner, [org, other])
    await owner?.end()
  }, 60_000)

  beforeEach(() => {
    seen.reset()
  })

  it('stores the device of a signed-in account, once, and a re-send keeps it on', async () => {
    const phone = device('phone')
    as(org, org.ownerId)
    expect(await stored(phone.endpoint)).toEqual([])
    const first = await subscribePushAction({ venueId: org.venues[0].id, ...phone })
    expect(first.ok, JSON.stringify(first)).toBe(true)
    const second = await subscribePushAction({ venueId: org.venues[0].id, ...phone })
    expect(second.ok).toBe(true)
    expect(await stored(phone.endpoint)).toEqual([
      { tenant_id: org.tenantId, user_id: org.ownerId, revoked_at: null },
    ])
  })

  it('ends it on Off, and a later On brings it back', async () => {
    const phone = device('off')
    as(org, org.ownerId)
    await subscribePushAction({ venueId: org.venues[0].id, ...phone })
    const off = await revokePushAction({ venueId: org.venues[0].id, endpoint: phone.endpoint })
    expect(off.ok, JSON.stringify(off)).toBe(true)
    expect((await stored(phone.endpoint))[0]?.revoked_at).not.toBeNull()
    await subscribePushAction({ venueId: org.venues[0].id, ...phone })
    expect((await stored(phone.endpoint))[0]?.revoked_at).toBeNull()
  })

  it("won't let a member of another organisation end it", async () => {
    const phone = device('theirs')
    as(org, org.ownerId)
    await subscribePushAction({ venueId: org.venues[0].id, ...phone })
    as(other, other.ownerId)
    expect(await revokePushAction({ venueId: org.venues[0].id, endpoint: phone.endpoint })).toEqual(
      {
        ok: false,
        error: 'venue_missing',
      },
    )
    await revokePushAction({ venueId: other.venues[0].id, endpoint: phone.endpoint })
    expect((await stored(phone.endpoint))[0]?.revoked_at).toBeNull()
  })

  it('refuses an account that may not answer alerts', async () => {
    const phone = device('plain')
    as(org, org.memberId)
    expect(await subscribePushAction({ venueId: org.venues[0].id, ...phone })).toMatchObject({
      ok: false,
    })
    expect(await stored(phone.endpoint)).toEqual([])
  })

  it('refuses what a browser never sends', async () => {
    as(org, org.ownerId)
    const venueId = org.venues[0].id
    const phone = device('bad')
    for (const input of [
      { venueId, ...phone, endpoint: 'http://fcm.googleapis.com/fcm/send/plain' },
      { venueId, ...phone, endpoint: 'https://169.254.169.254/latest/meta-data' },
      { venueId, ...phone, endpoint: 'https://evilpush.apple.com.example.org/send' },
      { venueId, ...phone, auth: 'short' },
      { venueId, ...phone, userId: other.ownerId },
      { venueId, endpoint: phone.endpoint },
    ]) {
      expect(await subscribePushAction(input)).toEqual({ ok: false, error: 'invalid' })
    }
    expect(await revokePushAction({ venueId, endpointHash: 'a'.repeat(64) })).toEqual({
      ok: false,
      error: 'invalid',
    })
    expect(await stored(phone.endpoint)).toEqual([])
  })

  describe('on the bar tablet', () => {
    it("subscribes the tablet's account with no PIN, at the tablet's own venue", async () => {
      const tablet = device('tablet')
      as(org, org.memberId, org.venues[0].deviceSession)
      const on = await subscribePushAction({ venueId: org.venues[0].id, ...tablet })
      expect(on.ok, JSON.stringify(on)).toBe(true)
      expect(await stored(tablet.endpoint)).toEqual([
        { tenant_id: org.tenantId, user_id: org.memberId, revoked_at: null },
      ])
    })

    it('has no Off without a PIN: the row stays on', async () => {
      const tablet = device('tablet-off')
      as(org, org.memberId, org.venues[0].deviceSession)
      await subscribePushAction({ venueId: org.venues[0].id, ...tablet })
      expect(
        await revokePushAction({ venueId: org.venues[0].id, endpoint: tablet.endpoint }),
      ).toEqual({ ok: false, error: 'pin_required' })
      expect((await stored(tablet.endpoint))[0]?.revoked_at).toBeNull()
    })

    it("can't subscribe at another venue of the organisation (RR-84)", async () => {
      const tablet = device('tablet-elsewhere')
      as(org, org.ownerId, org.venues[1].deviceSession)
      expect(await subscribePushAction({ venueId: org.venues[0].id, ...tablet })).toEqual({
        ok: false,
        error: 'actor_unknown',
      })
      expect(await stored(tablet.endpoint)).toEqual([])
    })
  })
})
