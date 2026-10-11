// The Design tab's server actions against a real Postgres, as the restro_app role (brief SH-05a):
// what saveLookAction and chooseTemplateAction write, who may call them, and every refusal. The
// session is the only fake: it says which organisation and role is asking.
import { newId, readPresentation, readVenueTheme, THEME_PRESETS } from '@restro/core'
import { provisionTenant, provisionVenue, setVenuePresentation } from '@restro/core/apply'
import type pg from 'pg'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { saveFeatureOptionsAction } from '../composer/guest-features-actions'
import { getPool } from '../db'
import { hasDatabase, openOwnerPool, testSlug, useTestServerEnvironment } from '../test-database'
import { chooseTemplateAction, saveLookAction } from './actions'
import { loadDesign } from './service'

const asked = vi.hoisted(() => ({ tenantId: '', role: 'owner' }))
const revalidated = vi.hoisted(() => [] as string[])

vi.mock('@/server/session', () => ({
  requireTenant: async () => ({
    user: { id: 'us_sh05atester', name: 'Tester', email: 'tester@example.test' },
    organizations: [],
    organization: { id: asked.tenantId, name: 'SH-05a club', slug: 'sh05a-club', role: asked.role },
  }),
}))
vi.mock('next/cache', () => ({ revalidatePath: (path: string) => revalidated.push(path) }))

const midnight = THEME_PRESETS.find((preset) => preset.id === 'midnight')
if (midnight === undefined) throw new Error('the Midnight preset is missing')

/** A whole look, the way the Design tab builds one for the Midnight preset. */
const wholeTheme = (fields: Record<string, unknown> = {}) => ({
  logo_asset_id: null,
  preset: 'midnight',
  colors: midnight.colours,
  overrides: midnight.overrides,
  font: 'lora',
  radius: midnight.radius,
  shadow: 3,
  scheme: 'dark',
  ...fields,
})

const NO_ASSET = 'as_0123456789ABCDEFGHIJKL'

