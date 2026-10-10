// barsy-connect against the in-memory installation (MSW + the demo recordings), on a real
// Postgres: success, wrong password, a host this worker must not use, credentials sealed for
// something else. As restro_app, through the job's real handler.
import { JOB_NAMES, newId } from '@restro/core'
import { updateIntegration } from '@restro/core/apply'
import { sealBarsyCredentials } from '@restro/core/seal'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import {
  allowSlowSetup,
  createTestDatabase,
  hasDatabase,
  SETUP_TIMEOUT_MS,
  type TestDatabase,
} from './database'
import { createFakeBarsy } from './fake-barsy'
import { createWorld, DEMO_BID, type World } from './world'

allowSlowSetup()

describe.skipIf(!hasDatabase)('barsy-connect', () => {
  const fake = createFakeBarsy()
  let db: TestDatabase
  let world: World

  beforeAll(async () => {
    db = await createTestDatabase()
    fake.listen()
  }, SETUP_TIMEOUT_MS)
  afterAll(async () => {
    fake.close()
    await db?.drop()
  })
  beforeEach(async () => {
    fake.reset()
    world = await createWorld(fake, { database: db })
  })
  afterEach(async () => {
    await world.close()
  })

  const payload = () => ({ tenantId: world.tenantId, integrationId: world.integrationId })
  const integration = async () =>
    (
      await world.query<{
        status: string
        status_detail: string | null
        last_checked_at: Date | null
        config: Record<string, unknown>
      }>('select * from restro.integrations where id = $1', [world.integrationId])
    )[0]
  const runs = (kind: string) =>
    world.query<{
      status: string
      counters: Record<string, number>
      error_summary: string | null
    }>(
      'select * from restro.job_runs where integration_id = $1 and kind = $2 order by created_at',
      [world.integrationId, kind],
    )

  it('succeeds: pings, records the venues, caches the trees, stores the tier-1 records', async () => {
    await world.query(`update restro.integrations set status = 'new' where id = $1`, [
      world.integrationId,
    ])
    await world.run(JOB_NAMES.barsyConnect, payload())

    const row = await integration()
    expect(row).toMatchObject({ status: 'connected', status_detail: null })
    expect(row?.last_checked_at).toBeInstanceOf(Date)

    // Misc_ping, then Misc_ping_user (with credentials), then the reads.
    expect(fake.calls.map((call) => call.method).slice(0, 2)).toEqual([
      'Misc_ping',
      'Misc_ping_user',
    ])
    expect(fake.calls[0]?.authorization).toBeNull()
    expect(fake.calls[1]?.authorization).toBe(fake.basic())

    const venues = await world.query<{ bid: number; name: string }>(
      'select bid, name from restro.barsy_venues where integration_id = $1 order by bid',
      [world.integrationId],
    )
    expect(venues.length).toBeGreaterThan(0)
    expect(venues.map((venue) => venue.bid)).toContain(DEMO_BID)

    // The cached tree: our own shape, no barsy payload.
    const trees = row?.config.catalogue_trees as Record<
      string,
      { categories: { cat_id: number; parent_id: number | null; name: string }[] }
    >
    const demo = trees[String(DEMO_BID)]
    expect(demo?.categories.find((category) => category.cat_id === 1091)).toBeDefined()
    expect(demo?.categories.find((category) => category.cat_id === 1171)).toBeDefined()

    const types = await world.query<{ external_type: string; n: string }>(
      `select external_type, count(*) as n from restro.source_records
       where integration_id = $1 group by external_type order by external_type`,
      [world.integrationId],
    )
    expect(types.map((type) => type.external_type)).toEqual([
      'article_details',
      'barsy_venue',
      'currency',
      'language',
    ])

    const [run] = await runs('barsy_connect')
    expect(run).toMatchObject({ status: 'completed', error_summary: null })
    expect(run?.counters.venues).toBe(venues.length)
  })

  it('connecting again stores nothing new', async () => {
    await world.run(JOB_NAMES.barsyConnect, payload())
    const count = () =>
      world.query<{ n: string }>(
        'select count(*) as n from restro.source_records where integration_id = $1',
        [world.integrationId],
      )
    const first = await count()
    await world.run(JOB_NAMES.barsyConnect, payload())
    expect(await count()).toEqual(first)
    expect(await runs('barsy_connect')).toHaveLength(2)
  })

  it('a wrong password sets status error with the code wrong_credentials and is not retried', async () => {
    fake.password = 'changed-in-barsy'
    // The handler does not throw: retrying a wrong password only risks locking the API user.
    await expect(world.run(JOB_NAMES.barsyConnect, payload())).resolves.toBeUndefined()
    expect(await integration()).toMatchObject({
      status: 'error',
      status_detail: 'wrong_credentials',
    })
    const [run] = await runs('barsy_connect')
    expect(run?.status).toBe('failed')
    expect(run?.error_summary).toContain('refused the credentials')
    // Only the ping and the credentials check went out: nothing was read with bad credentials.
    expect(fake.calls.map((call) => call.method)).toEqual(['Misc_ping', 'Misc_ping_user'])
  })

  it('never logs or stores the password or the sealed value', async () => {
    fake.password = 'changed-in-barsy'
    await world.run(JOB_NAMES.barsyConnect, payload())
    const [row] = await world.query<{ credentials_sealed: string }>(
      'select credentials_sealed from restro.integrations where id = $1',
      [world.integrationId],
    )
    // The logs and everything the sync wrote about itself (runs, status text, config).
    const everything = [
      ...world.logLines,
      JSON.stringify(await world.query('select * from restro.job_runs')),
      JSON.stringify(
        await world.query('select status, status_detail, config from restro.integrations'),
      ),
    ].join('\n')
    expect(everything).not.toContain('changed-in-barsy')
    expect(everything).not.toContain('demo-password')
    expect(everything).not.toContain(row?.credentials_sealed ?? 'sealed')
    expect(everything).not.toContain(world.publicKeyText)
  })

  it('refuses a host outside the allowed suffixes: status error, no request goes out', async () => {
    await updateIntegration(world.pool, world.tenantId, world.integrationId, {
      host: 'evil.example.com',
    })
    await world.run(JOB_NAMES.barsyConnect, payload())
    expect(await integration()).toMatchObject({
      status: 'error',
      status_detail: 'host_refused',
    })
    expect(fake.calls).toEqual([])
  })

  it('a staging worker refuses a production host', async () => {
    await updateIntegration(world.pool, world.tenantId, world.integrationId, {
      host: 'live-club.barsyonline.com',
    })
    await world.run(JOB_NAMES.barsyConnect, payload())
    expect(await integration()).toMatchObject({
      status: 'error',
      status_detail: 'host_refused',
    })
    expect(fake.calls).toEqual([])
  })

  it('credentials sealed for another host do not open: the message says to connect again', async () => {
    const other = newId('in')
    const sealedElsewhere = sealBarsyCredentials(
      { user: 'demo', password: fake.password },
      {
        tenantId: world.tenantId,
        integrationId: other,
        host: fake.host,
        publicKey: world.publicKeyText,
      },
    )
    await updateIntegration(world.pool, world.tenantId, world.integrationId, {
      credentialsSealed: sealedElsewhere,
    })
    await world.run(JOB_NAMES.barsyConnect, payload())
    const row = await integration()
    expect(row?.status).toBe('error')
    expect(row?.status_detail).toBe('credentials_unreadable')
    expect(fake.calls).toEqual([])
  })

  it('an integration of another tenant is not found: the run fails, nothing is read', async () => {
    const stranger = newId('tn')
    await expect(
      world.run(JOB_NAMES.barsyConnect, {
        tenantId: stranger,
        integrationId: world.integrationId,
      }),
    ).rejects.toThrow()
    expect(fake.calls).toEqual([])
  })
})
