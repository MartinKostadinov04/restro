// The venue's night in the worker (#82; D120, D122 §4) on Postgres: at the closing hour the tick
// closes every table of the venue (reason `closing_hour`) and touches no venue without hours; the
// pre-opening check starts 2 hours before opening, runs once per 10-minute slot, probes the POS
// like a pause does, pauses the connection when the POS refuses or does not answer, alerts the
// venue's staff and Restro's team (one alert) only from 30 minutes before opening, and does nothing on a
// closed night. The probes go to a fake connector: what a POS answers is the connector tests'
// business.
import {
  DEFAULT_ORDERING_SETTINGS,
  type IntegrationId,
  newId,
  type ProbeResult,
  type ServiceConnector,
  type VenueId,
} from '@restro/core'
import {
  createArea,
  createIntegration,
  createTable,
  mapBarsyVenue,
  provisionTenant,
  provisionVenue,
  upsertBarsyVenues,
} from '@restro/core/apply'
import { createPool, type DbPool } from '@restro/db'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { ConnectionBreakers } from '../src/jobs/breaker'
import { InstanceBudgets } from '../src/jobs/floor'
import {
  type CheckedSlots,
  closeTablesAtClosingHour,
  runPreOpeningChecks,
} from '../src/jobs/service-hours'
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

// Open Friday and Saturday 22:00, last orders 04:30, closing 05:30 (Sofia, the service day ends
// 07:00). Friday 2026-10-23 opens at 19:00Z (summer time), so its check starts at 17:00Z.
const NIGHT = { opens: '22:00', lastOrders: '04:30', closes: '05:30' }
const HOURS = { ...DEFAULT_ORDERING_SETTINGS.serviceHours, fri: NIGHT, sat: NIGHT }
const LIVE: ProbeResult = { kind: 'answered', mode: 'live', degraded: null, fiscalDevice: null }
const quiet = { warn: () => undefined }

