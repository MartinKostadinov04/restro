// What migration 0047 left behind (D129, My styles; ticket #177), read from the live catalog of the
// migrated test database: the table's own rules and the ones that keep a Style to its organisation.
// The policies themselves and the app role's grants are checked for every table by rls-guard and
// app-role; this file holds what is particular to `design_styles`:
//   - a name unique among the organisation's Styles that are not removed, and free again once one
//     is removed (the partial index), while two organisations may hold the same name;
//   - the row's provenance NOT NULL and the manual layer and source (rule 2);
//   - `updated_at` kept by the trigger;
//   - the app role has no DELETE: a delete is a soft removal the toast's Undo clears (D83).
import { randomUUID } from 'node:crypto'

import type pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { APP_ROLE, TABLE_ACCESS } from '../src/table-access'
import { databaseError, hasDatabase, openOwnerPool, testId } from './database'

const VALUES = `'{"general": {"screen": "auto"}}'::jsonb`

describe.skipIf(!hasDatabase)('the organisation’s saved Styles (migration 0047)', () => {
  let owner: pg.Pool
  const tenants: string[] = []

  const newTenant = async () => {
    const id = testId('tn')
    await owner.query('insert into restro.tenants (id, name) values ($1, $2)', [
      id,
      `Styles ${randomUUID().slice(0, 8)}`,
    ])
    tenants.push(id)
    return id
  }

  const insert = (tenantId: string, name: string, removed = false) =>
    owner.query(
      `insert into restro.design_styles
         (id, tenant_id, name, style, style_values, removed_at, layer, source, actor, job_id,
          change_set_id)
       values ($1, $2, $3, 'basic', ${VALUES}, ${removed ? 'now()' : 'null'}, 'manual', 'manual',
               'user:us_test', 'jb_test', $4)`,
      [testId('ds'), tenantId, name, testId('cs')],
    )

  beforeAll(async () => {
    owner = await openOwnerPool()
  }, 60_000)

  afterAll(async () => {
    if (owner) {
      for (const id of tenants) {
        await owner.query('delete from restro.design_styles where tenant_id = $1', [id])
        await owner.query('delete from restro.tenants where id = $1', [id])
      }
      await owner.end()
    }
  })

  it('is a tenant table the app role may read, add to and change, and never delete from', () => {
    expect(TABLE_ACCESS.design_styles).toEqual({
      tenancy: 'tenant',
      app: ['SELECT', 'INSERT', 'UPDATE'],
    })
  })

  it('grants the app role no DELETE in the database either', async () => {
    const { rows } = await owner.query<{ privilege_type: string }>(
      `select privilege_type from information_schema.role_table_grants
        where table_schema = 'restro' and table_name = 'design_styles' and grantee = $1
        order by 1`,
      [APP_ROLE],
    )
    expect(rows.map((row) => row.privilege_type)).toEqual(['INSERT', 'SELECT', 'UPDATE'])
  })

  it('holds one live Style per name, and frees the name once one is removed', async () => {
    const tenant = await newTenant()
    await insert(tenant, 'Club night')
    expect(await databaseError(insert(tenant, 'Club night'))).toMatch(
      /design_styles_live_name_unique/,
    )
    // Removed rows do not block the name, however many there are.
    await owner.query('update restro.design_styles set removed_at = now() where tenant_id = $1', [
      tenant,
    ])
    await insert(tenant, 'Club night')
    await insert(tenant, 'Club night', true)
    const { rows } = await owner.query<{ count: string }>(
      'select count(*) as count from restro.design_styles where tenant_id = $1',
      [tenant],
    )
    expect(rows[0]?.count).toBe('3')
  })

  it('lets two organisations hold the same name', async () => {
    const one = await newTenant()
    const two = await newTenant()
    await insert(one, 'Shared name')
    await insert(two, 'Shared name')
    expect(await databaseError(insert(one, 'Shared name'))).toMatch(/unique/)
  })

  it('refuses a row without its provenance, and any layer or source but manual', async () => {
    const tenant = await newTenant()
    const bad = (columns: string, values: string) =>
      owner.query(
        `insert into restro.design_styles (id, tenant_id, name, style, style_values, ${columns})
         values ($1, $2, $3, 'basic', ${VALUES}, ${values})`,
        [testId('ds'), tenant, `Bad ${randomUUID().slice(0, 8)}`],
      )
    // No provenance at all: the columns are NOT NULL.
    expect(await databaseError(bad('layer', `'manual'`))).toMatch(/not-null|null value/i)
    const rest = `'user:us_test', 'jb_test', '${testId('cs')}'`
    expect(
      await databaseError(
        bad('layer, source, actor, job_id, change_set_id', `'till', 'manual', ${rest}`),
      ),
    ).toMatch(/design_styles_layer/)
    expect(
      await databaseError(
        bad('layer, source, actor, job_id, change_set_id', `'manual', 'till:in_1', ${rest}`),
      ),
    ).toMatch(/design_styles_source/)
  })

  it('refuses a name that is empty, untrimmed or too long', async () => {
    const tenant = await newTenant()
    for (const name of ['', '  padded  ', 'x'.repeat(61)]) {
      expect(await databaseError(insert(tenant, name))).toMatch(/design_styles_name_length/)
    }
  })

  it('keeps updated_at current through the trigger', async () => {
    const tenant = await newTenant()
    await insert(tenant, 'Touched')
    const read = async () =>
      (
        await owner.query<{ updated_at: Date }>(
          'select updated_at from restro.design_styles where tenant_id = $1',
          [tenant],
        )
      ).rows[0]?.updated_at
    const before = await read()
    await owner.query(
      `update restro.design_styles set name = 'Touched again' where tenant_id = $1`,
      [tenant],
    )
    const after = await read()
    expect(after?.getTime()).toBeGreaterThan(before?.getTime() ?? 0)
  })
})
