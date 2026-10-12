// Migrations 0018–0023 (adjustments 01, T79) on a scratch database of their own: migrated to 0017
// by the real migrator, seeded like a database of today, then migrated to the head. They check
// the hand-written backfills: instance names and the chosen systems (0018), the live menu (0019),
// places copied into areas and tables keeping their ids and tokens (0020), one address name per
// organisation (0022), and row-level security on every new tenant table.
//
// Rows are sorted in JavaScript on both sides, never by SQL `order by` (CLAUDE.md).
import { randomUUID } from 'node:crypto'
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { drizzle } from 'drizzle-orm/node-postgres'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { hasDatabase, ownerDatabaseUrl, testId, testPublicId } from './database'

const MIGRATIONS = fileURLToPath(new URL('../migrations', import.meta.url))
const FIRST_TAG = '0018_integration_instances'
const LAST_TAG = '0023_purge'

type Row = Record<string, unknown>
interface Journal {
  entries: { idx: number; tag: string; when: number }[]
}

const compareText = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)
const byId = (a: Row, b: Row) => compareText(String(a.id), String(b.id))

/**
 * A migrations folder holding the migrations before 0018 only (the database before T79), or,
 * with `through`, up to and including 0023. Later migrations are left out on purpose: this test
 * is about what these six did.
 */
function foldersBefore0018(through = false): string {
  const folder = mkdtempSync(join(tmpdir(), 'restro-0017-'))
  mkdirSync(join(folder, 'meta'))
  const journal = JSON.parse(readFileSync(join(MIGRATIONS, 'meta', '_journal.json'), 'utf8'))
  const entries = (journal as Journal).entries.filter((entry) =>
    through ? entry.tag <= LAST_TAG : entry.tag < FIRST_TAG,
  )
  expect(entries.map((entry) => entry.idx)).toEqual([...Array(through ? 24 : 18).keys()])
  writeFileSync(join(folder, 'meta', '_journal.json'), JSON.stringify({ ...journal, entries }))
  for (const entry of entries) {
    cpSync(join(MIGRATIONS, `${entry.tag}.sql`), join(folder, `${entry.tag}.sql`))
  }
  return folder
}

