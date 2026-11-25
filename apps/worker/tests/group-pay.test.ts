// One payment over several tables of a linked group (#542, D160 §2) on Postgres through the
// worker's real code, against a real simulator server over HTTP and the simulated card provider.
// A party is seated on tables 1 to 4, one linked group; the paying phone is at table 2. "The whole
// bill" moves every member table's lines onto one payment table of table 2's bar, under each
// table's own turn, and closes it once: one close, one capture. A pick mixing tables pays those
// lines alone. Two phones paying one line at once: one holds it, the other is told it is being
// paid. A move the POS refuses after some tables' lines moved, a failed last check, and "No
// receipt" after a close the POS did not confirm each put every line back on its own table. A
// member table whose bill did not read well holds back its lines and the whole bill. At a POS that
// splits a bill off instead of moving lines, each table pays its own. Only the simulator is ever
// called (rule 7).
import { randomUUID } from 'node:crypto'

import {
  DEFAULT_ORDERING_SETTINGS,
  hashTableCode,
  type IntegrationId,
  newId,
  type PaymentJob,
  providerRef,
  SERVICE_TIMINGS,
  type ServiceConnector,
  serviceDate,
  type VenueId,
} from '@restro/core'
import {
  createIntegration,
  mapBarsyVenue,
  provisionTenant,
  provisionVenue,
  setFloorSource,
  upsertBarsyVenues,
} from '@restro/core/apply'
import {
  applyService,
  DEFAULT_ROLE_PERMISSIONS,
  forgetGuestCodes,
  GUEST_LIMITS,
  type GuestLimit,
  GuestLimiter,
  type GuestLimitName,
  guestAct,
  guestState,
  type ServiceCommand,
  type ServiceContext,
} from '@restro/core/service'
import { createPool, type DbPool } from '@restro/db'
import {
  createSimPayProvider,
  SIM_PAY_KIND,
  ManualClock as SimPayClock,
  SimPayEngine,
} from '@restro/sim-pay'
import {
  buildEngine,
  createSimPosConnector,
  createSimServer,
  type FaultRule,
  fetchTransport,
  loadScenarioFile,
  readingLogin,
  ManualClock as SimPosClock,
  type SimServer,
  type SimSwitches,
} from '@restro/sim-pos'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { readFloorOf } from '../src/jobs/floor'
import {
  checkPayment,
  type PaymentJobDeps,
  PaymentStepRetry,
  preparePayment,
} from '../src/jobs/payments'
import { ReadingBudgets, readTableOf, TABLE_READ_MIN_GAP_MS } from '../src/jobs/readings'
import type { JobQueue } from '../src/jobs/types'
import { createLogger } from '../src/logger'
import { serviceConnectorFor } from '../src/service-connectors'
import {
  allowSlowSetup,
  createTestDatabase,
  hasDatabase,
  type TestDatabase,
  testSlug,
  withOwnerClient,
} from './database'
import { simBudgets, TEST_WRITE_TIMEOUT_MS } from './sim-pace'

allowSlowSetup()

const KEY = 'group-pay-test-key-'.padEnd(48, 'x')
/** Demo Bar's tables 1 to 4 on the simulator, all of the main hall's bar. */
const NUMBERS = ['1', '2', '3', '4'] as const
type TableNumber = (typeof NUMBERS)[number]
const POS_TABLES: Record<TableNumber, string> = {
  '1': '30001',
  '2': '30002',
  '3': '30003',
  '4': '30004',
}
/** The main hall's payment tables. */
const PAYMENT_TABLES = ['39001', 'pay main 2']
const CALL_MS = 500
const TIMINGS = { ...SERVICE_TIMINGS, readTimeoutMs: 2_000, writeTimeoutMs: TEST_WRITE_TIMEOUT_MS }
const BETWEEN_RUNS_MS = 5_000
const SETTLED = ['captured', 'released', 'stranded', 'capture_failed']

const LOOSE = new GuestLimiter(
  Object.fromEntries(
    Object.entries(GUEST_LIMITS).map(([name, limit]) => [name, { ...limit, max: 10_000 }]),
  ) as Record<GuestLimitName, GuestLimit>,
)

