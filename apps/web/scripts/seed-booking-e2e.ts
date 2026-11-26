// Fixtures for the booking page's end-to-end tests (#577, #580). Run by the tests themselves
// (`seed <sim host> <on|off> [night|area|spot]`):
//
//   seed   an organisation "Booking Club" of its own with Demo Bar (scripts/lib/seed-demo-bar-table.ts:
//          the menu published in the Editorial Style, which draws the booking page), open every
//          night 22:00–05:00, its reservation rules with online booking on or off, and one closed
//          date three nights from today; then the venue's booking file, written as the worker's
//          `publish-booking` job writes it.
//          With `area` or `spot` (#580) it also draws the plan "Ground floor": "Table 1" on Demo
//          Bar's Table 1 (in the Area "Main hall"), and the bar stools "Bar 1" and "Bar 2" with no
//          Table. Guests then choose an Area, or pick their own spot with bookings that confirm
//          themselves. Every run starts with every spot free: the spots earlier runs held are let go.
//
//   booked <night>      prints the venue's online bookings on that night, Requested or Reserved, with
//                       the Area each asked for and the spots it holds (`seed_booking_e2e_booked`).
//
//   requested <night>   prints how many Requested reservations the venue has on that night, with
//                       their party sizes and spots (`seed_booking_e2e_requested`): what the request
//                       left behind, read as the database owner.
//
// Like `db:seed:dev` this refuses to run unless NODE_ENV is development and the database is on this
// machine. It prints one JSON line (`seed_booking_e2e_done`) with the page's path, a night that can
// be booked (two from today) and the closed one.
import { createPublishStore, publishStoreConfig } from '@restro/assets'
import {
  addDaysToDay,
  guestBookingPath,
  newId,
  serviceDate,
  type TenantId,
  WEEKDAYS,
} from '@restro/core'
import { venues, withTenant } from '@restro/db'
import { eq } from 'drizzle-orm'
import pg from 'pg'

import { writeBookingFile } from '../../worker/src/publish/booking'
import { getPool } from '../src/server/db'
import { seedBookingSettings } from './e2e/booking-settings'
import { DEMO_BAR_VENUE } from './lib/demo-bar'
import { seedDemoBarTable } from './lib/seed-demo-bar-table'

const TENANT_ID = `tn_${'E2eBookingClub'.padEnd(22, '0')}` as TenantId
const ORGANIZATION_SLUG = 'booking-club'
const NIGHTLY = { opens: '22:00', lastOrders: '04:30', closes: '05:00' }
const SEED = ['restro', 'system', 'e2e-seed'] as const

/** What guests may choose on the page. */
type GuestMay = 'night' | 'area' | 'spot'

/**
 * The plan guests see (#580), drawn again on every run: the spots earlier runs held are let go
 * first, so every spot starts free. As the database owner, like the settings: a fixture stands in
 * for the owner's plan editor here.
 */
async function drawPlan(owner: pg.Pool, tenantId: string, venueId: string): Promise<void> {
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
  for (const [name, kind, shape, x, tableOf] of [
    ['Table 1', 'table', 'rect', 20, tableId],
    ['Bar 1', 'stool', 'circle', 160, null],
    ['Bar 2', 'stool', 'circle', 300, null],
  ] as const) {
    await owner.query(
      `insert into restro.spots
         (id, tenant_id, venue_id, plan_id, name, kind, shape, x, y, width, height, rotation,
          seats, table_id, source, actor, job_id)
       values ($1, $2, $3, $4, $5, $6, $7, $8, 20, 80, 80, 0, null, $9, $10, $11, $12)`,
      [newId('sp'), tenantId, venueId, planId, name, kind, shape, x, tableOf, ...SEED],
    )
  }
}

