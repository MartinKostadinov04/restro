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
import { seedPayNight } from './e2e/tonight-pay-night'
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
  'payment_steps',
  'payment_lines',
  'payments',
  'sent_orders',
  'table_orders',
  'sittings',
] as const

/** What each night puts on the screen. */
const NIGHTS = [
  'empty',
  'busy',
  'bar-paused',
  'restro-paused',
  'many',
  'flow',
  'crowd',
  'pay',
  'pay-stuck',
] as const

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

    /**
     * The night of the sent orders, the Log and the end of the night (#86): one sent order in
     * every state with its steps in the Log, a reason code with no word, an answered problem,
     * and an earlier night already closed. `crowd` is 230 plain sent orders for the paging.
     */
    const flow = async (scene: string) => {
      const georgiId = (
        await owner.query<{ id: string }>(
          `select id from restro.staff_members where tenant_id = $1 and display_name = 'Georgi'`,
          [tenantId],
        )
      ).rows[0]?.id as string
      const sittings: Record<string, string> = {}
      for (const number of ['1', '2', '3', '4', '5', '6']) sittings[number] = await sitting(number)
      const log = async (
        kind: string,
        fields: {
          sentOrderId?: string
          tableNumber?: string
          toState?: string
          reason?: string
          actor?: string
          via?: string
          details?: Record<string, unknown>
          minutesAgo?: number
          retention?: string
          serviceDate?: string
        } = {},
      ) => {
        await owner.query(
          `insert into restro.log_entries
             (tenant_id, venue_id, service_date, kind, sent_order_id, table_id, to_state, reason, via,
              details, retention, at, source, actor, job_id)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11,
                   now() - ($12 || ' minutes')::interval, 'staff', $13, 'e2e-seed')`,
          [
            tenantId,
            venueId,
            fields.serviceDate ?? day,
            kind,
            fields.sentOrderId ?? null,
            fields.tableNumber === undefined ? null : tables[fields.tableNumber],
            fields.toState ?? null,
            fields.reason ?? null,
            fields.via ?? null,
            JSON.stringify(fields.details ?? {}),
            fields.retention ?? 'night',
            String(fields.minutesAgo ?? 1),
            fields.actor ?? 'system',
          ],
        )
      }
      const order = async (
        number: string,
        reference: string,
        state: string,
        reason: string | null,
        minutesAgo: number,
        note: string | null = null,
      ) => {
        const id = newId('so')
        const lineId = newId('ol')
        await owner.query(
          `insert into restro.sent_orders
             (id, tenant_id, venue_id, table_id, sitting_id, service_date, kind, reference, state, reason,
              lines, total_minor, bill_before_minor, pos_bill_ref, sent_at, created_at, source, actor, job_id)
           values ($1, $2, $3, $4, $5, $6, 'on_bill', $7, $8, $9, $10::jsonb, 1800, 4600, '1042',
                   now() - ($11 || ' minutes')::interval, now() - ($11 || ' minutes')::interval,
                   'guest', 'guest', 'e2e-seed')`,
          [
            id,
            tenantId,
            venueId,
            tables[number],
            sittings[number],
            day,
            reference,
            state,
            reason,
            JSON.stringify([
              {
                id: lineId,
                itemId: newId('nd'),
                optionIds: [],
                qty: 2,
                unitMinor: 900,
                name: 'Mojito',
                optionNames: ['no mint'],
              },
            ]),
            String(minutesAgo),
          ],
        )
        if (note !== null) {
          await owner.query(
            `insert into restro.sent_order_notes
               (tenant_id, venue_id, sent_order_id, line_id, note, service_date, source, actor, job_id)
             values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
            [tenantId, venueId, id, lineId, note, day, ...SEED],
          )
        }
        return id
      }

      if (scene === 'crowd') {
        await owner.query(
          `insert into restro.sent_orders
             (id, tenant_id, venue_id, table_id, sitting_id, service_date, kind, reference, state,
              lines, total_minor, created_at, source, actor, job_id)
           select 'so_crowd' || lpad(i::text, 4, '0'), $1, $2, t.id, st.id, $3, 'on_bill',
                  'Z' || lpad(i::text, 3, '0'), 'added',
                  jsonb_build_array(jsonb_build_object('id', 'ol_crowd' || lpad(i::text, 4, '0'),
                    'itemId', 'nd_crowd', 'optionIds', jsonb_build_array(), 'qty', 1,
                    'unitMinor', 500, 'name', 'Beer', 'optionNames', jsonb_build_array())),
                  500, now() - (i || ' seconds')::interval, 'guest', 'guest', 'e2e-seed'
             from generate_series(1, 230) i
             join restro.tables t on t.tenant_id = $1 and t.number = ((i % 6) + 1)::text
             join restro.sittings st on st.table_id = t.id and st.ended_at is null`,
          [tenantId, venueId, day],
        )
        return
      }

      // Table 1: the order the POS never confirmed, with its steps and Restro's late finding.
      const unconfirmed = await order('1', 'K7F2', 'unconfirmed', 'check_timed_out', 14, 'no ice')
      await alert(
        'order_unconfirmed',
        unconfirmed,
        {
          reference: 'K7F2',
          sentOrderId: unconfirmed,
          tableId: tables['1'],
          items: [{ name: 'Mojito', options: ['no mint'], qty: 2 }],
          totalMinor: 1800,
          sentAt: new Date(Date.now() - 14 * 60_000).toISOString(),
          billBeforeMinor: 4600,
        },
        13,
      )
      await pause('table', tables['1'] as string, 'order_unconfirmed', true, 'system', {
        sentOrderId: unconfirmed,
      })
      for (const [state, minutes] of [
        ['waiting', 14],
        ['sending', 14],
        ['checking', 13],
        ['unconfirmed', 12],
      ] as const) {
        await log('sent_order.state', {
          sentOrderId: unconfirmed,
          tableNumber: '1',
          toState: state,
          minutesAgo: minutes,
        })
      }
      await log('sent_order.landed_late', {
        sentOrderId: unconfirmed,
        tableNumber: '1',
        minutesAgo: 5,
      })
      // The others, one in each state and each reason.
      await order('2', 'SO01', 'added', null, 40)
      const sold = await order('2', 'SO02', 'not_sent', 'item_unavailable', 35)
      await order('3', 'SO03', 'not_sent', 'ordering_paused', 30)
      await order('3', 'SO04', 'not_sent', 'pos_unreachable', 28)
      await order('3', 'WRD1', 'not_sent', 'made_up_code', 27)
      const found = await order('4', 'SO05', 'added', 'staff_found', 25)
      await order('4', 'AP42', 'awaiting_approval', null, 20)
      await order('5', 'SO06', 'sending', null, 1)
      await log('sent_order.state', {
        sentOrderId: sold,
        tableNumber: '2',
        toState: 'not_sent',
        reason: 'item_unavailable',
        minutesAgo: 35,
      })
      await log('sent_order.state', {
        sentOrderId: found,
        tableNumber: '4',
        toState: 'unconfirmed',
        reason: 'check_timed_out',
        minutesAgo: 24,
      })
      await log('sent_order.state', {
        sentOrderId: found,
        tableNumber: '4',
        toState: 'added',
        reason: 'staff_found',
        minutesAgo: 22,
        actor: `staff:${mariaId}`,
        via: 'telegram',
      })

      // The rest of the Log: a sitting, a call, a staff pause, a guard, a setting, a lease (hidden).
      await log('sitting.opened', { tableNumber: '1', minutesAgo: 60 })
      await log('waiter_call.called', { tableNumber: '2', minutesAgo: 50, actor: 'guest' })
      await log('pause.started', {
        reason: 'staff',
        minutesAgo: 45,
        actor: `staff:${mariaId}`,
        details: { scope: 'venue' },
      })
      await log('pause.lifted', {
        reason: 'lifted',
        minutesAgo: 44,
        actor: `staff:${georgiId}`,
        details: { scope: 'venue', cause: 'staff' },
      })
      await log('guard.tripped', { reason: 'order_cap', tableNumber: '3', minutesAgo: 29 })
      await log('settings.changed', {
        reason: 'payment_table',
        minutesAgo: 70,
        retention: 'record',
        actor: `staff:${georgiId}`,
      })
      await log('lease.taken_over', { tableNumber: '1', minutesAgo: 3 })

      // An earlier night, closed: its written totals, an answered problem and a Log line.
      const earlier = new Date(Date.parse(`${day}T00:00:00Z`) - 24 * 3600_000)
        .toISOString()
        .slice(0, 10)
      const old = newId('st')
      await owner.query(
        `insert into restro.sittings
           (id, tenant_id, venue_id, table_id, service_date, opened_how, opened_at, ended_at, end_reason, source, actor, job_id)
         values ($1, $2, $3, $4, $5, 'one', now() - interval '26 hours', now() - interval '25 hours', 'staff_closed', $6, $7, $8)`,
        [old, tenantId, venueId, tables['6'], earlier, ...SEED],
      )
      const answered = newId('so')
      await owner.query(
        `insert into restro.sent_orders
           (id, tenant_id, venue_id, table_id, sitting_id, service_date, kind, reference, state, reason,
            lines, total_minor, source, actor, job_id)
         values ($1, $2, $3, $4, $5, $6, 'on_bill', 'OLD1', 'not_sent', 'staff_not_found', $7::jsonb, 900,
                 'guest', 'guest', 'e2e-seed')`,
        [
          answered,
          tenantId,
          venueId,
          tables['6'],
          old,
          earlier,
          JSON.stringify([
            {
              id: newId('ol'),
              itemId: newId('nd'),
              optionIds: [],
              qty: 1,
              unitMinor: 900,
              name: 'Negroni',
              optionNames: [],
            },
          ]),
        ],
      )
      await log('sent_order.state', {
        sentOrderId: answered,
        tableNumber: '6',
        toState: 'not_sent',
        reason: 'staff_not_found',
        actor: `staff:${georgiId}`,
        serviceDate: earlier,
        minutesAgo: 1500,
      })
      await owner.query(
        `insert into restro.service_days (tenant_id, venue_id, service_date, totals, source, actor, job_id)
         values ($1, $2, $3, $4::jsonb, 'worker', 'system', 'e2e-seed')`,
        [
          tenantId,
          venueId,
          earlier,
          JSON.stringify({
            sittings: 12,
            sentOrders: 31,
            sentOrdersAdded: 28,
            sentOrdersNotSent: 3,
            sentOrdersUnconfirmed: 0,
            addedMinor: 51200,
            waiterCalls: 6,
            alerts: 2,
            pauses: 1,
            payments: 9,
            capturedMinor: 40000,
            tipMinor: 3100,
          }),
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
      // Restro's own reading found the order on the bill afterwards (#135); staff still answer.
      await owner.query(
        `insert into restro.log_entries
           (tenant_id, venue_id, service_date, kind, sent_order_id, table_id, retention, source, actor, job_id)
         values ($1, $2, $3, 'sent_order.landed_late', $4, $5, 'night', 'worker', 'system', 'e2e-seed')`,
        [tenantId, venueId, day, unconfirmed, tables['1']],
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
      // (In the bar-paused night table 4 waits on nothing, so its tile shows the pause.)
      if (name !== 'bar-paused') await sentOrder('4', four, 'awaiting_approval', 'AP42')
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
      // Every table open with a call and an order awaiting approval: twelve rows fill the column
      // (a table has one open call at a time).
      for (const number of ['1', '2', '3', '4', '5', '6']) {
        const id = await sitting(number)
        await owner.query(
          `insert into restro.waiter_calls
             (id, tenant_id, venue_id, table_id, sitting_id, service_date, called_at, source, actor, job_id)
           values ($1, $2, $3, $4, $5, $6, now() - interval '1 minute', 'guest', 'guest', 'e2e-seed')`,
          [newId('wc'), tenantId, venueId, tables[number], id, day],
        )
        await sentOrder(number, id, 'awaiting_approval', `MN${number}0`)
      }
    }
    if (name === 'pay' || name === 'pay-stuck') {
      await seedPayNight({ owner, tenantId, venueId, day, tables, sitting }, name)
    }
    if (name === 'flow' || name === 'crowd') await flow(name)
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
