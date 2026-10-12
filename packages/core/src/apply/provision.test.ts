import { createPool, type DbPool, tenants, venues, withTenant } from '@restro/db'
import { eq } from 'drizzle-orm'
import type pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { newId } from '../ids'
import * as core from '../index'
import * as applyEntry from './index'
import {
  ProvisionError,
  provisionMenu,
  provisionTenant,
  provisionVenue,
  renameVenueSlug,
} from './provision'
import { appDatabaseUrl, cleanUp, hasDatabase, openOwnerPool, testSlug } from './test-database'

/** A pool that is never used: the input checks run before any query. */
const unusedPool = {} as DbPool

describe('module boundary', () => {
  it('is exported from @restro/core/apply, never from the pure @restro/core entry', () => {
    expect(Object.keys(applyEntry)).toEqual(
      expect.arrayContaining([
        'provisionTenant',
        'provisionVenue',
        'renameVenueSlug',
        'ProvisionError',
      ]),
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

  it.each([
    ['a slug in capitals', 'Main'],
    ['a slug with a space', 'a b'],
    ['a slug with a double dash', 'a--b'],
    ['a slug that starts with a dash', '-a'],
    ['an empty slug', ''],
    ['a slug that is too long', 'a'.repeat(64)],
  ])('renameVenueSlug refuses %s', async (_label, slug) => {
    await expect(renameVenueSlug(unusedPool, newId('tn'), newId('vn'), slug)).rejects.toMatchObject(
      { name: 'ProvisionError', code: 'invalid_input' },
    )
  })

  it('renameVenueSlug refuses a malformed tenant or venue id', async () => {
    await expect(renameVenueSlug(unusedPool, 'tn_nope', newId('vn'), 'main')).rejects.toMatchObject(
      { code: 'invalid_input' },
    )
    await expect(
      renameVenueSlug(unusedPool, newId('tn'), newId('nd'), 'main'),
    ).rejects.toMatchObject({ code: 'invalid_input' })
  })
})

describe.skipIf(!hasDatabase)('provisioning against Postgres (as the restro_app role)', () => {
  const tenantA = newId('tn')
  const tenantB = newId('tn')
  const tenantWithoutRow = newId('tn')
  // Slugs need not be unique (D68); a slug of its own per run tells this test's venues apart.
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

  it('gives a venue a public code: 12 characters of a-z0-9, its own, and not made from its id', async () => {
    const [first] = await withTenant(app, tenantA, (tx) =>
      tx.select().from(venues).where(eq(venues.slug, slugA)),
    )
    if (!first) throw new Error('the first venue of tenantA should exist')
    expect(first.publicId).toMatch(/^[a-z0-9]{12}$/)
    // Rule 3: never derived from the internal id.
    expect(first.id.toLowerCase()).not.toContain(first.publicId)

    const more = await Promise.all(
      Array.from({ length: 5 }, (_, i) =>
        provisionVenue(app, tenantB, { name: `Code ${i}`, slug: testSlug('code') }),
      ),
    )
    const codes = [first.publicId, ...more.map((venue) => venue.publicId)]
    expect(codes.every((code) => /^[a-z0-9]{12}$/.test(code))).toBe(true)
    expect(new Set(codes).size).toBe(codes.length)
  })

  it('keeps a slug unique within an organisation and free across organisations (D84)', async () => {
    // slugA is tenantA's already. A second venue of tenantA is refused; one of tenantB is fine.
    await expect(
      provisionVenue(app, tenantA, { name: 'Another', slug: slugA }),
    ).rejects.toMatchObject({ code: 'slug_taken' })
    const sameInB = await provisionVenue(app, tenantB, { name: 'Twin', slug: slugA })
    expect(sameInB.slug).toBe(slugA)
    const seenByA = await withTenant(app, tenantA, (tx) => tx.select().from(venues))
    expect(seenByA.filter((venue) => venue.slug === slugA)).toHaveLength(1)
  })

  describe('renameVenueSlug', () => {
    const readVenue = async (tenantId: string, venueId: string) =>
      (
        await withTenant(app, tenantId, (tx) =>
          tx.select().from(venues).where(eq(venues.id, venueId)),
        )
      )[0]

    it('changes the slug and leaves the public code and every other column alone', async () => {
      const venue = await provisionVenue(app, tenantA, {
        name: 'Renamed',
        slug: testSlug('before'),
      })
      await provisionMenu(app, tenantA, venue.id)
      const after = testSlug('after')
      const result = await renameVenueSlug(app, tenantA, venue.id, after)
      expect(result).toEqual({
        venueId: venue.id,
        slug: after,
        publicId: venue.publicId,
        changed: true,
      })
      const row = await readVenue(tenantA, venue.id)
      expect(row).toMatchObject({
        id: venue.id,
        slug: after,
        publicId: venue.publicId,
        name: 'Renamed',
        timezone: venue.timezone,
        currency: venue.currency,
        enabledLocales: venue.enabledLocales,
        createdAt: venue.createdAt,
      })
    })

    it('keeps the code through many renames, and writes nothing for the slug it already has', async () => {
      const venue = await provisionVenue(app, tenantA, { name: 'Many', slug: testSlug('many') })
      for (const slug of ['one', 'two', 'a', 'one']) {
        const result = await renameVenueSlug(app, tenantA, venue.id, slug)
        expect(result).toMatchObject({ slug, publicId: venue.publicId, changed: true })
      }
      const before = await readVenue(tenantA, venue.id)
      const again = await renameVenueSlug(app, tenantA, venue.id, 'one')
      expect(again).toMatchObject({ slug: 'one', publicId: venue.publicId, changed: false })
      const afterwards = await readVenue(tenantA, venue.id)
      expect(afterwards?.publicId).toBe(venue.publicId)
      // No update happened, so the touch trigger did not move updated_at.
      expect(afterwards?.updatedAt).toEqual(before?.updatedAt)
    })

    it('takes a slug another venue holds', async () => {
      const venue = await provisionVenue(app, tenantA, { name: 'Twin', slug: testSlug('twin') })
      const result = await renameVenueSlug(app, tenantA, venue.id, slugB)
      expect(result).toMatchObject({ slug: slugB, changed: true })
    })

    it('does not see a venue of another tenant: venue_missing, nothing changed', async () => {
      const theirs = await provisionVenue(app, tenantB, {
        name: 'Theirs',
        slug: testSlug('theirs'),
      })
      await expect(renameVenueSlug(app, tenantA, theirs.id, 'mine')).rejects.toMatchObject({
        name: 'ProvisionError',
        code: 'venue_missing',
      })
      expect((await readVenue(tenantB, theirs.id))?.slug).toBe(theirs.slug)
      await expect(renameVenueSlug(app, tenantA, newId('vn'), 'mine')).rejects.toMatchObject({
        code: 'venue_missing',
      })
    })
  })

  it('provisionVenue reports a tenant that has no row yet', async () => {
    await expect(
      provisionVenue(app, tenantWithoutRow, { name: 'Orphan', slug: testSlug('orphan') }),
    ).rejects.toMatchObject({ name: 'ProvisionError', code: 'tenant_missing' })
  })
})
