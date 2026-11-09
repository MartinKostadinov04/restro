// The reservations fixture of the Tonight test club (#326): one night's book as the service paths
// leave it, a night that has passed, and the Log entries one reservation's history is made of.
// Raw SQL on the reservation tables, so it lives under `e2e/` like the payment fixture does (the
// write-target guard skips such folders); `../seed-tonight-e2e.ts` calls it with its own pool.
//
// It owns its own rows: every run clears the club's reservations and starts the night again, so no
// story inherits another's. Nothing here is a Restro write path — a fixture is not app code.
import { newId } from '@restro/core'
import type pg from 'pg'

/** What the scene needs of the fixture. */
export interface ReservationsWorld {
  readonly owner: pg.Pool
  readonly tenantId: string
  readonly venueId: string
  /** The venue's current service day, as the fixture's own clock reads it. */
  readonly day: string
  /** The venue's time zone, so a night's hours are the club's own. */
  readonly timezone: string
  /** A staff member of the club, to name in the Log (`sm_`). */
  readonly staffId: string
}

/** The two nights a scene writes, so the spec can ask for them by name. */
export interface SeededNights {
  /** The venue's current service day, the night the book is set for. */
  readonly day: string
  /** The night before it, which holds one finished booking and reads as a record. */
  readonly before: string
}

/** The scenes: a night as it runs, and the same with the owner's switch on for the past. */
export const RESERVATION_SCENES = ['book', 'book-past-open'] as const
export type ReservationScene = (typeof RESERVATION_SCENES)[number]

/** The tables this fixture writes, cleared newest-dependency-first before each run. */
const OWNED = [
  'log_entries',
  'reservation_spots',
  'reservations',
  'reservation_nights',
  'guests',
  'spots',
  'floor_plans',
  'venue_spot_kinds',
  'reservation_settings',
] as const

const SEED = ['restro', 'system', 'e2e-seed'] as const

/** The names on the book, so the spec and the fixture say the same thing. */
export const BOOK = {
  late: 'Иванова',
  coming: 'Димитров',
  seated: 'Петров',
  undone: 'Георгиев',
  passed: 'Тодорова',
  spot: 'Маса 7',
  booth: 'Сепаре 1',
  phone: '+359888123456',
  /** The guest record's key: digits only, as the guests table keeps it (D140). */
  phoneKey: '359888123456',
  note: 'Торта в 01:00',
} as const

