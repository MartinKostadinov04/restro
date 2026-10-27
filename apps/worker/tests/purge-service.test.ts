// The service step of the purge (#84; D111, D122 §7, D83) on Postgres, as the restro_purge role,
// with the clock at 26 October 2026, 15:00 in Sofia: every row goes on its date and none a moment
// before (31 days for the night's rows, 18 months for record Log entries, `retain_until` for sent
// orders and sittings); an active pause, a sent order a payment names, the original of a kept
// duplicate and a staff member a kept record entry names stay; a push subscription goes 31 days
// after it was revoked, a live one never; one content-free `purge_log` row
// counts what went. The app role cannot delete any of it, the venue purge erases every service
// row of the venue, and the hourly tick closes the ended service days. Skipped without a database
// or the purge role.
// Payments (#112) go 18 months after they settled (`retain_until`), with their lines and steps, and
// none a moment before; one waiting for a manager's answer, with an open dispute or not settled
// stays. A venue's purge waits while one of its payments is kept, and erases nothing meanwhile.
import { createHash, randomUUID } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { LocalPublishStore } from '@restro/assets'
import { newId, serviceDate } from '@restro/core'
import { createArea, createTable, provisionTenant, provisionVenue } from '@restro/core/apply'
import { createPool, type DbPool } from '@restro/db'
import pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { purgeService, purgeVenue } from '../src/jobs/purge'
import { closeServiceDays, dueServiceDays } from '../src/jobs/service-day'
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

/** The purge's clock: 15:00 in Sofia. */
const NOW = new Date('2026-10-26T12:00:00Z')
// Night rows: the 24th ended 31 days and 8 hours ago, the 25th not yet 31 days ago.
const NIGHT_DUE = '2026-09-24'
const NIGHT_KEPT = '2026-09-25'
// Record Log entries: 18 months back is 26 April 2025, 15:00, inside that day's night.
const RECORD_DUE = '2025-04-25'
const RECORD_KEPT = '2025-04-26'
const OLD_DAY = '2025-04-01'
const UNTIL_DUE = '2026-10-26T11:59:59Z'
const UNTIL_KEPT = '2026-10-26T12:00:01Z'
const SEED = ['restro', 'system', 'test-seed'] as const
const quiet = { info: () => undefined, warn: () => undefined }
let references = 0

