// The venue's look (brief S3-03): the pure theme helpers, the writer `setVenueTheme`, and the
// publisher feeding the brand colour and the logo into the snapshot's theme. Postgres as restro_app.
import { createPool, type DbPool, venues, withTenant } from '@restro/db'
import { eq } from 'drizzle-orm'
import type pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import type { ChangeSet } from '../change-set'
import { sha256Hex } from '../hash'
import { newId } from '../ids'
import { DEFAULT_THEME } from '../snapshot/build'
import {
  generatePalette,
  PALETTE_STEPS,
  readVenueTheme,
  snapshotPalette,
  VenueThemeSchema,
} from '../theme'
import { apply } from './apply'
import { createAsset, setAssetVariants } from './create-asset'
import { type ProvisionedMenu, provisionMenu, provisionTenant, provisionVenue } from './provision'
import { loadCurrentSnapshot, publishMenu } from './publish'
import { appDatabaseUrl, cleanUp, hasDatabase, openOwnerPool, testSlug } from './test-database'
import { setVenueTheme, VenueThemeError } from './venue-theme'

describe('the venue theme setting (pure)', () => {
  it('derives the eleven snapshot colours from the brand colour, light to dark', () => {
    const palette = snapshotPalette('#3366cc')
    expect(palette).toHaveLength(PALETTE_STEPS.length)
    expect(palette).toEqual(PALETTE_STEPS.map((step) => generatePalette('#3366cc')[step]))
    expect(palette[5]).toBe('#3366cc')
  })

  it('reads a stored theme, lower-casing the colour', () => {
    expect(readVenueTheme({ theme: { brand: '#3366CC', logo_asset_id: null } })).toEqual({
      brand: '#3366cc',
      logo_asset_id: null,
    })
  })

  it('treats a missing or malformed theme as none, never as an error', () => {
    expect(readVenueTheme({})).toBeNull()
    expect(readVenueTheme(null)).toBeNull()
    expect(readVenueTheme({ theme: { brand: 'red', logo_asset_id: null } })).toBeNull()
    expect(readVenueTheme({ theme: { brand: '#3366cc' } })).toBeNull()
    expect(readVenueTheme({ theme: { brand: '#3366cc', logo_asset_id: 'x', extra: 1 } })).toBeNull()
  })

  it('refuses a colour that is not #rrggbb and an id that is not an asset', () => {
    expect(VenueThemeSchema.safeParse({ brand: '#abc', logo_asset_id: null }).success).toBe(false)
    expect(VenueThemeSchema.safeParse({ brand: '#aabbcc', logo_asset_id: 'nd_x' }).success).toBe(
      false,
    )
  })
})

describe('setVenueTheme input checks (no database needed)', () => {
  it.each([
    ['a malformed venue id', { venueId: 'vn_nope', theme: null }],
    ['a colour name', { venueId: newId('vn'), theme: { brand: 'blue', logo_asset_id: null } }],
    ['an unknown field', { venueId: newId('vn'), theme: null, font: 'Inter' }],
  ])('refuses %s before touching the database', async (_label, input) => {
    await expect(setVenueTheme({} as DbPool, newId('tn'), input as never)).rejects.toMatchObject({
      name: 'VenueThemeError',
      code: 'invalid_input',
    })
  })
})

