// Fixtures for the Tonight screen's end-to-end test (#85). Run by the test itself:
//
//   seed              an organisation "Tonight Club" of its own with one venue, six tables in two
//                     bars (Main bar: 1-3, Second bar: 4-6), the Staff and Manager roles, and the
//                     people the screen is tried by: an owner, a waiter with a phone (a staff member
//                     with a sign-in), the bar tablet's account (a plain member; the test marks its
//                     session a shared device), and two people with PINs (Maria, Staff, 1234;
//                     Georgi, Manager, 4321). Idempotent; ends with a clean night (see `night`).
//   night <name>      resets the night, then sets the scene (see NIGHTS below).
//   call <table>      a guest at the open table (its number) calls a waiter, as the phone's tap does.
//   device <email>    marks the newest session of the account a shared device of the venue, as the
//                     owner's "mark this device" would.
//
// Everything is written the way the service paths write it, as the database owner (the screen
// under test is the only thing that should use the app role). Like `db:seed:dev` this refuses to
// run unless NODE_ENV is development and the database is on this machine. The PIN pepper is the
// test servers' (STAFF_PIN_PEPPER).
import { createHmac } from 'node:crypto'

import { newId, serviceDate } from '@restro/core'
import { createArea, createTable, provisionVenue } from '@restro/core/apply'
import { authMember, authOrganization, venues, withTenant } from '@restro/db'
import { and, eq } from 'drizzle-orm'
import pg from 'pg'

import { createAuth } from '../src/server/auth'
import { getAuthDb, getPool } from '../src/server/db'
import { authModelId } from '../src/server/ids'
import { assertDevEnvironment, readAdminCredentials } from './lib/guard'

const ORGANIZATION = { name: 'Tonight Club', slug: 'tonight-club' }
const VENUE = { name: 'Tonight Club Sofia', slug: 'tonight-club' }
const EMAILS = {
  owner: 'tonight-owner@demo-club.test',
  waiter: 'tonight-waiter@demo-club.test',
  tablet: 'tonight-tablet@demo-club.test',
} as const
const SEED = ['restro', 'system', 'e2e-seed'] as const
const STAFF_PERMISSIONS = [
  'tables.open_close',
  'tables.resume',
  'ordering.pause',
  'alerts.answer',
  'night.view',
]
const MANAGER_PERMISSIONS = [
  ...STAFF_PERMISSIONS,
  'ordering.lift',
  'sold_out',
  'log.view',
  'night.view_full',
  'money.follow_up',
]

async function ensureUser(
  auth: ReturnType<typeof createAuth>,
  email: string,
  name: string,
  password: string,
): Promise<string> {
  const context = await auth.$context
  const hash = await context.password.hash(password)
  const existing = await context.internalAdapter.findUserByEmail(email)
  if (existing) {
    await context.internalAdapter.updatePassword(existing.user.id, hash)
    return existing.user.id
  }
  const user = await context.internalAdapter.createUser(
    { email, name, emailVerified: true },
    { method: 'admin' },
  )
  await context.internalAdapter.linkAccount({
    userId: user.id,
    providerId: 'credential',
    accountId: user.id,
    password: hash,
  })
  return user.id
}

function ownerPool(): pg.Pool {
  const url = process.env.DATABASE_URL_OWNER
  if (!url) throw new Error('seed-tonight-e2e needs DATABASE_URL_OWNER (see .env.example).')
  assertDevEnvironment({ ...process.env, DATABASE_URL: url })
  return new pg.Pool({ connectionString: url, max: 1 })
}

function pinHmac(tenantId: string, pin: string): string {
  const pepper = process.env.STAFF_PIN_PEPPER
  if (!pepper) throw new Error('seed-tonight-e2e needs STAFF_PIN_PEPPER (the test servers’).')
  return createHmac('sha256', pepper).update(`${tenantId}|${pin}`).digest('hex')
}

async function target(): Promise<{ tenantId: string; venueId: string }> {
  const [organization] = await getAuthDb()
    .select({ id: authOrganization.id })
    .from(authOrganization)
    .where(eq(authOrganization.slug, ORGANIZATION.slug))
    .limit(1)
  if (!organization) throw new Error('Run the `seed` step first: there is no Tonight Club.')
  const [venue] = await withTenant(getPool(), organization.id, (tx) =>
    tx.select({ id: venues.id }).from(venues).where(eq(venues.slug, VENUE.slug)).limit(1),
  )
  if (!venue) throw new Error('Run the `seed` step first: there is no venue.')
  return { tenantId: organization.id, venueId: venue.id }
}

