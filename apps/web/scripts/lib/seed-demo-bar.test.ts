// Demo Bar in a real database (#71): seeded through the real writers as the restro_app role, seeded
// again (nothing may change), and read back: the venue on a `sim` instance linked to its till
// venue, the menu with POS provenance, the sold-out item not for sale, the item with required
// options, and no bars or tables yet (they come from the simulator through the worker's floor
// reading). Runs when DATABASE_URL_OWNER is set, like the other database tests.
import { newId } from '@restro/core'
import { provisionTenant } from '@restro/core/apply'
import { createPool, type DbPool } from '@restro/db'
import type pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { appDatabaseUrl, hasDatabase, openOwnerPool } from '../../src/server/test-database'
import { seedDemoBar } from './seed-demo-bar'

/** Tables the seed fills, children before parents, for the clean-up. */
const TABLES = [
  'events',
  'field_values',
  'placements',
  'source_links',
  'menus',
  'nodes',
  'source_records',
  'job_runs',
  'places',
  'menu_routes',
  'tables',
  'areas',
  'bars',
  'barsy_venues',
  'integrations',
  'venue_slug_history',
  'venues',
] as const

describe.skipIf(!hasDatabase)('Demo Bar against Postgres (as the restro_app role)', () => {
  const tenant = newId('tn')
  let app: DbPool
  let owner: pg.Pool

  const rows = async <Row extends object>(sql: string, values: unknown[] = []) =>
    (await owner.query(sql, values)).rows as Row[]

  beforeAll(async () => {
    owner = openOwnerPool()
    app = createPool(appDatabaseUrl(), { applicationName: 'restro-web-demo-bar-tests' })
    await provisionTenant(app, { tenantId: tenant, name: 'Demo Bar test club' })
  })

  afterAll(async () => {
    await app?.end()
    if (owner) {
      // The app role cannot delete: children before parents, as the other seed tests do.
      for (const table of TABLES) {
        await owner.query(`delete from restro.${table} where tenant_id = $1`, [tenant])
      }
      await owner.query('delete from restro.tenants where id = $1', [tenant])
      await owner.end()
    }
  })

  it('seeds the venue, its simulated instance, the link and the menu', async () => {
    const seeded = await seedDemoBar(app, tenant)
    expect(seeded.sections).toBe(6)
    expect(seeded.articles).toBe(29)

    const [venue] = await rows<{ name: string; slug: string; settings: Record<string, unknown> }>(
      'select name, slug, settings from restro.venues where id = $1',
      [seeded.venueId],
    )
    expect(venue).toMatchObject({ name: 'Demo Bar', slug: 'demo-bar' })
    // The floor source names the four payment tables, to be marked when the floor first appears.
    expect(venue?.settings.floor_source).toEqual({
      halls: null,
      bars: null,
      paymentTables: expect.arrayContaining(['PM1', 'PM2', 'PU1', 'PU2']),
    })

    const [instance] = await rows<{
      kind: string
      status: string
      config: Record<string, unknown>
    }>('select kind, status, config from restro.integrations where id = $1', [seeded.integrationId])
    expect(instance).toMatchObject({ kind: 'sim', status: 'connected' })
    expect(instance?.config.sim_scenario).toBe('quiet-night')

    const [link] = await rows<{ venue_id: string }>(
      'select venue_id from restro.barsy_venues where integration_id = $1',
      [seeded.integrationId],
    )
    expect(link?.venue_id).toBe(seeded.venueId)

    // The bars and tables are the simulator's to give, through the worker: none here yet.
    expect(
      await rows('select 1 from restro.tables where venue_id = $1', [seeded.venueId]),
    ).toHaveLength(0)
    expect(
      await rows('select 1 from restro.bars where venue_id = $1', [seeded.venueId]),
    ).toHaveLength(0)
  })

  it('writes the menu with POS provenance: till-layer values that cite the instance, never a person', async () => {
    const [instance] = await rows<{ id: string }>(
      'select id from restro.integrations where tenant_id = $1',
      [tenant],
    )
    const foreign = await rows<{ n: number }>(
      'select count(*)::int as n from restro.field_values where tenant_id = $1 and source <> $2',
      [tenant, `till:${instance?.id}`],
    )
    expect(foreign[0]?.n).toBe(0)
    const layers = await rows<{ layer: string }>(
      'select distinct layer from restro.field_values where tenant_id = $1',
      [tenant],
    )
    expect(layers).toEqual([{ layer: 'till' }])
  })

  it('has a sold-out item that is not for sale, and one item with required options', async () => {
    const soldOut = await rows<{ n: number }>(
      `select count(*)::int as n from restro.field_values
       where tenant_id = $1 and field_key = 'for_sale' and value = 'false'::jsonb`,
      [tenant],
    )
    expect(soldOut[0]?.n).toBe(1)
    const groups = await rows<{ n: number }>(
      `select count(*)::int as n from restro.nodes where tenant_id = $1 and node_type = 'modifier_group'`,
      [tenant],
    )
    expect(groups[0]?.n).toBe(1)
    const options = await rows<{ n: number }>(
      `select count(*)::int as n from restro.nodes where tenant_id = $1 and node_type = 'option'`,
      [tenant],
    )
    expect(options[0]?.n).toBe(2)
  })

  it('seeds again without changing anything', async () => {
    const count = async () =>
      (
        await rows<{ nodes: number; values: number; venues: number; instances: number }>(
          `select (select count(*)::int from restro.nodes where tenant_id = $1) as nodes,
                  (select count(*)::int from restro.field_values where tenant_id = $1) as values,
                  (select count(*)::int from restro.venues where tenant_id = $1) as venues,
                  (select count(*)::int from restro.integrations where tenant_id = $1) as instances`,
          [tenant],
        )
      )[0]
    const before = await count()
    const again = await seedDemoBar(app, tenant)
    expect(await count()).toEqual(before)
    expect(again.created).toBe(0)
  })
})
