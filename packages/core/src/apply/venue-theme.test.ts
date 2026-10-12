// The venue's look (briefs S3-03 and SH-01): the pure theme helpers, the writer `setVenueTheme`,
// and the publisher feeding the theme (v1: brand colour and logo; v2: three colours, overrides,
// font, corners, shadow, light/dark policy) into the snapshot's theme. Postgres as restro_app.
import { createPool, type DbPool, venues, withTenant } from '@restro/db'
import { eq } from 'drizzle-orm'
import type pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import type { ChangeSet } from '../change-set'
import { sha256Hex } from '../hash'
import { newId } from '../ids'
import { DEFAULT_THEME } from '../snapshot/build'
import {
  deriveRoles,
  generatePalette,
  PALETTE_STEPS,
  paletteRoles,
  readVenueTheme,
  semanticColours,
  semanticColoursDark,
  snapshotPalette,
  THEME_PRESETS,
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
  const theme = (fields: Record<string, unknown>) => ({ logo_asset_id: null, ...fields })
  it.each([
    ['a malformed venue id', { venueId: 'vn_nope', theme: null }],
    ['a colour name', { venueId: newId('vn'), theme: { brand: 'blue', logo_asset_id: null } }],
    ['an unknown field', { venueId: newId('vn'), theme: null, font: 'Inter' }],
    ['an unknown font', { venueId: newId('vn'), theme: theme({ font: 'comic-sans' }) }],
    ['a radius out of range', { venueId: newId('vn'), theme: theme({ radius: 40 }) }],
    ['a shadow out of range', { venueId: newId('vn'), theme: theme({ shadow: 9 }) }],
    ['an unknown scheme', { venueId: newId('vn'), theme: theme({ scheme: 'sepia' }) }],
    ['an unknown preset', { venueId: newId('vn'), theme: theme({ preset: 'neon' }) }],
  ])('refuses %s before touching the database', async (_label, input) => {
    await expect(setVenueTheme({} as DbPool, newId('tn'), input as never)).rejects.toMatchObject({
      name: 'VenueThemeError',
      code: 'invalid_input',
    })
  })

  it('refuses colours that do not read, naming every failing pair, before touching the database', async () => {
    const refusal = setVenueTheme({} as DbPool, newId('tn'), {
      venueId: newId('vn'),
      theme: {
        logo_asset_id: null,
        colors: { primary: '#ffffff', secondary: '#f4f4f5', tertiary: '#2563eb' },
        overrides: { light: { text: '#eeeeee' }, dark: { on_accent: '#2563eb' } },
      },
    })
    await expect(refusal).rejects.toMatchObject({ name: 'VenueThemeError', code: 'unreadable' })
    const error = (await refusal.catch((caught: unknown) => caught)) as VenueThemeError
    expect(error.issues.map(({ mode, fg, bg }) => `${mode} ${fg}/${bg}`)).toEqual([
      'light text/background',
      'light text/surface',
      'dark on_accent/accent',
    ])
    expect(error.message).toContain('light text on background')
    expect(error.message).toContain('needs 4.5:1')
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
    // A v1 theme keeps today's look (its palette, the default tokens) and gets, since SH-01, the
    // roles the shell has always derived from that palette, and the auto scheme.
    const palette = generatePalette('#3366cc')
    expect(next.snapshot.body?.theme).toEqual({
      ...DEFAULT_THEME,
      palette: snapshotPalette('#3366cc'),
      roles: paletteRoles(palette),
      scheme: 'auto',
    })
    expect(next.snapshot.body?.theme.roles?.light.accent_text).toBe(
      semanticColours(palette).accentText,
    )
    expect(next.snapshot.body?.theme.roles?.dark.text).toBe(semanticColoursDark(palette).text)
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

  it('saves a v2 theme, keeps other settings, and publishes its roles, font, corners and policy', async () => {
    const theme = {
      logo_asset_id: null,
      preset: null,
      colors: { primary: '#FBF5EC', secondary: '#f0e2d2', tertiary: '#c8372d' },
      overrides: { dark: { accent: '#e5533f' } },
      font: 'playfair-display',
      radius: 18,
      shadow: 2,
      scheme: 'light',
    } as const
    const stored = await setVenueTheme(app, tenant, { venueId, theme })
    const lower = { ...theme, colors: { ...theme.colors, primary: '#fbf5ec' } }
    expect(stored).toEqual(lower)
    expect(await settingsOf()).toEqual({ other: 1, theme: lower })
    // Saving the same theme again changes nothing.
    expect(await setVenueTheme(app, tenant, { venueId, theme })).toEqual(lower)
    expect(await settingsOf()).toEqual({ other: 1, theme: lower })

    const published = await publish(40)
    expect(published.status).toBe('published')
    expect(published.snapshot.body?.theme).toEqual({
      palette: snapshotPalette('#c8372d'),
      font: 'Playfair Display',
      radius: 18,
      shadow: 2,
      logo: null,
      roles: deriveRoles(lower.colors, lower.overrides),
      scheme: 'light',
    })
    expect(published.snapshot.body?.theme.roles?.dark.accent).toBe('#e5533f')
  })

  it('saves a preset as it is and publishes the designer colours', async () => {
    const midnight = THEME_PRESETS[1]
    if (midnight === undefined) throw new Error('no preset')
    await setVenueTheme(app, tenant, {
      venueId,
      theme: {
        logo_asset_id: null,
        preset: midnight.id,
        colors: midnight.colours,
        overrides: midnight.overrides,
        radius: midnight.radius,
      },
    })
    const published = await publish(50)
    // The designer's eight roles as chosen; the extended roles of D93 are published with them.
    expect(published.snapshot.body?.theme.roles).toMatchObject(midnight.overrides)
    expect(published.snapshot.body?.theme).toMatchObject({ radius: 6, font: 'Inter', shadow: 1 })
  })

  it('refuses an unreadable override and keeps the saved theme', async () => {
    const before = await settingsOf()
    await expect(
      setVenueTheme(app, tenant, {
        venueId,
        theme: {
          logo_asset_id: null,
          colors: { primary: '#ffffff', secondary: '#f4f4f5', tertiary: '#2563eb' },
          overrides: { light: { muted: '#dddddd' } },
        },
      }),
    ).rejects.toMatchObject({ code: 'unreadable' })
    expect(await settingsOf()).toEqual(before)
  })
})
