// The payment route after the hold (#111) on Postgres through the worker's real code, against a
// real simulator server over HTTP and the simulated card provider: a held payment takes a free
// payment table, its lines move there under the real table's write turn, the last check reads the
// isolated bill and the real table fresh, the close and the capture follow, and the payment table
// is free again once it reads empty. The fault scripts time out every write, before and after it
// lands: each ends captured, released or unconfirmed, and nothing is released once a close was
// attempted until a manager answers "No receipt". A failed check puts the lines back; lines that
// can't go back are stranded; a refused capture is the owners'. The model test runs two guests'
// payments on one table under random fault scripts and checks four invariants: a capture only
// after proof of a close; no release once a close was attempted; a line never in two payments; a
// payment table never used by two payments at once. A write that lands late, inside the read-back
// window, is read back and never sent again; two runs of one payment at once (a job pg-boss ran
// again while its first run went on) move the lines once and close the bill once. In the model a
// waiter also acts at the POS's own front end right before any call (voids, moves a line away,
// adds a round, closes in cash, on the real table or the payment table); the provider drops the
// hold (cancelled, run out) or sends notices (held again, a stale failed, captured, a refund),
// stored and handled by the real notice job beside the route, now, late or twice; and a manager
// answers each close the POS did not confirm through `payment.answer`, as the till shows it. Two
// more invariants: the money taken is the card payment Restro's close put on the bill, and a bill
// Restro closed is captured or the owners are told; every notice is handled and every refund
// recorded.
import { randomUUID } from 'node:crypto'

import {
  DEFAULT_ORDERING_SETTINGS,
  hashTableCode,
  type IntegrationId,
  JOB_NAMES,
  newId,
  type PaymentJob,
  providerRef,
  SERVICE_TIMINGS,
  type ServiceConnector,
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
  LEASE_MARGIN_MS,
} from '@restro/core/service'
import { recordProviderNotice } from '@restro/core/service/notices'
import { createPool, type DbPool } from '@restro/db'
import {
  createSimPayProvider,
  SIM_PAY_KIND,
  ManualClock as SimPayClock,
  SimPayEngine,
} from '@restro/sim-pay'
import {
  buildEngine,
  createSimServer,
  type FaultRule,
  loadScenarioFile,
  PosRefusal,
  ManualClock as SimPosClock,
  type SimServer,
  SimSetupError,
  UndefinedBehaviour,
} from '@restro/sim-pos'
import fc from 'fast-check'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { InstanceBudgets, readFloorOf } from '../src/jobs/floor'
import {
  checkPayment,
  createPaymentJobs,
  PAYMENT_RUN_MS,
  type PaymentJobDeps,
  type PaymentRunOutcome,
  PaymentStepRetry,
  paymentStepMs,
  preparePayment,
} from '../src/jobs/payments'
import { handleProviderNotices } from '../src/jobs/provider-notices'
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

allowSlowSetup()

const KEY = 'payment-route-test-key-'.padEnd(48, 'x')
/** Demo Bar's table 1 and its two payment tables in the main hall, on the simulator. */
const POS_TABLE = '30001'
const PAYMENT_TABLES = ['39001', 'pay main 2']
/** How long one connector call takes on the simulator's clock: a read is two calls, the limit 5 a second. */
const CALL_MS = 500
/** Short write and read timeouts, so a hanging call is `unknown` quickly. */
const TIMINGS = { ...SERVICE_TIMINGS, readTimeoutMs: 2_000, writeTimeoutMs: 300 }
/** A late write lands this long after its call: inside the read-back window (D115's minute). */
const LATE_LANDING_MS = 20_000
/** How much time passes between two runs of a job: its read-back, on both clocks. */
const BETWEEN_RUNS_MS = 5_000

const LOOSE = new GuestLimiter(
  Object.fromEntries(
    Object.entries(GUEST_LIMITS).map(([name, limit]) => [name, { ...limit, max: 10_000 }]),
  ) as Record<GuestLimitName, GuestLimit>,
)

/** The states a run ends in when nobody needs to act. */
const SETTLED = ['captured', 'released', 'stranded', 'capture_failed']

describe('the prepare job', () => {
  it('gives a run its deadline and one step more before pg-boss runs it again', () => {
    const [prepare] = createPaymentJobs({
      sim: { env: 'test', allowHosts: [] },
      providers: new Map(),
    })
    const expire = (prepare?.options.queue.expireInSeconds ?? 0) * 1_000
    expect(expire).toBeGreaterThanOrEqual(
      PAYMENT_RUN_MS + paymentStepMs(SERVICE_TIMINGS) + LEASE_MARGIN_MS,
    )
  })
})

