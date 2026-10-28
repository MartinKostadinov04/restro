import { getTableConfig, PgTable } from 'drizzle-orm/pg-core'
import { describe, expect, it } from 'vitest'

import { isTenantId } from './internal/pool'
import * as schema from './schema'
import { APP_DELETE_TABLES, APP_SCHEMA, TABLE_ACCESS, type TableAccess } from './table-access'

const tables = (Object.values(schema) as unknown[])
  .filter((value): value is PgTable => value instanceof PgTable)
  .map((table) => getTableConfig(table))

describe('table access list', () => {
  const access: Record<string, TableAccess> = TABLE_ACCESS

  it('lists every table of the Drizzle schema and nothing else', () => {
    expect(tables.map((table) => table.name).sort()).toEqual(Object.keys(access).sort())
  })

  it('puts every table in schema restro', () => {
    for (const table of tables) expect(table.schema, table.name).toBe(APP_SCHEMA)
  })

  it('matches each table’s tenancy to its columns', () => {
    for (const table of tables) {
      const hasTenantId = table.columns.some((column) => column.name === 'tenant_id')
      const tenancy = access[table.name]?.tenancy
      if (tenancy === 'tenant' || tenancy === 'tenant-or-system') {
        expect(hasTenantId, `${table.name} needs tenant_id`).toBe(true)
      } else {
        expect(hasTenantId, `${table.name} must not have tenant_id`).toBe(false)
      }
    }
  })

  it('never grants the app role UPDATE or DELETE on templates (immutable rows)', () => {
    expect(TABLE_ACCESS.templates.app).toEqual(['SELECT', 'INSERT'])
  })

  // D83, made precise by Martin 10-12: the app role deletes only the three row kinds apply()
  // removes as the action itself, plus Better Auth's session and verification rows. Widening
  // this list is a guardrail change (D67): stop and ask.
  it('lets the app role DELETE only from the five tables D83 names', () => {
    const deletable = Object.entries(access)
      .filter(([, table]) => table.app.includes('DELETE'))
      .map(([name]) => name)
      .sort()
    expect(deletable).toEqual([...APP_DELETE_TABLES].sort())
  })

  it('gives the purge role DELETE only on tenant data, INSERT only on its own records, never UPDATE', () => {
    for (const [name, table] of Object.entries(access)) {
      const purge: readonly string[] = table.purge ?? []
      expect(purge.includes('UPDATE'), `${name}: the purge role never updates`).toBe(false)
      if (purge.includes('DELETE')) {
        // The one platform-level table it erases: the provider's notices, 18 months on (#166).
        const expected = name === 'provider_notices' ? 'system' : 'tenant'
        expect(table.tenancy, `${name}: the purge role deletes tenant data only`).toBe(expected)
      }
      if (purge.includes('INSERT')) {
        expect(
          ['tombstones', 'purge_log'],
          `${name}: the purge role writes only its records`,
        ).toContain(name)
      }
      if (name.startsWith('auth_') || name === 'templates' || name === 'worker_heartbeats') {
        expect(purge, `${name}: the purge role never touches it`).toEqual([])
      }
    }
    // What a purge erases must be erasable: every venue-owned table.
    for (const name of [
      'venues',
      'menus',
      'nodes',
      'placements',
      'field_values',
      'source_records',
      'source_links',
      'events',
      'job_runs',
      'snapshots',
      'publish_pointers',
      'item_first_published',
      'tags',
      'areas',
      'tables',
      'menu_routes',
      'venue_slug_history',
    ]) {
      expect(access[name]?.purge, name).toContain('DELETE')
    }
  })
})

describe('isTenantId', () => {
  it.each(['tn_1', 'tn_4f9KzQ2mX7pL0aBcDeFgHi'])('accepts %s', (value) => {
    expect(isTenantId(value)).toBe(true)
  })

  it.each(['', 'tn_', 'vn_abc', 'TN_abc', 'tn_abc ', 'tn_a-b', "tn_a';--", null, 42])(
    'rejects %j',
    (value) => {
      expect(isTenantId(value)).toBe(false)
    },
  )
})
