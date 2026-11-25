// A cancel's guest email rides in the cancel's own transaction (#592, the outbox pattern), on
// Postgres as the restro_app role with the real pg-boss queue: the job is sent through the
// command's `queueJobs` with `{ db: queue }`, the way the web app's `enqueueJobIn` does it. A queue
// that fails rolls the cancel back, so a cancel is never saved without its email, and a job is
// never queued for a cancel that did not happen. Nothing is sent.
import { randomUUID } from 'node:crypto'

import { JOB_NAMES, newId, prepareJob, serviceDate, type VenueId } from '@restro/core'
import { provisionTenant, provisionVenue } from '@restro/core/apply'
import {
  applyService,
  guestEmailJobOf,
  type QueueExecutor,
  type ServiceCommand,
  type ServiceContext,
  type ServiceResult,
} from '@restro/core/service'
import { createPool, type DbPool } from '@restro/db'
import { PgBoss } from 'pg-boss'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { QUEUE_SCHEMA } from '../src/connection'
import {
  allowSlowSetup,
  createTestDatabase,
  hasDatabase,
  SETUP_TIMEOUT_MS,
  type TestDatabase,
  testSlug,
  withOwnerClient,
} from './database'

allowSlowSetup()

describe.skipIf(!hasDatabase)('a cancel and its guest email, in one transaction (#592)', () => {
  let db: TestDatabase
  let pool: DbPool
  let boss: PgBoss
  const tenantId = newId('tn')
  const ownerId = `svc-${newId('us').slice(3)}`
  let venueId: VenueId
  let today: string

  const query = <Row extends object = Record<string, unknown>>(
    sql: string,
    values: unknown[] = [],
  ) =>
    withOwnerClient(db.ownerUrl, async (client) => (await client.query(sql, values)).rows as Row[])

  const staff = (): ServiceContext => ({
    tenantId,
    venueId,
    origin: 'staff',
    actor: { kind: 'user', userId: ownerId, sessionId: `sess-${randomUUID()}` },
    jobId: `req-${randomUUID()}`,
    signedInAt: new Date(),
  })

  async function apply(command: ServiceCommand) {
    const { result } = await applyService(pool, command, staff())
    if (result.status !== 'accepted') {
      throw new Error(`${command.type} refused: ${result.code} ${JSON.stringify(result.details)}`)
    }
    return result
  }

  /** Sends the guest email the answer owes through the command's transaction, as the web app does. */
  async function sendIn(result: ServiceResult, queue: QueueExecutor): Promise<void> {
    const job = guestEmailJobOf(result, { tenantId, venueId })
    if (job === null) return
    const prepared = prepareJob(JOB_NAMES.guestEmail, job)
    await boss.send(JOB_NAMES.guestEmail, prepared.data, {
      singletonKey: prepared.singletonKey,
      db: queue,
    })
  }

  /** A booking tonight for two whose guest has an email address, not yet cancelled. */
  async function booking(): Promise<string> {
    const created = await apply({
      type: 'reservation.create',
      serviceDate: today,
      startsAt: new Date(`${today}T22:00:00Z`).toISOString(),
      kind: 'booking',
      status: 'reserved',
      partySize: 2,
      guestName: 'Иван Иванов',
      phone: `+35988${Math.floor(1_000_000 + Math.random() * 8_999_999)}`,
      spotIds: [],
    } as ServiceCommand)
    const reservationId = created.details.reservationId as string
    const [row] = await query<{ guest_id: string }>(
      'select guest_id from restro.reservations where id = $1',
      [reservationId],
    )
    await apply({
      type: 'guest.save',
      guestId: row?.guest_id,
      email: 'guest-592@example.test',
    } as ServiceCommand)
    return reservationId
  }

  const cancelWith = (
    reservationId: string,
    queueJobs: (result: ServiceResult, queue: QueueExecutor) => Promise<void>,
  ) =>
    applyService(pool, { type: 'reservation.cancel', reservationId } as ServiceCommand, staff(), {
      queueJobs,
    })

  const statusOf = async (reservationId: string) =>
    (
      await query<{ status: string }>('select status from restro.reservations where id = $1', [
        reservationId,
      ])
    )[0]?.status

  const jobsOf = (reservationId: string) =>
    query<{ id: string }>(
      `select id from ${QUEUE_SCHEMA}.job where name = $1 and data ->> 'reservationId' = $2`,
      [JOB_NAMES.guestEmail, reservationId],
    )

  const logCount = async () =>
    Number(
      (
        await query<{ count: string }>(
          'select count(*)::text as count from restro.log_entries where venue_id = $1',
          [venueId],
        )
      )[0]?.count,
    )

  beforeAll(async () => {
    db = await createTestDatabase()
    pool = createPool(db.appUrl, { applicationName: 'restro-worker-guest-outbox-tests', max: 4 })
    boss = new PgBoss({
      connectionString: db.appUrl,
      schema: QUEUE_SCHEMA,
      createSchema: false,
      migrate: true,
      supervise: false,
      schedule: false,
      max: 1,
    })
    await boss.start()
    await boss.createQueue(JOB_NAMES.guestEmail)
    await provisionTenant(pool, { tenantId, name: 'Outbox club' })
    await query(
      `insert into restro.auth_organization (id, name, slug) values ($1, 'Outbox club', $2)`,
      [tenantId, `outbox-${newId('tn').slice(3, 11)}`],
    )
    await query('insert into restro.auth_user (id, name, email) values ($1, $2, $3)', [
      ownerId,
      'Test owner',
      `${ownerId}@example.test`,
    ])
    await query(
      'insert into restro.auth_member (id, organization_id, user_id, role) values ($1, $2, $3, $4)',
      [`mb-${ownerId}`, tenantId, ownerId, 'owner'],
    )
    const venue = await provisionVenue(pool, tenantId, {
      name: 'Club Опашка',
      slug: testSlug('guest-outbox'),
    })
    venueId = venue.id as VenueId
    const [venueRow] = await query<{ timezone: string; ends_at: string }>(
      'select timezone, service_day_ends_at::text as ends_at from restro.venues where id = $1',
      [venueId],
    )
    today = serviceDate(new Date(), venueRow?.timezone ?? 'UTC', venueRow?.ends_at ?? '07:00:00')
    await apply({ type: 'reservation_settings.set', turnMinutes: 90 } as ServiceCommand)
  }, SETUP_TIMEOUT_MS)

  afterAll(async () => {
    await boss?.stop({ graceful: false })
    await pool?.end()
    await db?.drop()
  })

  it('saves the cancel and its queued email together', async () => {
    const reservationId = await booking()
    const { result } = await cancelWith(reservationId, sendIn)
    expect(result.status).toBe('accepted')
    expect(await statusOf(reservationId)).toBe('cancelled')
    expect(await jobsOf(reservationId)).toHaveLength(1)
  })

  it('rolls the cancel back when the queue cannot take its email', async () => {
    const reservationId = await booking()
    const before = await logCount()
    await expect(
      cancelWith(reservationId, async () => {
        throw new Error('queue unreachable')
      }),
    ).rejects.toThrow('queue unreachable')
    expect(await statusOf(reservationId)).toBe('reserved')
    expect(await logCount()).toBe(before)
    expect(await jobsOf(reservationId)).toHaveLength(0)
  })

  it('keeps no queued email when the cancel fails after queueing it', async () => {
    const reservationId = await booking()
    await expect(
      cancelWith(reservationId, async (result, queue) => {
        await sendIn(result, queue)
        throw new Error('failed after the queue')
      }),
    ).rejects.toThrow('failed after the queue')
    expect(await statusOf(reservationId)).toBe('reserved')
    expect(await jobsOf(reservationId)).toHaveLength(0)
  })

  it('queues nothing for a refused command', async () => {
    let called = false
    const { result } = await cancelWith(newId('rv'), async () => {
      called = true
    })
    expect(result.status).toBe('refused')
    expect(called).toBe(false)
  })
})
