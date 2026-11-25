// The `guest-email` job's reading on Postgres as the restro_app role (#576): a cancel that staff
// made owes one email; the job reads the reservation, the guest's address and the Log again when it
// runs, and sends nothing once the reservation is deleted or its guest erased. The sender is a
// fake: nothing real is reached.
import { randomUUID } from 'node:crypto'

import { newId, serviceDate, type VenueId } from '@restro/core'
import { provisionTenant, provisionVenue } from '@restro/core/apply'
import {
  applyService,
  guestEmailJobOf,
  type ServiceCommand,
  type ServiceContext,
} from '@restro/core/service'
import { createPool, type DbPool } from '@restro/db'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { readGuestEmailNews, sendGuestEmailOf } from '../src/jobs/guest-email'
import { createLogger } from '../src/logger'
import {
  allowSlowSetup,
  createTestDatabase,
  hasDatabase,
  type TestDatabase,
  testSlug,
  withOwnerClient,
} from './database'
import { createFakeEmailSender } from './fake-email-sender'

allowSlowSetup()

const ADDRESS = 'guest-576@example.test'

describe.skipIf(!hasDatabase)('the guest email of a cancelled reservation (#576)', () => {
  let db: TestDatabase
  let pool: DbPool
  const tenantId = newId('tn')
  const ownerId = `svc-${newId('us').slice(3)}`
  let venueId: VenueId
  let today: string
  let timezone = 'UTC'
  let lines: string[] = []
  let log: Awaited<ReturnType<typeof createLogger>>

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

  /** A booking tonight at 22:00 for three, whose guest has `email`; and its cancel's job. */
  async function cancelled(email: string | null) {
    const created = await apply({
      type: 'reservation.create',
      serviceDate: today,
      startsAt: new Date(`${today}T22:00:00Z`).toISOString(),
      kind: 'booking',
      status: 'reserved',
      partySize: 3,
      guestName: 'Мария Петрова',
      phone: `+35988${Math.floor(1_000_000 + Math.random() * 8_999_999)}`,
      spotIds: [],
    } as ServiceCommand)
    const reservationId = created.details.reservationId as string
    const [row] = await query<{ guest_id: string }>(
      'select guest_id from restro.reservations where id = $1',
      [reservationId],
    )
    const guestId = row?.guest_id as string
    if (email !== null) await apply({ type: 'guest.save', guestId, email } as ServiceCommand)
    const cancel = await apply({ type: 'reservation.cancel', reservationId } as ServiceCommand)
    return { reservationId, guestId, job: guestEmailJobOf(cancel, { tenantId, venueId }) }
  }

  const sendOf = async (job: NonNullable<Awaited<ReturnType<typeof cancelled>>['job']>) => {
    const sender = createFakeEmailSender()
    const outcome = await sendGuestEmailOf(job, { pool, log, sender })
    return { outcome, sent: sender.guestSent }
  }

  beforeAll(async () => {
    db = await createTestDatabase()
    pool = createPool(db.appUrl, { applicationName: 'restro-worker-guest-email-tests', max: 4 })
    await provisionTenant(pool, { tenantId, name: 'Email club' })
    await query(
      `insert into restro.auth_organization (id, name, slug) values ($1, 'Email club', $2)`,
      [tenantId, `email-${newId('tn').slice(3, 11)}`],
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
    log = await createLogger({
      level: 'trace',
      pretty: false,
      destination: { write: (line: string) => void lines.push(line) },
    })
    const venue = await provisionVenue(pool, tenantId, {
      name: 'Club Нощ',
      slug: testSlug('guest-email'),
    })
    venueId = venue.id as VenueId
    const [venueRow] = await query<{ timezone: string; ends_at: string }>(
      'select timezone, service_day_ends_at::text as ends_at from restro.venues where id = $1',
      [venueId],
    )
    timezone = venueRow?.timezone ?? 'UTC'
    today = serviceDate(new Date(), timezone, venueRow?.ends_at ?? '07:00:00')
    await apply({ type: 'reservation_settings.set', turnMinutes: 90 } as ServiceCommand)
  })

  afterAll(async () => {
    await pool?.end()
    await db?.drop()
  })

  it('sends one email for a cancel, from the venue, and logs neither the address nor the name', async () => {
    lines = []
    const { reservationId, job } = await cancelled(ADDRESS)
    expect(job).not.toBeNull()
    if (job === null) return
    const news = await readGuestEmailNews(pool, job)
    expect(news).toMatchObject({
      status: 'cancelled',
      deleted: false,
      serviceDate: today,
      partySize: 3,
      latestEntry: job.entry,
      email: ADDRESS,
      venueName: 'Club Нощ',
      timeZone: timezone,
    })
    const { outcome, sent } = await sendOf(job)
    expect(outcome).toBe('sent')
    expect(sent).toHaveLength(1)
    expect(sent[0]?.to).toBe(ADDRESS)
    expect(sent[0]?.words.subject).toBe('Резервацията ви е отказана')
    expect(sent[0]?.idempotencyKey).toBe(`${reservationId}-reservation_cancelled-${job.entry}`)
    expect(lines.join('\n')).toContain(reservationId)
    expect(lines.join('\n')).not.toMatch(/guest-576|example\.test|Мария/)
  })

  it('owes nothing to a reservation without an email', async () => {
    const { job } = await cancelled(null)
    expect(job).toBeNull()
  })

  it('sends nothing once the reservation is deleted or the guest erased before the job runs', async () => {
    const deleted = await cancelled(ADDRESS)
    await apply({
      type: 'reservation.delete',
      reservationId: deleted.reservationId,
    } as ServiceCommand)
    expect((await sendOf(deleted.job as NonNullable<typeof deleted.job>)).outcome).toBe(
      'news_changed',
    )

    const erased = await cancelled(ADDRESS)
    await apply({ type: 'guest.erase', guestId: erased.guestId } as ServiceCommand)
    expect((await sendOf(erased.job as NonNullable<typeof erased.job>)).outcome).toBe('no_email')
  })

  it('reads nothing of another venue', async () => {
    const { job } = await cancelled(ADDRESS)
    if (job === null) throw new Error('a cancel with an address owes an email')
    expect(await readGuestEmailNews(pool, { ...job, venueId: newId('vn') })).toBeNull()
  })
})