describe.skipIf(!hasDatabase)('the venue night jobs', () => {
  let db: TestDatabase
  let pool: DbPool
  const tenantId = newId('tn')
  let log: Awaited<ReturnType<typeof createLogger>>

  const query = <Row extends object = Record<string, unknown>>(
    sql: string,
    values: unknown[] = [],
  ) =>
    withOwnerClient(db.ownerUrl, async (client) => (await client.query(sql, values)).rows as Row[])

  const setOrdering = (venueId: string, serviceHours: unknown) =>
    query(
      `update restro.venues set settings = jsonb_set(settings, '{ordering}', $2::jsonb) where id = $1`,
      [venueId, JSON.stringify({ ...DEFAULT_ORDERING_SETTINGS, serviceHours })],
    )

  beforeAll(async () => {
    db = await createTestDatabase()
    pool = createPool(db.appUrl, { applicationName: 'restro-worker-service-hours-tests', max: 4 })
    await provisionTenant(pool, { tenantId, name: 'Night club' })
    await query(
      `insert into restro.auth_organization (id, name, slug) values ($1, 'Night club', $2)`,
      [tenantId, `night-${newId('tn').slice(3, 11)}`],
    )
    log = await createLogger({ level: 'debug', pretty: false, destination: { write: () => {} } })
  })

  afterAll(async () => {
    await pool?.end()
    await db?.drop()
  })

  describe('the closing hour', () => {
    let venueId: string
    let sittingIds: string[]
    let untouchedVenueId: string
    let untouchedSitting: string

    async function venueWithOpenTables(name: string, hours: unknown, count: number) {
      const venue = await provisionVenue(pool, tenantId, { name, slug: testSlug('close') })
      await setOrdering(venue.id, hours)
      const area = await createArea(pool, tenantId, venue.id, 'Hall')
      if (!area.ok) throw new Error(area.reason)
      const sittings: string[] = []
      for (let n = 1; n <= count; n++) {
        const table = await createTable(pool, tenantId, {
          areaId: area.area.id,
          name: null,
          number: String(n),
        })
        if (!table.ok) throw new Error(table.reason)
        const id = newId('st')
        await query(
          `insert into restro.sittings
             (id, tenant_id, venue_id, table_id, service_date, opened_how, source, actor, job_id)
           values ($1, $2, $3, $4, '2026-10-23', 'one', 'restro', 'system', 'test-seed')`,
          [id, tenantId, venue.id, table.table.id],
        )
        sittings.push(id)
      }
      return { venueId: venue.id, sittings }
    }

    beforeEach(async () => {
      await query(`update restro.venues set settings = settings - 'ordering'`)
      ;({ venueId, sittings: sittingIds } = await venueWithOpenTables('Closing Bar', HOURS, 3))
      const other = await venueWithOpenTables(
        'No hours Bar',
        DEFAULT_ORDERING_SETTINGS.serviceHours,
        1,
      )
      untouchedVenueId = other.venueId
      untouchedSitting = other.sittings[0] as string
    })

    const endState = async (id: string) =>
      (
        await query<{ ended_at: Date | null; end_reason: string | null }>(
          'select ended_at, end_reason from restro.sittings where id = $1',
          [id],
        )
      )[0]

    it('closes every table of a venue at its closing hour, with a Log entry each', async () => {
      // Closes 05:30 Saturday = 02:30Z.
      expect(await closeTablesAtClosingHour(pool, new Date('2026-10-24T02:29:00Z'), quiet)).toBe(0)
      for (const id of sittingIds) expect((await endState(id))?.ended_at).toBeNull()

      expect(await closeTablesAtClosingHour(pool, new Date('2026-10-24T02:30:00Z'), quiet)).toBe(3)
      for (const id of sittingIds) {
        expect((await endState(id))?.end_reason).toBe('closing_hour')
        const log = await query(
          `select reason, actor from restro.log_entries where sitting_id = $1 and kind = 'sitting.ended'`,
          [id],
        )
        expect(log).toEqual([{ reason: 'closing_hour', actor: 'system' }])
      }
      // A second run finds nothing to close.
      expect(await closeTablesAtClosingHour(pool, new Date('2026-10-24T02:31:00Z'), quiet)).toBe(0)
    })

    it('closes a table kept for a payment when the payment ends, past 07:00 (D122)', async () => {
      const paymentId = newId('py')
      const [table] = await query<{ table_id: string }>(
        'select table_id from restro.sittings where id = $1',
        [sittingIds[0]],
      )
      await query(
        `insert into restro.payments
           (id, tenant_id, venue_id, table_id, sitting_id, service_date, kind, state, handle_hash,
            currency, provider_kind, source, actor, job_id)
         values ($1, $2, $3, $4, $5, '2026-10-23', 'on_bill', 'held', $6, 'EUR', 'sim', 'guest',
                 'guest', 'test-seed')`,
        [paymentId, tenantId, venueId, table?.table_id, sittingIds[0], 'a'.repeat(64)],
      )
      expect(await closeTablesAtClosingHour(pool, new Date('2026-10-24T02:30:00Z'), quiet)).toBe(2)
      expect((await endState(sittingIds[0] as string))?.ended_at).toBeNull()
      // 07:01 in Sofia: the service day is over and the payment still going, so nothing yet.
      expect(await closeTablesAtClosingHour(pool, new Date('2026-10-24T04:01:00Z'), quiet)).toBe(0)
      await query(
        `update restro.payments set state = 'captured', settled_at = now() where id = $1`,
        [paymentId],
      )
      expect(await closeTablesAtClosingHour(pool, new Date('2026-10-24T04:02:00Z'), quiet)).toBe(1)
      expect((await endState(sittingIds[0] as string))?.end_reason).toBe('closing_hour')
    })

    it('leaves a venue with no hours alone', async () => {
      await closeTablesAtClosingHour(pool, new Date('2026-10-24T03:00:00Z'), quiet)
      expect((await endState(untouchedSitting))?.ended_at).toBeNull()
      expect(untouchedVenueId).not.toBe(venueId)
    })

    it('counts the closing hour in the venue’s zone: after the autumn change it is an hour later', async () => {
      // Saturday 2026-10-24's night closes 05:30 on Sunday, after the clocks went back: 03:30Z.
      expect(await closeTablesAtClosingHour(pool, new Date('2026-10-25T02:30:00Z'), quiet)).toBe(0)
      expect(await closeTablesAtClosingHour(pool, new Date('2026-10-25T03:30:00Z'), quiet)).toBe(3)
    })
  })

  describe('the pre-opening check', () => {
    let demo: { venueId: VenueId; integrationId: IntegrationId }
    let host = 0
    let at = 0
    let answer: ProbeResult = LIVE
    let probes = 0
    let breakers: ConnectionBreakers
    let checked: CheckedSlots
    const fake = {
      probe: async () => {
        probes += 1
        return answer
      },
    } as unknown as ServiceConnector
    const policy = { env: 'test', allowHosts: [] } as const
    const env = () => ({ pool, log, now: () => new Date(at) })
    const deps = () => ({
      sim: policy,
      budgets: new InstanceBudgets(),
      breakers,
      connectorFor: () => fake,
      clock: () => 0,
    })
    const check = (iso: string) => {
      at = new Date(iso).getTime()
      return runPreOpeningChecks(env(), deps(), checked)
    }
    const alerts = () =>
      query<{ audience: string; details: Record<string, unknown> }>(
        `select audience, details from restro.alerts
          where venue_id = $1 and kind = 'pre_opening_check' order by audience`,
        [demo.venueId],
      )
    const pauses = () =>
      query<{ cause: string; lifted_at: Date | null }>(
        `select cause, lifted_at from restro.pauses where scope = 'connection' and target_id = $1`,
        [demo.integrationId],
      )

    beforeEach(async () => {
      // Earlier tests' venues have their own instances: they take no part in this one.
      await query(`update restro.venues set settings = settings - 'ordering'`)
      host += 1
      const integrationId = (
        await createIntegration(pool, tenantId, { kind: 'sim', host: `127.0.0.1:${9500 + host}` })
      ).id
      const venue = await provisionVenue(pool, tenantId, {
        name: 'Opening Bar',
        slug: testSlug('opening'),
      })
      await setOrdering(venue.id, HOURS)
      await upsertBarsyVenues(pool, tenantId, integrationId, [{ bid: 1, name: 'Opening Bar' }])
      expect((await mapBarsyVenue(pool, tenantId, integrationId, 1, venue.id)).ok).toBe(true)
      demo = { venueId: venue.id as VenueId, integrationId: integrationId as IntegrationId }
      answer = LIVE
      probes = 0
      breakers = new ConnectionBreakers(() => 0.5)
      checked = new Set()
    })

    it('does not start before 2 hours ahead of opening', async () => {
      expect(await check('2026-10-23T16:59:00Z')).toEqual({ checked: 0, failed: 0, alerted: 0 })
      expect(probes).toBe(0)
    })

    it('probes once from 2 hours ahead and once per 10-minute slot', async () => {
      expect(await check('2026-10-23T17:00:00Z')).toMatchObject({ checked: 1, failed: 0 })
      expect(probes).toBe(1)
      // The same slot again (the next tick, or a restart) probes nothing.
      expect(await check('2026-10-23T17:01:00Z')).toMatchObject({ checked: 0 })
      expect(await check('2026-10-23T17:09:00Z')).toMatchObject({ checked: 0 })
      expect(probes).toBe(1)
      expect(await check('2026-10-23T17:10:00Z')).toMatchObject({ checked: 1 })
      expect(probes).toBe(2)
      expect(await pauses()).toEqual([])
      expect(await alerts()).toEqual([])
    })

    it('stops at opening: a connection pause or the breaker takes over', async () => {
      expect(await check('2026-10-23T19:00:00Z')).toEqual({ checked: 0, failed: 0, alerted: 0 })
      expect(probes).toBe(0)
    })

    it('does nothing on a closed night: no probe, no pause, no alert', async () => {
      // Thursday 2026-10-22 is closed, and the next opening (Friday 22:00) is a day away.
      for (const iso of ['2026-10-22T10:00:00Z', '2026-10-22T18:00:00Z', '2026-10-22T20:00:00Z']) {
        expect(await check(iso)).toEqual({ checked: 0, failed: 0, alerted: 0 })
      }
      expect(probes).toBe(0)
      expect(await alerts()).toEqual([])
    })

    it('pauses the connection when the POS refuses, but alerts nobody before 30 minutes ahead', async () => {
      answer = {
        kind: 'refused',
        refusal: { code: 'credentials', scope: 'login', line: null, detail: null },
      }
      expect(await check('2026-10-23T17:00:00Z')).toMatchObject({
        checked: 1,
        failed: 1,
        alerted: 0,
      })
      expect(await pauses()).toMatchObject([{ cause: 'credentials', lifted_at: null }])
      expect(await alerts()).toEqual([])
    })

    it('alerts the venue and Restro from 30 minutes ahead, once for the night', async () => {
      answer = {
        kind: 'refused',
        refusal: { code: 'credentials', scope: 'login', line: null, detail: null },
      }
      expect(await check('2026-10-23T18:29:00Z')).toMatchObject({ failed: 1, alerted: 0 })
      expect(await check('2026-10-23T18:30:00Z')).toMatchObject({ failed: 1, alerted: 1 })
      expect(await alerts()).toMatchObject([
        { audience: 'venue', details: { cause: 'credentials' } },
      ])
      expect(await check('2026-10-23T18:40:00Z')).toMatchObject({ failed: 1, alerted: 0 })
      expect(await alerts()).toHaveLength(1)
    })

    it('treats a POS that does not answer as a failed check: paused, and alerted when due', async () => {
      answer = { kind: 'unknown', reason: 'timed out' }
      expect(await check('2026-10-23T18:30:00Z')).toMatchObject({ failed: 1, alerted: 1 })
      expect(await pauses()).toMatchObject([{ cause: 'pos_unreachable', lifted_at: null }])
      expect(await alerts()).toMatchObject([
        { audience: 'venue', details: { cause: 'pos_unreachable' } },
      ])
    })

    it('raises no alert when the check passes', async () => {
      expect(await check('2026-10-23T18:30:00Z')).toEqual({ checked: 1, failed: 0, alerted: 0 })
      expect(await alerts()).toEqual([])
    })

    it('leaves a venue with no POS instance alone', async () => {
      const handMade = await provisionVenue(pool, tenantId, {
        name: 'Hand-made Bar',
        slug: testSlug('hand'),
      })
      await setOrdering(handMade.id, HOURS)
      // Only the demo venue has an instance, so one probe, whatever the other venues are.
      expect(await check('2026-10-23T17:00:00Z')).toMatchObject({ checked: 1 })
      expect(probes).toBe(1)
    })
  })
})
