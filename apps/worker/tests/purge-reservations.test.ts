// A venue that has taken a booking can be erased (#361; D83, D140, D134): the reservations side
// of migration 0046 was in neither purge path, and its tables point at the venue with ON DELETE
// no action, so the purge's transaction failed on a foreign key and the club's guests' names,
// phone numbers and email addresses stayed in our database. Two tests, as the restro_purge role:
//
//   - a venue with a floor plan, spots, kinds, settings, a night, guests with a private note, a
//     booking, a waiting walk-in, a block and their spot holds is erased whole, every row of the
//     nine tables with it, and the content-free `purge_log` row counts them;
//   - the guard: every table that hangs off `venues` through a foreign key, read from Postgres,
//     is accounted for by the venue purge, and a table it has never seen is reported (D67: the
//     next nine tables somebody adds cannot quietly block a venue's erasure).
//
// Skipped without a database or the purge role.
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { LocalPublishStore } from '@restro/assets'
import { newId } from '@restro/core'
import { createArea, createTable, provisionTenant, provisionVenue } from '@restro/core/apply'
import { createPool, type DbPool } from '@restro/db'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { purgeVenue, venueTablesNotAccountedFor } from '../src/jobs/purge'
import {
  allowSlowSetup,
  createTestDatabase,
  hasDatabase,
  type TestDatabase,
  testSlug,
  withOwnerClient,
} from './database'

allowSlowSetup()

const hasPurge =
  hasDatabase && (process.env.DATABASE_PURGE_PASSWORD || process.env.DATABASE_URL_PURGE)

const SEED = ['staff', 'staff:sm_seed', 'test-seed'] as const
const NIGHT = '2026-10-24'

/** The nine tables migration 0046 added: none may outlive the venue. */
const RESERVATION_TABLES = [
  'floor_plans',
  'spots',
  'venue_spot_kinds',
  'reservations',
  'reservation_spots',
  'reservation_settings',
  'reservation_nights',
  'guests',
  'guest_private_notes',
] as const

/**
 * Every table in schema `restro` whose rows hang off a venue: the chain of foreign keys that
 * starts at `venues`, and every table that carries a `venue_id` of its own (one that names no
 * venue by a key still keeps a venue's rows). That is what a venue's purge has to answer for, read
 * from Postgres and not from a list in this file, so a table added tomorrow is in it.
 */
const VENUE_TABLE_CLOSURE = `
  with recursive edges as (
    select child.relname::text as child, parent.relname::text as parent
    from pg_constraint c
    join pg_class child on child.oid = c.conrelid
    join pg_class parent on parent.oid = c.confrelid
    join pg_namespace nc on nc.oid = child.relnamespace and nc.nspname = 'restro'
    join pg_namespace np on np.oid = parent.relnamespace and np.nspname = 'restro'
    where c.contype = 'f' and child.relname <> parent.relname
  ),
  reach as (
    select child, parent from edges where parent = 'venues'
    union
    select e.child, e.parent from edges e join reach r on e.parent = r.child
  )
  select distinct child as name from reach
  union
  select c.table_name::text as name
  from information_schema.columns c
  where c.table_schema = 'restro' and c.column_name = 'venue_id' and c.table_name <> 'venues'
  order by name`

