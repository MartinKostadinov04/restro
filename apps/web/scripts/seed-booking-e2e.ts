// Fixtures for the booking page's end-to-end test (#577). Run by the test itself
// (`seed <sim host> <on|off>`):
//
//   seed   an organisation "Booking Club" of its own with Demo Bar (scripts/lib/seed-demo-bar-table.ts:
//          the menu published in the Editorial Style, which draws the booking page), open every
//          night 22:00–05:00, its reservation rules with online booking on or off, and one closed
//          date three nights from today; then the venue's booking file, written as the worker's
//          `publish-booking` job writes it.
//
//   requested <night>   prints how many Requested reservations the venue has on that night, with
//                       their party sizes and spots (`seed_booking_e2e_requested`): what the request
//                       left behind, read as the database owner.
//
// Like `db:seed:dev` this refuses to run unless NODE_ENV is development and the database is on this
// machine. It prints one JSON line (`seed_booking_e2e_done`) with the page's path, a night that can
// be booked (two from today) and the closed one.
import { createPublishStore, publishStoreConfig } from '@restro/assets'
import { addDaysToDay, guestBookingPath, serviceDate, type TenantId, WEEKDAYS } from '@restro/core'
import { venues, withTenant } from '@restro/db'
import { eq } from 'drizzle-orm'
import pg from 'pg'

import { writeBookingFile } from '../../worker/src/publish/booking'
import { getPool } from '../src/server/db'
import { DEMO_BAR_VENUE } from './lib/demo-bar'
import { seedDemoBarTable } from './lib/seed-demo-bar-table'

const TENANT_ID = `tn_${'E2eBookingClub'.padEnd(22, '0')}` as TenantId
const ORGANIZATION_SLUG = 'booking-club'
const SEED = ['restro', 'system', 'e2e-seed'] as const
const NIGHTLY = { opens: '22:00', lastOrders: '04:30', closes: '05:00' }

async function seed(simHost: string, on: boolean): Promise<void> {
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
    await owner.query(
      `insert into restro.reservation_settings
         (tenant_id, venue_id, turn_minutes, online, closed_dates, source, actor, job_id)
       values ($1, $2, 120, $3::jsonb, $4::jsonb, $5, $6, $7)
       on conflict (tenant_id, venue_id) do update
         set online = excluded.online, closed_dates = excluded.closed_dates, updated_at = now()`,
      [TENANT_ID, venue.id, JSON.stringify({ bookingPage: on }), JSON.stringify([closed]), ...SEED],
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

const [step, first, second] = process.argv.slice(2)
const run =
  step === 'seed' && first !== undefined && (second === 'on' || second === 'off')
    ? seed(first, second === 'on')
    : step === 'requested' && first !== undefined
      ? requested(first)
      : Promise.reject(new Error('seed <sim host> <on|off> | requested <night>'))
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
