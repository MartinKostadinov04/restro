import { getTableConfig, PgTable } from 'drizzle-orm/pg-core'
import { describe, expect, it } from 'vitest'

import { isTenantId } from './internal/pool'
import * as schema from './schema'
import { APP_SCHEMA, TABLE_ACCESS, type TableAccess } from './table-access'

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
