import { createPool, type DbPool, tenants, venues, withTenant } from '@restro/db'
import type pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { newId } from '../ids'
import * as core from '../index'
import * as applyEntry from './index'
import { ProvisionError, provisionTenant, provisionVenue } from './provision'
import { appDatabaseUrl, cleanUp, hasDatabase, openOwnerPool, testSlug } from './test-database'

/** A pool that is never used: the input checks run before any query. */
const unusedPool = {} as DbPool

describe('module boundary', () => {
  it('is exported from @restro/core/apply, never from the pure @restro/core entry', () => {
    expect(Object.keys(applyEntry)).toEqual(
      expect.arrayContaining(['provisionTenant', 'provisionVenue', 'ProvisionError']),
    )
    expect(Object.keys(core)).not.toContain('provisionTenant')
    expect(Object.keys(core)).not.toContain('provisionVenue')
  })
})

describe('input checks (no database needed)', () => {
  it('provisionTenant refuses a malformed tenant id and an empty name', async () => {
    await expect(
      provisionTenant(unusedPool, { tenantId: 'tn_short', name: 'Club' }),
    ).rejects.toThrow(ProvisionError)
    await expect(
      provisionTenant(unusedPool, { tenantId: newId('vn'), name: 'Club' }),
    ).rejects.toThrow(ProvisionError)
    await expect(
      provisionTenant(unusedPool, { tenantId: newId('tn'), name: '   ' }),
    ).rejects.toMatchObject({
      code: 'invalid_input',
    })
  })

  it.each([
    ['an empty name', { name: ' ', slug: 'main' }],
    ['an upper-case slug', { name: 'Club', slug: 'Main' }],
    ['a slug with a space', { name: 'Club', slug: 'a b' }],
    ['a slug with a double dash', { name: 'Club', slug: 'a--b' }],
    ['an unknown time zone', { name: 'Club', slug: 'main', timezone: 'Mars/Base' }],
    ['a malformed service day end', { name: 'Club', slug: 'main', serviceDayEndsAt: '7am' }],
    ['a currency we do not accept', { name: 'Club', slug: 'main', currency: 'USD' as 'EUR' }],
    [
      'a default locale that is not enabled',
      { name: 'Club', slug: 'main', defaultLocale: 'de_DE' as const },
    ],
    [
      'an unknown locale',
      { name: 'Club', slug: 'main', enabledLocales: ['bg_BG', 'xx_XX' as 'bg_BG'] },
    ],
  ] as const)('provisionVenue refuses %s', async (_label, input) => {
    await expect(provisionVenue(unusedPool, newId('tn'), input)).rejects.toMatchObject({
      code: 'invalid_input',
    })
  })

  it('provisionVenue refuses a malformed tenant id', async () => {
    await expect(
      provisionVenue(unusedPool, 'tn_nope', { name: 'Club', slug: 'main' }),
    ).rejects.toMatchObject({ code: 'invalid_input' })
  })
})

