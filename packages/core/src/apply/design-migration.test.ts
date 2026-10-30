// Migration 0043 (the design record, D129, D130), on a scratch database of its own: migrated to the
// one before, seeded with venues as they stood, then migrated through it. Every venue must get a
// Basic record that core's schema reads, with what it set before carried over and drawn as before.
// It lives in core so the record is checked against the contract the app reads it with: the
// migration writes Basic's values out by hand. Skipped without a database.
import { randomUUID } from 'node:crypto'
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { drizzle } from 'drizzle-orm/node-postgres'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  BASIC_DESIGN_VALUES,
  cornersOfRadius,
  type DesignRecord,
  DesignRecordSchema,
  depthOfShadow,
  designThemeOf,
} from '../design/record'
import { newId } from '../ids'
import { themePaletteOf, themeRolesOf } from '../theme'
import { type VenueTheme, VenueThemeSchema } from '../theme/settings'
import { hasDatabase } from './test-database'

const MIGRATIONS = fileURLToPath(new URL('../../../db/migrations', import.meta.url))
const TAG = '0043_design_record'

interface Journal {
  entries: { idx: number; tag: string; when: number }[]
}

/** A migrations folder holding the migrations before this one, or, with `through`, this one too. */
function migrationsFolder(through: boolean): string {
  const folder = mkdtempSync(join(tmpdir(), 'restro-dr-'))
  mkdirSync(join(folder, 'meta'))
  const journal = JSON.parse(
    readFileSync(join(MIGRATIONS, 'meta', '_journal.json'), 'utf8'),
  ) as Journal
  const entries = journal.entries.filter((entry) => (through ? entry.tag <= TAG : entry.tag < TAG))
  writeFileSync(join(folder, 'meta', '_journal.json'), JSON.stringify({ ...journal, entries }))
  for (const entry of entries) {
    cpSync(join(MIGRATIONS, `${entry.tag}.sql`), join(folder, `${entry.tag}.sql`))
  }
  return folder
}

const TENANT = 'tn_DESIGNMIGRATION'
const COLOURS = { primary: '#F5F1EA', secondary: '#e7e0d4', tertiary: '#e0a43a' }
const LOGO = 'as_0123456789ABCDEFGHIJKL'

/** The venues as they stood: an id, its settings, and its live menu's settings when it has one. */
const VENUES: Record<string, { settings: unknown; menu?: unknown }> = {
  whole: {
    settings: {
      other: 1,
      guest_features: { filters: false },
      presentation: { face: 'editorial-market', options: { layout: 'one' } },
      theme: {
        logo_asset_id: LOGO,
        preset: 'midnight',
        colors: COLOURS,
        overrides: { dark: { border: '#334455' } },
        font: 'lora',
        radius: 6,
        shadow: 3,
        scheme: 'dark',
      },
    },
    menu: { layout: 'one_column', layout_switch: false },
  },
  brand: {
    settings: { theme: { brand: '#2563EB', logo_asset_id: null } },
    menu: { layout: 'list' },
  },
  nothing: { settings: {} },
  noSettingsOnMenu: { settings: {}, menu: {} },
  hiddenTemplate: { settings: { presentation: { face: 'qr-phone', options: {} } } },
  severalMenus: { settings: {}, menu: { layout: 'one_column', layout_switch: false } },
  archived: {
    settings: { theme: { logo_asset_id: null, font: 'lora' } },
    menu: { layout: 'list' },
  },
  defaults: {
    settings: {
      theme: { logo_asset_id: null, font: 'inter', radius: 8, shadow: 1, scheme: 'auto' },
    },
  },
  bothColourings: {
    settings: { theme: { brand: '#2563eb', colors: COLOURS, logo_asset_id: null } },
  },
}
const RADII = Array.from({ length: 33 }, (_, radius) => radius)
const SHADOWS = [0, 1, 2, 3, 4, 5]

const idOf = (name: string) => `vn_${name}`

