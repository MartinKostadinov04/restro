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

/**
 * The scenes: a night as it runs, the same with the owner's switch on for the past, and the same
 * with the club's pay-first settings set, so the pay rule a party carries has a table's own rule
 * above it (#334).
 */
export const RESERVATION_SCENES = ['book', 'book-past-open', 'book-pay-rule'] as const
export type ReservationScene = (typeof RESERVATION_SCENES)[number]

/** The tables this fixture writes, cleared newest-dependency-first before each run. */
const OWNED = [
  'log_entries',
  'reservation_spots',
  'reservations',
  'reservation_nights',
  'guest_private_notes',
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
  /** The blocked spot of the plan, and the reason it carries (#327). */
  blocked: 'Маса 8',
  blockedReason: 'repair',
  /** A name too long for a spot at 390 px: it clips there and reads whole in the sheet. */
  longName: 'Бар 12 вляво',
  /** A spot that is not a table, so it is never offered a phone code (D134, log 1.68). */
  standing: 'Правостоящи до сцената',
  /** A kind the plan does not offer as a filter, to prove `filters` is honoured. */
  counter: 'Бар плот',
  phone: '+359888123456',
  /** The guest record's key: digits only, as the guests table keeps it (D140). */
  phoneKey: '359888123456',
  note: 'Торта в 01:00',
} as const

/** The club's one regular on the venue's list (#333): three letters of the name suggest him. */
export const REGULAR = {
  name: 'Стефан Редовен',
  phone: '+359 888 777 100',
  phoneKey: '359888777100',
} as const

/** The club's two plans, so the spec can pick the one it means (D134, log 1.28). */
export const PLANS = { main: 'Основна зала', terrace: 'Тераса' } as const

/**
 * The club's own spot kinds: key, the word staff read, its legend symbol, whether the plan offers
 * it as a filter, its default seats and its place in the list. `Бар` does not filter, so a kind
 * left out of the filter bar is covered too.
 */
export const PLAN_KINDS = [
  ['table', 'Маси', 'table', true, 4, 'a0'],
  ['booth', 'Сепарета', 'booth', true, 6, 'a1'],
  ['stool', 'Бар столове', 'stool', true, 1, 'a2'],
  ['standing', 'Правостоящи', 'standing', true, null, 'a3'],
  ['counter', 'Бар', 'counter', false, null, 'a4'],
] as const satisfies readonly (readonly [string, string, string, boolean, number | null, string])[]