describe.skipIf(!hasDatabase)('the venue theme against Postgres (as the restro_app role)', () => {
  const tenant = newId('tn')
  const otherTenant = newId('tn')
  let app: DbPool
  let owner: pg.Pool
  let venueId: `vn_${string}`
  let menu: ProvisionedMenu

  const settingsOf = async () =>
    (
      await withTenant(app, tenant, (tx) => tx.select().from(venues).where(eq(venues.id, venueId)))
    )[0]?.settings

  async function makeAsset(forTenant: string, name: string) {
    return createAsset(app, forTenant, {
      origin: 'upload',
      contentType: 'image/png',
      checksum: sha256Hex(name),
      width: 600,
      height: 200,
      storageKey: `tenants/${forTenant}/assets/${name}/original.png`,
    })
  }

  beforeAll(async () => {
    owner = openOwnerPool()
    app = createPool(appDatabaseUrl(), { applicationName: 'restro-core-venue-theme-tests' })
    await provisionTenant(app, { tenantId: tenant, name: 'Theme test club' })
    await provisionTenant(app, { tenantId: otherTenant, name: 'Another club' })
    venueId = (await provisionVenue(app, tenant, { name: 'Main', slug: testSlug('main') }))
      .id as `vn_${string}`
    menu = await provisionMenu(app, tenant, venueId)
    const section = newId('nd')
    const item = newId('nd')
    const result = await apply(app, tenant, {
      id: newId('cs'),
      source: 'manual',
      jobId: newId('jb'),
      actor: 'user:us_test',
      observedAt: new Date().toISOString(),
      ops: [
        {
          op: 'createNode',
          id: section,
          nodeType: 'section',
          parent: { id: menu.id },
          status: 'active',
          sortKey: 'end',
        },
        {
          op: 'setField',
          node: { id: section },
          fieldKey: 'title',
          layer: 'manual',
          scope: 'master',
          value: { bg_BG: 'Бар', en_US: 'Bar' },
        },
        { op: 'createNode', id: item, nodeType: 'item', parent: null, status: 'active' },
        {
          op: 'setField',
          node: { id: item },
          fieldKey: 'name',
          layer: 'manual',
          scope: 'master',
          value: { bg_BG: 'Вода', en_US: 'Water' },
        },
        {
          op: 'setField',
          node: { id: item },
          fieldKey: 'price',
          layer: 'manual',
          scope: 'master',
          value: { amount_minor: 300, currency: 'EUR' },
        },
        {
          op: 'setField',
          node: { id: item },
          fieldKey: 'allergens',
          layer: 'manual',
          scope: 'master',
          value: [],
        },
        { op: 'setPlacement', item: { id: item }, section: { id: section }, sortKey: 'end' },
      ],
    } as ChangeSet)
    expect(result.rejected).toEqual([])
  })
  afterAll(async () => {
    if (owner) await cleanUp(owner, [tenant, otherTenant])
    await owner?.end()
    await app?.end()
  })

  const publish = (minutes: number) =>
    publishMenu(
      app,
      tenant,
      { menuId: menu.id, venueId, reason: 'manual', actor: 'user:us_test' },
      { now: new Date(Date.parse('2026-10-09T18:00:00Z') + minutes * 60_000) },
    )

  it('a venue starts with no theme and publishes the default one', async () => {
    expect(await settingsOf()).toEqual({})
    const first = await publish(0)
    expect(first.snapshot.body?.theme).toEqual(DEFAULT_THEME)
  })

  it('saves the brand colour, keeps other settings, and the next publish carries the palette', async () => {
    const stored = await setVenueTheme(app, tenant, {
      venueId,
      theme: { brand: '#3366CC', logo_asset_id: null },
    })
    expect(stored).toEqual({ brand: '#3366cc', logo_asset_id: null })
    expect(await settingsOf()).toEqual({ theme: { brand: '#3366cc', logo_asset_id: null } })

    const next = await publish(10)
    expect(next.status).toBe('published')
    expect(next.snapshot.body?.theme).toEqual({
      ...DEFAULT_THEME,
      palette: snapshotPalette('#3366cc'),
    })
    // A publish with nothing new in between is the same snapshot.
    expect((await publish(11)).status).toBe('unchanged')
  })

  it('puts the logo in the snapshot only once its variant files exist', async () => {
    const logo = await makeAsset(tenant, 'logo-one')
    await setVenueTheme(app, tenant, {
      venueId,
      theme: { brand: '#3366cc', logo_asset_id: logo.id },
    })
    // Stored but no variants yet: the logo is left out, not shown broken.
    const without = await publish(20)
    expect(without.snapshot.body?.theme.logo).toBeNull()
    expect(without.snapshot.body?.assets).toEqual({})

    expect(await setAssetVariants(app, tenant, logo.id, { thumb: 320, card: 600, full: 600 })).toBe(
      true,
    )
    const withLogo = await publish(21)
    expect(withLogo.status).toBe('published')
    expect(withLogo.snapshot.body?.theme.logo).toBe(logo.id)
    expect(withLogo.snapshot.body?.assets[logo.id]).toMatchObject({ w: 600, h: 200 })
    // Rule 3: nothing about where the original is stored reaches the snapshot.
    expect(JSON.stringify(withLogo.snapshot.body)).not.toContain('original.png')
    const current = await loadCurrentSnapshot(app, tenant, { menuId: menu.id, venueId })
    expect(current?.id).toBe(withLogo.snapshot.id)
  })

  it('refuses a logo that is not a stored image of this tenant', async () => {
    const foreign = await makeAsset(otherTenant, 'logo-foreign')
    for (const logo_asset_id of [foreign.id, newId('as')]) {
      await expect(
        setVenueTheme(app, tenant, { venueId, theme: { brand: '#3366cc', logo_asset_id } }),
      ).rejects.toMatchObject({ name: 'VenueThemeError', code: 'logo_not_usable' })
    }
    await expect(
      setVenueTheme(app, tenant, { venueId: newId('vn'), theme: null }),
    ).rejects.toBeInstanceOf(VenueThemeError)
    // Nothing changed.
    expect(readVenueTheme(await settingsOf())?.brand).toBe('#3366cc')
  })

  it("never writes another tenant's venue", async () => {
    await expect(
      setVenueTheme(app, otherTenant, {
        venueId,
        theme: { brand: '#aa0000', logo_asset_id: null },
      }),
    ).rejects.toMatchObject({ code: 'venue_not_found' })
  })

  it('goes back to the default theme with null, leaving other settings alone', async () => {
    await owner.query(
      `update restro.venues set settings = settings || '{"other": 1}'::jsonb where id = $1`,
      [venueId],
    )
    expect(await setVenueTheme(app, tenant, { venueId, theme: null })).toBeNull()
    expect(await settingsOf()).toEqual({ other: 1 })
    const reset = await publish(30)
    expect(reset.snapshot.body?.theme).toEqual(DEFAULT_THEME)
  })
})