describe.skipIf(!hasDatabase)('the payment route', () => {
  let db: TestDatabase
  let pool: DbPool
  let sim: SimServer
  const simClock = new SimPosClock()
  const payClock = new SimPayClock()
  const engine = new SimPayEngine({ clock: payClock })
  const provider = createSimPayProvider({ env: 'test', engine })
  const tenantId = newId('tn')
  let log: Awaited<ReturnType<typeof createLogger>>
  let clock = new Date()
  let demo: { venueId: VenueId; integrationId: IntegrationId }
  let tableId: `tb_${string}`
  let code: string
  let accountRef: string
  /** A manager at the venue (`money.follow_up`), who answers a close the POS did not confirm. */
  let managerId: string
  /** Called before every connector method, with its name and arguments (a test's waiter). */
  let beforeCall: (method: string, args: unknown[]) => void | Promise<void> = () => {}
  const sent: { name: string; data: object; options?: object }[] = []
  const queue: JobQueue = {
    async send(name, data, options) {
      sent.push({ name, data, ...(options === undefined ? {} : { options }) })
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
  /** The real connector, with the test's waiter acting before each call. */
  const connectorFor: typeof serviceConnectorFor = (integration, simPolicy) => {
    const connector = serviceConnectorFor(integration, simPolicy)
    return new Proxy(connector, {
      get(target, name, receiver) {
        const value = Reflect.get(target, name, receiver)
        if (typeof value !== 'function') return value
        return (...args: unknown[]) => {
          // Each call takes a moment on the simulator's clock, as one over the network does.
          simClock.advance(CALL_MS)
          const before = beforeCall(String(name), args)
          if (before instanceof Promise) return before.then(() => value.apply(target, args))
          return value.apply(target, args)
        }
      },
    }) as ServiceConnector
  }
  const deps = (overrides: Partial<PaymentJobDeps> = {}): PaymentJobDeps => ({
    sim: policy,
    providers: new Map([[SIM_PAY_KIND, provider]]),
    budgets: new InstanceBudgets(),
    connectorFor,
    timings: TIMINGS,
    // The route's pause before a write passes on the simulator's clock (its per-second limit).
    sleep: async (ms) => {
      simClock.advance(ms)
    },
    ...overrides,
  })
  const target = (paymentId: string): PaymentJob => ({
    tenantId,
    venueId: demo.venueId,
    paymentId: paymentId as PaymentJob['paymentId'],
  })

  beforeAll(async () => {
    db = await createTestDatabase()
    pool = createPool(db.appUrl, { applicationName: 'restro-worker-payment-route-tests', max: 4 })
    await provisionTenant(pool, { tenantId, name: 'Route club' })
    await query(
      `insert into restro.auth_organization (id, name, slug) values ($1, 'Route club', $2)`,
      [tenantId, `route-${newId('tn').slice(3, 11)}`],
    )
    log = await createLogger({ level: 'debug', pretty: false, destination: { write: () => {} } })
    sim = createSimServer({ scenario: 'demo-bar', print: () => {}, clock: simClock })
    const host = `127.0.0.1:${await sim.listen(0)}`

    const integrationId = (await createIntegration(pool, tenantId, { kind: 'sim', host })).id
    const venue = await provisionVenue(pool, tenantId, {
      name: 'Demo Bar',
      slug: testSlug('route'),
    })
    await upsertBarsyVenues(pool, tenantId, integrationId, [{ bid: 1, name: 'Demo Bar' }])
    expect((await mapBarsyVenue(pool, tenantId, integrationId, 1, venue.id)).ok).toBe(true)
    demo = { venueId: venue.id as VenueId, integrationId: integrationId as IntegrationId }
    await setFloorSource(pool, tenantId, {
      venueId: demo.venueId,
      source: { halls: null, bars: null, paymentTables: ['PM1', 'PM2'] },
    })
    simClock.advance(1100)
    const floor = await readFloorOf(
      { pool, log, now: () => clock },
      { tenantId, ...demo },
      { sim: policy, budgets: new InstanceBudgets() },
    )
    expect(floor.kind).toBe('read')
    const [table] = await query<{ id: `tb_${string}` }>(
      `select id from restro.tables where venue_id = $1 and number = '1'`,
      [demo.venueId],
    )
    if (table === undefined) throw new Error('no table 1')
    tableId = table.id
    const marked = await query<{ number: string }>(
      `select number from restro.tables where venue_id = $1 and is_payment_table order by number`,
      [demo.venueId],
    )
    expect(marked.map((row) => row.number)).toEqual(['PM1', 'PM2'])
    await query(
      `update restro.venues set settings = jsonb_set(settings, '{ordering}', $2::jsonb) where id = $1`,
      [demo.venueId, JSON.stringify({ ...DEFAULT_ORDERING_SETTINGS, locationCheck: false })],
    )

    const account = engine.addAccount()
    engine.finishConnecting(account)
    accountRef = account.provider
    await query(
      `insert into restro.payment_accounts
         (tenant_id, venue_id, provider_kind, account_ref, state, connected_at, source, actor, job_id)
       values ($1, $2, $3, $4, 'connected', now(), 'restro', 'system', 'test-seed')`,
      [tenantId, demo.venueId, SIM_PAY_KIND, accountRef],
    )

    managerId = `route-manager-${randomUUID()}`
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
  })

  afterAll(async () => {
    await sim?.close()
    await pool?.end()
    await db?.drop()
  })

  beforeEach(() => reset())

  /** A fresh night: a new till with table 1's round, nothing in flight, a new sitting. */
  async function reset() {
    forgetGuestCodes()
    LOOSE.clear()
    sent.length = 0
    beforeCall = () => {}
    engine.clearFaults()
    // A fresh till, with the pilot's limit of calls per second; a late write lands in the window.
    const scenario = loadScenarioFile('demo-bar')
    sim.host.engine = buildEngine(
      { ...scenario, switches: { ...scenario.switches, lateLandingMs: LATE_LANDING_MS } },
      { clock: simClock },
    )
    // What earlier tests left: their payments over, their payment tables free.
    await query(
      `update restro.payments set state = 'released', reason = 'test', form_values = null,
         payment_table_id = null, settled_at = coalesce(settled_at, now())
       where venue_id = $1`,
      [demo.venueId],
    )
    await query(`update restro.locks set holder = null, deadline = null where venue_id = $1`, [
      demo.venueId,
    ])
    // Notices earlier nights left are handled.
    await query('update restro.provider_notices set handled_at = now() where handled_at is null')
    await query(
      `update restro.sittings set ended_at = now(), end_reason = 'staff_closed'
       where table_id = $1 and ended_at is null`,
      [tableId],
    )
    await query(
      `insert into restro.sittings (id, tenant_id, venue_id, table_id, service_date, opened_how, source, actor, job_id)
       values ($1, $2, $3, $4, $5, 'one', 'staff', 'system', 'test')`,
      [newId('st'), tenantId, demo.venueId, tableId, new Date().toISOString().slice(0, 10)],
    )
    code = `code${randomUUID().replaceAll('-', '')}`
    await query('update restro.tables set qr_token = $2, qr_code_hash = $3 where id = $1', [
      tableId,
      code,
      await hashTableCode(code),
    ])
    sim.host.engine.waiter.addRound(POS_TABLE, [
      { article: '2001' },
      { article: '2002', quantity: '2' },
    ])
    await read()
  }

  async function read() {
    simClock.advance(1100)
    clock = new Date(clock.getTime() + TABLE_READ_MIN_GAP_MS + 1)
    const outcome = await readTableOf(
      { pool, log, now: () => clock },
      { tenantId, venueId: demo.venueId, tableId },
      {
        sim: policy,
        billIdKey: KEY,
        budgets: new InstanceBudgets(),
        readingBudgets: new ReadingBudgets(),
      },
    )
    expect(outcome).toMatchObject({ kind: 'recorded', complete: true })
  }

  async function lines() {
    const answer = await guestState(pool, { code, view: 'bill', limiter: LOOSE })
    if (!answer.ok || answer.answer.unchanged) throw new Error('no state')
    return answer.answer.bill?.parts.flatMap((part) => part.lines) ?? []
  }

  /** A guest's Pay of the line at `index` (or every line), held at the provider. */
  async function held(index: number | 'all' = 1): Promise<string> {
    const id = await tryHeld(index)
    if (id === null) throw new Error('the Pay was refused')
    return id
  }

  /** The same, or null when the Pay is refused (another phone is paying for its lines). */
  async function tryHeld(index: number | 'all'): Promise<string | null> {
    const shown = await lines()
    const picked = index === 'all' ? shown : [shown[index] as (typeof shown)[number]]
    const answer = await guestAct(pool, {
      code,
      command: {
        type: 'pay.start',
        actionId: randomUUID(),
        pick: { kind: 'lines', lines: picked.map((l) => ({ lineId: l.id, quantity: l.quantity })) },
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
    if (!answer.ok || answer.result.status !== 'accepted') return null
    const id = answer.result.subjectId as string
    expect(await preparePayment(env(), target(id), deps())).toEqual({
      kind: 'at',
      state: 'awaiting_guest',
    })
    engine.guest.pay(providerRef((await stored(id))?.provider_payment_ref ?? ''))
    expect(await checkPayment(env(), target(id), deps())).toEqual({ kind: 'at', state: 'held' })
    return id
  }

  /**
   * Runs the prepare job as pg-boss would, a retry after each step that concluded nothing, until
   * the payment is settled with its table free, or waits for a person (unconfirmed). Between two
   * runs a few seconds pass, on the simulator's clock and on the database's for the payment's
   * steps (their read-back windows).
   */
  async function drive(id: string, runs = 40, overrides: Partial<PaymentJobDeps> = {}) {
    const retries: string[] = []
    for (let run = 0; run < runs; run += 1) {
      if (run > 0) await pass(id, BETWEEN_RUNS_MS)
      try {
        await preparePayment(env(), target(id), deps(overrides))
      } catch (error) {
        if (!(error instanceof PaymentStepRetry)) throw error
        retries.push(error.message)
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
    return { row: await stored(id), retries }
  }

  /** Time passes for the payment's recorded steps and on the simulator. */
  async function pass(id: string, ms: number) {
    simClock.advance(ms)
    await query(
      `update restro.payment_steps set at = at - make_interval(secs => $2) where payment_id = $1`,
      [id, ms / 1_000],
    )
  }
  /** The calls of one POS method the simulator received. */
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
        refunded_minor: string
        settled: boolean
      }>(
        `select state, reason, amount_minor, captured_minor, provider_payment_ref, payment_table_id,
                refunded_minor, settled_at is not null as settled
           from restro.payments where id = $1`,
        [id],
      )
    )[0]
  const steps = async (id: string) =>
    (
      await query<{ step: string; outcome: string; answer: string | null }>(
        `select step, outcome, answer from restro.payment_steps where payment_id = $1 order by seq`,
        [id],
      )
    ).map((row) => `${row.step}:${row.outcome}${row.answer === null ? '' : `:${row.answer}`}`)
  const states = async (id: string) =>
    (
      await query<{ to_state: string; reason: string | null }>(
        `select to_state, reason from restro.log_entries
          where kind = 'payment.state' and payment_id = $1 order by seq`,
        [id],
      )
    ).map((row) => row.to_state)
  const alertsOf = async (id: string) =>
    (
      await query<{ kind: string; permission: string | null }>(
        'select kind, permission from restro.alerts where subject_id = $1 order by kind',
        [id],
      )
    ).map((row) => `${row.kind}:${row.permission}`)
  /** The open rows on a POS table, by article. */
  const rowsOn = (posTable: string) =>
    sim.host.engine.state.bills
      .filter((bill) => bill.table === posTable && bill.state === 'open')
      .flatMap((bill) => bill.rows.map((row) => row.article))
      .sort()
  const paymentTablesEmpty = () => PAYMENT_TABLES.every((table) => rowsOn(table).length === 0)
  const heldLocks = async () =>
    (
      await query<{ holder: string | null }>(
        `select holder from restro.locks where venue_id = $1 and holder is not null`,
        [demo.venueId],
      )
    ).map((row) => row.holder)
  /** A manager's answer through `payment.answer`, as the Tonight screen sends it. */
  const answer = async (id: string, value: 'receipt_printed' | 'no_receipt') =>
    (
      await applyService(
        pool,
        { type: 'payment.answer', paymentId: id, answer: value },
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
  const fault = (...rules: FaultRule[]) => sim.host.engine.faults.add(...rules)

  it('pays a line: a payment table, the move, the check, the close, the capture', async () => {
    const id = await held(1)
    const { row } = await drive(id)
    // Two of article 2002 at 11.00 each.
    expect(row).toMatchObject({
      settled: true,
      state: 'captured',
      amount_minor: '2200',
      captured_minor: '2200',
      payment_table_id: null,
    })
    expect(await steps(id)).toEqual([
      'createHold:attempting',
      'createHold:done',
      'isolateLines:attempting',
      'isolateLines:done',
      'payAndClose:attempting',
      'payAndClose:done',
      'capture:attempting',
      'capture:done',
    ])
    expect(await states(id)).toEqual([
      'held',
      'queued',
      'isolated',
      'checked',
      'closed',
      'captured',
      'captured',
    ])
    // The real table's bill no longer has the line; the payment table is empty and free.
    expect(rowsOn(POS_TABLE)).toEqual(['2001'])
    expect(paymentTablesEmpty()).toBe(true)
    expect(await heldLocks()).toEqual([])
    expect(engine.paymentsOf(providerRef(accountRef), id as never)).toEqual([
      expect.objectContaining({ status: 'captured', capturedMinor: 2_200 }),
    ])
    await read()
    expect((await lines()).map((line) => line.amountMinor)).toEqual([1_050])
  })

  describe('a timeout at every write', () => {
    it.each([
      ['the move, before it lands', { on: 'moveRows', fault: { kind: 'hang' } }],
      ['the move, after it landed', { on: 'moveRows', fault: { kind: 'landsThenHangs' } }],
    ] as const)('%s: still captured', async (_, rule) => {
      const id = await held(1)
      fault(rule as FaultRule)
      const { row } = await drive(id)
      expect(row).toMatchObject({ state: 'captured', captured_minor: '2200' })
      expect((await steps(id)).filter((step) => step.startsWith('isolateLines'))).toContain(
        'isolateLines:unknown:late',
      )
      expect(rowsOn(POS_TABLE)).toEqual(['2001'])
      expect(paymentTablesEmpty()).toBe(true)
    })

    it('the move, landing late inside the read-back window: read back, never sent again', async () => {
      const id = await held(1)
      fault({ on: 'moveRows', fault: { kind: 'landsLate' } })
      const { row } = await drive(id)
      expect(row).toMatchObject({ state: 'captured', captured_minor: '2200' })
      expect(calls('moveRows')).toBe(1)
      expect((await steps(id)).filter((step) => step === 'isolateLines:attempting')).toHaveLength(1)
      expect(rowsOn(POS_TABLE)).toEqual(['2001'])
      expect(paymentTablesEmpty()).toBe(true)
    })

    it('the close, before it lands: unconfirmed for a manager; "No receipt" puts the lines back', async () => {
      const id = await held(1)
      fault({ on: 'closeBill', fault: { kind: 'hang' } })
      const first = await drive(id)
      expect(first.row).toMatchObject({ state: 'unconfirmed', reason: 'close_unknown' })
      expect(await alertsOf(id)).toEqual(['payment_unconfirmed:money.follow_up'])
      // Nothing undoes or releases it on its own: another run changes nothing.
      await drive(id, 3)
      expect(await stored(id)).toMatchObject({ state: 'unconfirmed', reason: 'close_unknown' })
      expect(engine.paymentsOf(providerRef(accountRef), id as never)).toEqual([
        expect.objectContaining({ status: 'held' }),
      ])

      expect(await answer(id, 'no_receipt')).toMatchObject({ status: 'accepted' })
      const { row } = await drive(id)
      expect(row).toMatchObject({ state: 'released', reason: 'no_receipt', payment_table_id: null })
      expect(rowsOn(POS_TABLE)).toEqual(['2001', '2002'])
      expect(paymentTablesEmpty()).toBe(true)
      expect(engine.paymentsOf(providerRef(accountRef), id as never)).toEqual([
        expect.objectContaining({ status: 'released' }),
      ])
    })

    it('the close, landing late: a manager is asked only once it can no longer land', async () => {
      const id = await held(1)
      fault(
        { on: 'closeBill', fault: { kind: 'landsLate' } },
        { on: 'moveRows', from: 2, fault: { kind: 'landsLate' } },
      )
      const { row } = await drive(id)
      expect(row).toMatchObject({ state: 'unconfirmed', reason: 'close_unknown' })
      // The till is final when the manager looks: the close landed, a receipt printed.
      sim.host.engine.settle()
      expect(sim.host.engine.pendingLateWrites()).toBe(0)
      expect(paymentTablesEmpty()).toBe(true)
      expect(await answer(id, 'receipt_printed')).toMatchObject({ status: 'accepted' })
      expect((await drive(id)).row).toMatchObject({ state: 'captured', captured_minor: '2200' })
      expect(calls('closeBill')).toBe(1)
    })

    it('the close, after it landed: unconfirmed; "Receipt printed" captures it', async () => {
      const id = await held(1)
      fault({ on: 'closeBill', fault: { kind: 'landsThenHangs' } })
      expect((await drive(id)).row).toMatchObject({
        state: 'unconfirmed',
        reason: 'close_unknown',
      })
      // An empty payment table is no proof of the close.
      expect(paymentTablesEmpty()).toBe(true)
      expect(await answer(id, 'receipt_printed')).toMatchObject({ status: 'accepted' })
      const { row } = await drive(id)
      expect(row).toMatchObject({
        state: 'captured',
        captured_minor: '2200',
        payment_table_id: null,
      })
      expect(rowsOn(POS_TABLE)).toEqual(['2001'])
    })

    it.each([
      ['before it reaches the provider', 'timeout_before'],
      ['after it landed', 'land_then_timeout'],
      ['with a server error the provider keeps under its key', 'server_error'],
    ] as const)('the capture, %s: captured once with its key', async (_, kind) => {
      const id = await held(1)
      engine.fault('capture', { kind })
      const { row } = await drive(id)
      expect(row).toMatchObject({ state: 'captured', captured_minor: '2200' })
      expect(engine.paymentsOf(providerRef(accountRef), id as never)).toEqual([
        expect.objectContaining({ status: 'captured', capturedMinor: 2_200 }),
      ])
      // Read back: landed is captured; not landed is captured with a new key.
      expect(await steps(id)).toContain(
        kind === 'land_then_timeout' ? 'capture:unknown:landed' : 'capture:unknown:not_landed',
      )
    })

    it('the move back after a failed check, before it lands: released', async () => {
      const id = await held(1)
      slipRoundOntoPaymentTable()
      fault({ on: 'moveRows', from: 2, fault: { kind: 'hang' } })
      const { row } = await drive(id)
      expect(row).toMatchObject({ state: 'released', reason: 'check_failed' })
      expect(await steps(id)).toContain('undoIsolate:unknown:late')
      expect(rowsOn(POS_TABLE)).toEqual(['2001', '2001', '2002'])
      expect(paymentTablesEmpty()).toBe(true)
    })
  })

  /** A waiter puts a round on the payment's bill on its payment table, after the move. */
  function slipRoundOntoPaymentTable() {
    let done = false
    beforeCall = (method, args) => {
      if (method !== 'readIsolated' || done) return
      done = true
      const isolated = args[1] as { table: { pos: string } }
      sim.host.engine.waiter.addRound(isolated.table.pos, [{ article: '2001' }])
    }
  }

  it('stops a payment whose bill changed at the last check, and puts its lines back', async () => {
    const id = await held(1)
    slipRoundOntoPaymentTable()
    const { row } = await drive(id)
    expect(row).toMatchObject({ state: 'released', reason: 'check_failed', payment_table_id: null })
    expect(await steps(id)).not.toContain('payAndClose:attempting')
    expect(await alertsOf(id)).toEqual(['payment_check_failed:alerts.answer'])
    expect(rowsOn(POS_TABLE)).toEqual(['2001', '2001', '2002'])
    expect(engine.paymentsOf(providerRef(accountRef), id as never)).toEqual([
      expect.objectContaining({ status: 'released' }),
    ])
  })

  it('releases the hold after a failed check, past a server error, with a new key', async () => {
    const id = await held(1)
    slipRoundOntoPaymentTable()
    engine.fault('release', { kind: 'server_error' })
    const { row } = await drive(id)
    expect(row).toMatchObject({ state: 'released', reason: 'check_failed' })
    expect(await steps(id)).toContain('release:unknown:not_landed')
    expect(engine.paymentsOf(providerRef(accountRef), id as never)).toEqual([
      expect.objectContaining({ status: 'released' }),
    ])
  })

  it('stops before the close when the hold is gone at the provider', async () => {
    const id = await held(1)
    const paymentRef = providerRef((await stored(id))?.provider_payment_ref ?? '')
    let done = false
    beforeCall = (method) => {
      if (method !== 'readIsolated' || done) return
      done = true
      // Cancelled at the provider (or run out) while its lines sat on the payment table.
      engine.release({
        accountRef: providerRef(accountRef),
        paymentRef,
        idempotencyKey: `${id}:outside`,
      })
    }
    const { row } = await drive(id)
    expect(row).toMatchObject({ state: 'released', reason: 'check_failed', settled: true })
    expect(await steps(id)).not.toContain('payAndClose:attempting')
    expect(await alertsOf(id)).toEqual(['payment_check_failed:alerts.answer'])
    expect(rowsOn(POS_TABLE)).toEqual(['2001', '2002'])
    expect(paymentTablesEmpty()).toBe(true)
  })

  it('strands lines the POS would not move back, and tells staff', async () => {
    const id = await held(1)
    slipRoundOntoPaymentTable()
    // A waiter keeps the bill: tried again for the read-back window, then stranded.
    fault({ on: 'moveRows', from: 2, times: 100, fault: { kind: 'refuse', code: 'bill_locked' } })
    const { row } = await drive(id)
    expect(row).toMatchObject({ state: 'stranded', reason: 'stranded' })
    expect(calls('moveRows')).toBeGreaterThan(2)
    expect(await alertsOf(id)).toEqual([
      'payment_check_failed:alerts.answer',
      'payment_stranded:alerts.answer',
    ])
    // The payment table keeps the lines, and stays the payment's until staff clear it.
    expect(row?.payment_table_id).not.toBeNull()
    expect(paymentTablesEmpty()).toBe(false)
    expect(await heldLocks()).toEqual([id])
  })

  it('lowers the amount for a line voided after the move, and captures that', async () => {
    const id = await held('all')
    let done = false
    beforeCall = (method, args) => {
      if (method !== 'readIsolated' || done) return
      done = true
      const isolated = args[1] as { ref: { pos: string } }
      const bill = sim.host.engine.state.bills.find((b) => b.id === isolated.ref.pos)
      const row = bill?.rows.find((r) => r.article === '2001')
      if (bill === undefined || row === undefined) throw new Error('no row to void')
      sim.host.engine.waiter.voidLine(bill.id, row.id)
    }
    const { row } = await drive(id)
    expect(row).toMatchObject({ state: 'captured', amount_minor: '2200', captured_minor: '2200' })
    expect(engine.paymentsOf(providerRef(accountRef), id as never)).toEqual([
      expect.objectContaining({ status: 'captured', amountMinor: 3_250, capturedMinor: 2_200 }),
    ])
  })

  it('makes the owners follow up a capture the provider refuses', async () => {
    const id = await held(1)
    engine.fault('capture', { kind: 'refuse', code: 'capture_refused' })
    const { row } = await drive(id)
    expect(row).toMatchObject({
      state: 'capture_failed',
      reason: 'capture_refused',
      payment_table_id: null,
    })
    expect(await alertsOf(id)).toEqual(['payment_capture_failed:money.follow_up'])
    // The bill is closed: nothing is put back.
    expect(rowsOn(POS_TABLE)).toEqual(['2001'])
  })

  it('waits while a send holds the real table’s turn, then moves the lines', async () => {
    const id = await held(1)
    await query(
      `insert into restro.locks (tenant_id, venue_id, scope, key, holder, fence, taken_at, deadline,
         source, actor, job_id)
       values ($1, $2, 'order_slot', $3, 'so_test', 1, now(), now() + interval '1 minute',
         'restro', 'system', 'test')
       on conflict (tenant_id, scope, key) do update
         set holder = 'so_test', deadline = now() + interval '1 minute'`,
      [tenantId, demo.venueId, tableId],
    )
    expect(await preparePayment(env(), target(id), deps())).toEqual({ kind: 'at', state: 'queued' })
    expect(await stored(id)).toMatchObject({ state: 'queued' })
    expect(rowsOn(POS_TABLE)).toEqual(['2001', '2002'])
    expect(sent).toContainEqual(
      expect.objectContaining({
        name: 'payment-prepare',
        options: expect.objectContaining({ startAfter: 2 }),
      }),
    )
    await query(
      `update restro.locks set holder = null, deadline = null
        where venue_id = $1 and scope = 'order_slot' and key = $2`,
      [demo.venueId, tableId],
    )
    expect((await drive(id)).row).toMatchObject({ state: 'captured' })
  })

  describe('two runs of one payment at once (a job pg-boss ran again while its first went on)', () => {
    it('from the hold: the lines move once, the bill closes once, captured', async () => {
      const id = await held(1)
      // One worker's two runs share its budgets at the POS.
      const shared = deps()
      await Promise.allSettled([
        preparePayment(env(), target(id), shared),
        preparePayment(env(), target(id), shared),
      ])
      const { row } = await drive(id)
      expect(row).toMatchObject({
        state: 'captured',
        captured_minor: '2200',
        payment_table_id: null,
      })
      expect(calls('moveRows')).toBe(1)
      expect(calls('closeBill')).toBe(1)
      expect(await alertsOf(id)).toEqual([])
      expect(rowsOn(POS_TABLE)).toEqual(['2001'])
    })

    it('while the first is inside the close: the second waits, and the close is proven', async () => {
      const id = await held(1)
      let second: PaymentRunOutcome | null = null
      beforeCall = async (method) => {
        if (method !== 'payAndClose' || second !== null) return
        second = await preparePayment(env(), target(id), deps())
      }
      // A close slow enough for the second run to look while it is out.
      const { row } = await drive(id, 40, { timings: { ...TIMINGS, writeTimeoutMs: 10_000 } })
      expect(second).toEqual({ kind: 'at', state: 'checked' })
      expect(row).toMatchObject({
        state: 'captured',
        captured_minor: '2200',
        payment_table_id: null,
      })
      expect(calls('closeBill')).toBe(1)
      expect(await alertsOf(id)).toEqual([])
    })
  })

  it('cancels a payment busy for a minute with no free payment table', async () => {
    for (const table of PAYMENT_TABLES)
      sim.host.engine.waiter.addRound(table, [{ article: '2001' }])
    const id = await held(1)
    expect(await preparePayment(env(), target(id), deps())).toEqual({ kind: 'at', state: 'queued' })
    expect(await stored(id)).toMatchObject({ state: 'queued', payment_table_id: null })
    await query(
      `update restro.payments set queue_ends_at = now() - interval '1 second' where id = $1`,
      [id],
    )
    const { row } = await drive(id)
    expect(row).toMatchObject({ state: 'released', reason: 'busy' })
    expect(rowsOn(POS_TABLE)).toEqual(['2001', '2002'])
  })

  describe('the model', () => {
    /** A timeout, an error or a refusal at each POS write; `from: 2` is the move back. */
    const POS_FAULTS: FaultRule[] = [
      { on: 'moveRows', fault: { kind: 'hang' } },
      { on: 'moveRows', fault: { kind: 'landsThenHangs' } },
      { on: 'moveRows', fault: { kind: 'landsLate' } },
      { on: 'moveRows', fault: { kind: 'fail' } },
      { on: 'moveRows', fault: { kind: 'refuse', code: 'bill_locked' } },
      { on: 'moveRows', from: 2, fault: { kind: 'hang' } },
      { on: 'moveRows', from: 2, fault: { kind: 'landsThenHangs' } },
      { on: 'moveRows', from: 2, fault: { kind: 'landsLate' } },
      { on: 'moveRows', from: 2, fault: { kind: 'refuse', code: 'bill_locked' } },
      { on: 'closeBill', fault: { kind: 'hang' } },
      { on: 'closeBill', fault: { kind: 'landsThenHangs' } },
      { on: 'closeBill', fault: { kind: 'landsLate' } },
      { on: 'closeBill', fault: { kind: 'fail' } },
      { on: 'closeBill', fault: { kind: 'refuse', code: 'bill_locked' } },
    ]
    const PROVIDER_FAULTS = [
      ['capture', { kind: 'timeout_before' }],
      ['capture', { kind: 'land_then_timeout' }],
      ['capture', { kind: 'server_error' }],
      ['capture', { kind: 'refuse', code: 'capture_refused' }],
      ['release', { kind: 'timeout_before' }],
      ['release', { kind: 'land_then_timeout' }],
      ['release', { kind: 'server_error' }],
    ] as const
    const pick = fc.constantFrom<number | 'all'>(0, 1, 'all')
    /** The connector calls a happening comes right before: the `nth` of that call in the night. */
    const MOMENTS = [
      'readTable',
      'isolateLines',
      'readIsolated',
      'payAndClose',
      'undoIsolate',
    ] as const
    const moment = fc.record({
      before: fc.constantFrom(...MOMENTS),
      nth: fc.integer({ min: 1, max: 3 }),
    })
    /** A waiter at the POS's own front end (`engine.waiter`), on the real table or a payment table. */
    const waiterAct = fc.record({
      kind: fc.constant('waiter' as const),
      at: moment,
      where: fc.constantFrom('real' as const, 'payment' as const),
      act: fc.constantFrom(
        'void' as const,
        'void_part' as const,
        'move_away' as const,
        'add' as const,
        'close_cash' as const,
      ),
      row: fc.nat({ max: 2 }),
    })
    /**
     * Something at the provider outside the route, and its notice: the hold's notice again, a
     * stale `failed`, the hold cancelled or run out, the capture's notice, a refund the venue makes
     * in its dashboard. The notice comes now, late (after the first runs) or twice.
     */
    const providerAct = fc.record({
      kind: fc.constant('provider' as const),
      at: moment,
      payment: fc.constantFrom(0, 1),
      event: fc.constantFrom(
        'held' as const,
        'failed' as const,
        'cancelled' as const,
        'expired' as const,
        'captured' as const,
        'refunded' as const,
      ),
      notice: fc.constantFrom('now' as const, 'late' as const, 'twice' as const),
    })
    type WaiterAct = typeof waiterAct extends fc.Arbitrary<infer T> ? T : never
    type ProviderAct = typeof providerAct extends fc.Arbitrary<infer T> ? T : never
    type Happening = WaiterAct | ProviderAct
    const nights = fc.record({
      picks: fc.tuple(pick, fc.option(pick, { nil: null })),
      pos: fc.subarray(POS_FAULTS, { maxLength: 3 }),
      provider: fc.option(fc.constantFrom(...PROVIDER_FAULTS), { nil: null }),
      slip: fc.boolean(),
      order: fc.array(fc.constantFrom(0, 1), { minLength: 1, maxLength: 4 }),
      happenings: fc.array(fc.oneof(waiterAct, providerAct), { maxLength: 3 }),
      /** The manager taps the answer again, and another taps the other one. */
      tapsAgain: fc.boolean(),
    })
    /** A refund the venue makes in its dashboard. */
    const REFUND_MINOR = 500
    const DAY_MS = 24 * 60 * 60 * 1000
    /** Where a waiter moves a line away to. */
    const OTHER_TABLE = '30002'

    it('captures only after a close, never releases after one, shares no line and no table, takes what the till shows', async () => {
      await fc.assert(
        fc.asyncProperty(nights, async (night) => {
          await reset()
          const ids: string[] = []
          for (const picked of night.picks) {
            if (picked === null) continue
            const id = await tryHeld(picked)
            if (id !== null) ids.push(id)
          }
          fault(...night.pos)
          if (night.provider !== null) engine.fault(night.provider[0], night.provider[1])
          // A waiter's round onto the payment's bill after the move, before the last check.
          const slip: Happening[] = night.slip
            ? [
                {
                  kind: 'waiter',
                  at: { before: 'readIsolated', nth: 1 },
                  where: 'payment',
                  act: 'add',
                  row: 0,
                },
              ]
            : []
          const played = await play([...slip, ...night.happenings], ids)
          // The payments' jobs in the night's order, then each until nothing is left to do. What
          // never came comes after the first runs; a manager answers each close the POS did not
          // confirm, as the till shows it.
          for (const which of night.order) {
            const id = ids[which]
            if (id === undefined) continue
            try {
              await preparePayment(env(), target(id), deps())
            } catch (error) {
              if (!(error instanceof PaymentStepRetry)) throw error
            }
          }
          for (let round = 0; round < 3; round += 1) {
            for (const id of ids) await drive(id)
            if (round === 0) await played.rest()
            await played.settled()
            if (round === 2) break
            for (const id of ids) await answerAsTheTillShows(id, played, night.tapsAgain)
          }
          await played.end()
          await invariants(ids, played)
        }),
        { numRuns: 25 },
      )
    })

    /** A provider's notice as the notice route stores it. */
    interface Notice {
      readonly id: string
      readonly type: string
      readonly kind: 'payment' | 'refund'
      readonly object: string
    }

    /** What the night did outside the route, for the invariants. */
    interface Played {
      /** What never came (its call never happened) comes now, then the late notices. */
      rest(): Promise<void>
      /** Waits for the notice job's runs still going. */
      settled(): Promise<void>
      /** The refunds that waited for a capture, the notices still to come, the notice job again. */
      end(): Promise<void>
      /** The payments whose hold the provider dropped itself (cancelled, run out). */
      readonly dropped: ReadonlySet<string>
      /** The payment's close at the till: closed with Restro's card payment, and how much. */
      till(id: string): { readonly closed: boolean; readonly cardMinor: number }
    }

    /**
     * Plays the night's happenings, each right before its connector call. A waiter acts and the
     * provider moves at once; a notice is stored and handled by the notice job beside the route
     * (one run at a time, as `exclusive`), and the checks it queues run as pg-boss runs them.
     */
    async function play(happenings: readonly Happening[], ids: readonly string[]): Promise<Played> {
      const pending = [...happenings]
      const seen = new Map<string, number>()
      const late: Notice[] = []
      const refunds: string[] = []
      const dropped = new Set<string>()
      /** The bill each payment's close named. */
      const closes = new Map<string, string>()
      const refs = new Map<string, string>()
      for (const id of ids) refs.set(id, (await stored(id))?.provider_payment_ref ?? '')
      const account = providerRef(accountRef)
      const statusOf = (id: string) => engine.paymentsOf(account, id as never)[0]?.status
      let outside = 0
      let jobs: Promise<void> = Promise.resolve()
      const failures: unknown[] = []

      async function noticeJob() {
        const from = sent.length
        await handleProviderNotices(
          { pool, log, now: () => clock, jobId: `notices-${randomUUID()}`, queue },
          { providers: new Map([[SIM_PAY_KIND, provider]]) },
        )
        for (const job of sent.slice(from)) {
          if (job.name !== JOB_NAMES.paymentCheck) continue
          await checkPayment(env(), target((job.data as PaymentJob).paymentId), deps())
        }
      }
      function deliver(notice: Notice) {
        jobs = jobs.then(async () => {
          try {
            await recordProviderNotice(pool, {
              providerKind: SIM_PAY_KIND,
              live: false,
              notice: {
                id: notice.id,
                type: notice.type,
                kind: notice.kind,
                accountRef: account,
                objectRef: providerRef(notice.object),
              },
              jobId: 'model-notice',
            })
            await noticeJob()
          } catch (error) {
            failures.push(error)
          }
        })
      }

      function providerDoes(id: string, event: ProviderAct['event']): Notice | null {
        const paymentRef = providerRef(refs.get(id) ?? '')
        const about = (type: string): Notice => ({
          id: `evt_${randomUUID()}`,
          type,
          kind: 'payment',
          object: paymentRef.provider,
        })
        if (event === 'cancelled') {
          // Cancelled outside Restro (a scripted fault at the release may take this call).
          const before = statusOf(id)
          outside += 1
          engine.release({
            accountRef: account,
            paymentRef,
            idempotencyKey: `${id}:outside:${outside}`,
          })
          if (before === 'held' && statusOf(id) === 'released') dropped.add(id)
          return about('payment.cancelled')
        }
        if (event === 'expired') {
          // The provider's clock passes every hold's capture-by: all of them run out.
          for (const other of ids) if (statusOf(other) === 'held') dropped.add(other)
          payClock.advance(engine.switches.holdDays * DAY_MS)
          return about('payment.expired')
        }
        if (event === 'refunded') {
          const [now] = engine.paymentsOf(account, id as never)
          if (now?.status !== 'captured' || now.capturedMinor - now.refundedMinor < REFUND_MINOR) {
            refunds.push(id)
            return null
          }
          const made = engine.venue.refundsInDashboard(account, paymentRef, REFUND_MINOR)
          return { id: made.id, type: made.type, kind: 'refund', object: made.object }
        }
        return about(`payment.${event}`)
      }

      function waiterDoes(act: WaiterAct) {
        const till = sim.host.engine
        till.settle()
        const tables = act.where === 'real' ? [POS_TABLE] : PAYMENT_TABLES
        const bill = till.state.bills.find(
          (b) => tables.includes(b.table) && b.state === 'open' && b.rows.length > 0,
        )
        const row = bill?.rows[act.row % bill.rows.length]
        if (bill === undefined || row === undefined) return
        try {
          if (act.act === 'void') till.waiter.voidLine(bill.id, row.id)
          else if (act.act === 'void_part') till.waiter.voidLine(bill.id, row.id, '1')
          else if (act.act === 'move_away') {
            till.waiter.moveLines(bill.id, [{ row: row.id }], OTHER_TABLE)
          } else if (act.act === 'add') {
            till.waiter.addRound(bill.table, [{ article: '2001' }], { bill: bill.id })
          } else till.waiter.closeBill(bill.id)
        } catch (error) {
          // What the POS does not let a waiter do is not done.
          const refused =
            error instanceof PosRefusal ||
            error instanceof SimSetupError ||
            error instanceof UndefinedBehaviour
          if (!refused) throw error
        }
      }

      function happen(happening: Happening) {
        if (happening.kind === 'waiter') {
          waiterDoes(happening)
          return
        }
        const id = ids[happening.payment]
        if (id === undefined) return
        const notice = providerDoes(id, happening.event)
        if (notice === null) return
        if (happening.notice === 'late') {
          late.push(notice)
          return
        }
        deliver(notice)
        // Sent again: once under the same event id (stored once), once as a new event.
        if (happening.notice === 'twice') late.push(notice, { ...notice, id: `${notice.id}-again` })
      }

      beforeCall = (method, args) => {
        if (method === 'payAndClose') {
          const request = args[1] as {
            readonly isolated: { readonly ref: { readonly pos: string } }
            readonly ref: string
          }
          closes.set(request.ref.replace(/-close$/, ''), request.isolated.ref.pos)
        }
        const nth = (seen.get(method) ?? 0) + 1
        seen.set(method, nth)
        for (const due of pending.filter((h) => h.at.before === method && h.at.nth === nth)) {
          pending.splice(pending.indexOf(due), 1)
          happen(due)
        }
      }

      const settled = async () => {
        await jobs
        if (failures.length > 0) throw failures[0]
      }
      return {
        dropped,
        settled,
        async rest() {
          for (const due of pending.splice(0)) happen(due)
          for (const notice of late.splice(0)) deliver(notice)
          await settled()
        },
        async end() {
          for (const id of refunds.splice(0)) {
            const notice = providerDoes(id, 'refunded')
            if (notice !== null) deliver(notice)
          }
          for (const notice of late.splice(0)) deliver(notice)
          await settled()
          // The notices that waited (a refund before the capture was recorded) are handled now.
          await noticeJob()
        },
        till(id) {
          const pos = sim.host.engine
          pos.settle()
          const bill = pos.state.bills.find((b) => b.id === closes.get(id))
          const api = new Set(pos.apiLogins().map((login) => login.id))
          const card = new Set(
            pos.state.paymentTypes.filter((type) => type.kind === 'card').map((type) => type.id),
          )
          const ours =
            bill?.state === 'closed'
              ? bill.payments.filter((p) => api.has(p.by) && card.has(p.type))
              : []
          return {
            closed: ours.length > 0,
            cardMinor: ours.reduce((sum, p) => sum + p.amountMinor, 0),
          }
        },
      }
    }

    /**
     * A manager looks at the till and answers a close the POS did not confirm, through
     * `payment.answer`: "Receipt printed" when Restro's card payment closed the bill, "No receipt"
     * otherwise. Tapping again changes nothing; another manager's other answer is refused.
     */
    async function answerAsTheTillShows(id: string, played: Played, tapsAgain: boolean) {
      const row = await stored(id)
      if (row?.state !== 'unconfirmed') return
      if (row.reason !== 'close_unknown' && row.reason !== 'close_refused') return
      const value = played.till(id).closed ? 'receipt_printed' : 'no_receipt'
      expect(await answer(id, value)).toMatchObject({
        status: 'accepted',
        details: { changed: true },
      })
      if (!tapsAgain) return
      expect(await answer(id, value)).toMatchObject({
        status: 'accepted',
        details: { changed: false },
      })
      const other = value === 'receipt_printed' ? 'no_receipt' : 'receipt_printed'
      expect(await answer(id, other)).toMatchObject({
        status: 'refused',
        code: 'payment_answered',
      })
    }

    async function invariants(ids: string[], played: Played) {
      const allSteps = await query<{
        payment_id: string
        step: string
        outcome: string
        answer: string | null
      }>(
        `select payment_id, step, outcome, answer from restro.payment_steps
          where payment_id = any($1) order by seq`,
        [ids],
      )
      const answers = await query<{ payment_id: string; to_state: string }>(
        `select payment_id, to_state from restro.log_entries
          where kind = 'payment.answered' and payment_id = any($1)`,
        [ids],
      )
      for (const id of ids) {
        const row = await stored(id)
        // Every payment ends settled: a manager answered each close the POS did not confirm.
        expect(SETTLED).toContain(row?.state)
        expect(row?.settled).toBe(true)
        const own = allSteps.filter((step) => step.payment_id === id)
        const at = (step: string, outcome: string, answer?: string) =>
          own.findIndex(
            (s) =>
              s.step === step &&
              s.outcome === outcome &&
              (answer === undefined || s.answer === answer),
          )
        const answered = answers.find((entry) => entry.payment_id === id)?.to_state ?? null
        const closeAttempt = at('payAndClose', 'attempting')
        const done = at('payAndClose', 'done')
        const closeProof = done >= 0 ? done : at('payAndClose', 'refused', 'already_done')
        const proven = closeProof >= 0 || answered === 'receipt_printed'
        const capture = at('capture', 'attempting')
        const [provider] = engine.paymentsOf(providerRef(accountRef), id as never)
        // 1. A capture only after proof of a close: the POS's, or a manager's "Receipt printed".
        if (capture >= 0) {
          expect(proven).toBe(true)
          if (answered === null) expect(closeProof).toBeLessThan(capture)
        }
        if (provider?.status === 'captured') expect(proven).toBe(true)
        // 2. No release once a close was attempted, unless a manager answered "No receipt".
        if (closeAttempt >= 0 && answered !== 'no_receipt') {
          expect(own.slice(closeAttempt).some((step) => step.step === 'release')).toBe(false)
          expect(row?.state).not.toBe('released')
          if (!played.dropped.has(id)) expect(provider?.status).not.toBe('released')
        }
        // 5. The money matches the till: a capture is the card payment Restro's close put on the
        // bill, and a bill Restro closed is captured, or the owners are told it was not.
        const till = played.till(id)
        if (provider?.status === 'captured') {
          expect(till.closed).toBe(true)
          expect(provider.capturedMinor).toBe(till.cardMinor)
        }
        if (till.closed) expect(['captured', 'capture_failed']).toContain(row?.state)
        // 6. A refund the venue made is recorded from its notice.
        expect(Number(row?.refunded_minor ?? 0)).toBe(provider?.refundedMinor ?? 0)
      }
      // 6. Every notice was handled, however late or often it came.
      const [waiting] = await query<{ count: number }>(
        'select count(*)::int as count from restro.provider_notices where handled_at is null',
      )
      expect(waiting?.count).toBe(0)
      // 3. A line is never in two payments that went past the last check.
      const kept = await query<{ pos_line_ref: string }>(
        `select l.pos_line_ref from restro.payment_lines l
           join restro.payments p on p.tenant_id = l.tenant_id and p.id = l.payment_id
          where l.payment_id = any($1) and l.pos_line_ref is not null
            and p.state in ('closed', 'captured', 'unconfirmed', 'capture_failed', 'stranded')`,
        [ids],
      )
      const refs = kept.map((line) => line.pos_line_ref)
      expect(new Set(refs).size).toBe(refs.length)
      // 4. A payment table is held by one payment at a time: each claim finds it free.
      const entries = await query<{
        payment_id: string
        to_state: string
        reason: string | null
        table: string | null
      }>(
        `select payment_id, to_state, reason, details->>'paymentTableId' as table
           from restro.log_entries
          where kind = 'payment.state' and payment_id = any($1) order by seq`,
        [ids],
      )
      const holder = new Map<string, string>()
      for (const entry of entries) {
        if (entry.table === null) continue
        if (entry.reason === 'table_freed') {
          expect(holder.get(entry.table)).toBe(entry.payment_id)
          holder.delete(entry.table)
        } else if (entry.to_state === 'queued') {
          expect(holder.get(entry.table)).toBeUndefined()
          holder.set(entry.table, entry.payment_id)
        }
      }
    }
  })
})