describe.skipIf(!hasPurge)('erasing a venue that has reservations (as the restro_purge role)', () => {
  let db: TestDatabase
  let pool: DbPool
  let purgePool: DbPool
  const tenantId = newId('tn')
  let venueId: string
  let staffId: string

  const query = <T = Record<string, unknown>>(text: string, values: unknown[] = []) =>
    withOwnerClient(db.ownerUrl, async (client) => (await client.query(text, values)).rows as T[])

  beforeAll(async () => {
    db = await createTestDatabase()
    pool = createPool(db.appUrl, { applicationName: 'restro-worker-purge-reservations', max: 4 })
    purgePool = createPool(db.purgeUrl ?? '', { applicationName: 'restro-worker-purge-rv' })
    await provisionTenant(pool, { tenantId, name: 'Reservations club' })
    await query(
      `insert into restro.auth_organization (id, name, slug) values ($1, 'Reservations club', $2)`,
      [tenantId, `reservations-${newId('tn').slice(3, 11).toLowerCase()}`],
    )
    const venue = await provisionVenue(pool, tenantId, {
      name: 'Booking Bar',
      slug: testSlug('purge-reservations'),
    })
    venueId = venue.id
    const area = await createArea(pool, tenantId, venueId, 'Hall')
    if (!area.ok) throw new Error(area.reason)
    const table = await createTable(pool, tenantId, {
      areaId: area.area.id,
      name: null,
      number: '1',
    })
    if (!table.ok) throw new Error(table.reason)

    staffId = newId('sm')
    await query(
      `insert into restro.staff_members
         (id, tenant_id, display_name, source, actor, job_id)
       values ($1, $2, 'Hostess', $3, $4, $5)`,
      [staffId, tenantId, ...SEED],
    )

    // The venue's reservations settings and one closed night.
    await query(
      `insert into restro.reservation_settings
         (tenant_id, venue_id, turn_minutes, source, actor, job_id)
       values ($1, $2, 120, $3, $4, $5)`,
      [tenantId, venueId, ...SEED],
    )
    await query(
      `insert into restro.reservation_nights
         (tenant_id, venue_id, service_date, closed_at, source, actor, job_id)
       values ($1, $2, $3, now(), $4, $5, $6)`,
      [tenantId, venueId, NIGHT, ...SEED],
    )
    await query(
      `insert into restro.venue_spot_kinds
         (tenant_id, venue_id, key, label, source, actor, job_id)
       values ($1, $2, 'booth', 'Booth', $3, $4, $5)`,
      [tenantId, venueId, ...SEED],
    )

    // The floor: a current plan with two spots, one of them on the venue's table.
    const planId = newId('fp')
    await query(
      `insert into restro.floor_plans
         (id, tenant_id, venue_id, name, is_current, source, actor, job_id)
       values ($1, $2, $3, 'Main floor', true, $4, $5, $6)`,
      [planId, tenantId, venueId, ...SEED],
    )
    const spotIds = [newId('sp'), newId('sp')]
    for (const [index, spotId] of spotIds.entries()) {
      await query(
        `insert into restro.spots
           (id, tenant_id, venue_id, plan_id, name, kind, x, y, width, height, table_id,
            source, actor, job_id)
         values ($1, $2, $3, $4, $5, 'booth', 10, 20, 60, 40, $6, $7, $8, $9)`,
        [
          spotId,
          tenantId,
          venueId,
          planId,
          `Booth ${index + 1}`,
          index === 0 ? table.table.id : null,
          ...SEED,
        ],
      )
    }

    // Two guest records with their details, and a manager's private note about one of them.
    const guestIds = [newId('gu'), newId('gu')]
    for (const [index, guestId] of guestIds.entries()) {
      await query(
        `insert into restro.guests
           (id, tenant_id, venue_id, phone_key, name, phone, email, is_regular,
            source, actor, job_id)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [
          guestId,
          tenantId,
          venueId,
          `35988800000${index}`,
          `Guest ${index + 1}`,
          `+35988800000${index}`,
          `guest${index + 1}@example.test`,
          index === 0,
          ...SEED,
        ],
      )
    }
    await query(
      `insert into restro.guest_private_notes
         (tenant_id, venue_id, guest_id, staff_member_id, note, source, actor, job_id)
       values ($1, $2, $3, $4, 'Always asks for the corner booth', $5, $6, $7)`,
      [tenantId, venueId, guestIds[0], staffId, ...SEED],
    )

    // A booking on a guest, a walk-in on the waiting list, and a block: all three kinds, and the
    // holds they have on the spots.
    const booking = newId('rv')
    const walkIn = newId('rv')
    const block = newId('rv')
    await query(
      `insert into restro.reservations
         (id, tenant_id, venue_id, service_date, starts_at, kind, status, party_size, guest_id,
          made_by, note, source, actor, job_id)
       values ($1, $2, $3, $4, now(), 'booking', 'reserved', 4, $5, $6, 'Birthday', $7, $8, $9)`,
      [booking, tenantId, venueId, NIGHT, guestIds[0], staffId, ...SEED],
    )
    await query(
      `insert into restro.reservations
         (id, tenant_id, venue_id, service_date, starts_at, kind, status, party_size, queue_key,
          party_label, source, actor, job_id)
       values ($1, $2, $3, $4, now(), 'walk_in', 'waiting', 2, 'a0', 'Ivan', $5, $6, $7)`,
      [walkIn, tenantId, venueId, NIGHT, ...SEED],
    )
    await query(
      `insert into restro.reservations
         (id, tenant_id, venue_id, service_date, starts_at, kind, status, reason,
          source, actor, job_id)
       values ($1, $2, $3, $4, now(), 'block', 'reserved', 'private_event', $5, $6, $7)`,
      [block, tenantId, venueId, NIGHT, ...SEED],
    )
    for (const [reservationId, spotId] of [
      [booking, spotIds[0]],
      [block, spotIds[1]],
    ] as const) {
      await query(
        `insert into restro.reservation_spots
           (tenant_id, reservation_id, spot_id, held_from, source, actor, job_id)
         values ($1, $2, $3, now(), $4, $5, $6)`,
        [tenantId, reservationId, spotId, ...SEED],
      )
    }

    // The Log names the reservation and the guest (0046 added both columns).
    await query(
      `insert into restro.log_entries
         (tenant_id, venue_id, service_date, kind, retention, details, reservation_id, guest_id,
          source, actor, job_id)
       values ($1, $2, $3, 'reservation.made', 'night', '{}'::jsonb, $4, $5, 'staff', $6, $7)`,
      [tenantId, venueId, NIGHT, booking, guestIds[0], SEED[1], SEED[2]],
    )

    await query(`update restro.venues set archived_at = now() - interval '31 days' where id = $1`, [
      venueId,
    ])
  })

  afterAll(async () => {
    await purgePool?.end()
    await pool?.end()
    await db?.drop()
  })

  it('takes every reservation row with the venue, and counts them in the purge log', async () => {
    // Every one of the nine has rows before the purge: a test that passed on an empty database
    // would prove nothing.
    for (const table of RESERVATION_TABLES) {
      const before = await query(`select 1 from restro.${table} where tenant_id = $1`, [tenantId])
      expect(before.length, `${table} before the purge`).toBeGreaterThan(0)
    }

    const root = await mkdtemp(path.join(tmpdir(), 'restro-purge-reservations-'))
    let result: Awaited<ReturnType<typeof purgeVenue>>
    try {
      const store = new LocalPublishStore({ rootDir: root })
      result = await purgeVenue({ purgePool, pool, store }, { tenantId, venueId })
    } finally {
      await rm(root, { recursive: true, force: true })
    }
    expect(result.status).toBe('purged')

    for (const table of RESERVATION_TABLES) {
      expect(
        await query(`select 1 from restro.${table} where tenant_id = $1`, [tenantId]),
        `${table} after the purge`,
      ).toEqual([])
    }
    expect(await query('select 1 from restro.venues where id = $1', [venueId])).toEqual([])
    // The staff member is the organisation's, not the venue's: the staff step lets her go.
    expect(await query('select 1 from restro.staff_members where id = $1', [staffId])).not.toEqual(
      [],
    )

    const [logged] = await query<{ counts: Record<string, number> }>(
      `select counts from restro.purge_log where kind = 'venue' and subject_id = $1`,
      [venueId],
    )
    expect(logged?.counts).toMatchObject({
      reservation_spots: 2,
      guest_private_notes: 1,
      reservations: 3,
      spots: 2,
      floor_plans: 1,
      venue_spot_kinds: 1,
      guests: 2,
      reservation_settings: 1,
      reservation_nights: 1,
    })
  })

  it('accounts for every table that hangs off a venue, and reports one it has not seen', async () => {
    const reachable = (await query<{ name: string }>(VENUE_TABLE_CLOSURE)).map((row) => row.name)
    // The query itself must work: the reservations tables are in the closure, `reservation_spots`
    // (which carries no venue_id) through its reservation.
    expect(reachable).toEqual(expect.arrayContaining([...RESERVATION_TABLES]))
    expect(reachable.length).toBeGreaterThan(30)
    expect(venueTablesNotAccountedFor(reachable)).toEqual([])
    // Named, not deleted from a list: the guard fails loudly on a table it has never seen.
    expect(venueTablesNotAccountedFor([...reachable, 'reservation_courses'])).toEqual([
      'reservation_courses',
    ])
  })
})