export async function seedReservationsNight(
  world: ReservationsWorld,
  scene: ReservationScene = 'book',
): Promise<SeededNights> {
  const { owner, tenantId, venueId, day, timezone, staffId } = world
  for (const table of OWNED) {
    if (table === 'log_entries') {
      await owner.query(
        `delete from restro.log_entries
         where tenant_id = $1 and (reservation_id is not null or guest_id is not null)`,
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

  // The club's floor (#327): two plans, so the picker has something to pick, and the club's own
  // spot kinds, each with its legend symbol, whether the plan filters by it and its default seats
  // — D134 gives a kind those three and no rule beyond them.
  const planId = newId('fp')
  const otherPlanId = newId('fp')
  for (const [id, name, current] of [
    [planId, PLANS.main, true],
    [otherPlanId, PLANS.terrace, false],
  ] as const) {
    await owner.query(
      `insert into restro.floor_plans (id, tenant_id, venue_id, name, is_current, source, actor, job_id)
       values ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [id, tenantId, venueId, name, current, ...SEED],
    )
  }
  for (const [key, label, symbol, filters, seats, sortKey] of PLAN_KINDS) {
    await owner.query(
      `insert into restro.venue_spot_kinds
         (tenant_id, venue_id, key, label, symbol, filters, default_seats, sort_key,
          source, actor, job_id)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [tenantId, venueId, key, label, symbol, filters, seats, sortKey, ...SEED],
    )
  }

  // A Table for the first spot, so its sheet can say which Table orders go onto (rule 3: our own
  // id, never a code). A club's bar stools have none, which is the point of the pair.
  const firstTable = (
    await owner.query<{ id: string }>(
      `select id from restro.tables where tenant_id = $1 and archived_at is null
       order by number limit 1`,
      [tenantId],
    )
  ).rows[0]?.id

  // #334: the pay-rule scene gives the club the house rule a club runs on — everything on the
  // bill — and gives the one spot that has a Table a rule of its own, which is what beats the rule
  // a party carries (D122 §5). Every other scene leaves the venue with no pay-first settings at
  // all, which is how every other spec has always found it.
  if (scene === 'book-pay-rule') {
    await owner.query(`update restro.venues set settings = settings || $2::jsonb where id = $1`, [
      venueId,
      JSON.stringify({
        payFirst: {
          itemMode: 'on_bill',
          applies: false,
          groups: {},
          tables: firstTable === undefined ? {} : { [firstTable]: true },
        },
      }),
    ])
  } else {
    await owner.query(`update restro.venues set settings = settings - 'payFirst' where id = $1`, [
      venueId,
    ])
  }

  /** One spot of the plan: a shape out of the folder and whole numbers, as #327 checks them. */
  const spot = async (one: {
    name: string
    kind: string
    shape: string
    x: number
    y: number
    width: number
    height: number
    rotation?: number
    seats?: number | null
    tableId?: string | null
    planId?: string
  }): Promise<string> => {
    const id = newId('sp')
    await owner.query(
      `insert into restro.spots
         (id, tenant_id, venue_id, plan_id, name, kind, shape, x, y, width, height, rotation,
          seats, table_id, source, actor, job_id)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)`,
      [
        id,
        tenantId,
        venueId,
        one.planId ?? planId,
        one.name,
        one.kind,
        one.shape,
        one.x,
        one.y,
        one.width,
        one.height,
        one.rotation ?? 0,
        one.seats ?? null,
        one.tableId ?? null,
        ...SEED,
      ],
    )
    return id
  }
  const table7 = await spot({
    name: BOOK.spot,
    kind: 'table',
    shape: 'rect',
    x: 40,
    y: 40,
    width: 80,
    height: 80,
    seats: 4,
    tableId: firstTable ?? null,
  })
  const booth1 = await spot({
    name: BOOK.booth,
    kind: 'booth',
    shape: 'booth',
    x: 160,
    y: 40,
    width: 120,
    height: 80,
    seats: 6,
  })
  const table8 = await spot({
    name: BOOK.blocked,
    kind: 'table',
    shape: 'circle',
    x: 320,
    y: 40,
    width: 80,
    height: 80,
    seats: 2,
  })
  await spot({
    name: 'Маса 9',
    kind: 'table',
    shape: 'rect',
    x: 440,
    y: 40,
    width: 80,
    height: 80,
    rotation: 15,
  })
  await spot({
    name: BOOK.longName,
    kind: 'stool',
    shape: 'circle',
    x: 40,
    y: 180,
    width: 40,
    height: 40,
  })
  await spot({
    name: 'Бар 13',
    kind: 'stool',
    shape: 'circle',
    x: 100,
    y: 180,
    width: 40,
    height: 40,
  })
  await spot({
    name: BOOK.standing,
    kind: 'standing',
    shape: 'pill',
    x: 180,
    y: 170,
    width: 220,
    height: 60,
  })
  await spot({
    name: BOOK.counter,
    kind: 'counter',
    shape: 'pill',
    x: 440,
    y: 180,
    width: 80,
    height: 240,
  })
  // The second plan has a spot of its own, so picking it changes what is drawn.
  await spot({
    name: 'Тераса 1',
    kind: 'table',
    shape: 'rect',
    x: 40,
    y: 40,
    width: 100,
    height: 70,
    planId: otherPlanId,
  })

  // One guest record, because a telephone number lives in exactly one place (D140).
  const guestId = newId('gu')
  await owner.query(
    `insert into restro.guests
       (id, tenant_id, venue_id, phone_key, name, phone, email, source, actor, job_id)
     values ($1, $2, $3, $4, $5, $6, 'ivanova@example.test', $7, $8, $9)`,
    [guestId, tenantId, venueId, BOOK.phoneKey, BOOK.late, BOOK.phone, ...SEED],
  )
  // One regular, for the booking form's suggestion and the guest's card (#333).
  await owner.query(
    `insert into restro.guests
       (id, tenant_id, venue_id, phone_key, name, phone, is_regular, source, actor, job_id)
     values ($1, $2, $3, $4, $5, $6, true, $7, $8, $9)`,
    [newId('gu'), tenantId, venueId, REGULAR.phoneKey, REGULAR.name, REGULAR.phone, ...SEED],
  )
  // A private list is kept by a staff member signed in as themselves (D140): the owner gets a
  // staff record of their own, with no role here (an owner holds everything anyway).
  const ownerUser = (
    await owner.query<{ id: string }>(
      `select u.id from restro.auth_user u
         join restro.auth_member m on m.user_id = u.id
       where m.organization_id = $1 and m.role = 'owner'
       limit 1`,
      [tenantId],
    )
  ).rows[0]?.id
  if (ownerUser !== undefined) {
    await owner.query(
      `insert into restro.staff_members (id, tenant_id, display_name, user_id, source, actor, job_id)
       select $1, $2, 'Tonight Owner', $3, $4, $5, $6
       where not exists (
         select 1 from restro.staff_members where tenant_id = $2 and user_id = $3
       )`,
      [newId('sm'), tenantId, ownerUser, ...SEED],
    )
  }

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

  // One spot kept out of use (#327, D137): a block of the club's own, with its reason and no end
  // — it stays on until somebody lifts it, which is what the plan's Unblock does.
  const blockId = newId('rv')
  await owner.query(
    `insert into restro.reservations
       (id, tenant_id, venue_id, service_date, starts_at, ends_at, kind, status, party_size,
        reason, made_by, source, actor, job_id)
     values ($1, $2, $3, $4, now() - interval '3 hours', null, 'block', 'reserved', null,
             $5, $6, 'staff', $7, 'e2e-seed')`,
    [blockId, tenantId, venueId, day, BOOK.blockedReason, staffId, `staff:${staffId}`],
  )
  await owner.query(
    `insert into restro.reservation_spots
       (tenant_id, reservation_id, spot_id, held_from, held_to, source, actor, job_id)
     values ($1, $2, $3, now() - interval '3 hours', null, 'staff', $4, 'e2e-seed')`,
    [tenantId, blockId, table8, `staff:${staffId}`],
  )

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
    details: Record<string, string> = {},
  ) => {
    await owner.query(
      `insert into restro.log_entries
         (tenant_id, venue_id, at, service_date, kind, reservation_id, from_state, to_state,
          details, retention, source, actor, job_id)
       values ($1, $2, now() - make_interval(mins => $3), $4, $5, $6, $7, $8, $9::jsonb, 'record',
               'staff', $10, 'e2e-seed')`,
      [
        tenantId,
        venueId,
        minutesAgo,
        day,
        kind,
        reservationId,
        fromState,
        toState,
        JSON.stringify(details),
        `staff:${staffId}`,
      ],
    )
  }
  await line(late, 'reservation.created', null, 'reserved', 300)
  await line(late, 'reservation.spots', null, 'held', 290, { spots: table7 })
  await line(late, 'reservation.changed', 'reserved', 'reserved', 120)
  await line(seated, 'reservation.created', null, 'seated', 95)
  await line(seated, 'reservation.status', 'waiting', 'seated', 85)
  // The block's own two lines, so a spot's history (#327) has something to show.
  await line(blockId, 'reservation.created', null, 'reserved', 180, {
    spots: table8,
    reason: BOOK.blockedReason,
  })
  await line(blockId, 'reservation.spots', null, 'held', 180, { spots: table8 })

  return { day, before }
}
