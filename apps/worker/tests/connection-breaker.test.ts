// The connection breaker in the worker (#79; D120, D122 §6) on Postgres: a refusal of the login
// pauses the instance at once (one `pauses` row of scope `connection`, the breaker's state on it,
// a probe queued for its time); a worker restarted from the row neither lifts nor doubles the
// pause and probes no earlier than the row says; three good probes, never before a minute, lift
// it and the watch goes on; a pause Restro's team lifted by hand closes the breaker at the next
// probe; a minute of failed calls pauses it; the tick queues a probe for each paused connection.
// The probes go to a fake connector: what a POS answers is the connector tests' business.
import {
  type IntegrationId,
  newId,
  type ProbeResult,
  type ServiceConnector,
  type VenueId,
} from '@restro/core'
import {
  createIntegration,
  mapBarsyVenue,
  provisionTenant,
  provisionVenue,
  upsertBarsyVenues,
} from '@restro/core/apply'
import { BREAKER, BREAKER_CAUSES } from '@restro/core/service'
import { createPool, type DbPool } from '@restro/db'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { ConnectionBreakers } from '../src/jobs/breaker'
import { judgeProbe, pausedConnections, runProbe } from '../src/jobs/connection'
import { InstanceBudgets } from '../src/jobs/floor'
import { createLogger } from '../src/logger'
import {
  allowSlowSetup,
  createTestDatabase,
  hasDatabase,
  type TestDatabase,
  testSlug,
  withOwnerClient,
} from './database'

allowSlowSetup()

const LIVE: ProbeResult = { kind: 'answered', mode: 'live', degraded: null, fiscalDevice: null }

describe('judgeProbe', () => {
  it('is good only for a correct answer within 3 s', () => {
    expect(judgeProbe(LIVE, 200)).toEqual({ outcome: 'good', cause: null })
    expect(judgeProbe({ ...LIVE, mode: null }, 200).outcome).toBe('good')
    expect(judgeProbe(LIVE, BREAKER.probeBudgetMs + 1).outcome).toBe('bad')
    expect(judgeProbe({ ...LIVE, degraded: true }, 200).outcome).toBe('bad')
    expect(judgeProbe({ kind: 'unknown', reason: 'timed out' }, 200).outcome).toBe('bad')
  })

  it('takes training mode, a fiscal device out and a refusal as refusals', () => {
    expect(judgeProbe({ ...LIVE, mode: 'training' }, 200)).toEqual({
      outcome: 'refused',
      cause: 'training_mode',
    })
    expect(judgeProbe({ ...LIVE, fiscalDevice: 'fault' }, 200)).toEqual({
      outcome: 'refused',
      cause: 'fiscal_device',
    })
    expect(
      judgeProbe(
        {
          kind: 'refused',
          refusal: { code: 'credentials', scope: 'login', line: null, detail: null },
        },
        200,
      ),
    ).toEqual({ outcome: 'refused', cause: 'credentials' })
  })
})

