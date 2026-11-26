// Fixtures for the booking page's end-to-end tests (#577, #580). Run by the tests themselves
// (`seed <sim host> <on|off> [night|area|spot]`):
//
//   seed   an organisation "Booking Club" of its own with Demo Bar (scripts/lib/seed-demo-bar-table.ts:
//          the menu published in the Editorial Style, which draws the booking page), open every
//          night 22:00–05:00, its reservation rules with online booking on or off, and one closed
//          date three nights from today; then the venue's booking file, written as the worker's
//          `publish-booking` job writes it.
//          With `area` or `spot` (#580) it also draws the plan "Ground floor": "Table 1" on Demo
//          Bar's Table 1 (in the Area "Main hall"), and the bar stools "Bar 1" and "Bar 2" and the
//          long thin "Bar counter" with no Table (scripts/e2e/booking-plan.ts). Guests then choose an Area, or pick their own spot with bookings that confirm
//          themselves. Every run starts with every spot free: the spots earlier runs held are let go.
//
//   booked <night>      prints the venue's online bookings on that night, Requested or Reserved, with
//                       the Area each asked for and the spots it holds (`seed_booking_e2e_booked`).
//
//   requested <night>   prints how many Requested reservations the venue has on that night, with
//                       their party sizes and spots (`seed_booking_e2e_requested`): what the request
//                       left behind, read as the database owner.
//
//   booked <night> <name>   prints the id and status of the newest booking that night for the guest
//                       of that name (`seed_booking_e2e_booked`), for the guest link's test (#579),
//                       and the path of the guest's own link as the worker writes it into his
//                       emails (with GUEST_LINK_KEY set: the test servers' key; null when the
//                       stored hash is not that key's).
//
//   owner <email>       makes that account (the admin password of .env.local) the owner of Booking
//                       Club, so the guest link's test can read the club's list (#579).
//
// Like `db:seed:dev` this refuses to run unless NODE_ENV is development and the database is on this
// machine. It prints one JSON line (`seed_booking_e2e_done`) with the page's path, a night that can
// be booked (two from today) and the closed one.
import { createPublishStore, publishStoreConfig } from '@restro/assets'
import { addDaysToDay, guestBookingPath, serviceDate, type TenantId, WEEKDAYS } from '@restro/core'
import { authMember, venues, withTenant } from '@restro/db'
import { and, eq } from 'drizzle-orm'
import pg from 'pg'

import { guestLinkOf } from '../../worker/src/guest-email/link'
import { writeBookingFile } from '../../worker/src/publish/booking'
import { createAuth } from '../src/server/auth'
import { getAuthDb, getPool } from '../src/server/db'
import { authModelId } from '../src/server/ids'
import { drawBookingPlan } from './e2e/booking-plan'
import { seedBookingSettings } from './e2e/booking-settings'
import { DEMO_BAR_VENUE } from './lib/demo-bar'
import { readAdminCredentials } from './lib/guard'
import { seedDemoBarTable } from './lib/seed-demo-bar-table'

const TENANT_ID = `tn_${'E2eBookingClub'.padEnd(22, '0')}` as TenantId
const ORGANIZATION_SLUG = 'booking-club'
const NIGHTLY = { opens: '22:00', lastOrders: '04:30', closes: '05:00' }

/** What guests may choose on the page. */
type GuestMay = 'night' | 'area' | 'spot'

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
    if (guestMay !== 'night') await drawBookingPlan(owner, TENANT_ID, venue.id)
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

/** The online bookings of a night, Requested or Reserved, with the Area asked for and the spots (#580). */
async function asked(night: string): Promise<void> {
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
    console.log(JSON.stringify({ level: 'info', event: 'seed_booking_e2e_asked', rows }))
  } finally {
    await owner.end()
  }
}

async function booked(night: string, name: string): Promise<void> {
  const owner = new pg.Pool({ connectionString: process.env.DATABASE_URL_OWNER, max: 1 })
  try {
    const { rows } = await owner.query<{
      id: string
      status: string
      venue_id: string
      guest_token_hash: string | null
    }>(
      `select r.id, r.status, r.venue_id, r.guest_token_hash
         from restro.reservations r
         join restro.venues v on v.id = r.venue_id
         join restro.guests g on g.id = r.guest_id
        where r.tenant_id = $1 and v.slug = $2 and r.service_date = $3 and g.name = $4
        order by r.created_at desc
        limit 1`,
      [TENANT_ID, DEMO_BAR_VENUE.slug, night, name],
    )
    const found = rows[0]
    if (found === undefined) throw new Error(`no booking that night for ${name}`)
    // The link's path as the worker writes it into the guest's emails: worked out again from the id
    // with the test servers' key, and only when it matches the hash the request stored.
    const key = process.env.GUEST_LINK_KEY
    const link =
      key === undefined
        ? undefined
        : guestLinkOf(
            found.id,
            {
              linkParts: {
                tokenHash: found.guest_token_hash,
                organization: ORGANIZATION_SLUG,
                venue: DEMO_BAR_VENUE.slug,
              },
            },
            { key, baseUrl: '' },
          )
    console.log(
      JSON.stringify({
        level: 'info',
        event: 'seed_booking_e2e_booked',
        id: found.id,
        status: found.status,
        venue_id: found.venue_id,
        link: link ?? null,
      }),
    )
  } finally {
    await owner.end()
  }
}

/** The account as Booking Club's owner, made or given back its password (as seed-tonight-e2e does). */
async function makeOwner(email: string): Promise<void> {
  const { password } = readAdminCredentials(process.env)
  const auth = createAuth({ scripts: true })
  const context = await auth.$context
  const hash = await context.password.hash(password)
  const existing = await context.internalAdapter.findUserByEmail(email)
  let userId: string
  if (existing) {
    await context.internalAdapter.updatePassword(existing.user.id, hash)
    userId = existing.user.id
  } else {
    const user = await context.internalAdapter.createUser(
      { email, name: 'Booking Owner', emailVerified: true },
      { method: 'admin' },
    )
    await context.internalAdapter.linkAccount({
      userId: user.id,
      providerId: 'credential',
      accountId: user.id,
      password: hash,
    })
    userId = user.id
  }
  const db = getAuthDb()
  const [membership] = await db
    .select({ id: authMember.id })
    .from(authMember)
    .where(and(eq(authMember.organizationId, TENANT_ID), eq(authMember.userId, userId)))
    .limit(1)
  if (membership === undefined) {
    await db
      .insert(authMember)
      .values({ id: authModelId('member'), organizationId: TENANT_ID, userId, role: 'owner' })
  } else {
    await db.update(authMember).set({ role: 'owner' }).where(eq(authMember.id, membership.id))
  }
  console.log(JSON.stringify({ level: 'info', event: 'seed_booking_e2e_owner' }))
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
      : step === 'asked' && first !== undefined
        ? asked(first)
        : step === 'booked' && first !== undefined && second !== undefined
          ? booked(first, second)
          : step === 'owner' && first !== undefined
            ? makeOwner(first)
            : Promise.reject(
                new Error(
                  'seed <sim host> <on|off> [night|area|spot] | requested <night> | asked <night> | booked <night> <name> | owner <email>',
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