export async function seedReservationsNight(
  world: ReservationsWorld,
  scene: ReservationScene = 'book',
): Promise<SeededNights> {
  const { owner, tenantId, venueId, day, timezone, staffId } = world
  for (const table of OWNED) {
    if (table === 'log_entries') {
      await owner.query(
        `delete from restro.log_entries where tenant_id = $1 and reservation_id is not null`,
        [tenantId],
      )
    } else {
      await owner.query(`delete from restro.${table} where tenant_id = $1`, [tenantId])
    }
  }

  // The venue's one turn time (D135), and the owner's switch for correcting a night that passed.
  await owner.query(
    `insert into restro.reservation_settings
       (tenant_id, venue_id, turn_minutes, edit_past_nights, source, actor, job_id)
     values ($1, $2, 120, $3, $4, $5, $6)`,
    [tenantId, venueId, scene === 'book-past-open', ...SEED],
  )

  // A plan with two spots, so a row can show what it holds (the plan itself is #327).
  const planId = newId('fp')
  await owner.query(
    `insert into restro.floor_plans (id, tenant_id, venue_id, name, is_current, source, actor, job_id)
     values ($1, $2, $3, 'Основна зала', true, $4, $5, $6)`,
    [planId, tenantId, venueId, ...SEED],
  )
  await owner.query(
    `insert into restro.venue_spot_kinds (tenant_id, venue_id, key, label, default_seats, source, actor, job_id)
     values ($1, $2, 'table', 'Маса', 4, $3, $4, $5)`,
    [tenantId, venueId, ...SEED],
  )
  const spot = async (name: string, x: number): Promise<string> => {
    const id = newId('sp')
    await owner.query(
      `insert into restro.spots
         (id, tenant_id, venue_id, plan_id, name, kind, x, y, width, height, seats,
          source, actor, job_id)
       values ($1, $2, $3, $4, $5, 'table', $6, 40, 80, 80, 4, $7, $8, $9)`,
      [id, tenantId, venueId, planId, name, x, ...SEED],
    )
    return id
  }
  const table7 = await spot(BOOK.spot, 40)
  const booth1 = await spot(BOOK.booth, 160)

  // One guest record, because a telephone number lives in exactly one place (D140).
  const guestId = newId('gu')
  await owner.query(
    `insert into restro.guests
       (id, tenant_id, venue_id, phone_key, name, phone, email, source, actor, job_id)
     values ($1, $2, $3, $4, $5, $6, 'ivanova@example.test', $7, $8, $9)`,
    [guestId, tenantId, venueId, BOOK.phoneKey, BOOK.late, BOOK.phone, ...SEED],
  )

  /** One line of the book. `at` is an interval from now, or an hour of the service day. */
  const reservation = async (one: {
    serviceDate: string
    starts: string
    kind: 'booking' | 'walk_in'
    status: string
    partySize: number
    label?: string | null
    guest?: boolean
    note?: string | null
    reason?: string | null
    seated?: string | null
    ended?: string | null
    spots?: readonly string[]
  }): Promise<string> => {
    const id = newId('rv')
    await owner.query(
      `insert into restro.reservations
         (id, tenant_id, venue_id, service_date, starts_at, ends_at, kind, status, party_size,
          guest_id, party_label, note, reason, made_by, seated_at, ended_at,
          source, actor, job_id)
       values ($1, $2, $3, $4, ${one.starts}, ${one.starts} + interval '120 minutes', $5, $6, $7,
               $8, $9, $10, $11, $12, ${one.seated ?? 'null'}, ${one.ended ?? 'null'},
               'staff', $13, 'e2e-seed')`,
      [
        id,
        tenantId,
        venueId,
        one.serviceDate,
        one.kind,
        one.status,
        one.partySize,
        one.guest === true ? guestId : null,
        one.guest === true ? null : (one.label ?? null),
        one.note ?? null,
        one.reason ?? null,
        staffId,
        `staff:${staffId}`,
      ],
    )
    for (const spotId of one.spots ?? []) {
      await owner.query(
        `insert into restro.reservation_spots
           (tenant_id, reservation_id, spot_id, held_from, held_to, source, actor, job_id)
         values ($1, $2, $3, ${one.starts}, ${one.starts} + interval '120 minutes', 'staff', $4,
                 'e2e-seed')`,
        [tenantId, id, spotId, `staff:${staffId}`],
      )
    }
    return id
  }

  /** An hour of the service day in the venue's own zone. */
  const hourOf = (date: string, hour: string) =>
    `(timestamp '${date} ${hour}' at time zone '${timezone}')`

  // Tonight, in arrival order. The late one is past its hour with nobody there (nothing is freed
  // by itself); the cancelled one is the club's own undo of a mis-tapped walk-in (#329).
  const seated = await reservation({
    serviceDate: day,
    starts: `now() - interval '90 minutes'`,
    kind: 'walk_in',
    status: 'seated',
    partySize: 2,
    label: BOOK.seated,
    seated: `now() - interval '85 minutes'`,
    spots: [booth1],
  })
  const late = await reservation({
    serviceDate: day,
    starts: `now() - interval '40 minutes'`,
    kind: 'booking',
    status: 'reserved',
    partySize: 4,
    guest: true,
    note: BOOK.note,
    spots: [table7],
  })
  await reservation({
    serviceDate: day,
    starts: `now() + interval '90 minutes'`,
    kind: 'booking',
    status: 'reserved',
    partySize: 6,
    label: BOOK.coming,
  })
  await reservation({
    serviceDate: day,
    starts: `now() - interval '20 minutes'`,
    kind: 'walk_in',
    status: 'cancelled',
    partySize: 3,
    label: BOOK.undone,
    reason: 'arrival_undone',
    ended: `now() - interval '18 minutes'`,
  })

  // The night before, so the day button has somewhere to go and it reads as a record.
  const before = (await owner.query<{ day: string }>(`select ($1::date - 1)::text as day`, [day]))
    .rows[0]?.day as string
  await reservation({
    serviceDate: before,
    starts: hourOf(before, '22:00'),
    kind: 'booking',
    status: 'finished',
    partySize: 5,
    label: BOOK.passed,
    seated: hourOf(before, '22:05'),
    ended: hourOf(before, '23:50'),
  })

  // One reservation's history, in the one Log (D141): taken, then its spot held, then changed.
  const line = async (
    reservationId: string,
    kind: string,
    fromState: string | null,
    toState: string | null,
    minutesAgo: number,
  ) => {
    await owner.query(
      `insert into restro.log_entries
         (tenant_id, venue_id, at, service_date, kind, reservation_id, from_state, to_state,
          retention, source, actor, job_id)
       values ($1, $2, now() - make_interval(mins => $3), $4, $5, $6, $7, $8, 'record', 'staff',
               $9, 'e2e-seed')`,
      [
        tenantId,
        venueId,
        minutesAgo,
        day,
        kind,
        reservationId,
        fromState,
        toState,
        `staff:${staffId}`,
      ],
    )
  }
  await line(late, 'reservation.created', null, 'reserved', 300)
  await line(late, 'reservation.spots', null, 'held', 290)
  await line(late, 'reservation.changed', 'reserved', 'reserved', 120)
  await line(seated, 'reservation.created', null, 'seated', 95)
  await line(seated, 'reservation.status', 'waiting', 'seated', 85)

  return { day, before }
}
