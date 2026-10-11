// Migration 0014 (brief CF-03: the neutral till role) and its reverse script, on a scratch
// database of their own: migrated to 0013 by the real migrator, seeded with rows in the barsy
// layer (values in both scopes, an override, an edition mark, link events of every op, assets of
// both origins), then 0014 is applied and checked against the same rows renamed; the reverse
// script must give back exactly the rows of the start, and 0014 must apply again after it. An
// `import` row stops 0014 before it changes anything.
//
// Every row is compared whole (all columns, `updated_at` included): the rename touches nothing
// else. Rows are sorted in JavaScript on both sides, never by SQL `order by` (CLAUDE.md).
import { randomUUID } from 'node:crypto'
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { drizzle } from 'drizzle-orm/node-postgres'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { hasDatabase, ownerDatabaseUrl, testId } from './database'

const MIGRATIONS = fileURLToPath(new URL('../migrations', import.meta.url))
const REVERSE = fileURLToPath(
  new URL('../migrations-reverse/0014_till_role.down.sql', import.meta.url),
)
const TAG = '0014_till_role'
const HASH = 'b'.repeat(64)

type Row = Record<string, unknown>
interface Journal {
  entries: { idx: number; tag: string; when: number }[]
}

/** The statements of a migration file, split like Drizzle's migrator does. */
function statements(path: string): string[] {
  return readFileSync(path, 'utf8')
    .split('--> statement-breakpoint')
    .filter((part) => part.replace(/--[^\n]*/g, '').trim() !== '')
}

/** A migrations folder holding the migrations before 0014 only (the database before CF-03). */
function foldersBefore0014(): string {
  const folder = mkdtempSync(join(tmpdir(), 'restro-0013-'))
  mkdirSync(join(folder, 'meta'))
  const journal = JSON.parse(readFileSync(join(MIGRATIONS, 'meta', '_journal.json'), 'utf8'))
  const entries = (journal as Journal).entries.filter((entry) => entry.tag < TAG)
  expect(entries.map((entry) => entry.idx)).toEqual([...Array(14).keys()])
  writeFileSync(join(folder, 'meta', '_journal.json'), JSON.stringify({ ...journal, entries }))
  for (const entry of entries) {
    cpSync(join(MIGRATIONS, `${entry.tag}.sql`), join(folder, `${entry.tag}.sql`))
  }
  return folder
}

const compareText = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)

/** Every row of a table as JSON (all columns), sorted in JavaScript by `key`. */
async function rowsOf(client: pg.Client, table: string, key: (row: Row) => string) {
  const { rows } = await client.query<{ row: Row }>(`select to_jsonb(t) as row from ${table} t`)
  return rows.map((r) => r.row).sort((a, b) => compareText(key(a), key(b)))
}

const valueKey = (row: Row) =>
  [row.node_id, row.field_key, row.layer, row.scope].map(String).join('|')
const eventKey = (row: Row) => String(row.seq).padStart(12, '0')
const assetKey = (row: Row) => String(row.id)

/** A row of the database before 0014, as 0014 must leave it. */
function renamedValue(row: Row): Row {
  const source = String(row.source)
  return {
    ...row,
    layer: row.layer === 'barsy' ? 'till' : row.layer,
    source: source.startsWith('barsy:') ? `till:${source.slice(6)}` : source,
  }
}

function renamedLinkJson(value: unknown): unknown {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return value
  const source = (value as Row).source
  return typeof source === 'string' && source.startsWith('barsy:')
    ? { ...(value as Row), source: `till:${source.slice(6)}` }
    : value
}

function renamedEvent(row: Row): Row {
  const link = ['linkSource', 'unlinkSource', 'setLinkState'].includes(String(row.op))
  return {
    ...renamedValue(row),
    old_value: link ? renamedLinkJson(row.old_value) : row.old_value,
    new_value: link ? renamedLinkJson(row.new_value) : row.new_value,
  }
}

function renamedAsset(row: Row): Row {
  return { ...row, origin: row.origin === 'barsy' ? 'connector' : row.origin }
}

