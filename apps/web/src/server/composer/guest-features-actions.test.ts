// The "Guest features" actions against a real Postgres, as the restro_app role (brief SH-05b): what
// saveGuestFeaturesAction and saveFeatureOptionsAction write, who may call them, and what they
// drop. The session is the only fake: it says which organisation and role is asking.
import { newId } from '@restro/core'
import { provisionTenant, provisionVenue, setVenuePresentation } from '@restro/core/apply'
import type pg from 'pg'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { getPool } from '@/server/db'
import {
  hasDatabase,
  openOwnerPool,
  testSlug,
  useTestServerEnvironment,
} from '@/server/test-database'

import { saveFeatureOptionsAction, saveGuestFeaturesAction } from './guest-features-actions'

const asked = vi.hoisted(() => ({ tenantId: '', role: 'owner' }))
const revalidated = vi.hoisted(() => [] as string[])

vi.mock('@/server/session', () => ({
  requireTenant: async () => ({
    user: { id: 'us_sh05btester', name: 'Tester', email: 'tester@example.test' },
    organizations: [],
    organization: { id: asked.tenantId, name: 'SH-05b club', slug: 'sh05b-club', role: asked.role },
  }),
}))
vi.mock('next/cache', () => ({ revalidatePath: (path: string) => revalidated.push(path) }))

const ALL_OFF = {
  filters: true,
  call_waiter: { enabled: false, kinds: [] },
  bill: false,
  ordering: false,
  pay: false,
}