describe.skipIf(!hasDatabase)('the Design tab’s actions (as the restro_app role)', () => {
  const tenant = newId('tn')
  const otherTenant = newId('tn')
  let owner: pg.Pool
  let venueId: string
  let otherVenueId: string

  const settingsOf = async (id: string) =>
    (
      await owner.query<{ settings: Record<string, unknown> }>(
        'select settings from restro.venues where id = $1',
        [id],
      )
    ).rows[0]?.settings
  const setSettings = (id: string, settings: Record<string, unknown>) =>
    owner.query('update restro.venues set settings = $2 where id = $1', [
      id,
      JSON.stringify(settings),
    ])

  beforeAll(async () => {
    useTestServerEnvironment()
    owner = openOwnerPool()
    await provisionTenant(getPool(), { tenantId: tenant, name: 'SH-05a club' })
    await provisionTenant(getPool(), { tenantId: otherTenant, name: 'Another club' })
    venueId = (
      await provisionVenue(getPool(), tenant, { name: 'Look Club', slug: testSlug('look') })
    ).id
    otherVenueId = (
      await provisionVenue(getPool(), otherTenant, { name: 'Elsewhere', slug: testSlug('else') })
    ).id
    asked.tenantId = tenant
  })

  beforeEach(async () => {
    asked.role = 'owner'
    revalidated.length = 0
    await setSettings(venueId, {})
    await setSettings(otherVenueId, {})
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

  describe('saveLookAction', () => {
    it('saves a whole look, readable, and refreshes the venue page', async () => {
      expect(await saveLookAction({ venueId, theme: wholeTheme() })).toEqual({ ok: true })
      const stored = readVenueTheme(await settingsOf(venueId))
      expect(stored).toMatchObject({
        logo_asset_id: null,
        preset: 'midnight',
        colors: midnight.colours,
        font: 'lora',
        radius: 6,
        shadow: 3,
        scheme: 'dark',
      })
      expect(stored?.overrides?.dark?.background).toBe('#0e0d0c')
      expect(revalidated).toEqual([`/venues/${venueId}`])
    })

    it('saves a look built from one brand colour, with every v2 field', async () => {
      const theme = {
        logo_asset_id: null,
        brand: '#E11D48',
        font: 'inter',
        radius: 8,
        shadow: 1,
        scheme: 'auto',
      }
      expect(await saveLookAction({ venueId, theme })).toEqual({ ok: true })
      expect(readVenueTheme(await settingsOf(venueId))).toEqual({ ...theme, brand: '#e11d48' })
    })

    it('leaves the other settings of the venue alone', async () => {
      await setSettings(venueId, {
        presentation: { face: 'editorial-market', options: {} },
        other: 1,
      })
      await saveLookAction({ venueId, theme: wholeTheme() })
      const settings = await settingsOf(venueId)
      expect(settings?.other).toBe(1)
      expect(readPresentation(settings)).toEqual({ face: 'editorial-market', options: {} })
    })

    it('refuses a look whose colours do not read, naming every failing pair, and writes nothing', async () => {
      const before = await saveLookAction({ venueId, theme: wholeTheme({ font: 'manrope' }) })
      expect(before).toEqual({ ok: true })
      const unreadable = wholeTheme({
        overrides: {
          ...midnight.overrides,
          // Text the colour of the page, in the light set.
          light: { ...midnight.overrides.light, text: midnight.overrides.light.background },
        },
      })
      const result = await saveLookAction({ venueId, theme: unreadable })
      expect(result).toMatchObject({ ok: false, error: 'unreadable' })
      if (result.ok || result.error !== 'unreadable') return
      expect(result.issues.map((issue) => `${issue.mode}:${issue.fg}-on-${issue.bg}`)).toEqual([
        'light:text-on-background',
        'light:text-on-surface',
      ])
      expect(result.issues[0]).toMatchObject({ min: 4.5 })
      expect(result.issues[0]?.ratio).toBeLessThan(4.5)
      // The earlier look is still the stored one.
      expect(readVenueTheme(await settingsOf(venueId))?.font).toBe('manrope')
    })

    it('refuses a partial look (the old card’s shape, or a v2 field missing) and writes nothing', async () => {
      const complete = wholeTheme()
      const partial: [string, unknown][] = [
        ['the first version’s brand and logo only', { logo_asset_id: null, brand: '#2563eb' }],
        ['no font', { ...complete, font: undefined }],
        ['no corners', { ...complete, radius: undefined }],
        ['no shadow', { ...complete, shadow: undefined }],
        ['no light/dark policy', { ...complete, scheme: undefined }],
        ['three colours without saying which preset', { ...complete, preset: undefined }],
        ['three colours and a brand colour', { ...complete, brand: '#2563eb' }],
        ['null (that would drop the look)', null],
      ]
      for (const [label, theme] of partial) {
        expect(await saveLookAction({ venueId, theme }), label).toEqual({
          ok: false,
          error: 'invalid',
        })
      }
      expect(readVenueTheme(await settingsOf(venueId))).toBeNull()
      expect(revalidated).toEqual([])
    })

    it('refuses input that is not a look at all', async () => {
      const bad: unknown[] = [
        null,
        'theme',
        { venueId, theme: wholeTheme({ font: 'comic-sans' }) },
        { venueId, theme: wholeTheme({ radius: 99 }) },
        {
          venueId,
          theme: wholeTheme({ colors: { primary: 'red', secondary: '#fff', tertiary: '#000' } }),
        },
        { venueId, theme: wholeTheme({ extra: 1 }) },
        { venueId: 'vn_nope', theme: wholeTheme() },
        { venueId, theme: wholeTheme(), extra: 1 },
      ]
      for (const input of bad) {
        const result = await saveLookAction(
          typeof input === 'object' && input !== null && 'venueId' in input
            ? input
            : { venueId, theme: input },
        )
        expect(result, JSON.stringify(input)).toEqual({ ok: false, error: 'invalid' })
      }
      expect(readVenueTheme(await settingsOf(venueId))).toBeNull()
    })

    it('refuses a logo that is not a stored image of this organisation', async () => {
      expect(
        await saveLookAction({ venueId, theme: wholeTheme({ logo_asset_id: NO_ASSET }) }),
      ).toEqual({
        ok: false,
        error: 'logo_not_usable',
      })
      expect(readVenueTheme(await settingsOf(venueId))).toBeNull()
    })

    it('lets an admin save, and refuses a plain member without writing', async () => {
      asked.role = 'admin'
      expect((await saveLookAction({ venueId, theme: wholeTheme() })).ok).toBe(true)
      await setSettings(venueId, {})
      for (const role of ['member', 'viewer', '']) {
        asked.role = role
        expect(await saveLookAction({ venueId, theme: wholeTheme() }), role).toEqual({
          ok: false,
          error: 'forbidden',
        })
      }
      expect(readVenueTheme(await settingsOf(venueId))).toBeNull()
    })

    it('does not find a venue of another organisation', async () => {
      expect(await saveLookAction({ venueId: otherVenueId, theme: wholeTheme() })).toEqual({
        ok: false,
        error: 'not_found',
      })
      expect(readVenueTheme(await settingsOf(otherVenueId))).toBeNull()
      expect(await saveLookAction({ venueId: newId('vn'), theme: wholeTheme() })).toEqual({
        ok: false,
        error: 'not_found',
      })
    })
  })

  describe('chooseTemplateAction', () => {
    const look = { layout: 'one', featureFirstSection: false }

    it('saves the visible template with its look options and refreshes the page', async () => {
      const result = await chooseTemplateAction({
        venueId,
        face: 'editorial-market',
        lookOptions: look,
      })
      expect(result).toEqual({
        ok: true,
        presentation: { face: 'editorial-market', options: look },
      })
      expect(readPresentation(await settingsOf(venueId))).toEqual({
        face: 'editorial-market',
        options: look,
      })
      expect(revalidated).toEqual([`/venues/${venueId}`])
    })

    it('refuses the hidden reference template and a name that is not in the registry', async () => {
      for (const face of ['qr-phone', 'no-such-template', 'Editorial-Market', '']) {
        const result = await chooseTemplateAction({ venueId, face, lookOptions: {} })
        expect(result.ok, face).toBe(false)
        expect(['unknown_face', 'invalid'], face).toContain(result.ok ? '' : result.error)
      }
      expect(await chooseTemplateAction({ venueId, face: 'qr-phone', lookOptions: {} })).toEqual({
        ok: false,
        error: 'unknown_face',
      })
      expect(readPresentation(await settingsOf(venueId))).toBeNull()
    })

    it('merges the look options and keeps the feature options the composer panel saved', async () => {
      await setVenuePresentation(getPool(), tenant, {
        venueId: venueId as never,
        presentation: {
          face: 'editorial-market',
          options: { layout: 'two', featureFirstSection: true, layoutSwitch: false },
        },
      })
      // The form also sends a feature key and a key the template does not declare: both ignored.
      const result = await chooseTemplateAction({
        venueId,
        face: 'editorial-market',
        lookOptions: { ...look, layoutSwitch: true, madeUp: 'x' },
      })
      expect(result).toEqual({
        ok: true,
        presentation: {
          face: 'editorial-market',
          options: { layout: 'one', featureFirstSection: false, layoutSwitch: false },
        },
      })
      expect(readPresentation(await settingsOf(venueId))?.options).toEqual({
        layout: 'one',
        featureFirstSection: false,
        layoutSwitch: false,
      })
    })

    it('replaces a value the template does not list by its default', async () => {
      const result = await chooseTemplateAction({
        venueId,
        face: 'editorial-market',
        lookOptions: { layout: 'diagonal', featureFirstSection: 'yes' },
      })
      expect(result).toMatchObject({
        ok: true,
        presentation: { options: { layout: 'two', featureFirstSection: true } },
      })
    })

    it('and the composer panel’s feature options never drop each other’s keys', async () => {
      // Look first, then the composer panel's switch, then the look again: each write keeps the
      // other's keys (SH-05b's saveFeatureOptionsAction is the mirror image of this action).
      await chooseTemplateAction({ venueId, face: 'editorial-market', lookOptions: look })
      expect(await saveFeatureOptionsAction({ venueId, options: { layoutSwitch: false } })).toEqual(
        { ok: true },
      )
      expect(readPresentation(await settingsOf(venueId))?.options).toEqual({
        layout: 'one',
        featureFirstSection: false,
        layoutSwitch: false,
      })
      await chooseTemplateAction({
        venueId,
        face: 'editorial-market',
        lookOptions: { layout: 'list', featureFirstSection: true },
      })
      expect(readPresentation(await settingsOf(venueId))?.options).toEqual({
        layout: 'list',
        featureFirstSection: true,
        layoutSwitch: false,
      })
      expect(await saveFeatureOptionsAction({ venueId, options: { layoutSwitch: true } })).toEqual({
        ok: true,
      })
      expect(readPresentation(await settingsOf(venueId))?.options).toEqual({
        layout: 'list',
        featureFirstSection: true,
        layoutSwitch: true,
      })
    })

    it('leaves the look and the other settings alone', async () => {
      await saveLookAction({ venueId, theme: wholeTheme() })
      await chooseTemplateAction({ venueId, face: 'editorial-market', lookOptions: look })
      expect(readVenueTheme(await settingsOf(venueId))?.font).toBe('lora')
    })

    it('refuses bad input', async () => {
      const bad: unknown[] = [
        null,
        { venueId, face: 'editorial-market' },
        { venueId, face: 'editorial-market', lookOptions: 'one' },
        { venueId, face: 'editorial-market', lookOptions: { layout: 1 } },
        { venueId, face: 'editorial-market', lookOptions: {}, extra: true },
        { venueId: 'vn_nope', face: 'editorial-market', lookOptions: {} },
      ]
      for (const input of bad) {
        expect(await chooseTemplateAction(input), JSON.stringify(input)).toEqual({
          ok: false,
          error: 'invalid',
        })
      }
      expect(readPresentation(await settingsOf(venueId))).toBeNull()
    })

    it('refuses a plain member without writing, and does not find another organisation’s venue', async () => {
      asked.role = 'member'
      expect(
        await chooseTemplateAction({ venueId, face: 'editorial-market', lookOptions: look }),
      ).toEqual({ ok: false, error: 'forbidden' })
      asked.role = 'owner'
      expect(
        await chooseTemplateAction({
          venueId: otherVenueId,
          face: 'editorial-market',
          lookOptions: look,
        }),
      ).toEqual({ ok: false, error: 'not_found' })
      expect(readPresentation(await settingsOf(venueId))).toBeNull()
      expect(readPresentation(await settingsOf(otherVenueId))).toBeNull()
    })
  })

  describe('loadDesign', () => {
    const noStore = async () => ({ getUrl: async () => 'https://example.test/logo' })

    it('gives the default template and no look for a venue that has chosen none', async () => {
      const row = { settings: await settingsOf(venueId) } as never
      const view = await loadDesign(getPool(), tenant, row, noStore, 'owner')
      expect(view).toEqual({
        theme: null,
        presentation: { face: 'editorial-market', options: {} },
        logo: null,
        canEdit: true,
      })
    })

    it('gives the saved look and template, and read-only for a member', async () => {
      await saveLookAction({ venueId, theme: wholeTheme() })
      await chooseTemplateAction({
        venueId,
        face: 'editorial-market',
        lookOptions: { layout: 'one', featureFirstSection: true },
      })
      const row = { settings: await settingsOf(venueId) } as never
      const view = await loadDesign(getPool(), tenant, row, noStore, 'member')
      expect(view.theme?.preset).toBe('midnight')
      expect(view.presentation.options).toMatchObject({ layout: 'one' })
      expect(view.canEdit).toBe(false)
      expect((await loadDesign(getPool(), tenant, row, noStore, 'admin')).canEdit).toBe(true)
    })
  })
})