describe.skipIf(!hasDatabase)('migration 0014 (till role) and its reverse script', () => {
  const database = `restro_till_${randomUUID().replaceAll('-', '').slice(0, 12)}`
  const tenant = testId('tn')
  const venue = testId('vn')
  const integration = testId('in')
  const menu = testId('nd')
  const section = testId('nd')
  const item = testId('nd')
  const handMade = testId('nd')
  const record = testId('sr')
  const job = testId('jb')
  const changeSet = testId('cs')
  const tillAsset = testId('as')
  const uploaded = testId('as')
  let admin: pg.Client
  let client: pg.Client
  let before0014: string
  const db = () => drizzle({ client })
  const migrateTo = (folder: string) =>
    migrate(db(), {
      migrationsFolder: folder,
      migrationsSchema: 'drizzle',
      migrationsTable: '__drizzle_migrations',
    })
  const snapshot = async () => ({
    values: await rowsOf(client, 'restro.field_values', valueKey),
    events: await rowsOf(client, 'restro.events', eventKey),
    assets: await rowsOf(client, 'restro.assets', assetKey),
  })
  const checkNames = async () =>
    (
      await client.query<{ conname: string }>(
        `select conname from pg_constraint
          where conrelid in ('restro.field_values'::regclass, 'restro.events'::regclass,
                             'restro.assets'::regclass)
            and contype = 'c'`,
      )
    ).rows
      .map((row) => row.conname)
      .sort(compareText)
  let start: Awaited<ReturnType<typeof snapshot>>

  beforeAll(async () => {
    admin = new pg.Client({ connectionString: ownerDatabaseUrl() })
    await admin.connect()
    await admin.query(`create database ${database}`)
    const url = new URL(ownerDatabaseUrl())
    url.pathname = `/${database}`
    client = new pg.Client({ connectionString: url.toString() })
    await client.connect()
    before0014 = foldersBefore0014()
    await migrateTo(before0014)

    // The rows a barsy pull, a person and the photo fetch wrote before CF-03.
    const fieldValue = (
      nodeId: string,
      fieldKey: string,
      layer: string,
      scope: string,
      value: unknown,
      extra: { basis?: unknown } = {},
    ) => {
      const till = layer === 'barsy'
      return client.query(
        `insert into restro.field_values
           (tenant_id, node_id, field_key, layer, scope, value, value_hash, source, job_id, actor,
            observed_at, source_record_id, mapping_version, basis)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, '2026-10-10T21:00:00Z', $11, $12, $13)`,
        [
          tenant,
          nodeId,
          fieldKey,
          layer,
          scope,
          JSON.stringify(value),
          HASH,
          till ? `barsy:${integration}` : 'manual',
          job,
          till ? `integration:${integration}` : 'user:us_seed',
          till ? record : null,
          till ? 3 : null,
          extra.basis === undefined ? null : JSON.stringify(extra.basis),
        ],
      )
    }
    const event = (
      op: string,
      nodeId: string,
      fieldKey: string,
      layer: string,
      oldValue: unknown,
      newValue: unknown,
    ) =>
      client.query(
        `insert into restro.events
           (tenant_id, node_id, op, field_key, layer, scope, old_value, new_value, source, actor,
            job_id, change_set_id)
         values ($1, $2, $3, $4, $5, 'master', $6, $7, $8, $9, $10, $11)`,
        [
          tenant,
          nodeId,
          op,
          fieldKey,
          layer,
          oldValue === null ? null : JSON.stringify(oldValue),
          newValue === null ? null : JSON.stringify(newValue),
          layer === 'barsy' ? `barsy:${integration}` : 'manual',
          layer === 'barsy' ? `integration:${integration}` : 'user:us_seed',
          job,
          changeSet,
        ],
      )
    await client.query('insert into restro.tenants (id, name) values ($1, $2)', [tenant, 'Seed'])
    await client.query(
      'insert into restro.venues (id, tenant_id, name, slug) values ($1, $2, $3, $4)',
      [venue, tenant, 'Main', `main-${tenant.slice(-8).toLowerCase()}`],
    )
    await client.query(
      `insert into restro.integrations (id, tenant_id, kind, host) values ($1, $2, 'barsy', 'seed.test')`,
      [integration, tenant],
    )
    await client.query(
      `insert into restro.nodes (id, tenant_id, node_type, parent_id, sort_key) values
         ($1, $5, 'menu', null, null), ($2, $5, 'section', $1, 'a0'),
         ($3, $5, 'item', null, null), ($4, $5, 'item', null, null)`,
      [menu, section, item, handMade, tenant],
    )
    await client.query(
      `insert into restro.menus (id, tenant_id, venue_id, template_key, template_version, root_node_id)
       values ($1, $2, $3, 'venue-menu', 1, $1)`,
      [menu, tenant, venue],
    )
    await client.query(
      `insert into restro.source_records
         (id, tenant_id, integration_id, external_type, external_id, scope, content_hash, raw, payload)
       values ($1, $2, $3, 'article', '1001', 'master', $4, '{}', '{}'::jsonb)`,
      [record, tenant, integration, HASH],
    )
    await client.query(
      `insert into restro.source_links (tenant_id, integration_id, external_type, external_id, node_id)
       values ($1, $2, 'article', '1001', $3), ($1, $2, 'category', '2001', $4)`,
      [tenant, integration, item, section],
    )
    const name = { bg_BG: 'Негрони', en_US: 'Negroni' }
    await fieldValue(item, 'name', 'barsy', 'master', name)
    await fieldValue(item, 'price', 'barsy', `venue:${venue}`, {
      amount_minor: 1250,
      currency: 'EUR',
    })
    await fieldValue(item, 'for_sale', 'barsy', `venue:${venue}`, true)
    await fieldValue(item, 'visible', 'barsy', 'master', false)
    await fieldValue(section, 'title', 'barsy', 'master', { bg_BG: 'Коктейли' })
    await fieldValue(item, 'description', 'manual', 'master', { en_US: 'Gin, Campari' })
    await fieldValue(
      item,
      'name',
      'override',
      'master',
      { ...name, en_US: 'Our Negroni' },
      {
        basis: name,
      },
    )
    await fieldValue(item, 'for_sale', 'edition:service:2026-10-10', 'master', false)
    await fieldValue(handMade, 'name', 'manual', 'master', { bg_BG: 'Домашно вино' })
    await event('setField', item, 'name', 'barsy', null, name)
    await event('clearField', item, 'portion', 'barsy', { value: 100, unit: 'ml' }, null)
    await event('createNode', item, 'node', 'barsy', null, { type: 'item' })
    await event('linkSource', item, 'link', 'barsy', null, {
      source: `barsy:${integration}`,
      external_type: 'article',
    })
    await event(
      'setLinkState',
      item,
      'link',
      'barsy',
      { source: `barsy:${integration}`, external_type: 'article', state: 'active' },
      { source: `barsy:${integration}`, external_type: 'article', state: 'missing' },
    )
    // A person unlinks: the event is manual, its old value names the till.
    await event(
      'unlinkSource',
      section,
      'link',
      'manual',
      {
        source: `barsy:${integration}`,
        external_type: 'category',
      },
      null,
    )
    await event('setField', item, 'description', 'manual', null, { en_US: 'Gin, Campari' })
    // A field value whose content happens to hold a `source` key is not a link event: untouched.
    await event('setField', handMade, 'name', 'manual', null, { source: 'barsy:not-a-link' })
    await client.query(
      `insert into restro.assets (id, tenant_id, origin, origin_ref) values
         ($1, $3, 'barsy', 'article 1001'), ($2, $3, 'upload', null)`,
      [tillAsset, uploaded, tenant],
    )
    start = await snapshot()
  })

  afterAll(async () => {
    await client?.end()
    if (before0014) rmSync(before0014, { recursive: true, force: true })
    if (admin) {
      await admin.query(`drop database if exists ${database} with (force)`)
      await admin.end()
    }
  })

  it('stops before changing anything when an import row exists', async () => {
    await client.query('begin')
    try {
      await client.query(
        `insert into restro.field_values
           (tenant_id, node_id, field_key, layer, scope, value, value_hash, source, job_id, actor,
            observed_at)
         values ($1, $2, 'abv', 'import', 'master', '5', $3, 'import:wines', $4, 'system', now())`,
        [tenant, handMade, HASH, job],
      )
      let failure = ''
      try {
        for (const statement of statements(join(MIGRATIONS, `${TAG}.sql`))) {
          await client.query(statement)
        }
      } catch (error) {
        failure = error instanceof Error ? error.message : String(error)
      }
      expect(failure).toContain('use the import layer or an import source')
    } finally {
      await client.query('rollback')
    }
    expect(await snapshot()).toEqual(start)
  })

  it('0014 renames the till role in every row and keeps everything else', async () => {
    const tillCount = start.values.filter((row) => row.layer === 'barsy').length
    expect(tillCount).toBe(5)
    await migrateTo(MIGRATIONS)
    const after = await snapshot()
    const sortBy = (key: (row: Row) => string) => (a: Row, b: Row) => compareText(key(a), key(b))
    expect(after.values).toEqual(start.values.map(renamedValue).sort(sortBy(valueKey)))
    expect(after.events).toEqual(start.events.map(renamedEvent))
    expect(after.assets).toEqual(start.assets.map(renamedAsset))
    // The same numbers, under the new names.
    expect(after.values.filter((row) => row.layer === 'till')).toHaveLength(tillCount)
    expect(JSON.stringify(after)).not.toMatch(/"(layer|origin)":"barsy"|"barsy:in_/)
    // The untouched value whose content merely names a source.
    expect(after.events.at(-1)?.new_value).toEqual({ source: 'barsy:not-a-link' })

    const names = await checkNames()
    expect(names).toEqual(
      expect.arrayContaining([
        'assets_origin',
        'events_layer',
        'events_source',
        'field_values_layer',
        'field_values_layer_matches_source',
        'field_values_source',
        'field_values_till_provenance',
        'field_values_venue_scope_till_only',
      ]),
    )
    expect(names.filter((name) => name.includes('barsy'))).toEqual([])

    // Row-level security is forced on the owner again, and updated_at is touched again.
    const { rows: forced } = await client.query<{ relname: string; forced: boolean }>(
      `select relname, relforcerowsecurity as forced from pg_class
        where oid in ('restro.field_values'::regclass, 'restro.events'::regclass,
                      'restro.assets'::regclass)`,
    )
    expect(forced.every((row) => row.forced)).toBe(true)
    const { rows: triggers } = await client.query<{ enabled: string }>(
      `select tgenabled as enabled from pg_trigger
        where tgname in ('field_values_touch_updated_at', 'assets_touch_updated_at')`,
    )
    expect(triggers.map((row) => row.enabled)).toEqual(['O', 'O'])
  })

  it('after 0014 the database enforces till provenance and refuses import and the vendor', async () => {
    const insert = async (columns: Record<string, unknown>) => {
      const row: Record<string, unknown> = {
        tenant_id: tenant,
        node_id: handMade,
        field_key: 'abv',
        layer: 'manual',
        scope: 'master',
        value: '5',
        value_hash: HASH,
        source: 'manual',
        job_id: job,
        actor: 'system',
        observed_at: '2026-10-11T10:00:00Z',
        source_record_id: null,
        mapping_version: null,
        ...columns,
      }
      const keys = Object.keys(row)
      try {
        await client.query(
          `insert into restro.field_values (${keys.join(', ')})
           values (${keys.map((_, index) => `$${index + 1}`).join(', ')})`,
          keys.map((key) => row[key]),
        )
        return 'inserted'
      } catch (error) {
        return error instanceof Error ? error.message : String(error)
      }
    }
    const till = { layer: 'till', source: `till:${integration}` }
    expect(await insert(till)).toMatch(/field_values_till_provenance/)
    expect(await insert({ ...till, source_record_id: record })).toMatch(
      /field_values_till_provenance/,
    )
    expect(await insert({ ...till, mapping_version: 3 })).toMatch(/field_values_till_provenance/)
    expect(await insert({ layer: 'import', source: 'import:wines' })).toMatch(
      /field_values_layer|field_values_source/,
    )
    expect(await insert({ layer: 'barsy', source: `barsy:${integration}` })).toMatch(
      /field_values_layer|field_values_source/,
    )
    expect(await insert({ ...till, scope: `venue:${venue}`, layer: 'manual' })).toMatch(
      /field_values_layer_matches_source|field_values_venue_scope_till_only/,
    )
    expect(await insert({ scope: `venue:${venue}` })).toMatch(/field_values_venue_scope_till_only/)
    expect(
      await insert({ ...till, source_record_id: record, mapping_version: 3, field_key: 'abv' }),
    ).toBe('inserted')
    await client.query(
      `delete from restro.field_values where node_id = $1 and field_key = 'abv' and layer = 'till'`,
      [handMade],
    )
  })

  it('the reverse script gives back the rows of the start, and 0014 applies again after it', async () => {
    const applied = await snapshot()
    await client.query('begin')
    try {
      for (const statement of statements(REVERSE)) await client.query(statement)
      await client.query('commit')
    } catch (error) {
      await client.query('rollback')
      throw error
    }
    expect(await snapshot()).toEqual(start)
    const names = await checkNames()
    expect(names).toEqual(
      expect.arrayContaining([
        'field_values_barsy_provenance',
        'field_values_venue_scope_barsy_only',
      ]),
    )
    expect(names.filter((name) => name.includes('till'))).toEqual([])
    const { rows } = await client.query<{ count: number }>(
      'select count(*)::int as count from drizzle.__drizzle_migrations',
    )
    expect(rows[0]?.count).toBe(14)

    await migrateTo(MIGRATIONS)
    expect(await snapshot()).toEqual(applied)
  })
})
