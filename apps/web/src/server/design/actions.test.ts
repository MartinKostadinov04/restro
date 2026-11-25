// The Design page's server action against a real Postgres, as the restro_app role (D129): what
// saveDesignAction writes through `setDesign`, who may call it, and every refusal. The session is the
// only fake: it says which organisation and role is asking.
import {
  BASIC_DESIGN_VALUES,
  DEFAULT_DESIGN,
  type DesignContent,
  designContentOf,
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
import { saveDesignAction } from './actions'
import { loadDesign } from './service'

const asked = vi.hoisted(() => ({ tenantId: '', role: 'owner' }))
const revalidated = vi.hoisted(() => [] as string[])

vi.mock('@/server/session', () => ({
  requireTenant: async () => ({
    user: { id: 'us_sh05atester', name: 'Tester', email: 'tester@example.test' },
    organizations: [],
    organization: {
      id: asked.tenantId,
      name: 'Design club',
      slug: 'design-club',
      role: asked.role,
    },
  }),
}))
vi.mock('next/cache', () => ({ revalidatePath: (path: string) => revalidated.push(path) }))

const midnight = THEME_PRESETS.find((preset) => preset.id === 'midnight')
if (midnight === undefined) throw new Error('the Midnight preset is missing')

/** A whole design: Basic with the Midnight colours, and the body font asked for. */
const wholeDesign = (font = 'lora', fields: Record<string, unknown> = {}) => ({
  style: 'basic',
  values: {
    ...BASIC_DESIGN_VALUES,
    general: { ...BASIC_DESIGN_VALUES.general, body_font: font, screen: 'dark' },
  },
  colors: midnight.colours,
  overrides: midnight.overrides,
  logo_asset_id: null,
  ...fields,
})

const NO_ASSET = 'as_0123456789ABCDEFGHIJKL'

describe.skipIf(!hasDatabase)('the Design page’s action (as the restro_app role)', () => {
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
  /** Saves a design from the revision stored now. */
  const saveNow = async (design: unknown = wholeDesign()) =>
    saveDesignAction({
      venueId,
      expectedRevision: readDesign(await settingsOf(venueId)).revision,
      design,
    })

  beforeAll(async () => {
    useTestServerEnvironment()
    owner = openOwnerPool()
    await provisionTenant(getPool(), { tenantId: tenant, name: 'Design club' })
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

  describe('saveDesignAction', () => {
    it('saves the whole design into the record, and refreshes the venue and Design pages', async () => {
      expect(await saveNow()).toEqual({ ok: true, revision: 1 })
      const stored = await recordOf(venueId)
      expect(stored).toMatchObject({
        revision: 1,
        style: 'basic',
        logo_asset_id: null,
        colors: midnight.colours,
        provenance: { layer: 'manual', source: 'manual', actor: 'user:us_sh05atester' },
      })
      expect(stored?.values.general).toMatchObject({ body_font: 'lora', screen: 'dark' })
      expect(stored?.overrides?.dark?.background).toBe('#0e0d0c')
      expect(revalidated).toEqual([`/venues/${venueId}`, `/venues/${venueId}/design`])
    })

    it('appends one event with the person and the job for every save', async () => {
      const eventsOfVenue = () =>
        owner.query<{ source: string; actor: string; job_id: string; field_key: string }>(
          `select source, actor, job_id, field_key from restro.events
           where tenant_id = $1 and scope = $2 order by seq`,
          [tenant, `venue:${venueId}`],
        )
      // Events are append-only: those of the earlier tests stay.
      const before = (await eventsOfVenue()).rows.length
      await saveNow()
      await saveNow(wholeDesign('manrope'))
      const added = (await eventsOfVenue()).rows.slice(before)
      expect(added.map((row) => row.field_key)).toEqual(['design', 'design'])
      for (const row of added) {
        expect(row).toMatchObject({ source: 'manual', actor: 'user:us_sh05atester' })
        expect(row.job_id).toMatch(/^jb_/)
      }
    })

    it('keeps every option’s value as the page sent it, the layout among them', async () => {
      const values = {
        ...BASIC_DESIGN_VALUES,
        items: { ...BASIC_DESIGN_VALUES.items, layout: 'one', guest_switch: 'off' },
      }
      await saveNow(wholeDesign('lora', { values }))
      expect((await recordOf(venueId))?.values).toEqual(values)
    })

    it('leaves the other settings of the venue alone', async () => {
      await setSettings(venueId, { other: 1 })
      await saveNow()
      expect((await settingsOf(venueId))?.other).toBe(1)
    })

    it('of two designs saved at once keeps one, and tells the other what is stored', async () => {
      const results = await Promise.all([
        saveDesignAction({ venueId, expectedRevision: 0, design: wholeDesign('manrope') }),
        saveDesignAction({ venueId, expectedRevision: 0, design: wholeDesign('lora') }),
      ])
      const kept = results.findIndex((result) => result.ok)
      expect(kept).not.toBe(-1)
      expect(results[1 - kept]).toMatchObject({
        ok: false,
        error: 'stale',
        view: {
          revision: 1,
          design: { values: { general: { body_font: kept === 0 ? 'manrope' : 'lora' } } },
        },
      })
    })

    it('refuses a stale revision with the stored design and writes nothing', async () => {
      await saveNow(wholeDesign('manrope'))
      const result = await saveDesignAction({
        venueId,
        expectedRevision: 0,
        design: wholeDesign('lora'),
      })
      expect(result).toMatchObject({
        ok: false,
        error: 'stale',
        view: { revision: 1, theme: { font: 'manrope' } },
      })
      expect((await recordOf(venueId))?.values.general.body_font).toBe('manrope')
    })

    it('refuses a design whose colours do not read, naming every failing pair, and writes nothing', async () => {
      expect(await saveNow(wholeDesign('manrope'))).toEqual({ ok: true, revision: 1 })
      const unreadable = wholeDesign('lora', {
        overrides: {
          ...midnight.overrides,
          // Text the colour of the page, in the light set.
          light: { ...midnight.overrides.light, text: midnight.overrides.light.background },
        },
      })
      const result = await saveDesignAction({ venueId, expectedRevision: 1, design: unreadable })
      expect(result).toMatchObject({ ok: false, error: 'unreadable' })
      if (result.ok || result.error !== 'unreadable') return
      expect(result.issues.map((issue) => `${issue.mode}:${issue.fg}-on-${issue.bg}`)).toEqual([
        'light:text-on-background',
        'light:text-on-surface',
      ])
      expect(result.issues[0]).toMatchObject({ min: 4.5 })
      expect(result.issues[0]?.ratio).toBeLessThan(4.5)
      // The earlier design is still the stored one.
      expect((await recordOf(venueId))?.values.general.body_font).toBe('manrope')
    })

    it('refuses input that is not a whole design, and writes nothing', async () => {
      const whole = wholeDesign()
      const { general, ...otherPages } = whole.values
      const { body_font: _noFont, ...generalWithoutFont } = general
      const bad: unknown[] = [
        null,
        'design',
        { venueId, design: whole },
        { venueId, expectedRevision: -1, design: whole },
        { venueId, expectedRevision: 0, design: null },
        { venueId, expectedRevision: 0, design: { ...whole, style: 'made-up' } },
        { venueId, expectedRevision: 0, design: { ...whole, brand: '#2563eb' } },
        { venueId, expectedRevision: 0, design: { ...whole, extra: 1 } },
        {
          venueId,
          expectedRevision: 0,
          design: { ...whole, values: { ...otherPages, general: generalWithoutFont } },
        },
        {
          venueId,
          expectedRevision: 0,
          design: { ...whole, values: { ...otherPages, general: { ...general, body_font: 'x' } } },
        },
        {
          venueId,
          expectedRevision: 0,
          design: { ...whole, colors: { primary: 'red', secondary: '#fff', tertiary: '#000' } },
        },
        { venueId: 'vn_nope', expectedRevision: 0, design: whole },
        { venueId, expectedRevision: 0, design: whole, extra: 1 },
      ]
      for (const input of bad) {
        expect(await saveDesignAction(input), JSON.stringify(input)).toEqual({
          ok: false,
          error: 'invalid',
        })
      }
      expect(await recordOf(venueId)).toBeNull()
      expect(revalidated).toEqual([])
    })

    it('refuses a logo that is not a stored image of this organisation', async () => {
      expect(await saveNow(wholeDesign('lora', { logo_asset_id: NO_ASSET }))).toEqual({
        ok: false,
        error: 'logo_not_usable',
      })
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
        await saveDesignAction({
          venueId: otherVenueId,
          expectedRevision: 0,
          design: wholeDesign(),
        }),
      ).toEqual({ ok: false, error: 'not_found' })
      expect(await recordOf(otherVenueId)).toBeNull()
      expect(
        await saveDesignAction({
          venueId: newId('vn'),
          expectedRevision: 0,
          design: wholeDesign(),
        }),
      ).toEqual({ ok: false, error: 'not_found' })
    })
  })

  describe('loadDesign', () => {
    const noStore = async () => ({ getUrl: async () => 'https://example.test/logo' })

    it('gives Basic at revision 0 for a venue with no record', async () => {
      const row = { settings: (await settingsOf(venueId)) ?? {} }
      const view = await loadDesign(getPool(), tenant, row, noStore, 'owner')
      expect(view).toEqual({
        revision: 0,
        design: designContentOf(DEFAULT_DESIGN),
        theme: designThemeOf(DEFAULT_DESIGN),
        logo: null,
        canEdit: true,
      })
    })

    it('gives the saved design and its revision, and read-only for a member', async () => {
      await saveNow()
      const row = { settings: (await settingsOf(venueId)) ?? {} }
      const view = await loadDesign(getPool(), tenant, row, noStore, 'member')
      expect(view.revision).toBe(1)
      expect((view.design as DesignContent).values.general.body_font).toBe('lora')
      expect(view.theme.font).toBe('lora')
      expect(view.theme.colors).toEqual(midnight.colours)
      expect(view.canEdit).toBe(false)
      expect((await loadDesign(getPool(), tenant, row, noStore, 'admin')).canEdit).toBe(true)
    })
  })
})
