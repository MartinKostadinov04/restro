// Sets the reservation settings, plan and spots of the Reservations settings test's venue (#325;
// scripts/seed-reservations-e2e.ts makes the venue). Run by the test itself, as the database owner:
//
//   fresh   nothing set: no settings row (so no turn time), no closed dates, three spots on one plan.
//   set     the same spots, and a settings row with a turn time of 120 minutes.
//
// The reservation tables are written by core/service alone (write-targets.test.ts); a fixture in an
// `e2e` folder is where a test sets them up, as the pay harness does. Refuses a database that is
// not on this machine.
import { newId } from '@restro/core'
import pg from 'pg'

import { assertDevEnvironment } from '../scripts/lib/guard'

const SEED = ['restro', 'system', 'e2e-reservations-state'] as const

const [state] = process.argv.slice(2)
if (state !== 'fresh' && state !== 'set') {
  console.error('reservations-state <fresh|set>')
  process.exit(1)
}

const url = process.env.DATABASE_URL_OWNER
if (!url) throw new Error('reservations-state needs DATABASE_URL_OWNER (see .env.example).')
assertDevEnvironment({ ...process.env, DATABASE_URL: url })
const owner = new pg.Pool({ connectionString: url, max: 1 })
try {
  const { rows } = await owner.query<{ tenant_id: string; id: string }>(
    `select tenant_id, id from restro.venues where slug = 'reservations-club'`,
  )
  const venue = rows[0]
  if (!venue) {
    throw new Error('Run scripts/seed-reservations-e2e.ts first: there is no Reservations Club.')
  }
  // Every state starts from the same floor.
  for (const table of ['reservation_settings', 'spots', 'floor_plans', 'venue_spot_kinds']) {
    await owner.query(`delete from restro.${table} where venue_id = $1`, [venue.id])
  }
  const planId = newId('fp')
  await owner.query(
    `insert into restro.floor_plans (id, tenant_id, venue_id, name, is_current, source, actor, job_id)
     values ($1, $2, $3, 'Main floor', true, $4, $5, $6)`,
    [planId, venue.tenant_id, venue.id, ...SEED],
  )
  for (const [key, label, seats] of [
    ['table', 'Маса', 4],
    ['booth', 'Сепаре', 8],
  ] as const) {
    await owner.query(
      `insert into restro.venue_spot_kinds (tenant_id, venue_id, key, label, default_seats, source, actor, job_id)
       values ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [venue.tenant_id, venue.id, key, label, seats, ...SEED],
    )
  }
  let x = 0
  for (const [name, kind, seats] of [
    ['12', 'table', 6],
    ['Sofa', 'booth', null],
    ['Bar 3', 'table', null],
  ] as const) {
    x += 12
    await owner.query(
      `insert into restro.spots (id, tenant_id, venue_id, plan_id, name, kind, x, y, width, height, seats, source, actor, job_id)
       values ($1, $2, $3, $4, $5, $6, $7, 0, 10, 10, $8, $9, $10, $11)`,
      [newId('sp'), venue.tenant_id, venue.id, planId, name, kind, x, seats, ...SEED],
    )
  }
  if (state === 'set') {
    await owner.query(
      `insert into restro.reservation_settings (tenant_id, venue_id, turn_minutes, source, actor, job_id)
       values ($1, $2, 120, $3, $4, $5)`,
      [venue.tenant_id, venue.id, ...SEED],
    )
  }
} finally {
  await owner.end()
}
