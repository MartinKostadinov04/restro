// RR-84 (D122 §7 and §9): a PIN unlocks Tonight's actions only, never settings, and a tablet is one
// device of the organisation. Looked for at this venue alone, a venue 2 tablet on an owner's account
// held every permission at venue 1, settings included, with no PIN. A session that is a live device
// at any venue is on a device: its own venue asks a PIN or answers quickly with Staff's rights, and
// any other venue refuses, as a PIN there does, so no PIN path opens.
import { randomUUID } from 'node:crypto'

import { withTenant } from '@restro/db'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { provisionVenue } from '../apply/provision'
import { hasDatabase, testSlug } from '../apply/test-database'
import { openServiceWorld, type ServiceWorld } from '../testing/service-world'
import { applyService } from './apply-service'
import { resolveGrants } from './grants'
import { DEFAULT_ROLE_PERMISSIONS, isSettingsPermission, PERMISSIONS } from './permissions'

describe.skipIf(!hasDatabase)('a tablet at another venue of the organisation (RR-84)', () => {
  let world: ServiceWorld
  let otherVenue: string
  let owner: string
  let session: string
  let device: string

  beforeAll(async () => {
    world = await openServiceWorld('device-venues')
    const venue = await provisionVenue(world.app, world.tenantId, {
      name: 'Second club',
      slug: testSlug('device-venues-2'),
    })
    otherVenue = venue.id
    owner = await world.addUser('owner')
    session = `sess-${randomUUID()}`
    device = await world.addSharedDevice(session)
  }, 120_000)

  afterAll(async () => {
    await world?.close()
  }, 60_000)

  const grants = (venueId: string, actor: Parameters<typeof resolveGrants>[3], quick?: true) =>
    withTenant(world.app, world.tenantId, (tx) =>
      resolveGrants(tx, world.tenantId, venueId, actor, quick === undefined ? {} : { quick }),
    )
  const onTablet = () => ({ kind: 'user' as const, userId: owner, sessionId: session })

  it('at another venue the owner on a tablet is refused', async () => {
    expect(await grants(otherVenue, onTablet())).toEqual({ ok: false, code: 'actor_unknown' })
  })

  it('at another venue a quick answer is refused too', async () => {
    expect(await grants(otherVenue, onTablet(), true)).toEqual({
      ok: false,
      code: 'actor_unknown',
    })
  })

  it('at another venue a settings command moves nothing', async () => {
    const { result } = await applyService(
      world.app,
      { type: 'settings.paying_set', changes: { minCardMinor: 100 }, providerMinMinor: 50 } as never,
      {
        tenantId: world.tenantId,
        venueId: otherVenue,
        origin: 'staff',
        actor: onTablet(),
        jobId: `req-${randomUUID()}`,
        signedInAt: new Date(),
      } as never,
    )
    expect(result).toMatchObject({ code: 'actor_unknown' })
  }, 30_000)

  it("at the device's own venue nothing changes: a PIN, or a quick answer with Staff's rights", async () => {
    expect(await grants(world.venueId, onTablet())).toEqual({ ok: false, code: 'pin_required' })
    const quick = await grants(world.venueId, onTablet(), true)
    if (!quick.ok) throw new Error(quick.code)
    expect(quick.device).toBe(true)
    expect([...quick.permissions].sort()).toEqual(
      DEFAULT_ROLE_PERMISSIONS.staff.filter((p) => !isSettingsPermission(p)).sort(),
    )
  })

  it('a PIN is good only at its own venue', async () => {
    const staffMemberId = await world.addStaff(['tables.open_close'])
    const pin = { kind: 'staff' as const, staffMemberId, sessionId: session }
    expect(await grants(world.venueId, pin)).toMatchObject({ ok: true })
    expect(await grants(otherVenue, pin)).toEqual({ ok: false, code: 'actor_unknown' })
  })

  it('a personal sign-in of the same account holds everything at both venues', async () => {
    const personal = { kind: 'user' as const, userId: owner, sessionId: `sess-${randomUUID()}` }
    for (const venueId of [world.venueId, otherVenue]) {
      const held = await grants(venueId, personal)
      if (!held.ok) throw new Error(held.code)
      expect(held.permissions.size).toBe(PERMISSIONS.length)
      expect(held.device).toBeUndefined()
    }
  })

  it('a revoked device is a personal sign-in again, everywhere', async () => {
    await world.owner.query('update restro.shared_devices set revoked_at = now() where id = $1', [
      device,
    ])
    for (const venueId of [world.venueId, otherVenue]) {
      const held = await grants(venueId, onTablet())
      if (!held.ok) throw new Error(held.code)
      expect(held.permissions.size).toBe(PERMISSIONS.length)
    }
  })
})