describe.skipIf(!hasDatabase)('the connection breaker', () => {
  let db: TestDatabase
  let pool: DbPool
  const tenantId = newId('tn')
  let log: Awaited<ReturnType<typeof createLogger>>
  let demo: { venueId: VenueId; integrationId: IntegrationId }
  let host = 0

  const query = <Row extends object = Record<string, unknown>>(
    sql: string,
    values: unknown[] = [],
  ) =>
    withOwnerClient(db.ownerUrl, async (client) => (await client.query(sql, values)).rows as Row[])

  /** The clock the breaker runs on; each test moves it. */
  let at = 0
  const sent: { name: string; data: object; startAfter: number | undefined }[] = []
  const queue = {
    async send(name: string, data: object, options?: { startAfter?: number | undefined }) {
      sent.push({ name, data, startAfter: options?.startAfter })
      return 'job'
    },
  }
  const env = () => ({ pool, log, now: () => new Date(at), queue })
  const ref = () => ({ tenantId, integrationId: demo.integrationId })
  const policy = { env: 'test', allowHosts: [] } as const

  /** A connector whose probe answers what the test says. */
  let answer: ProbeResult = LIVE
  let probes = 0
  const fake = {
    probe: async () => {
      probes += 1
      return answer
    },
  } as unknown as ServiceConnector
  const deps = (breakers: ConnectionBreakers) => ({
    sim: policy,
    budgets: new InstanceBudgets(),
    breakers,
    connectorFor: () => fake,
    clock: () => 0,
  })

  const connectionPauses = () =>
    query<{
      id: string
      cause: string
      restro_started: boolean
      lifted_at: Date | null
      lift_reason: string | null
      probe_count: number
      next_probe_at: Date | null
      details: Record<string, unknown>
    }>(
      `select id, cause, restro_started, lifted_at, lift_reason, probe_count, next_probe_at, details
       from restro.pauses where scope = 'connection' and target_id = $1 order by started_at`,
      [demo.integrationId],
    )

  beforeAll(async () => {
    db = await createTestDatabase()
    pool = createPool(db.appUrl, { applicationName: 'restro-worker-breaker-tests', max: 4 })
    await provisionTenant(pool, { tenantId, name: 'Breaker club' })
    await query(
      `insert into restro.auth_organization (id, name, slug) values ($1, 'Breaker club', $2)`,
      [tenantId, `breaker-${newId('tn').slice(3, 11)}`],
    )
    log = await createLogger({ level: 'debug', pretty: false, destination: { write: () => {} } })
  })

  afterAll(async () => {
    await pool?.end()
    await db?.drop()
  })

  beforeEach(async () => {
    // A fresh instance and venue per test: no pause, no history.
    host += 1
    const integrationId = (
      await createIntegration(pool, tenantId, { kind: 'sim', host: `127.0.0.1:${9000 + host}` })
    ).id
    const venue = await provisionVenue(pool, tenantId, {
      name: 'Breaker Bar',
      slug: testSlug('breaker'),
    })
    await upsertBarsyVenues(pool, tenantId, integrationId, [{ bid: 1, name: 'Breaker Bar' }])
    expect((await mapBarsyVenue(pool, tenantId, integrationId, 1, venue.id)).ok).toBe(true)
    demo = { venueId: venue.id as VenueId, integrationId: integrationId as IntegrationId }
    at = Date.now()
    sent.length = 0
    answer = LIVE
    probes = 0
  })

  const refusal = { kind: 'refused', cause: 'credentials' } as const

  it('pauses the instance at once on a refusal of its login, with a probe queued', async () => {
    const breakers = new ConnectionBreakers(() => 0.5)
    const state = await breakers.record(env(), ref(), refusal)
    expect(state.open?.cause).toBe('credentials')
    expect(await breakers.gate(env(), ref())).toBe('paused')

    const [pause, ...more] = await connectionPauses()
    expect(more).toEqual([])
    expect(pause).toMatchObject({ cause: 'credentials', restro_started: true, lifted_at: null })
    expect(pause?.details.venueIds).toEqual([demo.venueId])
    const saved = pause?.details.breaker as { open: { since: number } } | undefined
    expect(saved?.open.since).toBe(at)
    // A refusal backs off: the first probe after 60 s (no jitter with random 0.5).
    expect(pause?.next_probe_at?.getTime()).toBe(at + 60_000)
    expect(sent).toEqual([{ name: 'connection-probe', data: ref(), startAfter: 60 }])
  })

  it('a restarted worker neither lifts nor doubles the pause, nor probes early', async () => {
    await new ConnectionBreakers(() => 0.5).record(env(), ref(), refusal)
    const [before] = await connectionPauses()

    // A new process: the breaker comes back from the row.
    const restarted = new ConnectionBreakers(() => 0.5)
    at += 10_000
    expect(await restarted.gate(env(), ref())).toBe('paused')
    await restarted.record(env(), ref(), refusal)
    await restarted.record(env(), ref(), { kind: 'call', ok: true, elapsedMs: 100 })
    const run = await runProbe(env(), ref(), deps(restarted))
    expect(run).toEqual({ kind: 'not_due', at: expect.any(Number) })
    expect(probes).toBe(0)

    const after = await connectionPauses()
    expect(after).toHaveLength(1)
    expect(after[0]?.id).toBe(before?.id)
    expect(after[0]?.lifted_at).toBeNull()
  })

  it('lifts after three good probes and not before a minute, then watches', async () => {
    const breakers = new ConnectionBreakers(() => 0.5)
    await breakers.record(env(), ref(), { kind: 'refused', cause: BREAKER_CAUSES.unreachable })
    const probeAt = async () => {
      const state = await breakers.state(env(), ref())
      at = state.open?.nextProbeAt ?? state.nextProbeAt ?? at
      return runProbe(env(), ref(), deps(breakers))
    }

    expect(await probeAt()).toEqual({ kind: 'probed', outcome: 'good' })
    expect(await probeAt()).toEqual({ kind: 'probed', outcome: 'good' })
    let [pause] = await connectionPauses()
    expect(pause?.lifted_at).toBeNull()
    expect(pause?.probe_count).toBe(2)

    expect(await probeAt()).toEqual({ kind: 'probed', outcome: 'good' })
    ;[pause] = await connectionPauses()
    expect(pause?.lifted_at).not.toBeNull()
    expect(pause?.lift_reason).toBe('probes_good')
    expect(pause?.probe_count).toBe(3)
    const state = await breakers.state(env(), ref())
    expect(state.open).toBeNull()
    expect(state.watchUntil).toBe(at + BREAKER.watchMs)
    expect(await breakers.gate(env(), ref())).toBe('open')
    // The watch probes on.
    expect(sent.at(-1)).toEqual({ name: 'connection-probe', data: ref(), startAfter: 15 })
  })

  it('keeps the pause while the probe finds training mode', async () => {
    const breakers = new ConnectionBreakers(() => 0.5)
    await breakers.record(env(), ref(), refusal)
    answer = { ...LIVE, mode: 'training' }
    for (let i = 0; i < 4; i++) {
      const state = await breakers.state(env(), ref())
      at = state.open?.nextProbeAt ?? at
      expect(await runProbe(env(), ref(), deps(breakers))).toEqual({
        kind: 'probed',
        outcome: 'refused',
      })
    }
    const [pause] = await connectionPauses()
    expect(pause?.lifted_at).toBeNull()
    expect(pause?.probe_count).toBe(4)
  })

  it('closes when Restro’s team lifted the pause by hand', async () => {
    const breakers = new ConnectionBreakers(() => 0.5)
    await breakers.record(env(), ref(), refusal)
    await query(
      `update restro.pauses set lifted_at = now(), lift_reason = 'lifted' where target_id = $1`,
      [demo.integrationId],
    )
    at = (await breakers.state(env(), ref())).open?.nextProbeAt ?? at
    answer = { kind: 'unknown', reason: 'still down' }
    await runProbe(env(), ref(), deps(breakers))
    const state = await breakers.state(env(), ref())
    expect(state.open).toBeNull()
    expect(state.watchUntil).toBe(at + BREAKER.watchMs)
    expect(await connectionPauses()).toHaveLength(1)
  })

  it('pauses after a minute of failed calls, and a restart remembers the recent pauses', async () => {
    const breakers = new ConnectionBreakers(() => 0.5)
    for (let i = 0; i <= 3; i++) {
      await breakers.record(env(), ref(), { kind: 'call', ok: false })
      at += 20_000
    }
    const [pause] = await connectionPauses()
    expect(pause?.cause).toBe(BREAKER_CAUSES.unreachable)

    await query(`update restro.pauses set lifted_at = now() where target_id = $1`, [
      demo.integrationId,
    ])
    const restarted = new ConnectionBreakers(() => 0.5)
    const state = await restarted.state(env(), ref())
    expect(state.open).toBeNull()
    expect(state.autoPauses).toHaveLength(1)
    // Lifted moments ago: the watch runs, and a probe is due.
    expect(state.watchUntil).not.toBeNull()
  })

  it('the tick finds each paused connection with its probe time', async () => {
    await new ConnectionBreakers(() => 0.5).record(env(), ref(), refusal)
    const paused = await pausedConnections(pool)
    expect(paused).toContainEqual({
      tenantId,
      integrationId: demo.integrationId,
      nextProbeAt: new Date(at + 60_000),
    })
  })
})