describe.skipIf(!hasDatabase)("one payment over a linked group's tables", () => {
  let db: TestDatabase
  let pool: DbPool
  let sim: SimServer
  const simClock = new SimPosClock()
  const payClock = new SimPayClock(new Date())
  const engine = new SimPayEngine({ clock: payClock })
  const provider = createSimPayProvider({ env: 'test', engine })
  const tenantId = newId('tn')
  const ownerId = `svc-${newId('us').slice(3)}`
  let log: Awaited<ReturnType<typeof createLogger>>
  let clock = new Date()
  let demo: { venueId: VenueId; integrationId: IntegrationId }
  let accountRef: string
  let managerId: string
  let partyId: string
  const tables = new Map<TableNumber, `tb_${string}`>()
  const codes = new Map<TableNumber, string>()
  let beforeCall: (method: string, args: unknown[]) => void | Promise<void> = () => {}
  const queue: JobQueue = {
    async send() {
      return randomUUID()
    },
  }

  const query = <Row extends object = Record<string, unknown>>(
    sql: string,
    values: unknown[] = [],
  ) =>
    withOwnerClient(db.ownerUrl, async (client) => (await client.query(sql, values)).rows as Row[])

  const policy = { env: 'test', allowHosts: [] } as const
  const env = () => ({ pool, log, now: () => clock, queue, jobId: `payment-${randomUUID()}` })
  // The till's switches beyond Demo Bar's (`reset`): the connector declares from the same ones.
  let switched: Partial<SimSwitches> = {}
  const connectorFor: typeof serviceConnectorFor = (integration, simPolicy) => {
    const scenario = loadScenarioFile('demo-bar')
    const connector =
      Object.keys(switched).length === 0
        ? serviceConnectorFor(integration, simPolicy)
        : createSimPosConnector({
            transport: fetchTransport(`http://${integration.host}`, simPolicy),
            login: readingLogin(scenario),
            switches: { ...scenario.switches, ...switched },
          })
    return new Proxy(connector, {
      get(target, name, receiver) {
        const value = Reflect.get(target, name, receiver)
        if (typeof value !== 'function') return value
        return (...args: unknown[]) => {
          simClock.advance(CALL_MS)
          const before = beforeCall(String(name), args)
          if (before instanceof Promise) return before.then(() => value.apply(target, args))
          return value.apply(target, args)
        }
      },
    }) as ServiceConnector
  }
  const deps = (): PaymentJobDeps => ({
    sim: policy,
    providers: new Map([[SIM_PAY_KIND, provider]]),
    budgets: simBudgets(simClock),
    connectorFor,
    timings: TIMINGS,
    sleep: async (ms) => {
      simClock.advance(ms)
    },
  })
  const target = (paymentId: string): PaymentJob => ({
    tenantId,
    venueId: demo.venueId,
    paymentId: paymentId as PaymentJob['paymentId'],
  })
  const staff = (): ServiceContext => ({
    tenantId,
    venueId: demo.venueId,
    origin: 'staff',
    actor: { kind: 'user', userId: ownerId, sessionId: `sess-${randomUUID()}` },
    jobId: `req-${randomUUID()}`,
    signedInAt: new Date(),
  })
  async function accept(command: ServiceCommand): Promise<Record<string, unknown>> {
    const { result } = await applyService(pool, command, staff())
    if (result.status !== 'accepted') {
      throw new Error(`${command.type} refused: ${result.code} ${JSON.stringify(result.details)}`)
    }
    return result.details
  }
  const tableId = (number: TableNumber) => tables.get(number) as `tb_${string}`

  /** Reads the till's floor again: the connector's capabilities are recorded from it. */
  async function readFloor() {
    simClock.advance(1100)
    const floor = await readFloorOf(
      { pool, log, now: () => clock },
      { tenantId, ...demo },
      { sim: policy, budgets: simBudgets(simClock), connectorFor },
    )
    expect(floor.kind).toBe('read')
  }

  beforeAll(async () => {
    db = await createTestDatabase()
    pool = createPool(db.appUrl, { applicationName: 'restro-worker-group-pay-tests', max: 4 })
    await provisionTenant(pool, { tenantId, name: 'Group pay club' })
    await query(
      `insert into restro.auth_organization (id, name, slug) values ($1, 'Group pay club', $2)`,
      [tenantId, `grouppay-${newId('tn').slice(3, 11)}`],
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
    log = await createLogger({ level: 'debug', pretty: false, destination: { write: () => {} } })
    sim = createSimServer({ scenario: 'demo-bar', print: () => {}, clock: simClock })
    const host = `127.0.0.1:${await sim.listen(0)}`

    const integrationId = (await createIntegration(pool, tenantId, { kind: 'sim', host })).id
    const venue = await provisionVenue(pool, tenantId, {
      name: 'Demo Bar',
      slug: testSlug('grouppay'),
    })
    await upsertBarsyVenues(pool, tenantId, integrationId, [{ bid: 1, name: 'Demo Bar' }])
    expect((await mapBarsyVenue(pool, tenantId, integrationId, 1, venue.id)).ok).toBe(true)
    demo = { venueId: venue.id as VenueId, integrationId: integrationId as IntegrationId }
    await setFloorSource(pool, tenantId, {
      venueId: demo.venueId,
      source: { halls: null, bars: null, paymentTables: ['PM1', 'PM2'] },
    })
    await readFloor()
    for (const number of NUMBERS) {
      const [table] = await query<{ id: `tb_${string}` }>(
        'select id from restro.tables where venue_id = $1 and number = $2',
        [demo.venueId, number],
      )
      if (table === undefined) throw new Error(`no table ${number}`)
      tables.set(number, table.id)
      const code = `code${randomUUID().replaceAll('-', '')}`
      await query('update restro.tables set qr_token = $2, qr_code_hash = $3 where id = $1', [
        table.id,
        code,
        await hashTableCode(code),
      ])
      codes.set(number, code)
    }
    // Paying is on only with a payment table in every bar (D125 2.3).
    await query(
      `update restro.tables set is_payment_table = true where venue_id = $1 and number = 'PU1'`,
      [demo.venueId],
    )
    await query(
      `update restro.venues set settings = jsonb_set(settings, '{ordering}', $2::jsonb) where id = $1`,
      [demo.venueId, JSON.stringify({ ...DEFAULT_ORDERING_SETTINGS, locationCheck: false })],
    )
    const account = engine.addAccount()
    engine.finishConnecting(account)
    accountRef = account.provider
    await query(
      `update restro.venues set settings = settings || '{"legalDetails":{"name":"Club EOOD","eik":"123456789","address":"Sofia, 1 Vitosha Blvd","privacyUrl":"https://club.example/privacy"}}'::jsonb where id = $1`,
      [demo.venueId],
    )
    await query(
      `insert into restro.payment_accounts
         (tenant_id, venue_id, provider_kind, account_ref, state, checks, connected_at, source, actor, job_id)
       values ($1, $2, $3, $4, 'connected', '{"cardPayments":true,"ticks":{"cardTypeInTill":{"at":"2026-10-27T00:00:00Z","by":"system"},"receiptEmailsOff":{"at":"2026-10-27T00:00:00Z","by":"system"}}}'::jsonb, now(), 'restro', 'system', 'test-seed')`,
      [tenantId, demo.venueId, SIM_PAY_KIND, accountRef],
    )

    // A manager, who answers a close the POS did not confirm.
    managerId = `group-manager-${randomUUID()}`
    await query('insert into restro.auth_user (id, name, email) values ($1, $2, $3)', [
      managerId,
      'Manager',
      `${managerId}@example.test`,
    ])
    await query(
      'insert into restro.auth_member (id, organization_id, user_id, role) values ($1, $2, $3, $4)',
      [`mb-${managerId}`, tenantId, managerId, 'member'],
    )
    const staffMemberId = newId('sm')
    const roleId = newId('rl')
    await query(
      `insert into restro.staff_members (id, tenant_id, display_name, user_id, source, actor, job_id)
       values ($1, $2, 'Manager', $3, 'restro', 'system', 'test-seed')`,
      [staffMemberId, tenantId, managerId],
    )
    await query(
      `insert into restro.venue_roles (id, tenant_id, venue_id, name, permissions, source, actor, job_id)
       values ($1, $2, $3, 'Manager', $4::jsonb, 'restro', 'system', 'test-seed')`,
      [roleId, tenantId, demo.venueId, JSON.stringify(DEFAULT_ROLE_PERMISSIONS.manager)],
    )
    await query(
      `insert into restro.staff_assignments (tenant_id, staff_member_id, venue_id, role_id, source, actor, job_id)
       values ($1, $2, $3, $4, 'restro', 'system', 'test-seed')`,
      [tenantId, staffMemberId, demo.venueId, roleId],
    )

    // A floor plan with a spot on each table, and a party booked on all four and marked present:
    // its tables open, and they are one linked group.
    await accept({ type: 'reservation_settings.set', turnMinutes: 90 } as ServiceCommand)
    const planId = (
      await accept({ type: 'plan.save', name: 'Floor', makeCurrent: true } as ServiceCommand)
    ).planId as string
    await accept({
      type: 'spot_kind.save',
      key: 'table',
      label: 'Table',
      defaultSeats: 4,
    } as ServiceCommand)
    const spotIds: string[] = []
    for (const [index, number] of NUMBERS.entries()) {
      const details = await accept({
        type: 'spot.save',
        planId,
        name: `T${number}`,
        kind: 'table',
        shape: 'rect',
        x: index * 100,
        y: 0,
        width: 80,
        height: 80,
        tableId: tableId(number),
      } as ServiceCommand)
      spotIds.push(details.spotId as string)
    }
    const [venueRow] = await query<{ timezone: string; ends_at: string }>(
      'select timezone, service_day_ends_at::text as ends_at from restro.venues where id = $1',
      [demo.venueId],
    )
    const today = serviceDate(
      new Date(),
      venueRow?.timezone ?? 'UTC',
      venueRow?.ends_at ?? '07:00:00',
    )
    partyId = (
      await accept({
        type: 'reservation.create',
        serviceDate: today,
        startsAt: new Date().toISOString(),
        kind: 'booking',
        status: 'reserved',
        partySize: 12,
        partyLabel: 'Group',
        phone: '+359888123456',
        spotIds,
      } as ServiceCommand)
    ).reservationId as string
    await accept({ type: 'reservation.arrive', reservationId: partyId } as ServiceCommand)
  })

  afterAll(async () => {
    await sim?.close()
    await pool?.end()
    await db?.drop()
  })

  beforeEach(() => reset())

  /**
   * A fresh till with a round on each member table, nothing in flight, every table read, and the
   * party seated again on its four tables in fresh sittings (a whole bill paid ends them all).
   * Earlier tests' payments are over, their payment tables free.
   */
  async function reset(switches: Partial<SimSwitches> = {}) {
    switched = switches
    forgetGuestCodes()
    LOOSE.clear()
    beforeCall = () => {}
    engine.clearFaults()
    const scenario = loadScenarioFile('demo-bar')
    sim.host.engine = buildEngine(
      { ...scenario, switches: { ...scenario.switches, ...switches } },
      { clock: simClock },
    )
    await query(
      `update restro.payments set state = 'released', reason = 'test', form_values = null,
         payment_table_id = null, settled_at = coalesce(settled_at, now()),
         receipt_to_bring_at = null
       where venue_id = $1`,
      [demo.venueId],
    )
    await query(`update restro.locks set holder = null, deadline = null where venue_id = $1`, [
      demo.venueId,
    ])
    await query('update restro.provider_notices set handled_at = now() where handled_at is null')
    const ids = NUMBERS.map(tableId)
    await query(
      `update restro.sittings set ended_at = now(), end_reason = 'staff_closed'
       where table_id = any($1) and ended_at is null`,
      [ids],
    )
    for (const id of ids) {
      await query(
        `insert into restro.sittings (id, tenant_id, venue_id, table_id, service_date, opened_how, source, actor, job_id)
         values ($1, $2, $3, $4, $5, 'one', 'staff', 'system', 'test')`,
        [newId('st'), tenantId, demo.venueId, id, new Date().toISOString().slice(0, 10)],
      )
    }
    // The party holds its spots in these sittings (a hold taken at or after the sitting opened).
    await query(`update restro.reservations set status = 'seated' where id = $1`, [partyId])
    await query(
      `update restro.reservation_spots set released_at = null, updated_at = clock_timestamp()
       where reservation_id = $1`,
      [partyId],
    )
    const waiter = sim.host.engine.waiter
    waiter.addRound(POS_TABLES['1'], [{ article: '2001' }, { article: '2002' }])
    waiter.addRound(POS_TABLES['2'], [{ article: '2002', quantity: '2' }])
    waiter.addRound(POS_TABLES['3'], [{ article: '2001' }, { article: '2002' }])
    waiter.addRound(POS_TABLES['4'], [
      { article: '2001' },
      { article: '2001' },
      { article: '2002' },
      { article: '2002' },
    ])
    for (const number of NUMBERS) expect(await read(number)).toMatchObject({ complete: true })
  }

  function read(number: TableNumber) {
    simClock.advance(1100)
    clock = new Date(clock.getTime() + TABLE_READ_MIN_GAP_MS + 1)
    return readTableOf(
      { pool, log, now: () => clock },
      { tenantId, venueId: demo.venueId, tableId: tableId(number) },
      {
        sim: policy,
        billIdKey: KEY,
        budgets: simBudgets(simClock),
        readingBudgets: new ReadingBudgets(),
      },
    )
  }

  async function stateAt(number: TableNumber) {
    const answer = await guestState(pool, {
      code: codes.get(number) as string,
      view: 'bill',
      limiter: LOOSE,
    })
    if (!answer.ok || answer.answer.unchanged) throw new Error('no state')
    return answer.answer
  }

  /** A table's lines as a phone there sees them on its own bill. */
  async function linesOf(number: TableNumber) {
    return (await stateAt(number)).bill?.parts.flatMap((part) => part.lines) ?? []
  }

  type Line = Awaited<ReturnType<typeof linesOf>>[number]

  /** A phone at `from` pays `picked` (`whole`: the whole bill, as the server reads it). */
  function payStart(from: TableNumber, picked: readonly Line[], whole = false) {
    return guestAct(pool, {
      code: codes.get(from) as string,
      command: {
        type: 'pay.start',
        actionId: randomUUID(),
        pick: whole
          ? { kind: 'whole' }
          : { kind: 'lines', lines: picked.map((l) => ({ lineId: l.id, quantity: l.quantity })) },
        seen: picked.map((l) => ({
          lineId: l.id,
          quantity: l.quantity,
          amountMinor: l.amountMinor,
        })),
        tipMinor: null,
        tipPercent: null,
      },
      ageMs: 10,
      view: 'bill',
      phone: randomUUID(),
      limiter: LOOSE,
      check: { humanToken: 'XXXX.DUMMY.TOKEN.XXXX' },
      humanCheck: async () => 'passed',
    })
  }

  /** Every member table's lines, table by table. */
  async function everyLine(): Promise<Line[]> {
    const all: Line[] = []
    for (const number of NUMBERS) all.push(...(await linesOf(number)))
    return all
  }

  /** The Pay, held at the provider. */
  async function held(from: TableNumber, picked: readonly Line[], whole = false) {
    const answer = await payStart(from, picked, whole)
    if (!answer.ok || answer.result.status !== 'accepted') {
      throw new Error(`the Pay was refused: ${JSON.stringify(answer)}`)
    }
    const id = answer.result.subjectId as string
    expect(await preparePayment(env(), target(id), deps())).toEqual({
      kind: 'at',
      state: 'awaiting_guest',
    })
    engine.guest.pay(providerRef((await stored(id))?.provider_payment_ref ?? ''))
    expect(await checkPayment(env(), target(id), deps())).toEqual({ kind: 'at', state: 'held' })
    return id
  }

  async function drive(id: string, runs = 60) {
    for (let run = 0; run < runs; run += 1) {
      if (run > 0) await pass(id, BETWEEN_RUNS_MS)
      try {
        await preparePayment(env(), target(id), deps())
      } catch (error) {
        if (!(error instanceof PaymentStepRetry)) throw error
      }
      const row = await stored(id)
      if (row === undefined) throw new Error('the payment is gone')
      if (SETTLED.includes(row.state) && row.payment_table_id === null) break
      if (
        row.state === 'unconfirmed' &&
        !['receipt_printed', 'no_receipt'].includes(row.reason ?? '')
      ) {
        break
      }
    }
    return stored(id)
  }

  async function pass(id: string, ms: number) {
    simClock.advance(ms)
    await query(
      `update restro.payment_steps set at = at - make_interval(secs => $2) where payment_id = $1`,
      [id, ms / 1_000],
    )
  }
  const calls = (method: string) =>
    sim.host.engine.calls().filter((call) => call.method === method).length
  const stored = async (id: string) =>
    (
      await query<{
        state: string
        reason: string | null
        amount_minor: string | null
        captured_minor: string | null
        provider_payment_ref: string | null
        payment_table_id: string | null
        settled: boolean
      }>(
        `select state, reason, amount_minor, captured_minor, provider_payment_ref, payment_table_id,
                settled_at is not null as settled
           from restro.payments where id = $1`,
        [id],
      )
    )[0]
  const steps = async (id: string) =>
    (
      await query<{ step: string; outcome: string }>(
        `select step, outcome from restro.payment_steps where payment_id = $1 order by seq`,
        [id],
      )
    ).map((row) => `${row.step}:${row.outcome}`)
  /** The open rows on a POS table, by article. */
  const rowsOn = (posTable: string) =>
    sim.host.engine.state.bills
      .filter((bill) => bill.table === posTable && bill.state === 'open')
      .flatMap((bill) => bill.rows.map((row) => row.article))
      .sort()
  const everyTableRows = () => NUMBERS.map((number) => rowsOn(POS_TABLES[number]))
  const paymentTablesEmpty = () => PAYMENT_TABLES.every((table) => rowsOn(table).length === 0)
  const fault = (...rules: FaultRule[]) => sim.host.engine.faults.add(...rules)
  const sum = (lines: readonly Line[]) => lines.reduce((total, line) => total + line.amountMinor, 0)
  const managerAnswer = async (id: string, value: 'receipt_printed' | 'no_receipt') =>
    (
      await applyService(
        pool,
        { type: 'payment.answer', paymentId: id, answering: 'close', answer: value },
        {
          tenantId,
          venueId: demo.venueId,
          origin: 'staff',
          actor: { kind: 'user', userId: managerId, sessionId: 'session-manager' },
          jobId: `answer-${randomUUID()}`,
          via: 'tonight',
        },
      )
    ).result

  it("pays the whole group's bill from table 2: one payment table, one close, one capture", async () => {
    const group = (await stateAt('2')).group
    expect(group?.paysAcross).toBe(true)
    expect(group?.tables).toHaveLength(4)
    const all = await everyLine()
    const before = everyTableRows()
    const id = await held('2', all, true)
    // Each covered table shows the payment's lines as being paid.
    for (const number of NUMBERS) {
      expect((await linesOf(number)).every((line) => line.beingPaid)).toBe(true)
    }

    const row = await drive(id)
    expect(row).toMatchObject({
      state: 'captured',
      settled: true,
      payment_table_id: null,
      captured_minor: String(sum(all)),
    })
    // Each source table's lines moved under its own call; the bill was closed once.
    expect(calls('moveRows')).toBe(4)
    expect(calls('closeBill')).toBe(1)
    expect((await steps(id)).filter((step) => step === 'isolateLines:done')).toHaveLength(4)
    expect((await steps(id)).filter((step) => step === 'payAndClose:attempting')).toHaveLength(1)
    expect(engine.paymentsOf(providerRef(accountRef), id as never)).toEqual([
      expect.objectContaining({ status: 'captured', capturedMinor: sum(all) }),
    ])
    expect(before.every((rows) => rows.length > 0)).toBe(true)
    expect(everyTableRows()).toEqual([[], [], [], []])
    expect(paymentTablesEmpty()).toBe(true)
    // The lines show as paid on their own tables, until a reading finds each table empty and ends
    // its sitting.
    const after = (await stateAt('2')).group
    expect(after?.tables.every((table) => table.paidLines.length > 0)).toBe(true)
    for (const number of NUMBERS) {
      expect(await read(number)).toMatchObject({ complete: true, ended: true })
    }
  })

  it("pays table 3's lines with single lines of tables 1 and 4 together, and leaves the rest", async () => {
    const one = await linesOf('1')
    const three = await linesOf('3')
    const four = await linesOf('4')
    const picked = [...three, one[0] as Line, four[2] as Line]
    const id = await held('3', picked)
    const row = await drive(id)
    expect(row).toMatchObject({ state: 'captured', captured_minor: String(sum(picked)) })
    expect(calls('moveRows')).toBe(3)
    expect(calls('closeBill')).toBe(1)
    expect(rowsOn(POS_TABLES['3'])).toEqual([])
    expect(rowsOn(POS_TABLES['1'])).toHaveLength(1)
    expect(rowsOn(POS_TABLES['4'])).toHaveLength(3)
    expect(rowsOn(POS_TABLES['2'])).toEqual(['2002'])
    expect(paymentTablesEmpty()).toBe(true)
  })

  it('two phones paying one line at once: one holds it, the other is told it is being paid', async () => {
    const line = (await linesOf('1'))[0] as Line
    const answers = await Promise.all([payStart('2', [line]), payStart('3', [line])])
    const accepted = answers.filter((a) => a.ok && a.result.status === 'accepted')
    const refused = answers.filter((a) => a.ok && a.result.status === 'rejected')
    expect(accepted).toHaveLength(1)
    expect(refused).toHaveLength(1)
    expect(refused[0]?.ok === true && refused[0].result.status === 'rejected').toBe(true)
    if (refused[0]?.ok && refused[0].result.status === 'rejected') {
      expect(refused[0].result.code).toBe('being_paid')
    }
    // And a pick over the whole group from table 4 meets the same line: refused too.
    expect(await payStart('4', await everyLine(), true)).toMatchObject({
      result: { status: 'rejected', code: 'being_paid' },
    })
  })

  it('a move the POS refuses after other tables moved: every line goes back to its own table', async () => {
    const before = everyTableRows()
    const all = await everyLine()
    const id = await held('2', all, true)
    // The first two tables' lines move; the till refuses the third table's move.
    fault({ on: 'moveRows', from: 3, fault: { kind: 'refuse', code: 'bill_locked' } })
    const row = await drive(id)
    expect(row).toMatchObject({ state: 'released', settled: true, payment_table_id: null })
    expect(await steps(id)).not.toContain('payAndClose:attempting')
    expect(everyTableRows()).toEqual(before)
    expect(paymentTablesEmpty()).toBe(true)
    expect(engine.paymentsOf(providerRef(accountRef), id as never)).toEqual([
      expect.objectContaining({ status: 'released' }),
    ])
  })

  it("a waiter's bill like the picked lines on the payment table before any move: nothing moves onto it", async () => {
    const before = everyTableRows()
    // Tables 1 and 3 have the same round: a waiter's bill of it matches table 1's lines.
    const picked = [...(await linesOf('1')), ...(await linesOf('3'))]
    const id = await held('3', picked)
    // Once the payment holds its payment table, a waiter rings the same round there.
    let rung: string | null = null
    beforeCall = async (method, args) => {
      if (method !== 'readTable' || rung !== null) return
      const table = (args[1] as { pos: string }).pos
      if (!PAYMENT_TABLES.includes(table)) return
      if ((await stored(id))?.payment_table_id == null) return
      rung = table
      sim.host.engine.waiter.addRound(table, [{ article: '2001' }, { article: '2002' }])
    }
    const row = await drive(id, 10)
    expect(rung).not.toBeNull()
    expect(row).toMatchObject({ state: 'released', settled: true })
    // Nothing was moved or closed: the waiter's bill is the waiter's, every table as it was.
    expect(calls('moveRows')).toBe(0)
    expect(calls('closeBill')).toBe(0)
    expect(everyTableRows()).toEqual(before)
    expect(rowsOn(rung as unknown as string)).toEqual(['2001', '2002'])
    expect(engine.paymentsOf(providerRef(accountRef), id as never)).toEqual([
      expect.objectContaining({ status: 'released' }),
    ])
  })

  it('a failed last check: every line goes back to its own table, nothing closed', async () => {
    const before = everyTableRows()
    const id = await held('2', await everyLine(), true)
    // A waiter puts a round on the payment's bill on its payment table, after the moves.
    let done = false
    beforeCall = (method, args) => {
      if (method !== 'readIsolated' || done) return
      done = true
      const isolated = args[1] as { table: { pos: string } }
      sim.host.engine.waiter.addRound(isolated.table.pos, [{ article: '2001' }])
    }
    const row = await drive(id)
    expect(row).toMatchObject({ state: 'released', reason: 'check_failed', payment_table_id: null })
    expect(calls('closeBill')).toBe(0)
    // The waiter's round goes back with the payment's bill, to the table that is put back last.
    const after = everyTableRows()
    expect(after.slice(0, 1)).toEqual(before.slice(0, 1))
    expect(after.slice(2)).toEqual(before.slice(2))
    expect(after[1]).toEqual([...(before[1] ?? []), '2001'].sort())
    expect(paymentTablesEmpty()).toBe(true)
  })

  it("a covered table that can't be read at the last check: nothing closes for less (rule 6)", async () => {
    const picked = [...(await linesOf('1')), ...(await linesOf('2'))]
    const id = await held('2', picked)
    // At the check, a waiter voids a line on the payment's bill, so the check reads the tables
    // the lines came from; table 1 has lost its POS place meanwhile.
    const [place] = await query<{ id: string; state: string }>(
      'select id, state from restro.places where table_id = $1',
      [tableId('1')],
    )
    let voided = false
    beforeCall = async (method, args) => {
      if (method !== 'readIsolated' || voided) return
      voided = true
      const isolated = args[1] as { ref: { pos: string } }
      const bill = sim.host.engine.state.bills.find((b) => b.id === isolated.ref.pos)
      sim.host.engine.waiter.voidLine(isolated.ref.pos, bill?.rows[0]?.id as string)
      await query(`update restro.places set state = 'deleted' where id = $1`, [place?.id])
    }
    try {
      const row = await drive(id, 6)
      expect(voided).toBe(true)
      // Table 1's lines are not taken as voided: nothing closed, nothing captured.
      expect(calls('closeBill')).toBe(0)
      expect(row?.state).not.toBe('captured')
      expect(row?.captured_minor).toBeNull()
    } finally {
      await query('update restro.places set state = $2 where id = $1', [place?.id, place?.state])
    }
  })

  it('"No receipt" after a close the POS did not confirm: every line back on its own table', async () => {
    const before = everyTableRows()
    const id = await held('2', await everyLine(), true)
    fault({ on: 'closeBill', fault: { kind: 'hang' } })
    expect(await drive(id)).toMatchObject({ state: 'unconfirmed', reason: 'close_unknown' })
    expect(await managerAnswer(id, 'no_receipt')).toMatchObject({ status: 'accepted' })
    const row = await drive(id)
    expect(row).toMatchObject({ state: 'released', reason: 'no_receipt', payment_table_id: null })
    expect(everyTableRows()).toEqual(before)
    expect(paymentTablesEmpty()).toBe(true)
  })

  it("a member table that didn't read well holds back its lines and the whole bill", async () => {
    const all = await everyLine()
    const four = await linesOf('4')
    fault({ on: 'read', from: 1, times: Infinity, fault: { kind: 'fail' } })
    expect(await read('4')).toMatchObject({ complete: false })
    sim.host.engine.faults.clear()
    expect((await stateAt('2')).group?.complete).toBe(false)

    expect(await payStart('2', all, true)).toMatchObject({
      result: { status: 'rejected', code: 'table_not_read' },
    })
    expect(await payStart('2', [four[0] as Line])).toMatchObject({
      result: { status: 'rejected', code: 'table_not_read' },
    })
    // A line of a table that read well still pays.
    const one = (await linesOf('1'))[0] as Line
    expect(await payStart('2', [one])).toMatchObject({ result: { status: 'accepted' } })
  })

  it('counts three open payments on each table a payment covers, not on the group', async () => {
    const four = await linesOf('4')
    // Phones at tables 1, 2 and 3 each pay a line of table 4: three payments cover table 4.
    for (const [index, from] of (['1', '2', '3'] as const).entries()) {
      expect(await payStart(from, [four[index] as Line])).toMatchObject({
        result: { status: 'accepted' },
      })
    }
    // A fourth on table 4 waits, from its own phone too.
    expect(await payStart('4', [four[3] as Line])).toMatchObject({
      result: { status: 'rejected', code: 'rate_limited' },
    })
    // Table 1 has one payment of its own: another of its lines still pays.
    const one = await linesOf('1')
    expect(await payStart('1', [one[0] as Line])).toMatchObject({
      result: { status: 'accepted' },
    })
  })

  it('at a POS that splits a bill off, each table pays its own', async () => {
    await reset({ billsPerTable: 'several' })
    await readFloor()
    try {
      expect((await stateAt('2')).group?.paysAcross).toBe(false)
      const one = (await linesOf('1'))[0] as Line
      expect(await payStart('2', [one])).toMatchObject({
        result: { status: 'rejected', code: 'bill_changed' },
      })
      const own = await linesOf('2')
      expect(await payStart('2', own)).toMatchObject({ result: { status: 'accepted' } })
    } finally {
      await reset()
      await readFloor()
    }
  })
})
