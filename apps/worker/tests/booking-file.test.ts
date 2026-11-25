// A venue's booking file on the CDN (#577): Postgres as restro_app, a local publish store, the
// real `publish-booking` job. The file holds the venue's name, the switch, its clock, its hours and
// its closed dates from today on; no tenant id (rule 3); it is put only when its bytes differ.
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { bookingPath, LocalPublishStore, readBookingFileFrom } from '@restro/assets'
import { addDaysToDay, JOB_NAMES, newId, serviceDate, type VenueId } from '@restro/core'
import type { Job } from 'pg-boss'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { createPublishJobs } from '../src/jobs/publish'
import type { JobDefinition } from '../src/jobs/types'
import { writeBookingFile } from '../src/publish/booking'
import {
  allowSlowSetup,
  createTestDatabase,
  hasDatabase,
  SETUP_TIMEOUT_MS,
  type TestDatabase,
} from './database'
import { createFakeBarsy } from './fake-barsy'
import { createWorld, type World } from './world'

allowSlowSetup()

describe.skipIf(!hasDatabase)("a venue's booking file (b/<venue id>.json)", () => {
  const fake = createFakeBarsy()
  let db: TestDatabase
  let world: World
  let root: string
  let store: LocalPublishStore
  let jobs: Map<string, JobDefinition>

  async function runBookingJob() {
    const job = jobs.get(JOB_NAMES.publishBooking)
    if (!job) throw new Error('no publish-booking job')
    const item = {
      id: newId('jb'),
      name: JOB_NAMES.publishBooking,
      data: { tenantId: world.tenantId, venueId: world.venueId },
      signal: new AbortController().signal,
      retryCount: 0,
    } as unknown as Job<object>
    await job.handler([item], world.context)
  }

  beforeAll(async () => {
    db = await createTestDatabase()
    fake.listen()
    root = await mkdtemp(path.join(tmpdir(), 'restro-worker-booking-'))
    store = new LocalPublishStore({ rootDir: root })
    world = await createWorld(fake, { database: db })
    jobs = new Map(
      createPublishJobs({ publishStore: store, assetStore: { get: async () => null } }).map(
        (job) => [job.name, job],
      ),
    )
  }, SETUP_TIMEOUT_MS)

  afterAll(async () => {
    await world?.close()
    fake.close()
    await db?.drop()
    if (root) await rm(root, { recursive: true, force: true })
  })

  it('is written off for a venue with no reservation settings, with no tenant id in it', async () => {
    await runBookingJob()
    const file = await readBookingFileFrom(store, world.venueId as VenueId)
    expect(file).toMatchObject({ venue_id: world.venueId, on: false, closed_dates: [] })
    const bytes = await readFile(path.join(root, bookingPath(world.venueId as VenueId)), 'utf8')
    expect(bytes).not.toContain(world.tenantId)
  })

  it('follows the switch and the closed dates from today on, and is put only when it differs', async () => {
    const file = await readBookingFileFrom(store, world.venueId as VenueId)
    const today = serviceDate(
      world.clock,
      file?.time_zone ?? 'Europe/Sofia',
      file?.day_ends_at ?? '07:00',
    )
    const yesterday = addDaysToDay(today, -1)
    const nextWeek = addDaysToDay(today, 7)
    await world.query(
      `insert into restro.reservation_settings
         (tenant_id, venue_id, turn_minutes, online, closed_dates, source, actor, job_id)
       values ($1, $2, 120, $3::jsonb, $4::jsonb, 'staff', 'staff:sm_seed', 'test-seed')`,
      [
        world.tenantId,
        world.venueId,
        JSON.stringify({ bookingPage: true }),
        JSON.stringify([yesterday, nextWeek]),
      ],
    )
    await runBookingJob()
    expect(await readBookingFileFrom(store, world.venueId as VenueId)).toMatchObject({
      on: true,
      closed_dates: [nextWeek],
    })
    const again = await writeBookingFile(
      { pool: world.pool, store, now: () => world.clock },
      { tenantId: world.tenantId, venueId: world.venueId },
    )
    expect(again).toEqual({ status: 'done', written: false, on: true })
  })

  it('writes nothing for a venue the tenant does not have', async () => {
    expect(
      await writeBookingFile(
        { pool: world.pool, store, now: () => world.clock },
        { tenantId: world.tenantId, venueId: newId('vn') },
      ),
    ).toEqual({ status: 'unknown_venue' })
  })
})