describe.skipIf(!hasDatabase)('migrations 0018–0023 (adjustments 01)', () => {
  const database = `restro_adjust_${randomUUID().replaceAll('-', '').slice(0, 12)}`
  const tenant1 = testId('tn')
  const tenant2 = testId('tn')
  const integration = testId('in')
  const venueA = testId('vn')
  const venueB = testId('vn')
  const venueC = testId('vn')
  const venueD = testId('vn')
  const menuA = testId('nd')
  const menuB = testId('nd')
  const placeIds = {
    window: testId('tb'),
    placeholder: testId('tb'),
    deleted: testId('tb'),
    nameless: testId('tb'),
    unserved: testId('tb'),
  }
  const tokenWindow = `tok${randomUUID().replaceAll('-', '')}`.slice(0, 22)
  const tokenUnserved = `tok${randomUUID().replaceAll('-', '')}`.slice(0, 22)
  let admin: pg.Client
  let client: pg.Client
  let before0018: string
  let through0023: string

  const rows = async (query: string, params: unknown[] = []): Promise<Row[]> => {
    const result = await client.query<{ row: Row }>(query, params)
    return result.rows.map((r) => r.row)
  }

  beforeAll(async () => {
    admin = new pg.Client({ connectionString: ownerDatabaseUrl() })
    await admin.connect()
    await admin.query(`create database ${database}`)
    const url = new URL(ownerDatabaseUrl())
    url.pathname = `/${database}`
    client = new pg.Client({ connectionString: url.toString() })
    await client.connect()
    before0018 = foldersBefore0018()
    await migrate(drizzle({ client }), {
      migrationsFolder: before0018,
      migrationsSchema: 'drizzle',
      migrationsTable: '__drizzle_migrations',
    })

    // A database of today: two organisations, one instance, four venues (two of one
    // organisation share a name; another organisation has that name too), two menus, two till
    // venues (one serving venue A, one serving nobody) and their places.
    await client.query('insert into restro.tenants (id, name) values ($1, $2), ($3, $4)', [
      tenant1,
      'Club One',
      tenant2,
      'Club Two',
    ])
    await client.query(
      "insert into restro.integrations (id, tenant_id, kind, host) values ($1, $2, 'barsy', 'demo.example.test')",
      [integration, tenant1],
    )
    const venue = (id: string, tenant: string, slug: string, createdAt: string) =>
      client.query(
        'insert into restro.venues (id, tenant_id, name, slug, public_id, created_at) values ($1, $2, $3, $4, $5, $6)',
        [id, tenant, `Venue ${slug}`, slug, testPublicId(), createdAt],
      )
    await venue(venueA, tenant1, 'club-a', '2026-01-01T00:00:00Z')
    await venue(venueB, tenant1, 'dup', '2026-01-02T00:00:00Z')
    await venue(venueC, tenant1, 'dup', '2026-01-03T00:00:00Z')
    await venue(venueD, tenant2, 'dup', '2026-01-04T00:00:00Z')
    for (const [menu, owner] of [
      [menuA, venueA],
      [menuB, venueB],
    ]) {
      await client.query(
        "insert into restro.nodes (id, tenant_id, node_type) values ($1, $2, 'menu')",
        [menu, tenant1],
      )
      await client.query(
        "insert into restro.menus (id, tenant_id, venue_id, template_key, template_version, root_node_id) values ($1, $2, $3, 'venue-menu', 1, $1)",
        [menu, tenant1, owner],
      )
    }
    await client.query(
      'insert into restro.barsy_venues (tenant_id, integration_id, bid, name, venue_id) values ($1, $2, 10, $3, $4), ($1, $2, 20, $5, null)',
      [tenant1, integration, 'Bar', venueA, 'Other'],
    )
    const place = (
      id: string,
      bid: number,
      placeId: string,
      placeNum: string | null,
      salon: string | null,
      isPublic: boolean,
      state: string,
      token: string | null,
      label: string | null,
    ) =>
      client.query(
        'insert into restro.places (id, tenant_id, integration_id, bid, place_id, place_num, salon_name, is_public, state, qr_token, label) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)',
        [id, tenant1, integration, bid, placeId, placeNum, salon, isPublic, state, token, label],
      )
    await place(placeIds.window, 10, '1', '1', 'Main', true, 'active', tokenWindow, 'Window')
    await place(placeIds.placeholder, 10, '2', '--', 'Main', false, 'active', null, null)
    await place(placeIds.deleted, 10, '3', '7', 'Terrace', true, 'deleted', null, null)
    await place(placeIds.nameless, 10, '4', null, null, true, 'active', null, null)
    await place(placeIds.unserved, 20, '9', '9', 'Hall', true, 'active', tokenUnserved, null)

    through0023 = foldersBefore0018(true)
    await migrate(drizzle({ client }), {
      migrationsFolder: through0023,
      migrationsSchema: 'drizzle',
      migrationsTable: '__drizzle_migrations',
    })
  })

  afterAll(async () => {
    await client?.end()
    if (before0018) rmSync(before0018, { recursive: true, force: true })
    if (through0023) rmSync(through0023, { recursive: true, force: true })
    if (admin) {
      await admin.query(`drop database if exists ${database} with (force)`)
      await admin.end()
    }
  })

  it('0018: names the existing instance "<kind> – <host>" and records the chosen systems', async () => {
    const instances = await rows('select to_jsonb(i) as row from restro.integrations i')
    expect(instances.map((row) => row.name)).toEqual(['barsy – demo.example.test'])
    const tenants = (await rows('select to_jsonb(t) as row from restro.tenants t')).sort(byId)
    const settings = Object.fromEntries(tenants.map((row) => [row.id, row.settings]))
    expect(settings).toEqual({ [tenant1]: { systems: ['barsy'] }, [tenant2]: {} })
  })

  it('0019: every venue with a menu has it as its live menu; the others have none', async () => {
    const venues = await rows('select to_jsonb(v) as row from restro.venues v')
    const live = Object.fromEntries(venues.map((row) => [row.id, row.live_menu_id]))
    expect(live).toEqual({ [venueA]: menuA, [venueB]: menuB, [venueC]: null, [venueD]: null })
    expect(venues.every((row) => row.unpublished_at === null)).toBe(true)
    const menus = await rows('select to_jsonb(m) as row from restro.menus m')
    expect(menus).toHaveLength(2)
    for (const menu of menus) {
      expect(menu).toMatchObject({ name: null, sort_key: 'a0', settings: {}, deleted_at: null })
      expect(typeof menu.updated_at).toBe('string')
    }
    const { rows: constraints } = await client.query<{ conname: string }>(
      "select conname from pg_constraint where conrelid = 'restro.menus'::regclass and conname in ('menus_venue_id_unique', 'menus_tenant_id_venue_id_id_unique')",
    )
    expect(constraints.map((row) => row.conname)).toEqual(['menus_tenant_id_venue_id_id_unique'])
  })

  it('0020: the served till venue’s places become areas and tables, keeping ids and tokens', async () => {
    const areas = (await rows('select to_jsonb(a) as row from restro.areas a')).sort((a, b) =>
      compareText(String(a.name), String(b.name)),
    )
    // "Terrace" held only a place the till deleted, so it gets no area; the place with no hall
    // lands in "Tables".
    expect(areas.map((area) => [area.venue_id, area.name, area.hidden, area.source_key])).toEqual([
      [venueA, 'Main', false, null],
      [venueA, 'Tables', false, null],
    ])
    expect(areas.every((area) => /^ar_[0-9A-Za-z]{22}$/.test(String(area.id)))).toBe(true)
    expect(new Set(areas.map((area) => area.sort_key)).size).toBe(2)
    const areaByName = Object.fromEntries(areas.map((area) => [String(area.name), area.id]))

    const tables = (await rows('select to_jsonb(t) as row from restro.tables t')).sort(byId)
    const byTableId = Object.fromEntries(tables.map((table) => [String(table.id), table]))
    expect(Object.keys(byTableId).sort()).toEqual(
      [placeIds.window, placeIds.placeholder, placeIds.nameless].sort(),
    )
    expect(byTableId[placeIds.window]).toMatchObject({
      venue_id: venueA,
      area_id: areaByName.Main,
      name: 'Window',
      number: '1',
      hidden: false,
      qr_token: tokenWindow,
      archived_at: null,
    })
    expect(byTableId[placeIds.placeholder]).toMatchObject({
      area_id: areaByName.Main,
      name: null,
      number: '--',
      hidden: true,
      qr_token: null,
    })
    expect(byTableId[placeIds.nameless]).toMatchObject({
      area_id: areaByName.Tables,
      name: null,
      number: '—',
      hidden: false,
    })
    const mainKeys = tables
      .filter((table) => table.area_id === areaByName.Main)
      .map((table) => table.sort_key)
    expect(new Set(mainKeys).size).toBe(mainKeys.length)

    const places = (await rows('select to_jsonb(p) as row from restro.places p')).sort(byId)
    const linked = Object.fromEntries(places.map((place) => [String(place.id), place.table_id]))
    expect(linked).toEqual({
      [placeIds.window]: placeIds.window,
      [placeIds.placeholder]: placeIds.placeholder,
      [placeIds.nameless]: placeIds.nameless,
      [placeIds.deleted]: null,
      [placeIds.unserved]: null,
    })
    // The till-side copies stay until the code reads tokens from `tables`.
    expect(places.find((place) => place.id === placeIds.window)?.qr_token).toBe(tokenWindow)
    expect(places.every((place) => place.salon_id === null && place.salon_weight === null)).toBe(
      true,
    )
  })

  it('0021: the routing dictionary starts empty', async () => {
    expect(await rows('select to_jsonb(r) as row from restro.menu_routes r')).toEqual([])
  })

  it('0022: two venues of one organisation stop sharing a name; another organisation keeps it', async () => {
    const venues = await rows('select to_jsonb(v) as row from restro.venues v')
    const slugs = Object.fromEntries(venues.map((row) => [row.id, row.slug]))
    expect(slugs).toEqual({
      [venueA]: 'club-a',
      [venueB]: 'dup',
      [venueC]: 'dup-2',
      [venueD]: 'dup',
    })
    const { rows: constraints } = await client.query<{ conname: string }>(
      "select conname from pg_constraint where conrelid = 'restro.venues'::regclass and conname = 'venues_tenant_id_slug_unique'",
    )
    expect(constraints).toHaveLength(1)
    expect(await rows('select to_jsonb(h) as row from restro.venue_slug_history h')).toEqual([])
    expect(await rows('select to_jsonb(h) as row from restro.organization_slug_history h')).toEqual(
      [],
    )
  })

  it('0023: the purge’s records exist and are empty', async () => {
    expect(await rows('select to_jsonb(t) as row from restro.tombstones t')).toEqual([])
    expect(await rows('select to_jsonb(l) as row from restro.purge_log l')).toEqual([])
  })

  it('forces row-level security on every new tenant table, with the tenant policies', async () => {
    const { rows: security } = await client.query<{
      name: string
      forced: boolean
      policies: number
    }>(
      `select c.relname as name, c.relforcerowsecurity as forced,
              (select count(*)::int from pg_policies p
               where p.schemaname = 'restro' and p.tablename = c.relname) as policies
       from pg_class c
       where c.relnamespace = 'restro'::regnamespace
         and c.relname in ('areas', 'tables', 'menu_routes', 'venue_slug_history', 'purge_log')`,
    )
    const byName = Object.fromEntries(security.map((row) => [row.name, row]))
    for (const name of ['areas', 'tables', 'menu_routes', 'venue_slug_history', 'purge_log']) {
      expect(byName[name], name).toMatchObject({ forced: true })
      expect(byName[name]?.policies, name).toBeGreaterThan(0)
    }
    const { rows: triggers } = await client.query<{ tgname: string }>(
      `select tgname from pg_trigger
       where tgname in ('menus_touch_updated_at', 'areas_touch_updated_at', 'tables_touch_updated_at', 'menu_routes_touch_updated_at')`,
    )
    expect(triggers.map((row) => row.tgname).sort()).toEqual([
      'areas_touch_updated_at',
      'menu_routes_touch_updated_at',
      'menus_touch_updated_at',
      'tables_touch_updated_at',
    ])
  })

  it('leaves the old tables’ row-level security forced and their triggers on, as before', async () => {
    const { rows: forced } = await client.query<{ name: string; force: boolean }>(
      `select relname as name, relforcerowsecurity as force from pg_class
        where relnamespace = 'restro'::regnamespace
          and relname in ('venues', 'tenants', 'integrations', 'places', 'barsy_venues')`,
    )
    expect(forced.every((row) => row.force)).toBe(true)
    const { rows: triggers } = await client.query<{ tgname: string; enabled: string }>(
      `select tgname, tgenabled as enabled from pg_trigger
        where tgname in ('venues_touch_updated_at', 'integrations_touch_updated_at', 'places_touch_updated_at')`,
    )
    expect(triggers).toHaveLength(3)
    expect(triggers.every((row) => row.enabled === 'O')).toBe(true)
  })
})
