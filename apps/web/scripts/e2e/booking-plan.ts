// The booking page fixture's plan (#580), written as the database owner like the night's book
// (reservations-night.ts). A fixture stands in for the owner's plan editor here; the app itself
// writes these only through core/service.
import { newId } from '@restro/core'
import type pg from 'pg'

const SEED = ['restro', 'system', 'e2e-seed'] as const

/**
 * The plan guests see (#580), drawn again on every run: the spots earlier runs held are let go
 * first, so every spot starts free. As the database owner, like the settings: a fixture stands in
 * for the owner's plan editor here.
 */
export async function drawBookingPlan(
  owner: pg.Pool,
  tenantId: string,
  venueId: string,
): Promise<void> {
  await owner.query('delete from restro.reservation_spots where tenant_id = $1', [tenantId])
  await owner.query('delete from restro.spots where tenant_id = $1', [tenantId])
  await owner.query('delete from restro.floor_plans where tenant_id = $1', [tenantId])
  await owner.query('delete from restro.venue_spot_kinds where tenant_id = $1', [tenantId])
  const planId = newId('fp')
  await owner.query(
    `insert into restro.floor_plans (id, tenant_id, venue_id, name, is_current, source, actor, job_id)
     values ($1, $2, $3, 'Ground floor', true, $4, $5, $6)`,
    [planId, tenantId, venueId, ...SEED],
  )
  for (const [key, label, symbol, seats, sortKey] of [
    ['table', 'Tables', 'table', 4, 'a0'],
    ['stool', 'Bar stools', 'stool', 1, 'a1'],
  ] as const) {
    await owner.query(
      `insert into restro.venue_spot_kinds
         (tenant_id, venue_id, key, label, symbol, filters, default_seats, sort_key,
          source, actor, job_id)
       values ($1, $2, $3, $4, $5, true, $6, $7, $8, $9, $10)`,
      [tenantId, venueId, key, label, symbol, seats, sortKey, ...SEED],
    )
  }
  const table = await owner.query<{ id: string }>(
    `select id from restro.tables where tenant_id = $1 and venue_id = $2 and archived_at is null
      order by number limit 1`,
    [tenantId, venueId],
  )
  const tableId = table.rows[0]?.id
  if (tableId === undefined) throw new Error('Demo Bar has no table')
  // "Bar counter" is long and thin (300 × 30), as a real counter is: the plan must still draw it
  // at least 44 px tall on a 390 px phone (#580 review).
  for (const [name, kind, shape, x, y, width, height, tableOf] of [
    ['Table 1', 'table', 'rect', 20, 20, 80, 80, tableId],
    ['Bar 1', 'stool', 'circle', 160, 20, 80, 80, null],
    ['Bar 2', 'stool', 'circle', 300, 20, 80, 80, null],
    ['Bar counter', 'stool', 'rect', 20, 140, 300, 30, null],
  ] as const) {
    await owner.query(
      `insert into restro.spots
         (id, tenant_id, venue_id, plan_id, name, kind, shape, x, y, width, height, rotation,
          seats, table_id, source, actor, job_id)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 0, null, $12, $13, $14, $15)`,
      [
        newId('sp'),
        tenantId,
        venueId,
        planId,
        name,
        kind,
        shape,
        x,
        y,
        width,
        height,
        tableOf,
        ...SEED,
      ],
    )
  }
}