async function seed(simHost: string, on: boolean, guestMay: GuestMay): Promise<void> {
  await seedDemoBarTable({
    tenantId: TENANT_ID,
    organizationName: 'Booking Club',
    organizationSlug: ORGANIZATION_SLUG,
    simHost,
    style: 'editorial',
    ordering: {
      locationCheck: false,
      serviceHours: Object.fromEntries(WEEKDAYS.map((day) => [day, NIGHTLY])),
    },
    features: {
      filters: true,
      call_waiter: { enabled: false, kinds: [] },
      bill: false,
      ordering: false,
      pay: false,
    },
  })
  const pool = getPool()
  const [venue] = await withTenant(pool, TENANT_ID, (tx) =>
    tx.select().from(venues).where(eq(venues.slug, DEMO_BAR_VENUE.slug)),
  )
  if (venue === undefined) throw new Error('Demo Bar went missing')
  const today = serviceDate(new Date(), venue.timezone, venue.serviceDayEndsAt)
  const open = addDaysToDay(today, 2)
  const closed = addDaysToDay(today, 3)

  const owner = new pg.Pool({ connectionString: process.env.DATABASE_URL_OWNER, max: 1 })
  try {
    if (guestMay !== 'night') await drawPlan(owner, TENANT_ID, venue.id)
    await seedBookingSettings(
      owner,
      { tenantId: TENANT_ID, venueId: venue.id },
      { bookingPage: on, closedDates: [closed], guestMay, autoConfirm: guestMay === 'spot' },
    )
  } finally {
    await owner.end()
  }

  const store = await createPublishStore(publishStoreConfig(process.env))
  const written = await writeBookingFile(
    { pool, store, now: () => new Date() },
    { tenantId: TENANT_ID, venueId: venue.id },
  )
  if (written.status !== 'done')
    throw new Error(`the booking file was not written: ${written.status}`)
  const path = guestBookingPath({ organization: ORGANIZATION_SLUG, venue: DEMO_BAR_VENUE.slug })
  console.log(JSON.stringify({ level: 'info', event: 'seed_booking_e2e_done', path, open, closed }))
}

async function requested(night: string): Promise<void> {
  const owner = new pg.Pool({ connectionString: process.env.DATABASE_URL_OWNER, max: 1 })
  try {
    const { rows } = await owner.query<{ party_size: number; spots: number }>(
      `select r.party_size,
              (select count(*) from restro.reservation_spots s where s.reservation_id = r.id)::int as spots
         from restro.reservations r
         join restro.venues v on v.id = r.venue_id
        where r.tenant_id = $1 and v.slug = $2 and r.service_date = $3 and r.status = 'requested'`,
      [TENANT_ID, DEMO_BAR_VENUE.slug, night],
    )
    console.log(JSON.stringify({ level: 'info', event: 'seed_booking_e2e_requested', rows }))
  } finally {
    await owner.end()
  }
}

async function booked(night: string): Promise<void> {
  const owner = new pg.Pool({ connectionString: process.env.DATABASE_URL_OWNER, max: 1 })
  try {
    const { rows } = await owner.query<{ status: string; area: string | null; spots: string[] }>(
      `select r.status,
              a.name as area,
              coalesce((select array_agg(s.name order by s.name)
                          from restro.reservation_spots rs
                          join restro.spots s on s.tenant_id = rs.tenant_id and s.id = rs.spot_id
                         where rs.reservation_id = r.id), '{}') as spots
         from restro.reservations r
         join restro.venues v on v.id = r.venue_id
         left join restro.areas a on a.tenant_id = r.tenant_id and a.id = r.requested_area_id
        where r.tenant_id = $1 and v.slug = $2 and r.service_date = $3
          and r.status in ('requested', 'reserved')`,
      [TENANT_ID, DEMO_BAR_VENUE.slug, night],
    )
    console.log(JSON.stringify({ level: 'info', event: 'seed_booking_e2e_booked', rows }))
  } finally {
    await owner.end()
  }
}

const [step, first, second, third] = process.argv.slice(2)
const guestMay: GuestMay | null =
  third === undefined
    ? 'night'
    : third === 'night' || third === 'area' || third === 'spot'
      ? third
      : null
const run =
  step === 'seed' &&
  first !== undefined &&
  (second === 'on' || second === 'off') &&
  guestMay !== null
    ? seed(first, second === 'on', guestMay)
    : step === 'requested' && first !== undefined
      ? requested(first)
      : step === 'booked' && first !== undefined
        ? booked(first)
        : Promise.reject(
            new Error(
              'seed <sim host> <on|off> [night|area|spot] | requested <night> | booked <night>',
            ),
          )
run
  .then(async () => {
    await getPool().end()
    process.exit(0)
  })
  .catch((error: unknown) => {
    console.error(
      `seed-booking-e2e failed: ${error instanceof Error ? error.message : String(error)}`,
    )
    process.exit(1)
  })
