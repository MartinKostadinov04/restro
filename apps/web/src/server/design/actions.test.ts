// The Design tab's server actions against a real Postgres, as the restro_app role (brief SH-05a,
// D129): what saveLookAction and saveLayoutAction write through `setDesign`, who may call them, and
// every refusal. The session is the only fake: it says which organisation and role is asking.
import {
  BASIC_DESIGN_VALUES,
  DEFAULT_DESIGN,
  designThemeOf,
  newId,
  readDesign,
  readDesignRecord,
  THEME_PRESETS,
} from '@restro/core'
import { provisionTenant, provisionVenue } from '@restro/core/apply'
import type pg from 'pg'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { getPool } from '../db'
import { hasDatabase, openOwnerPool, testSlug, useTestServerEnvironment } from '../test-database'
import { saveLayoutAction, saveLookAction } from './actions'
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
  shadow: 1,
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
  const recordOf = async (id: string) => readDesignRecord(await settingsOf(id))
  /** Saves a look from the revision stored now. */
  const saveNow = async (fields: Record<string, unknown> = {}) =>
    saveLookAction({
      venueId,
      expectedRevision: readDesign(await settingsOf(venueId)).revision,
      theme: wholeTheme(fields),
    })

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
      for (const table of ['events', 'menus', 'nodes', 'venues']) {
        await owner.query(`delete from restro.${table} where tenant_id = any($1)`, [tenants])
      }
      await owner.query('delete from restro.tenants where id = any($1)', [tenants])
      await owner.end()
    }
  })

  describe('saveLookAction', () => {
    it('saves a whole look into the record, and refreshes the venue page', async () => {
      expect(await saveNow()).toEqual({ ok: true, revision: 1 })
      const stored = await recordOf(venueId)
      expect(stored).toMatchObject({
        revision: 1,
        style: 'basic',
        logo_asset_id: null,
        colors: midnight.colours,
        provenance: { layer: 'manual', source: 'manual', actor: 'user:us_sh05atester' },
      })
      expect(stored?.values.general).toMatchObject({
        body_font: 'lora',
        corners: 'soft',
        depth: 'low',
        screen: 'dark',
      })
      expect(stored?.overrides?.dark?.background).toBe('#0e0d0c')
      expect(revalidated).toEqual([`/venues/${venueId}`])
    })

    it('appends one event with the person and the job for every save', async () => {
      await saveNow()
      await saveNow({ font: 'manrope' })
      const events = await owner.query<{
        source: string
        actor: string
        job_id: string
        field_key: string
      }>(
        `select source, actor, job_id, field_key from restro.events
         where tenant_id = $1 and scope = $2 order by seq`,
        [tenant, `venue:${venueId}`],
      )
      expect(events.rows.filter((row) => row.field_key === 'design').length).toBeGreaterThanOrEqual(
        2,
      )
      for (const row of events.rows) {
        expect(row).toMatchObject({ source: 'manual', actor: 'user:us_sh05atester' })
        expect(row.job_id).toMatch(/^jb_/)
      }
    })

    it('saves a look built from one brand colour', async () => {
      const theme = {
        logo_asset_id: null,
        brand: '#E11D48',
        font: 'inter',
        radius: 8,
        shadow: 1,
        scheme: 'auto',
      }
      expect(await saveLookAction({ venueId, expectedRevision: 0, theme })).toEqual({
        ok: true,
        revision: 1,
      })
      expect(readDesign(await settingsOf(venueId)).design).toEqual({
        ...DEFAULT_DESIGN,
        brand: '#e11d48',
      })
    })

    it('leaves the other settings of the venue and the record’s other pages alone', async () => {
      await setSettings(venueId, { other: 1 })
      await saveLayoutAction({ venueId, layout: 'one', guestSwitch: false })
      await saveNow()
      const settings = await settingsOf(venueId)
      expect(settings?.other).toBe(1)
      expect(readDesign(settings).design.values.items).toMatchObject({
        layout: 'one',
        guest_switch: 'off',
      })
    })

    it('of two looks saved at once keeps one, and tells the other what is stored', async () => {
      const results = await Promise.all([
        saveLookAction({ venueId, expectedRevision: 0, theme: wholeTheme({ font: 'manrope' }) }),
        saveLookAction({ venueId, expectedRevision: 0, theme: wholeTheme({ font: 'lora' }) }),
      ])
      const kept = results.findIndex((result) => result.ok)
      expect(kept).not.toBe(-1)
      expect(results[1 - kept]).toMatchObject({
        ok: false,
        error: 'stale',
        view: { revision: 1, theme: { font: kept === 0 ? 'manrope' : 'lora' } },
      })
    })

    it('refuses a stale revision with the stored design and writes nothing', async () => {
      await saveNow({ font: 'manrope' })
      const result = await saveLookAction({
        venueId,
        expectedRevision: 0,
        theme: wholeTheme({ font: 'lora' }),
      })
      expect(result).toMatchObject({
        ok: false,
        error: 'stale',
        view: { revision: 1, theme: { font: 'manrope' } },
      })
      expect((await recordOf(venueId))?.values.general.body_font).toBe('manrope')
    })

    it('refuses a look whose colours do not read, naming every failing pair, and writes nothing', async () => {
      expect(await saveNow({ font: 'manrope' })).toEqual({ ok: true, revision: 1 })
      const unreadable = wholeTheme({
        overrides: {
          ...midnight.overrides,
          // Text the colour of the page, in the light set.
          light: { ...midnight.overrides.light, text: midnight.overrides.light.background },
        },
      })
      const result = await saveLookAction({ venueId, expectedRevision: 1, theme: unreadable })
      expect(result).toMatchObject({ ok: false, error: 'unreadable' })
      if (result.ok || result.error !== 'unreadable') return
      expect(result.issues.map((issue) => `${issue.mode}:${issue.fg}-on-${issue.bg}`)).toEqual([
        'light:text-on-background',
        'light:text-on-surface',
      ])
      expect(result.issues[0]).toMatchObject({ min: 4.5 })
      expect(result.issues[0]?.ratio).toBeLessThan(4.5)
      // The earlier look is still the stored one.
      expect((await recordOf(venueId))?.values.general.body_font).toBe('manrope')
    })

    it('refuses a partial look (the old card’s shape, or a v2 field missing) and writes nothing', async () => {
      const complete = wholeTheme()
      const partial: [string, unknown][] = [
        ['the first version’s brand and logo only', { logo_asset_id: null, brand: '#2563eb' }],
        ['no font', { ...complete, font: undefined }],
        ['no corners', { ...complete, radius: undefined }],
        ['no shadow', { ...complete, shadow: undefined }],
        ['no light/dark policy', { ...complete, scheme: undefined }],
        ['three colours and a brand colour', { ...complete, brand: '#2563eb' }],
        ['null (that would drop the look)', null],
      ]
      for (const [label, theme] of partial) {
        expect(await saveLookAction({ venueId, expectedRevision: 0, theme }), label).toEqual({
          ok: false,
          error: 'invalid',
        })
      }
      expect(await recordOf(venueId)).toBeNull()
      expect(revalidated).toEqual([])
    })

    it('refuses input that is not a look at all', async () => {
      const bad: unknown[] = [
        null,
        'theme',
        { venueId, theme: wholeTheme() },
        { venueId, expectedRevision: -1, theme: wholeTheme() },
        { venueId, expectedRevision: 0, theme: wholeTheme({ font: 'comic-sans' }) },
        { venueId, expectedRevision: 0, theme: wholeTheme({ radius: 99 }) },
        {
          venueId,
          expectedRevision: 0,
          theme: wholeTheme({ colors: { primary: 'red', secondary: '#fff', tertiary: '#000' } }),
        },
        { venueId, expectedRevision: 0, theme: wholeTheme({ extra: 1 }) },
        { venueId: 'vn_nope', expectedRevision: 0, theme: wholeTheme() },
        { venueId, expectedRevision: 0, theme: wholeTheme(), extra: 1 },
      ]
      for (const input of bad) {
        expect(await saveLookAction(input), JSON.stringify(input)).toEqual({
          ok: false,
          error: 'invalid',
        })
      }
      expect(await recordOf(venueId)).toBeNull()
    })

    it('refuses a logo that is not a stored image of this organisation', async () => {
      expect(
        await saveLookAction({
          venueId,
          expectedRevision: 0,
          theme: wholeTheme({ logo_asset_id: NO_ASSET }),
        }),
      ).toEqual({ ok: false, error: 'logo_not_usable' })
      expect(await recordOf(venueId)).toBeNull()
    })

    it('lets an admin save, and refuses a plain member without writing', async () => {
      asked.role = 'admin'
      expect((await saveNow()).ok).toBe(true)
      await setSettings(venueId, {})
      for (const role of ['member', 'viewer', '']) {
        asked.role = role
        expect(await saveNow(), role).toEqual({ ok: false, error: 'forbidden' })
      }
      expect(await recordOf(venueId)).toBeNull()
    })

    it('does not find a venue of another organisation', async () => {
      expect(
        await saveLookAction({
          venueId: otherVenueId,
          expectedRevision: 0,
          theme: wholeTheme(),
        }),
      ).toEqual({ ok: false, error: 'not_found' })
      expect(await recordOf(otherVenueId)).toBeNull()
      expect(
        await saveLookAction({
          venueId: newId('vn'),
          expectedRevision: 0,
          theme: wholeTheme(),
        }),
      ).toEqual({ ok: false, error: 'not_found' })
    })
  })

  describe('saveLayoutAction', () => {
    it('saves the layout and the guest switch into the record and keeps the rest', async () => {
      await saveNow()
      expect(await saveLayoutAction({ venueId, layout: 'two', guestSwitch: true })).toEqual({
        ok: true,
      })
      const stored = await recordOf(venueId)
      expect(stored?.revision).toBe(2)
      expect(stored?.values.items).toMatchObject({ layout: 'two', guest_switch: 'on' })
      expect(stored?.values.general.body_font).toBe('lora')
      expect(revalidated).toContain(`/venues/${venueId}`)
    })

    it('makes the first record of a venue that has none, on Basic', async () => {
      expect(await saveLayoutAction({ venueId, layout: 'one', guestSwitch: false })).toEqual({
        ok: true,
      })
      const stored = await recordOf(venueId)
      expect(stored?.revision).toBe(1)
      expect(stored?.values).toEqual({
        ...BASIC_DESIGN_VALUES,
        items: { ...BASIC_DESIGN_VALUES.items, layout: 'one', guest_switch: 'off' },
      })
    })

    it('refuses a member, a layout that is not one, and another organisation’s venue', async () => {
      asked.role = 'member'
      expect(await saveLayoutAction({ venueId, layout: 'list', guestSwitch: true })).toEqual({
        ok: false,
        error: 'not_allowed',
      })
      asked.role = 'owner'
      for (const input of [
        null,
        { venueId, layout: 'grid', guestSwitch: true },
        { venueId, layout: 'list', guestSwitch: 'yes' },
        { venueId, layout: 'list' },
        { venueId, layout: 'list', guestSwitch: true, colour: 'red' },
      ]) {
        expect(await saveLayoutAction(input), JSON.stringify(input)).toEqual({
          ok: false,
          error: 'invalid',
        })
      }
      expect(
        await saveLayoutAction({ venueId: otherVenueId, layout: 'list', guestSwitch: true }),
      ).toEqual({ ok: false, error: 'unknown_venue' })
      expect(await recordOf(venueId)).toBeNull()
      expect(await recordOf(otherVenueId)).toBeNull()
    })
  })

  describe('loadDesign', () => {
    const noStore = async () => ({ getUrl: async () => 'https://example.test/logo' })

    it('gives Basic at revision 0 for a venue with no record', async () => {
      const row = { settings: (await settingsOf(venueId)) ?? {} }
      const view = await loadDesign(getPool(), tenant, row, noStore, 'owner')
      expect(view).toEqual({
        revision: 0,
        theme: designThemeOf(DEFAULT_DESIGN),
        logo: null,
        canEdit: true,
      })
    })

    it('gives the saved look and its revision, and read-only for a member', async () => {
      await saveNow()
      const row = { settings: (await settingsOf(venueId)) ?? {} }
      const view = await loadDesign(getPool(), tenant, row, noStore, 'member')
      expect(view.revision).toBe(1)
      expect(view.theme.font).toBe('lora')
      expect(view.theme.colors).toEqual(midnight.colours)
      expect(view.canEdit).toBe(false)
      expect((await loadDesign(getPool(), tenant, row, noStore, 'admin')).canEdit).toBe(true)
    })
  })
})