async function tableIds(owner: pg.Pool, tenantId: string): Promise<Record<string, string>> {
  const rows = await owner.query<{ id: string; number: string }>(
    'select id, number from restro.tables where tenant_id = $1 and archived_at is null',
    [tenantId],
  )
  return Object.fromEntries(rows.rows.map((row) => [row.number, row.id]))
}

async function seed(): Promise<void> {
  const owner = ownerPool()
  const { password } = readAdminCredentials(process.env)
  const auth = createAuth({ scripts: true })
  const db = getAuthDb()
  try {
    const ownerId = await ensureUser(auth, EMAILS.owner, 'Tonight Owner', password)
    const waiterId = await ensureUser(auth, EMAILS.waiter, 'Tonight Waiter', password)
    const tabletId = await ensureUser(auth, EMAILS.tablet, 'Bar Tablet', password)

    const [found] = await db
      .select({ id: authOrganization.id })
      .from(authOrganization)
      .where(eq(authOrganization.slug, ORGANIZATION.slug))
      .limit(1)
    const tenantId =
      found?.id ??
      (
        await auth.api.createOrganization({
          body: { name: ORGANIZATION.name, slug: ORGANIZATION.slug, userId: ownerId },
        })
      ).id
    for (const [userId, role] of [
      [ownerId, 'owner'],
      [waiterId, 'member'],
      [tabletId, 'member'],
    ] as const) {
      const [membership] = await db
        .select({ id: authMember.id })
        .from(authMember)
        .where(and(eq(authMember.organizationId, tenantId), eq(authMember.userId, userId)))
        .limit(1)
      if (!membership) {
        await db
          .insert(authMember)
          .values({ id: authModelId('member'), organizationId: tenantId, userId, role })
      } else {
        await db.update(authMember).set({ role }).where(eq(authMember.id, membership.id))
      }
    }

    const pool = getPool()
    let [venue] = await withTenant(pool, tenantId, (tx) =>
      tx.select({ id: venues.id }).from(venues).where(eq(venues.slug, VENUE.slug)).limit(1),
    )
    if (!venue) {
      await provisionVenue(pool, tenantId, { name: VENUE.name, slug: VENUE.slug })
      ;[venue] = await withTenant(pool, tenantId, (tx) =>
        tx.select({ id: venues.id }).from(venues).where(eq(venues.slug, VENUE.slug)).limit(1),
      )
    }
    if (!venue) throw new Error('the venue was not made')
    const venueId = venue.id

    // Tables: six, in a hall of their own, two bars.
    if (Object.keys(await tableIds(owner, tenantId)).length === 0) {
      const area = await createArea(pool, tenantId, venueId, 'Hall')
      if (!area.ok) throw new Error(`area refused: ${JSON.stringify(area)}`)
      for (const number of ['1', '2', '3', '4', '5', '6']) {
        const table = await createTable(pool, tenantId, {
          areaId: area.area.id,
          name: null,
          number,
        })
        if (!table.ok) throw new Error(`table refused: ${JSON.stringify(table)}`)
      }
    }
    const bars = await owner.query<{ id: string; name: string }>(
      'select id, name from restro.bars where venue_id = $1',
      [venueId],
    )
    const barId: Record<string, string> = Object.fromEntries(
      bars.rows.map((row) => [row.name, row.id]),
    )
    for (const name of ['Main bar', 'Second bar']) {
      if (barId[name] !== undefined) continue
      barId[name] = newId('br')
      await owner.query(
        `insert into restro.bars (id, tenant_id, venue_id, name, source_key)
         values ($1, $2, $3, $4, $5)`,
        [barId[name], tenantId, venueId, name, name.toLowerCase().replace(' ', '-')],
      )
    }
    const tables = await tableIds(owner, tenantId)
    for (const [number, bar] of [
      ['1', 'Main bar'],
      ['2', 'Main bar'],
      ['3', 'Main bar'],
      ['4', 'Second bar'],
      ['5', 'Second bar'],
      ['6', 'Second bar'],
    ] as const) {
      await owner.query('update restro.tables set bar_id = $1 where id = $2', [
        barId[bar],
        tables[number],
      ])
    }

    // Roles and people.
    const roles: Record<'staff' | 'manager', string> = { staff: '', manager: '' }
    for (const [kind, permissions] of [
      ['staff', STAFF_PERMISSIONS],
      ['manager', MANAGER_PERMISSIONS],
    ] as const) {
      const [existing] = (
        await owner.query<{ id: string }>(
          'select id from restro.venue_roles where venue_id = $1 and default_kind = $2',
          [venueId, kind],
        )
      ).rows
      roles[kind] = existing?.id ?? newId('rl')
      if (existing === undefined) {
        await owner.query(
          `insert into restro.venue_roles
             (id, tenant_id, venue_id, name, permissions, default_kind, source, actor, job_id)
           values ($1, $2, $3, $4, $5::jsonb, $6, $7, $8, $9)`,
          [
            roles[kind],
            tenantId,
            venueId,
            kind === 'staff' ? 'Staff' : 'Manager',
            JSON.stringify(permissions),
            kind,
            ...SEED,
          ],
        )
      }
    }
    for (const person of [
      { name: 'Maria', role: roles.staff, pin: '1234', userId: null },
      { name: 'Georgi', role: roles.manager, pin: '4321', userId: null },
      { name: 'Tonight Waiter', role: roles.staff, pin: null, userId: waiterId },
    ]) {
      const [existing] = (
        await owner.query<{ id: string }>(
          'select id from restro.staff_members where tenant_id = $1 and display_name = $2',
          [tenantId, person.name],
        )
      ).rows
      if (existing !== undefined) continue
      const id = newId('sm')
      await owner.query(
        `insert into restro.staff_members
           (id, tenant_id, display_name, user_id, pin_hmac, pin_sealed, pin_set_at, source, actor, job_id)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [
          id,
          tenantId,
          person.name,
          person.userId,
          person.pin === null ? null : pinHmac(tenantId, person.pin),
          // The sealed copy only the worker opens (the screen never shows a PIN): a stand-in.
          person.pin === null ? null : 'e2e-sealed-stand-in',
          person.pin === null ? null : new Date(),
          ...SEED,
        ],
      )
      await owner.query(
        `insert into restro.staff_assignments
           (tenant_id, staff_member_id, venue_id, role_id, source, actor, job_id)
         values ($1, $2, $3, $4, $5, $6, $7)`,
        [tenantId, id, venueId, person.role, ...SEED],
      )
    }
    await night('empty')
    console.log(
      JSON.stringify({ level: 'info', event: 'seed_tonight_e2e_done', tenantId, venueId }),
    )
  } finally {
    await owner.end()
  }
}

/** The service rows of the night, emptied (children first). */
const NIGHT_TABLES = [
  'sent_order_notes',
  'log_entries',
  'locks',
  'bill_readings',
  'waiter_calls',
  'alerts',
  'pauses',
  'service_days',
  'sent_orders',
  'table_orders',
  'sittings',
] as const

/** What each night puts on the screen. */
const NIGHTS = ['empty', 'busy', 'bar-paused', 'restro-paused', 'many'] as const

async function night(name: string): Promise<void> {
  if (!(NIGHTS as readonly string[]).includes(name)) {
    throw new Error(`unknown night "${name}" (${NIGHTS.join(', ')})`)
  }
  const { tenantId, venueId } = await target()
  const owner = ownerPool()
  try {
    for (const table of NIGHT_TABLES) {
      await owner.query(`delete from restro.${table} where tenant_id = $1`, [tenantId])
    }
    const [venue] = await withTenant(getPool(), tenantId, (tx) =>
      tx.select().from(venues).where(eq(venues.id, venueId)),
    )
    if (!venue) throw new Error('the venue went missing')
    const day = serviceDate(new Date(), venue.timezone, venue.serviceDayEndsAt)
    const tables = await tableIds(owner, tenantId)
    const barOf = async (number: string) =>
      (
        await owner.query<{ bar_id: string }>('select bar_id from restro.tables where id = $1', [
          tables[number],
        ])
      ).rows[0]?.bar_id as string
    const mariaId = (
      await owner.query<{ id: string }>(
        `select id from restro.staff_members where tenant_id = $1 and display_name = 'Maria'`,
        [tenantId],
      )
    ).rows[0]?.id as string

    const sitting = async (number: string): Promise<string> => {
      const id = newId('st')
      await owner.query(
        `insert into restro.sittings
           (id, tenant_id, venue_id, table_id, service_date, opened_how, opened_at, source, actor, job_id)
         values ($1, $2, $3, $4, $5, 'one', now() - interval '40 minutes', $6, $7, $8)`,
        [id, tenantId, venueId, tables[number], day, ...SEED],
      )
      return id
    }
    const sentOrder = async (
      number: string,
      sittingId: string,
      state: string,
      reference: string,
    ): Promise<string> => {
      const id = newId('so')
      await owner.query(
        `insert into restro.sent_orders
           (id, tenant_id, venue_id, table_id, sitting_id, service_date, kind, reference, state,
            lines, total_minor, action_id, sent_at, source, actor, job_id)
         values ($1, $2, $3, $4, $5, $6, 'on_bill', $7, $8, $9::jsonb, 1800, $10,
                 now() - interval '4 minutes', 'guest', 'guest', 'e2e-seed')`,
        [
          id,
          tenantId,
          venueId,
          tables[number],
          sittingId,
          day,
          reference,
          state,
          JSON.stringify([
            {
              id: newId('ol'),
              itemId: newId('nd'),
              optionIds: [],
              qty: 2,
              unitMinor: 900,
              name: 'Mojito',
              optionNames: [],
            },
          ]),
          randomUuid(),
        ],
      )
      return id
    }
    const alert = async (
      kind: string,
      subjectId: string,
      details: Record<string, unknown>,
      minutesAgo: number,
    ) => {
      const id = newId('al')
      await owner.query(
        `insert into restro.alerts
           (id, tenant_id, venue_id, service_date, kind, audience, subject_id, permission, details,
            raised_at, source, actor, job_id)
         values ($1, $2, $3, $4, $5, 'venue', $6, 'alerts.answer', $7::jsonb,
                 now() - ($8 || ' minutes')::interval, $9, $10, $11)`,
        [id, tenantId, venueId, day, kind, subjectId, JSON.stringify(details), minutesAgo, ...SEED],
      )
    }
    const pause = async (
      scope: string,
      targetId: string,
      cause: string,
      restro: boolean,
      actor: string,
      details: Record<string, unknown> = {},
    ) => {
      await owner.query(
        `insert into restro.pauses
           (id, tenant_id, venue_id, service_date, scope, target_id, cause, restro_started, details,
            source, actor, job_id)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10, $11, $12)`,
        [
          newId('pa'),
          tenantId,
          venueId,
          day,
          scope,
          targetId,
          cause,
          restro,
          JSON.stringify(details),
          restro ? 'worker' : 'staff',
          actor,
          'e2e-seed',
        ],
      )
    }

    if (name === 'busy' || name === 'bar-paused' || name === 'restro-paused') {
      const one = await sitting('1')
      const two = await sitting('2')
      const three = await sitting('3')
      await sitting('4')
      // Table 1: a sent order the POS never confirmed (the table is paused with its alert).
      const unconfirmed = await sentOrder('1', one, 'unconfirmed', 'K7F2')
      await pause('table', tables['1'] as string, 'order_unconfirmed', true, 'system', {
        sentOrderId: unconfirmed,
      })
      await alert(
        'order_unconfirmed',
        unconfirmed,
        {
          reference: 'K7F2',
          sentOrderId: unconfirmed,
          tableId: tables['1'],
          items: [{ name: 'Mojito', options: [], qty: 2 }],
          totalMinor: 1800,
          sentAt: new Date(Date.now() - 4 * 60_000).toISOString(),
          billBeforeMinor: 4600,
        },
        4,
      )
      // Table 2 calls a waiter; table 3's guard paused it; table 4 awaits approval.
      await owner.query(
        `insert into restro.waiter_calls
           (id, tenant_id, venue_id, table_id, sitting_id, service_date, called_at, source, actor, job_id)
         values ($1, $2, $3, $4, $5, $6, now() - interval '2 minutes', 'guest', 'guest', 'e2e-seed')`,
        [newId('wc'), tenantId, venueId, tables['2'], two, day],
      )
      await pause('table', tables['3'] as string, 'guard_tripped', true, 'system')
      void three
      const four = (
        await owner.query<{ id: string }>(
          'select id from restro.sittings where table_id = $1 and ended_at is null',
          [tables['4']],
        )
      ).rows[0]?.id as string
      await sentOrder('4', four, 'awaiting_approval', 'AP42')
      // Two items ran out in the POS.
      for (const [index, item] of ['Mojito', 'Negroni'].entries()) {
        const itemId = newId('nd')
        await alert(
          'item_out_of_stock',
          itemId,
          { itemId, name: item, integrationId: 'in_x' },
          10 - index,
        )
      }
    }
    if (name === 'bar-paused') {
      await pause('bar', await barOf('4'), 'staff', false, `staff:${mariaId}`)
    }
    if (name === 'restro-paused') {
      await pause(
        'connection',
        `in_${'E2eTonightPos'.padEnd(22, '0')}`,
        'breaker',
        true,
        'system',
        {
          venueIds: [venueId],
        },
      )
    }
    if (name === 'many') {
      // Forty tables are too many for the seed's six; twelve calls and every table open fill the columns.
      for (const number of ['1', '2', '3', '4', '5', '6']) {
        const id = await sitting(number)
        for (let call = 0; call < 2; call += 1) {
          await owner.query(
            `insert into restro.waiter_calls
               (id, tenant_id, venue_id, table_id, sitting_id, service_date, called_at, source, actor, job_id)
             values ($1, $2, $3, $4, $5, $6, now() - ($7 || ' minutes')::interval, 'guest', 'guest', 'e2e-seed')`,
            [newId('wc'), tenantId, venueId, tables[number], id, day, String(call + 1)],
          )
        }
      }
    }
    console.log(JSON.stringify({ level: 'info', event: 'seed_tonight_e2e_night', name }))
  } finally {
    await owner.end()
  }
}

function randomUuid(): string {
  return crypto.randomUUID()
}

/** A call at an open table, as a phone's tap makes it. */
async function call(number: string): Promise<void> {
  const { tenantId, venueId } = await target()
  const owner = ownerPool()
  try {
    const tables = await tableIds(owner, tenantId)
    const open = await owner.query<{ id: string; service_date: string }>(
      'select id, service_date from restro.sittings where table_id = $1 and ended_at is null',
      [tables[number]],
    )
    const sitting = open.rows[0]
    if (sitting === undefined) throw new Error(`table ${number} is not open`)
    await owner.query(
      `insert into restro.waiter_calls
         (id, tenant_id, venue_id, table_id, sitting_id, service_date, source, actor, job_id)
       values ($1, $2, $3, $4, $5, $6, 'guest', 'guest', 'e2e-seed')`,
      [newId('wc'), tenantId, venueId, tables[number], sitting.id, sitting.service_date],
    )
  } finally {
    await owner.end()
  }
}

/** Marks the newest session of the account a shared device of the venue. */
async function device(email: string): Promise<void> {
  const { tenantId, venueId } = await target()
  const owner = ownerPool()
  try {
    const session = await owner.query<{ id: string }>(
      `select s.id from restro.auth_session s join restro.auth_user u on u.id = s.user_id
        where u.email = $1 order by s.created_at desc limit 1`,
      [email],
    )
    const id = session.rows[0]?.id
    if (id === undefined) throw new Error(`${email} has no session: sign in first`)
    await owner.query(
      `insert into restro.shared_devices (id, tenant_id, venue_id, name, session_id, source, actor, job_id)
       values ($1, $2, $3, 'Bar tablet', $4, $5, $6, $7)
       on conflict do nothing`,
      [newId('dv'), tenantId, venueId, id, ...SEED],
    )
  } finally {
    await owner.end()
  }
}

const [step, argument] = process.argv.slice(2)
const run =
  step === 'seed'
    ? seed()
    : step === 'night' && argument !== undefined
      ? night(argument)
      : step === 'call' && argument !== undefined
        ? call(argument)
        : step === 'device' && argument !== undefined
          ? device(argument)
          : Promise.reject(new Error('seed | night <name> | call <table> | device <email>'))
run
  .then(async () => {
    await getPool().end()
    process.exit(0)
  })
  .catch((error: unknown) => {
    console.error(
      `seed-tonight-e2e ${step} failed: ${error instanceof Error ? error.message : String(error)}`,
    )
    process.exit(1)
  })