describe.skipIf(!hasDatabase)('provisioning against Postgres (as the restro_app role)', () => {
  const tenantA = newId('tn')
  const tenantB = newId('tn')
  const tenantWithoutRow = newId('tn')
  // Venue slugs are globally unique, so each run (and each parallel test file) uses its own.
  const slugA = testSlug('demo-club')
  const slugB = testSlug('main')
  let app: DbPool
  let owner: pg.Pool

  beforeAll(() => {
    owner = openOwnerPool()
    app = createPool(appDatabaseUrl(), { applicationName: 'restro-core-tests' })
  })

  afterAll(async () => {
    await app?.end()
    if (owner) {
      await cleanUp(owner, [tenantA, tenantB, tenantWithoutRow])
      await owner.end()
    }
  })

  it('provisionTenant creates the tenant row, visible to that tenant only', async () => {
    const created = await provisionTenant(app, { tenantId: tenantA, name: '  Club A ' })
    expect(created).toEqual({ id: tenantA, name: 'Club A', created: true })
    await provisionTenant(app, { tenantId: tenantB, name: 'Club B' })

    const seenByA = await withTenant(app, tenantA, (tx) => tx.select().from(tenants))
    expect(seenByA.map((tenant) => tenant.id)).toEqual([tenantA])
    const seenByB = await withTenant(app, tenantB, (tx) => tx.select().from(tenants))
    expect(seenByB.map((tenant) => tenant.id)).toEqual([tenantB])
  })

  it('provisionTenant is idempotent: a second call changes nothing', async () => {
    const again = await provisionTenant(app, { tenantId: tenantA, name: 'A different name' })
    expect(again).toEqual({ id: tenantA, name: 'Club A', created: false })
  })

  it('provisionVenue creates a venue with the documented defaults and a fresh vn_ id', async () => {
    const venue = await provisionVenue(app, tenantA, {
      name: ' Demo Club Sofia ',
      slug: slugA,
    })
    expect(venue.id).toMatch(/^vn_[0-9A-Za-z]{22}$/)
    expect(venue).toMatchObject({
      tenantId: tenantA,
      name: 'Demo Club Sofia',
      slug: slugA,
      timezone: 'Europe/Sofia',
      serviceDayEndsAt: '07:00:00',
      currency: 'EUR',
      defaultLocale: 'bg_BG',
      enabledLocales: ['bg_BG', 'en_US'],
    })
  })

  it('a venue is visible to its tenant only (row-level security does the isolation)', async () => {
    await provisionVenue(app, tenantB, { name: 'Club B main', slug: slugB })
    const seenByA = await withTenant(app, tenantA, (tx) => tx.select().from(venues))
    const seenByB = await withTenant(app, tenantB, (tx) => tx.select().from(venues))
    expect(seenByA.map((venue) => venue.slug)).toEqual([slugA])
    expect(seenByB.map((venue) => venue.slug)).toEqual([slugB])
  })

  it('provisionVenue accepts the venue settings it is given', async () => {
    const venue = await provisionVenue(app, tenantB, {
      name: 'Second',
      slug: testSlug('second'),
      timezone: 'Europe/Vienna',
      serviceDayEndsAt: '06:30',
      defaultLocale: 'en_US',
      enabledLocales: ['en_US', 'de_DE'],
    })
    expect(venue).toMatchObject({
      timezone: 'Europe/Vienna',
      serviceDayEndsAt: '06:30:00',
      defaultLocale: 'en_US',
      enabledLocales: ['en_US', 'de_DE'],
    })
  })

  it('provisionVenue reports a slug the tenant already uses as slug_taken', async () => {
    await expect(
      provisionVenue(app, tenantA, { name: 'Another', slug: slugA }),
    ).rejects.toMatchObject({ name: 'ProvisionError', code: 'slug_taken' })
  })

  it('a slug is a global public address: another tenant cannot take it either (slug_taken, not a raw database error)', async () => {
    // tenantA holds slugA; tenantB cannot even see tenantA's venues (row-level security), so only
    // the global unique index can tell it, and the error must still be the typed one.
    const refusal = await provisionVenue(app, tenantB, { name: 'Intruder', slug: slugA }).then(
      () => null,
      (error: unknown) => error,
    )
    expect(refusal).toBeInstanceOf(ProvisionError)
    expect(refusal).toMatchObject({ name: 'ProvisionError', code: 'slug_taken' })
    // Nothing was created for tenantB under that slug, and tenantA still has its venue.
    const seenByB = await withTenant(app, tenantB, (tx) => tx.select().from(venues))
    expect(seenByB.map((venue) => venue.slug)).not.toContain(slugA)
    const seenByA = await withTenant(app, tenantA, (tx) => tx.select().from(venues))
    expect(seenByA.map((venue) => venue.slug)).toEqual([slugA])
  })

  it('provisionVenue reports a tenant that has no row yet', async () => {
    await expect(
      provisionVenue(app, tenantWithoutRow, { name: 'Orphan', slug: testSlug('orphan') }),
    ).rejects.toMatchObject({ name: 'ProvisionError', code: 'tenant_missing' })
  })
})