describe.skipIf(!hasPurge)('the service purge (as the restro_purge role)', () => {
  let db: TestDatabase
  let pool: DbPool
  let purgePool: DbPool
  const tenantId = newId('tn')
  let venueId: string
  let tableId: string
  const ids: Record<string, string> = {}

  const query = <T = Record<string, unknown>>(text: string, values: unknown[] = []) =>
    withOwnerClient(db.ownerUrl, async (client) => (await client.query(text, values)).rows as T[])
  const exists = async (table: string, id: string, column = 'id') =>
    (await query(`select 1 from restro.${table} where ${column} = $1`, [id])).length === 1

  async function venueWithTable(name: string) {
    const venue = await provisionVenue(pool, tenantId, { name, slug: testSlug('service-purge') })
    const area = await createArea(pool, tenantId, venue.id, 'Hall')
    if (!area.ok) throw new Error(area.reason)
    const table = await createTable(pool, tenantId, {
      areaId: area.area.id,
      name: null,
      number: '1',
    })
    if (!table.ok) throw new Error(table.reason)
    return { venueId: venue.id, tableId: table.table.id }
  }
  async function sitting(venue: string, table: string, day: string, until: string | null) {
    const id = newId('st')
    await query(
      `insert into restro.sittings
         (id, tenant_id, venue_id, table_id, service_date, opened_how, ended_at, end_reason,
          retain_until, source, actor, job_id)
       values ($1, $2, $3, $4, $5, 'one', now(), 'staff_closed', $6, $7, $8, $9)`,
      [id, tenantId, venue, table, day, until, ...SEED],
    )
    return id
  }
  async function sentOrder(
    venue: string,
    table: string,
    sittingId: string,
    day: string,
    until: string | null,
    duplicateOf: string | null = null,
  ) {
    const id = newId('so')
    references += 1
    await query(
      `insert into restro.sent_orders
         (id, tenant_id, venue_id, table_id, sitting_id, service_date, kind, reference, state,
          lines, total_minor, retain_until, duplicate_of, source, actor, job_id)
       values ($1, $2, $3, $4, $5, $6, 'on_bill', $12, 'added', '[{"n":1}]'::jsonb, 500, $7, $8,
               $9, $10, $11)`,
      [
        id,
        tenantId,
        venue,
        table,
        sittingId,
        day,
        until,
        duplicateOf,
        ...SEED,
        `R${String(references).padStart(4, '0')}`,
      ],
    )
    return id
  }
  async function note(venue: string, sentOrderId: string, day: string) {
    await query(
      `insert into restro.sent_order_notes
         (tenant_id, venue_id, sent_order_id, line_id, note, service_date, source, actor, job_id)
       values ($1, $2, $3, 'ol_1', 'no ice', $4, $5, $6, $7)`,
      [tenantId, venue, sentOrderId, day, ...SEED],
    )
  }
  async function waiterCall(venue: string, table: string, sittingId: string, day: string) {
    const id = newId('wc')
    await query(
      `insert into restro.waiter_calls
         (id, tenant_id, venue_id, table_id, sitting_id, service_date, state, source, actor, job_id)
       values ($1, $2, $3, $4, $5, $6, 'lapsed', $7, $8, $9)`,
      [id, tenantId, venue, table, sittingId, day, ...SEED],
    )
    return id
  }
  async function alert(
    venue: string,
    day: string,
    kind = 'pos.unreachable',
    subjectId = venue,
    done = false,
  ) {
    const id = newId('al')
    await query(
      `insert into restro.alerts
         (id, tenant_id, venue_id, service_date, kind, subject_id, done_at, source, actor, job_id)
       values ($1, $2, $3, $4, $5, $6, case when $7 then now() else null end, $8, $9, $10)`,
      [id, tenantId, venue, day, kind, subjectId, done, ...SEED],
    )
    return id
  }
  async function pause(venue: string, day: string, lifted: boolean) {
    const id = newId('pa')
    await query(
      `insert into restro.pauses
         (id, tenant_id, venue_id, service_date, scope, target_id, cause, restro_started,
          lifted_at, source, actor, job_id)
       values ($1, $2, $3, $4, 'venue', $3, 'manual', true,
               case when $5 then now() else null end, $6, $7, $8)`,
      [id, tenantId, venue, day, lifted, ...SEED],
    )
    return id
  }
  async function logEntry(
    venue: string,
    day: string,
    retention: 'night' | 'record',
    actor = 'system',
    staffMemberId: string | null = null,
  ) {
    const [row] = await query<{ seq: string }>(
      `insert into restro.log_entries
         (tenant_id, venue_id, service_date, kind, retention, details, source, actor, job_id)
       values ($1, $2, $3, $4, $5, $6::jsonb, 'restro', $7, 'test-seed')
       returning seq::text`,
      [
        tenantId,
        venue,
        day,
        retention === 'night' ? 'sitting.ended' : 'staff.changed',
        retention,
        JSON.stringify(staffMemberId === null ? {} : { staffMemberId }),
        actor,
      ],
    )
    return row?.seq ?? ''
  }
  async function archivedStaff(venue: string, until: string) {
    const id = newId('sm')
    const roleId = newId('rl')
    await query(
      `insert into restro.staff_members
         (id, tenant_id, display_name, archived_at, retain_until, source, actor, job_id)
       values ($1, $2, 'Waiter', now(), $3, $4, $5, $6)`,
      [id, tenantId, until, ...SEED],
    )
    await query(
      `insert into restro.venue_roles (id, tenant_id, venue_id, name, source, actor, job_id)
       values ($1, $2, $3, $4, $5, $6, $7)`,
      [roleId, tenantId, venue, `Role ${roleId.slice(3, 9)}`, ...SEED],
    )
    await query(
      `insert into restro.staff_assignments
         (tenant_id, staff_member_id, venue_id, role_id, source, actor, job_id)
       values ($1, $2, $3, $4, $5, $6, $7)`,
      [tenantId, id, venue, roleId, ...SEED],
    )
    return id
  }
  async function pushSubscription(userId: string, revokedAt: string | null) {
    const endpointHash = createHash('sha256').update(randomUUID()).digest('hex')
    await query(
      `insert into restro.push_subscriptions
         (tenant_id, user_id, endpoint_hash, endpoint, p256dh, auth, revoked_at, source, actor,
          job_id)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        tenantId,
        userId,
        endpointHash,
        `https://push.example.test/${endpointHash}`,
        'p'.repeat(64),
        'a'.repeat(22),
        revokedAt,
        ...SEED,
      ],
    )
    return endpointHash
  }
  async function payment(venue: string, table: string, sittingId: string, sentOrderId: string) {
    const id = newId('py')
    await query(
      `insert into restro.payments
         (id, tenant_id, venue_id, table_id, sitting_id, sent_order_id, service_date, kind, state,
          handle_hash, currency, provider_kind, source, actor, job_id)
       values ($1, $2, $3, $4, $5, $6, $7, 'pay_first', 'requested', $8, 'EUR', 'sim',
               $9, $10, $11)`,
      [
        id,
        tenantId,
        venue,
        table,
        sittingId,
        sentOrderId,
        OLD_DAY,
        createHash('sha256').update(randomUUID()).digest('hex'),
        ...SEED,
      ],
    )
    return id
  }
  /** A card payment on the bill, settled in `state` and kept until `until`, with a line and a step. */
  async function settledPayment(
    venue: string,
    table: string,
    sittingId: string,
    until: string,
    state = 'released',
    reason = 'cancelled',
    dispute: string | null = null,
  ) {
    const id = newId('py')
    await query(
      `insert into restro.payments
         (id, tenant_id, venue_id, table_id, sitting_id, service_date, kind, state, reason,
          handle_hash, amount_minor, currency, provider_kind, settled_at, retain_until, dispute,
          source, actor, job_id)
       values ($1, $2, $3, $4, $5, $6, 'on_bill', $7, $8, $9, 1450, 'EUR', 'sim-pay',
               $10::timestamptz - interval '18 months', $10, $11, $12, $13, $14)`,
      [
        id,
        tenantId,
        venue,
        table,
        sittingId,
        OLD_DAY,
        state,
        reason,
        createHash('sha256').update(randomUUID()).digest('hex'),
        until,
        dispute,
        ...SEED,
      ],
    )
    references += 1
    await query(
      `insert into restro.payment_lines
         (tenant_id, venue_id, payment_id, position, pos_line_ref, quantity, pos_amount_minor,
          display_name, source, actor, job_id)
       values ($1, $2, $3, 1, $4, 1, 1450, 'Gin tonic', $5, $6, $7)`,
      [tenantId, venue, id, String(9_200_000 + references), ...SEED],
    )
    await query(
      `insert into restro.payment_steps
         (tenant_id, venue_id, payment_id, step, outcome, answer, source, actor, job_id)
       values ($1, $2, $3, 'createHold', 'attempting', null, 'worker', 'system', 'test-seed')`,
      [tenantId, venue, id],
    )
    return id
  }

  beforeAll(async () => {
    db = await createTestDatabase()
    pool = createPool(db.appUrl, { applicationName: 'restro-worker-service-purge-tests', max: 4 })
    purgePool = createPool(db.purgeUrl ?? '', { applicationName: 'restro-worker-service-purge' })
    await provisionTenant(pool, { tenantId, name: 'Retention club' })
    await query(
      `insert into restro.auth_organization (id, name, slug) values ($1, 'Retention club', $2)`,
      [tenantId, `retention-${newId('tn').slice(3, 11).toLowerCase()}`],
    )
    ;({ venueId, tableId } = await venueWithTable('Retention Bar'))
    const v = venueId
    const t = tableId

    // A sitting past its date with everything on it: all of it goes, children first.
    ids.oldSitting = await sitting(v, t, OLD_DAY, UNTIL_DUE)
    ids.oldSent = await sentOrder(v, t, ids.oldSitting, OLD_DAY, UNTIL_DUE)
    await note(v, ids.oldSent, OLD_DAY)
    ids.oldCall = await waiterCall(v, t, ids.oldSitting, OLD_DAY)
    await query(
      `insert into restro.table_orders (id, tenant_id, venue_id, table_id, sitting_id, source, actor, job_id)
       values ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [newId('to'), tenantId, v, t, ids.oldSitting, ...SEED],
    )
    // A sitting a second short of its date, with its sent order.
    ids.keptSitting = await sitting(v, t, OLD_DAY, UNTIL_KEPT)
    ids.keptSent = await sentOrder(v, t, ids.keptSitting, OLD_DAY, UNTIL_KEPT)
    // The original of a kept duplicate stays with it.
    ids.original = await sentOrder(v, t, ids.keptSitting, OLD_DAY, UNTIL_DUE)
    ids.duplicate = await sentOrder(v, t, ids.keptSitting, OLD_DAY, UNTIL_KEPT, ids.original)
    // A sent order a payment names stays, and so does its sitting.
    ids.paidSitting = await sitting(v, t, OLD_DAY, UNTIL_DUE)
    ids.paidSent = await sentOrder(v, t, ids.paidSitting, OLD_DAY, UNTIL_DUE)
    ids.payment = await payment(v, t, ids.paidSitting, ids.paidSent)
    // A sitting whose day was never closed has no date: never due.
    ids.unclosedSitting = await sitting(v, t, OLD_DAY, null)

    ids.callDue = await waiterCall(v, t, ids.keptSitting, NIGHT_DUE)
    ids.callKept = await waiterCall(v, t, ids.keptSitting, NIGHT_KEPT)
    await note(v, ids.keptSent, NIGHT_DUE)
    await note(v, ids.duplicate, NIGHT_KEPT)
    ids.alertDue = await alert(v, NIGHT_DUE)
    ids.alertKept = await alert(v, NIGHT_KEPT)
    ids.pauseDue = await pause(v, NIGHT_DUE, true)
    ids.pauseActive = await pause(v, NIGHT_DUE, false)
    ids.pauseKept = await pause(v, NIGHT_KEPT, true)
    ids.nightDue = await logEntry(v, NIGHT_DUE, 'night')
    ids.nightKept = await logEntry(v, NIGHT_KEPT, 'night')
    ids.recordDue = await logEntry(v, RECORD_DUE, 'record')

    // Archived staff: free to go; named by a kept record entry (as actor, in details); named
    // only by a record entry that goes in the same run; not yet at their date.
    ids.staffFree = await archivedStaff(v, UNTIL_DUE)
    ids.staffActor = await archivedStaff(v, UNTIL_DUE)
    ids.recordKept = await logEntry(v, RECORD_KEPT, 'record', `staff:${ids.staffActor}`)
    ids.staffNamed = await archivedStaff(v, UNTIL_DUE)
    await logEntry(v, RECORD_KEPT, 'record', 'system', ids.staffNamed)
    ids.staffNamedOld = await archivedStaff(v, UNTIL_DUE)
    await logEntry(v, RECORD_DUE, 'record', `staff:${ids.staffNamedOld}`)
    ids.staffLater = await archivedStaff(v, UNTIL_KEPT)

    // Push subscriptions: revoked 31 days and a second ago, 31 days less a second ago, live.
    const userId = `svc-${newId('us').slice(3)}`
    await query('insert into restro.auth_user (id, name, email) values ($1, $2, $3)', [
      userId,
      'Owner',
      `${userId}@example.test`,
    ])
    ids.pushDue = await pushSubscription(userId, '2026-09-25T11:59:59Z')
    ids.pushKept = await pushSubscription(userId, '2026-09-25T12:00:01Z')
    ids.pushLive = await pushSubscription(userId, null)
  })

  afterAll(async () => {
    await purgePool?.end()
    await pool?.end()
    await db?.drop()
  })

  it('erases each row on its date and none before', async () => {
    const { counts } = await purgeService({ purgePool }, { tenantId, now: NOW })
    expect(counts).toMatchObject({
      sent_order_notes: 2,
      table_orders: 1,
      waiter_calls: 2,
      alerts: 1,
      pauses: 1,
      log_entries: 3,
      sent_orders: 1,
      sittings: 1,
      staff_assignments: 2,
      staff_members: 2,
      push_subscriptions: 1,
    })

    expect(await exists('sittings', ids.oldSitting ?? '')).toBe(false)
    expect(await exists('sent_orders', ids.oldSent ?? '')).toBe(false)
    expect(await exists('waiter_calls', ids.oldCall ?? '')).toBe(false)
    expect(await exists('sittings', ids.keptSitting ?? '')).toBe(true)
    expect(await exists('sent_orders', ids.keptSent ?? '')).toBe(true)
    expect(await exists('sent_orders', ids.original ?? '')).toBe(true)
    expect(await exists('sent_orders', ids.duplicate ?? '')).toBe(true)
    expect(await exists('sent_orders', ids.paidSent ?? '')).toBe(true)
    expect(await exists('sittings', ids.paidSitting ?? '')).toBe(true)
    expect(await exists('payments', ids.payment ?? '')).toBe(true)
    expect(await exists('sittings', ids.unclosedSitting ?? '')).toBe(true)

    expect(await exists('waiter_calls', ids.callDue ?? '')).toBe(false)
    expect(await exists('waiter_calls', ids.callKept ?? '')).toBe(true)
    expect(await query('select service_date::text as d from restro.sent_order_notes')).toEqual([
      { d: NIGHT_KEPT },
    ])
    expect(await exists('alerts', ids.alertDue ?? '')).toBe(false)
    expect(await exists('alerts', ids.alertKept ?? '')).toBe(true)
    expect(await exists('pauses', ids.pauseDue ?? '')).toBe(false)
    expect(await exists('pauses', ids.pauseActive ?? '')).toBe(true)
    expect(await exists('pauses', ids.pauseKept ?? '')).toBe(true)
    expect(await exists('log_entries', ids.nightDue ?? '', 'seq')).toBe(false)
    expect(await exists('log_entries', ids.nightKept ?? '', 'seq')).toBe(true)
    expect(await exists('log_entries', ids.recordDue ?? '', 'seq')).toBe(false)
    expect(await exists('log_entries', ids.recordKept ?? '', 'seq')).toBe(true)

    expect(await exists('staff_members', ids.staffFree ?? '')).toBe(false)
    expect(await exists('staff_members', ids.staffNamedOld ?? '')).toBe(false)
    expect(await exists('staff_members', ids.staffActor ?? '')).toBe(true)
    expect(await exists('staff_members', ids.staffNamed ?? '')).toBe(true)
    expect(await exists('staff_members', ids.staffLater ?? '')).toBe(true)
    expect(await exists('staff_assignments', ids.staffFree ?? '', 'staff_member_id')).toBe(false)
    expect(await exists('staff_assignments', ids.staffActor ?? '', 'staff_member_id')).toBe(true)
    expect(await exists('push_subscriptions', ids.pushDue ?? '', 'endpoint_hash')).toBe(false)
    expect(await exists('push_subscriptions', ids.pushKept ?? '', 'endpoint_hash')).toBe(true)
    expect(await exists('push_subscriptions', ids.pushLive ?? '', 'endpoint_hash')).toBe(true)
  })

  it('logs the run as counts only, once, and a run with nothing due logs nothing', async () => {
    const logged = await query<{ subject_id: string; counts: Record<string, unknown> }>(
      `select subject_id, counts from restro.purge_log where kind = 'service'`,
    )
    expect(logged).toHaveLength(1)
    expect(logged[0]?.subject_id).toBe(tenantId)
    for (const value of Object.values(logged[0]?.counts ?? {})) expect(typeof value).toBe('number')

    const again = await purgeService({ purgePool }, { tenantId, now: NOW })
    expect(Object.values(again.counts).every((rows) => rows === 0)).toBe(true)
    expect(await query(`select 1 from restro.purge_log where kind = 'service'`)).toHaveLength(1)
  })

  it('lets the rows a second later go a second later', async () => {
    const later = new Date(NOW.getTime() + 2000)
    const { counts } = await purgeService({ purgePool }, { tenantId, now: later })
    expect(counts).toMatchObject({ staff_members: 1, push_subscriptions: 1 })
    expect(await exists('push_subscriptions', ids.pushKept ?? '', 'endpoint_hash')).toBe(false)
    expect(await exists('push_subscriptions', ids.pushLive ?? '', 'endpoint_hash')).toBe(true)
    expect(await exists('staff_members', ids.staffLater ?? '')).toBe(false)
  })

  it('refuses the app role any delete', async () => {
    const client = new pg.Client({ connectionString: db.appUrl })
    await client.connect()
    try {
      for (const table of [
        'log_entries',
        'sent_orders',
        'sittings',
        'waiter_calls',
        'alerts',
        'pauses',
        'sent_order_notes',
        'staff_members',
        'service_days',
      ]) {
        await expect(client.query(`delete from restro.${table}`)).rejects.toMatchObject({
          code: '42501',
        })
      }
    } finally {
      await client.end()
    }
  })

  it('closes the ended service days on the hourly tick, oldest first, once', async () => {
    const { venueId: v, tableId: t } = await venueWithTable('Closing Bar')
    const [venue] = await query<{ timezone: string; ends: string }>(
      'select timezone, service_day_ends_at::text as ends from restro.venues where id = $1',
      [v],
    )
    const today = serviceDate(new Date(), venue?.timezone ?? '', venue?.ends ?? '')
    const first = await sitting(v, t, '2026-01-10', null)
    await sentOrder(v, t, first, '2026-01-10', null)
    await sitting(v, t, '2026-01-11', null)
    await sitting(v, t, today, null)

    const due = (await dueServiceDays(pool, new Date())).filter((day) => day.venueId === v)
    expect(due.map((day) => day.serviceDate)).toEqual(['2026-01-10', '2026-01-11'])
    expect(await closeServiceDays(pool, new Date(), quiet)).toBeGreaterThanOrEqual(2)
    expect(
      await query(
        'select service_date::text as d from restro.service_days where venue_id = $1 order by 1',
        [v],
      ),
    ).toEqual([{ d: '2026-01-10' }, { d: '2026-01-11' }])
    const [kept] = await query<{ retain_until: Date | null }>(
      'select retain_until from restro.sittings where id = $1',
      [first],
    )
    expect(kept?.retain_until?.getTime() ?? 0).toBeGreaterThan(Date.now() + 500 * 24 * 3600 * 1000)
    expect((await dueServiceDays(pool, new Date())).filter((day) => day.venueId === v)).toEqual([])
  })

  it('tells the end-of-night report of each day it closes, once (#86)', async () => {
    const { venueId: v, tableId: t } = await venueWithTable('Report Bar')
    await sitting(v, t, '2026-01-10', null)
    const told: { venueId: string; serviceDate: string }[] = []
    const onClosed = async (day: { venueId: string; serviceDate: string }) => {
      if (day.venueId === v) told.push(day)
    }
    await closeServiceDays(pool, new Date(), quiet, onClosed)
    expect(told).toEqual([expect.objectContaining({ venueId: v, serviceDate: '2026-01-10' })])
    // A day already closed is not reported again.
    await closeServiceDays(pool, new Date(), quiet, onClosed)
    expect(told).toHaveLength(1)
  })

  it('keeps the later days of a venue open while an earlier one is refused', async () => {
    const { venueId: v, tableId: t } = await venueWithTable('Waiting Bar')
    const first = await sitting(v, t, '2026-01-10', null)
    const inFlight = await sentOrder(v, t, first, '2026-01-10', null)
    await query(`update restro.sent_orders set state = 'waiting' where id = $1`, [inFlight])
    await sitting(v, t, '2026-01-11', null)
    const closedDays = () =>
      query('select service_date::text as d from restro.service_days where venue_id = $1', [v])

    const waits: unknown[] = []
    const log = { info: (fields: unknown) => waits.push(fields), warn: () => undefined }
    await closeServiceDays(pool, new Date(), log)
    expect(await closedDays()).toEqual([])
    expect(waits).toContainEqual(
      expect.objectContaining({ venueId: v, serviceDate: '2026-01-10', code: 'orders_open' }),
    )

    await query(`update restro.sent_orders set state = 'added' where id = $1`, [inFlight])
    await closeServiceDays(pool, new Date(), quiet)
    expect(await closedDays()).toHaveLength(2)
  })

  it('keeps the open alert of a pause still on, however old, and erases done ones', async () => {
    const { venueId: v } = await venueWithTable('Paused Bar')
    const fortyDaysAgo = '2026-09-16'
    const onPause = await pause(v, fortyDaysAgo, false)
    const open = await alert(v, fortyDaysAgo, 'ordering_paused', onPause)
    const donePause = await alert(v, fortyDaysAgo, 'ordering_paused', newId('pa'), true)
    const doneOther = await alert(v, fortyDaysAgo, 'pos.unreachable', v, true)
    // An open alert someone must press Done on still goes after 31 days (the default for now).
    const openOther = await alert(v, fortyDaysAgo, 'pos.unreachable', v)

    await purgeService({ purgePool }, { tenantId, now: NOW })
    expect(await exists('pauses', onPause)).toBe(true)
    expect(await exists('alerts', open)).toBe(true)
    for (const id of [donePause, doneOther, openOther]) {
      expect(await exists('alerts', id), id).toBe(false)
    }
  })

  it('erases a payment 18 months after it settled, with its lines and steps, and none before', async () => {
    const v = venueId
    const t = tableId
    const s = ids.keptSitting ?? ''
    const due = await settledPayment(v, t, s, UNTIL_DUE)
    const later = await settledPayment(v, t, s, UNTIL_KEPT)
    // Waiting for a manager's answer, or disputed and still open: kept, however old.
    const asking = await settledPayment(v, t, s, UNTIL_DUE, 'unconfirmed', 'close_unknown')
    const disputed = await settledPayment(v, t, s, UNTIL_DUE, 'released', 'cancelled', 'open')
    // The due one never freed its payment table (R9): its lease goes with it; the kept one's stays.
    const lease = async (holder: string) => {
      const key = newId('tb')
      await query(
        `insert into restro.locks (tenant_id, venue_id, scope, key, holder, fence, taken_at,
           source, actor, job_id)
         values ($1, $2, 'payment_table', $3, $4, 1, now(), $5, $6, $7)`,
        [tenantId, v, key, holder, ...SEED],
      )
      return key
    }
    const dueLease = await lease(due)
    const laterLease = await lease(later)
    const leaseOf = (key: string) =>
      query('select holder from restro.locks where scope = $1 and key = $2', ['payment_table', key])
    const { counts } = await purgeService({ purgePool }, { tenantId, now: NOW })
    expect(counts).toMatchObject({ payments: 1, payment_lines: 1, payment_steps: 1, locks: 1 })
    expect(await leaseOf(dueLease)).toEqual([])
    expect(await leaseOf(laterLease)).toEqual([{ holder: later }])
    expect(await exists('payments', due)).toBe(false)
    expect(await query('select 1 from restro.payment_lines where payment_id = $1', [due])).toEqual(
      [],
    )
    expect(await query('select 1 from restro.payment_steps where payment_id = $1', [due])).toEqual(
      [],
    )
    for (const kept of [later, asking, disputed, ids.payment ?? '']) {
      expect(await exists('payments', kept)).toBe(true)
    }
    expect(
      await query('select 1 from restro.payment_lines where payment_id = $1', [later]),
    ).toHaveLength(1)
    // A second later, the next one goes.
    const next = await purgeService(
      { purgePool },
      { tenantId, now: new Date(NOW.getTime() + 2000) },
    )
    expect(next.counts).toMatchObject({ payments: 1 })
    expect(await exists('payments', later)).toBe(false)
  })

  it('makes the purge of a venue wait while one of its payments is kept, erasing nothing', async () => {
    const { venueId: v, tableId: t } = await venueWithTable('Kept Bar')
    const s = await sitting(v, t, OLD_DAY, UNTIL_DUE)
    const keptUntil = new Date(Date.now() + 86_400_000).toISOString()
    const kept = await settledPayment(v, t, s, keptUntil)
    await query(`update restro.venues set archived_at = now() - interval '31 days' where id = $1`, [
      v,
    ])
    const root = await mkdtemp(path.join(tmpdir(), 'restro-payment-purge-'))
    try {
      const store = new LocalPublishStore({ rootDir: root })
      const first = await purgeVenue({ purgePool, pool, store }, { tenantId, venueId: v })
      expect(first.status).toBe('payments_kept')
      expect(await exists('payments', kept)).toBe(true)
      expect(await exists('sittings', s)).toBe(true)
      expect(await query('select 1 from restro.venues where id = $1', [v])).toHaveLength(1)
      // Once it is due, the venue goes with it.
      await query(
        `update restro.payments set retain_until = now() - interval '1 second' where id = $1`,
        [kept],
      )
      const second = await purgeVenue({ purgePool, pool, store }, { tenantId, venueId: v })
      expect(second.status).toBe('purged')
      expect(await exists('payments', kept)).toBe(false)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('erases every service row of a purged venue', async () => {
    const { venueId: v, tableId: t } = await venueWithTable('Gone Bar')
    const bar = newId('br')
    await query(
      `insert into restro.bars (id, tenant_id, venue_id, name, source_key)
       values ($1, $2, $3, 'Main bar', 'main')`,
      [bar, tenantId, v],
    )
    await query('update restro.tables set bar_id = $2 where id = $1', [t, bar])
    const s = await sitting(v, t, OLD_DAY, UNTIL_KEPT)
    const so = await sentOrder(v, t, s, OLD_DAY, UNTIL_KEPT)
    await query('update restro.sent_orders set bar_id = $2 where id = $1', [so, bar])
    await note(v, so, OLD_DAY)
    // Its payments are past their 18 months: they go with the venue.
    const paid = await payment(v, t, s, so)
    await query(
      `update restro.payments set state = 'released', reason = 'cancelled', settled_at = $2,
         retain_until = now() - interval '1 second' where id = $1`,
      [paid, OLD_DAY],
    )
    await waiterCall(v, t, s, OLD_DAY)
    await alert(v, OLD_DAY)
    await pause(v, OLD_DAY, false)
    await logEntry(v, OLD_DAY, 'record')
    await archivedStaff(v, UNTIL_KEPT)
    await query(
      `insert into restro.service_days (tenant_id, venue_id, service_date, source, actor, job_id)
       values ($1, $2, $3, $4, $5, $6)`,
      [tenantId, v, OLD_DAY, ...SEED],
    )
    await query(
      `insert into restro.shared_devices (id, tenant_id, venue_id, name, session_id, source, actor, job_id)
       values ($1, $2, $3, 'Bar tablet', 'session-gone', $4, $5, $6)`,
      [newId('dv'), tenantId, v, ...SEED],
    )
    await query(
      `insert into restro.bill_readings (tenant_id, venue_id, table_id, read_at, complete, source, actor, job_id)
       values ($1, $2, $3, now(), true, $4, $5, $6)`,
      [tenantId, v, t, ...SEED],
    )
    await query(
      `insert into restro.locks (tenant_id, venue_id, scope, key, source, actor, job_id)
       values ($1, $2, 'order_slot', $3, $4, $5, $6)`,
      [tenantId, v, t, ...SEED],
    )
    await query(`update restro.venues set archived_at = now() - interval '31 days' where id = $1`, [
      v,
    ])

    const root = await mkdtemp(path.join(tmpdir(), 'restro-service-purge-'))
    try {
      const store = new LocalPublishStore({ rootDir: root })
      const result = await purgeVenue({ purgePool, pool, store }, { tenantId, venueId: v })
      expect(result.status).toBe('purged')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
    for (const table of [
      'bars',
      'sittings',
      'sent_orders',
      'sent_order_notes',
      'payments',
      'waiter_calls',
      'alerts',
      'pauses',
      'log_entries',
      'service_days',
      'staff_assignments',
      'venue_roles',
      'shared_devices',
      'bill_readings',
      'locks',
    ]) {
      expect(await query(`select 1 from restro.${table} where venue_id = $1`, [v]), table).toEqual(
        [],
      )
    }
    // The organisation's staff member is not the venue's: the staff step lets it go.
    expect(
      await query(`select 1 from restro.staff_members where retain_until = $1`, [UNTIL_KEPT]),
    ).not.toEqual([])
  })
})