describe.skipIf(!hasDatabase)('the Guest features actions (as the restro_app role)', () => {
  const tenant = newId('tn')
  const otherTenant = newId('tn')
  let owner: pg.Pool
  let venueId: string
  let freshVenueId: string
  let foreignVenueId: string

  /** The venue's settings as stored, read with the owner connection. */
  const settingsOf = async (id: string): Promise<Record<string, unknown>> =>
    (
      await owner.query<{ settings: Record<string, unknown> }>(
        'select settings from restro.venues where id = $1',
        [id],
      )
    ).rows[0]?.settings ?? {}

  beforeAll(async () => {
    useTestServerEnvironment()
    owner = openOwnerPool()
    const pool = getPool()
    await provisionTenant(pool, { tenantId: tenant, name: 'SH-05b club' })
    await provisionTenant(pool, { tenantId: otherTenant, name: 'Another club' })
    asked.tenantId = tenant
    venueId = (await provisionVenue(pool, tenant, { name: 'Main', slug: testSlug('features') })).id
    freshVenueId = (await provisionVenue(pool, tenant, { name: 'Fresh', slug: testSlug('fresh') }))
      .id
    foreignVenueId = (
      await provisionVenue(pool, otherTenant, { name: 'Else', slug: testSlug('else') })
    ).id
  })

  beforeEach(() => {
    asked.role = 'owner'
    asked.tenantId = tenant
    revalidated.length = 0
  })

  afterAll(async () => {
    if (owner) {
      const tenants = [tenant, otherTenant]
      for (const table of ['menus', 'nodes', 'venues']) {
        await owner.query(`delete from restro.${table} where tenant_id = any($1)`, [tenants])
      }
      await owner.query('delete from restro.tenants where id = any($1)', [tenants])
      await owner.end()
    }
  })

  it('saves the switches and the request kinds, in the vocabulary order, and says so to the page', async () => {
    const result = await saveGuestFeaturesAction({
      venueId,
      features: {
        filters: false,
        call_waiter: { enabled: true, kinds: ['bill', 'waiter'] },
        bill: true,
        ordering: false,
        pay: true,
      },
    })
    expect(result).toEqual({ ok: true })
    expect((await settingsOf(venueId)).guest_features).toEqual({
      filters: false,
      call_waiter: { enabled: true, kinds: ['waiter', 'bill'] },
      bill: true,
      ordering: false,
      pay: true,
    })
    expect(revalidated).toEqual([`/venues/${venueId}`])
  })

  it('lets an admin, and a person with several roles that include one, change them', async () => {
    for (const role of ['admin', 'member,owner']) {
      asked.role = role
      expect(await saveGuestFeaturesAction({ venueId, features: ALL_OFF })).toEqual({ ok: true })
    }
  })

  it('refuses a plain member and writes nothing', async () => {
    await saveGuestFeaturesAction({ venueId, features: ALL_OFF })
    revalidated.length = 0
    const before = (await settingsOf(venueId)).guest_features
    asked.role = 'member'
    const result = await saveGuestFeaturesAction({
      venueId,
      features: { ...ALL_OFF, bill: true, pay: true },
    })
    expect(result).toEqual({ ok: false, error: 'forbidden' })
    expect((await settingsOf(venueId)).guest_features).toEqual(before)
    expect(revalidated).toEqual([])
  })

  it('refuses input that is not a guest feature set, and a venue of another organisation', async () => {
    const bad = {
      venueId,
      features: { ...ALL_OFF, call_waiter: { enabled: true, kinds: ['drinks'] } },
    }
    expect(await saveGuestFeaturesAction(bad)).toEqual({ ok: false, error: 'invalid' })
    const repeated = {
      venueId,
      features: { ...ALL_OFF, call_waiter: { enabled: true, kinds: ['bill', 'bill'] } },
    }
    expect(await saveGuestFeaturesAction(repeated)).toEqual({ ok: false, error: 'invalid' })

    const elsewhere = await saveGuestFeaturesAction({ venueId: foreignVenueId, features: ALL_OFF })
    expect(elsewhere).toEqual({ ok: false, error: 'invalid' })
    expect((await settingsOf(foreignVenueId)).guest_features).toBeUndefined()
  })

  it('saves the template feature option and keeps the look options the Design tab owns', async () => {
    await setVenuePresentation(getPool(), tenant, {
      venueId,
      presentation: {
        face: 'editorial-market',
        options: { layout: 'list', featureFirstSection: false, layoutSwitch: true },
      },
    })
    expect(await saveFeatureOptionsAction({ venueId, options: { layoutSwitch: false } })).toEqual({
      ok: true,
    })
    expect((await settingsOf(venueId)).presentation).toEqual({
      face: 'editorial-market',
      options: { layout: 'list', featureFirstSection: false, layoutSwitch: false },
    })
  })

  it('drops a key the face does not declare, a look key and a value of the wrong type', async () => {
    await setVenuePresentation(getPool(), tenant, {
      venueId,
      presentation: {
        face: 'editorial-market',
        options: { layout: 'list', featureFirstSection: false, layoutSwitch: false },
      },
    })
    const result = await saveFeatureOptionsAction({
      venueId,
      options: {
        layout: 'one',
        featureFirstSection: true,
        notAKey: true,
        layoutSwitch: 'yes',
      },
    })
    expect(result).toEqual({ ok: true })
    // Nothing of that input was stored: the look keys and the invented key are as they were, and
    // a value of the wrong type leaves the switch as it was.
    expect((await settingsOf(venueId)).presentation).toEqual({
      face: 'editorial-market',
      options: { layout: 'list', featureFirstSection: false, layoutSwitch: false },
    })
  })

  it('gives a venue with no template the registry default face, with the switch', async () => {
    expect(
      await saveFeatureOptionsAction({ venueId: freshVenueId, options: { layoutSwitch: false } }),
    ).toEqual({ ok: true })
    expect((await settingsOf(freshVenueId)).presentation).toEqual({
      face: 'editorial-market',
      options: { layoutSwitch: false },
    })
  })

  it('refuses a plain member for the template options and writes nothing', async () => {
    const before = (await settingsOf(venueId)).presentation
    asked.role = 'member'
    expect(await saveFeatureOptionsAction({ venueId, options: { layoutSwitch: true } })).toEqual({
      ok: false,
      error: 'forbidden',
    })
    expect((await settingsOf(venueId)).presentation).toEqual(before)
  })
})