describe.skipIf(!hasDatabase)('the design record migration (D129, D130)', () => {
  const database = `restro_dr_${randomUUID().replaceAll('-', '').slice(0, 12)}`
  const before = migrationsFolder(false)
  const through = migrationsFolder(true)
  let admin: pg.Client
  let client: pg.Client
  const updatedBefore = new Map<string, string>()

  const migrateTo = (folder: string) =>
    migrate(drizzle({ client }), {
      migrationsFolder: folder,
      migrationsSchema: 'drizzle',
      migrationsTable: '__drizzle_migrations',
    })

  /** A venue row as the owner writes it (the foreign keys are off: only its settings matter). */
  async function insertVenue(name: string, settings: unknown, menu: unknown) {
    const id = idOf(name)
    const menuId = menu === undefined ? null : newId('nd')
    await client.query(
      `insert into restro.venues (id, tenant_id, name, slug, public_id, settings, live_menu_id)
       values ($1, $2, $3, $3, $4, $5::jsonb, $6)`,
      [
        id,
        TENANT,
        name,
        randomUUID().replaceAll('-', '').slice(0, 12),
        JSON.stringify(settings),
        menuId,
      ],
    )
    if (menuId !== null) {
      await client.query(
        `insert into restro.menus (id, tenant_id, venue_id, template_key, template_version, root_node_id, settings)
         values ($1, $2, $3, 'venue-menu', 1, $1, $4::jsonb)`,
        [menuId, TENANT, id, JSON.stringify(menu)],
      )
    }
  }

  const settingsOf = async (name: string) =>
    (
      await client.query<{ settings: Record<string, unknown> }>(
        'select settings from restro.venues where id = $1',
        [idOf(name)],
      )
    ).rows[0]?.settings ?? {}
  const recordOf = async (name: string): Promise<DesignRecord> =>
    DesignRecordSchema.parse((await settingsOf(name)).design)

  beforeAll(async () => {
    admin = new pg.Client({ connectionString: process.env.DATABASE_URL_OWNER })
    await admin.connect()
    await admin.query(`create database ${database}`)
    const url = new URL(process.env.DATABASE_URL_OWNER ?? '')
    url.pathname = `/${database}`
    client = new pg.Client({ connectionString: url.toString() })
    await client.connect()
    await migrateTo(before)
    await client.query('set session_replication_role = replica')
    await client.query(`insert into restro.tenants (id, name) values ($1, 'Migration club')`, [
      TENANT,
    ])
    for (const [name, venue] of Object.entries(VENUES)) {
      await insertVenue(name, venue.settings, venue.menu)
    }
    // The menu that is not live comes first and says otherwise: only the live one's settings count.
    await client.query(
      `insert into restro.menus (id, tenant_id, venue_id, template_key, template_version, root_node_id, sort_key, settings)
       values ($1, $2, $3, 'venue-menu', 1, $1, 'Zz', '{"layout": "list", "layout_switch": true}'::jsonb)`,
      [newId('nd'), TENANT, idOf('severalMenus')],
    )
    await client.query(`update restro.venues set archived_at = now() where id = $1`, [
      idOf('archived'),
    ])
    for (const radius of RADII) {
      await insertVenue(`radius${radius}`, { theme: { logo_asset_id: null, radius } }, undefined)
    }
    for (const shadow of SHADOWS) {
      await insertVenue(`shadow${shadow}`, { theme: { logo_asset_id: null, shadow } }, undefined)
    }
    await client.query(`update restro.venues set updated_at = '2026-01-02T03:04:05Z'`)
    const stamped = await client.query<{ id: string; updated_at: Date }>(
      'select id, updated_at from restro.venues',
    )
    for (const row of stamped.rows) updatedBefore.set(row.id, row.updated_at.toISOString())
    await client.query('set session_replication_role = origin')
    await migrateTo(through)
  }, 120_000)

  afterAll(async () => {
    await client?.end()
    if (admin !== undefined) {
      await admin.query(`drop database if exists ${database} with (force)`)
      await admin.end()
    }
    rmSync(before, { recursive: true, force: true })
    rmSync(through, { recursive: true, force: true })
  })

  it('gives every venue a record core reads, on Basic, revision 1, by the system', async () => {
    const { rows } = await client.query<{ id: string; settings: Record<string, unknown> }>(
      'select id, settings from restro.venues',
    )
    expect(rows.length).toBe(Object.keys(VENUES).length + RADII.length + SHADOWS.length)
    for (const row of rows) {
      const record = DesignRecordSchema.parse(row.settings.design)
      expect(record, row.id).toMatchObject({
        revision: 1,
        style: 'basic',
        provenance: {
          layer: 'manual',
          source: 'manual',
          actor: 'system',
          job_id: 'migration:0043_design_record',
          change_set_id: null,
        },
      })
      expect(row.settings, row.id).not.toHaveProperty('theme')
      expect(row.settings, row.id).not.toHaveProperty('presentation')
    }
  })

  it('writes out Basic’s values as the contract has them, for what it does not carry', async () => {
    const record = await recordOf('hiddenTemplate')
    expect(record.values).toEqual({
      ...BASIC_DESIGN_VALUES,
      items: { ...BASIC_DESIGN_VALUES.items, layout: 'two', guest_switch: 'on' },
    })
  })

  it('carries the colours, roles, logo, font and screen, and the live menu’s layout and switch', async () => {
    const record = await recordOf('whole')
    expect(record.colors).toEqual({ ...COLOURS, primary: COLOURS.primary.toLowerCase() })
    expect(record.overrides).toEqual({ dark: { border: '#334455' } })
    expect(record.logo_asset_id).toBe(LOGO)
    expect(record.values.general).toEqual({
      ...BASIC_DESIGN_VALUES.general,
      body_font: 'lora',
      heading_font: 'same',
      corners: 'soft',
      depth: 'low',
      screen: 'dark',
    })
    expect(record.values.items).toEqual({
      ...BASIC_DESIGN_VALUES.items,
      layout: 'one',
      guest_switch: 'off',
    })
  })

  it('takes the layout from the venue’s live menu, of several', async () => {
    const { items } = (await recordOf('severalMenus')).values
    expect(items.layout).toBe('one')
    expect(items.guest_switch).toBe('off')
  })

  it('gives an archived venue its record too, in case it comes back', async () => {
    const record = await recordOf('archived')
    expect(record.values.general.body_font).toBe('lora')
    expect(record.values.items.layout).toBe('list')
  })

  it('leaves the venue’s other settings as they were', async () => {
    const settings = await settingsOf('whole')
    expect(settings.other).toBe(1)
    expect(settings.guest_features).toEqual({ filters: false })
  })

  it('keeps one brand colour, and takes the three colours over it, as a publish did', async () => {
    const brand = await recordOf('brand')
    expect(brand.brand).toBe('#2563eb')
    expect(brand).not.toHaveProperty('colors')
    expect(brand.values.items.layout).toBe('list')
    const both = await recordOf('bothColourings')
    expect(both).not.toHaveProperty('brand')
    expect(both.colors?.tertiary).toBe(COLOURS.tertiary)
  })

  it('moves no venue onto Editorial, and keeps two columns with the switch where none was set', async () => {
    for (const name of Object.keys(VENUES)) {
      expect((await recordOf(name)).style, name).toBe('basic')
    }
    for (const name of ['nothing', 'noSettingsOnMenu', 'hiddenTemplate', 'defaults']) {
      const { items } = (await recordOf(name)).values
      expect(items.layout, name).toBe('two')
      expect(items.guest_switch, name).toBe('on')
    }
  })

  it('maps corners and depth to the nearest word, the same as core', async () => {
    for (const radius of RADII) {
      const { corners } = (await recordOf(`radius${radius}`)).values.general
      expect(corners, `radius ${radius}`).toBe(cornersOfRadius(radius))
    }
    for (const shadow of SHADOWS) {
      const { depth } = (await recordOf(`shadow${shadow}`)).values.general
      expect(depth, `shadow ${shadow}`).toBe(depthOfShadow(shadow))
    }
  })

  it('draws a venue as before: the same palette, roles, font, corners, depth and screen', async () => {
    for (const name of ['defaults', 'nothing', 'brand', 'hiddenTemplate']) {
      const old = VenueThemeSchema.parse(
        (VENUES[name]?.settings as { theme?: unknown } | undefined)?.theme ?? {
          logo_asset_id: null,
        },
      ) as VenueTheme
      const theme = designThemeOf(await recordOf(name))
      expect(themePaletteOf(theme), name).toEqual(themePaletteOf(old))
      expect(themeRolesOf(theme), name).toEqual(themeRolesOf(old))
      expect(theme.logo_asset_id, name).toBe(old.logo_asset_id)
      expect(theme.font, name).toBe(old.font ?? 'inter')
      expect(theme.radius, name).toBe(old.radius ?? 8)
      expect(theme.shadow, name).toBe(old.shadow ?? 1)
      expect(theme.scheme, name).toBe(old.scheme ?? 'auto')
    }
    // Colours and roles carried whole draw the same even where corners moved to a word.
    const whole = VenueThemeSchema.parse(
      (VENUES.whole?.settings as { theme?: unknown } | undefined)?.theme,
    )
    const theme = designThemeOf(await recordOf('whole'))
    expect(themeRolesOf(theme)).toEqual(themeRolesOf(whole))
    expect(themePaletteOf(theme)).toEqual(themePaletteOf(whole))
  })

  it('changes nothing else of a row, and puts row-level security back', async () => {
    const { rows } = await client.query<{ id: string; updated_at: Date }>(
      'select id, updated_at from restro.venues',
    )
    for (const row of rows) {
      expect(row.updated_at.toISOString(), row.id).toBe(updatedBefore.get(row.id))
    }
    const forced = await client.query<{ relname: string; relforcerowsecurity: boolean }>(
      `select relname, relforcerowsecurity from pg_class
       where oid in ('restro.venues'::regclass, 'restro.menus'::regclass)`,
    )
    expect(forced.rows.map((row) => row.relforcerowsecurity)).toEqual([true, true])
    const trigger = await client.query<{ tgenabled: string }>(
      `select tgenabled from pg_trigger where tgname = 'venues_touch_updated_at'`,
    )
    expect(trigger.rows[0]?.tgenabled).toBe('O')
  })

  describe('the changelog', () => {
    const insertEvent = (fields: {
      op: string
      nodeId: string | null
      fieldKey?: string
      layer?: string
      scope?: string
    }) =>
      client.query(
        `insert into restro.events
           (tenant_id, node_id, op, field_key, layer, scope, source, actor, job_id, change_set_id,
            new_value)
         values ($1, $2, $3, $4, $5, $6, 'manual', 'system', 'jb_x', 'cs_x', '{"revision": 1}'::jsonb)`,
        [
          TENANT,
          fields.nodeId,
          fields.op,
          fields.fieldKey ?? 'design',
          fields.layer ?? 'manual',
          fields.scope ?? 'venue:vn_whole',
        ],
      )

    it('holds a design save with no node, and only that', async () => {
      await insertEvent({ op: 'setDesign', nodeId: null })
      await expect(insertEvent({ op: 'setField', nodeId: null })).rejects.toThrow(
        /events_node_only_for_document_ops/,
      )
      await client.query('set session_replication_role = replica')
      try {
        await expect(insertEvent({ op: 'setDesign', nodeId: 'nd_x' })).rejects.toThrow(
          /events_node_only_for_document_ops/,
        )
      } finally {
        await client.query('set session_replication_role = origin')
      }
    })

    it('holds a design save only with the venue’s scope, the design key and the manual layer', async () => {
      for (const fields of [{ scope: 'master' }, { fieldKey: 'price' }, { layer: 'integration' }]) {
        await expect(
          insertEvent({ op: 'setDesign', nodeId: null, ...fields }),
          JSON.stringify(fields),
        ).rejects.toThrow(/events_design_scope|events_layer/)
      }
    })
  })
})
