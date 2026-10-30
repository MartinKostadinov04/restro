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
// recorded. A close may land after the read-back window too (C52), after a manager who looked
// too early answered "No receipt": a hold is never released while the till shows Restro's card
// payment on a closed bill, unless a manager answered "No receipt" again with the items missing.
// The model's notices run beside the route, so a night's order hangs on the database's timing; with
// PAYMENT_MODEL_ORDER=fixed each connector call waits for the notice jobs before it, and a failing
// night replays from its seed (F6).
// The recovery (#112): a worker killed right after it recorded any step of the route, before or
// after the call, leaves a payment the recovery's pass alone brings to captured, released or
// unconfirmed. A hold that runs out while its payment waits for a table or a manager's answer
// settles `released`, reason `expired`, and the open questions close.
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
  BUDGET_WAIT_MS,
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
  createSimPosConnector,
  createSimServer,
  type FaultRule,
  fetchTransport,
  loadScenarioFile,
  PosRefusal,
  readingLogin,
  ManualClock as SimPosClock,
  type SimServer,
  SimSetupError,
  UndefinedBehaviour,
} from '@restro/sim-pos'
import fc from 'fast-check'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { InstanceBudgets, readFloorOf } from '../src/jobs/floor'
import { recoverPayments } from '../src/jobs/payment-recovery'
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
/** A late write that lands after the read-back window, which barsy's docs don't rule out (C52). */
const PAST_WINDOW_MS = TIMINGS.readBackWindowMs + 20_000
/** How much time passes between two runs of a job: its read-back, on both clocks. */
const BETWEEN_RUNS_MS = 5_000

const LOOSE = new GuestLimiter(
  Object.fromEntries(
    Object.entries(GUEST_LIMITS).map(([name, limit]) => [name, { ...limit, max: 10_000 }]),
  ) as Record<GuestLimitName, GuestLimit>,
)

/** The states a run ends in when nobody needs to act. */
const SETTLED = ['captured', 'released', 'stranded', 'capture_failed']
/**
 * The model's order: `fixed` makes each connector call wait for the notice jobs started before it,
 * so a night replays from its seed (F6); by default they run beside the route, as in production.
 */
const FIXED_ORDER = process.env.PAYMENT_MODEL_ORDER === 'fixed'

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
    // Paying is on only with a payment table in every bar (D125 2.3): PM1 and PM2 are the first
    // bar's, PU1 is the second's.
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
    // The venue's legal details are part of what turns paying on (#198).
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
  async function reset(lateLandingMs = LATE_LANDING_MS) {
    forgetGuestCodes()
    LOOSE.clear()
    sent.length = 0
    beforeCall = () => {}
    engine.clearFaults()
    // A fresh till, with the pilot's limit of calls per second; a late write lands in the window.
    const scenario = loadScenarioFile('demo-bar')
    sim.host.engine = buildEngine(
      { ...scenario, switches: { ...scenario.switches, lateLandingMs } },
      { clock: simClock },
    )
    // What earlier tests left: their payments over, their payment tables free.
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
  async function tryHeld(
    index: number | 'all',
    tipMinor: number | null = null,
    overrides: Partial<PaymentJobDeps> = {},
  ): Promise<string | null> {
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
        tipMinor,
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
    expect(await preparePayment(env(), target(id), deps(overrides))).toEqual({
      kind: 'at',
      state: 'awaiting_guest',
    })
    engine.guest.pay(providerRef((await stored(id))?.provider_payment_ref ?? ''))
    expect(await checkPayment(env(), target(id), deps(overrides))).toEqual({
      kind: 'at',
      state: 'held',
    })
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
  const answer = async (
    id: string,
    value: 'receipt_printed' | 'no_receipt',
    answering: 'close' | 'lines_not_back' = 'close',
  ) =>
    (
      await applyService(
        pool,
        { type: 'payment.answer', paymentId: id, answering, answer: value },
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

    it('"No receipt" after a move back with no lines recorded: not back, and no move sent', async () => {
      const id = await held(1)
      fault({ on: 'closeBill', fault: { kind: 'hang' } })
      expect((await drive(id)).row).toMatchObject({ state: 'unconfirmed', reason: 'close_unknown' })
      expect(await answer(id, 'no_receipt')).toMatchObject({ status: 'accepted' })
      // An earlier move back whose lines could not be recorded (too many, say): what it took is
      // unknown, so nothing proves the lines back.
      await query(
        `insert into restro.payment_steps
           (tenant_id, venue_id, payment_id, step, outcome, idempotency_key, source, actor, job_id)
         values ($1, $2, $3, 'undoIsolate', 'attempting', $4, 'worker', 'system', 'test-seed')`,
        [tenantId, demo.venueId, id, `${id}-undo`],
      )
      await pass(id, TIMINGS.readBackWindowMs)
      const moves = calls('moveRows')
      const { row } = await drive(id)
      expect(row).toMatchObject({ state: 'unconfirmed', reason: 'lines_not_back' })
      expect(calls('moveRows')).toBe(moves)
      expect(paymentTablesEmpty()).toBe(false)
      expect(engine.paymentsOf(providerRef(accountRef), id as never)).toEqual([
        expect.objectContaining({ status: 'held' }),
      ])
    })

    it('"No receipt", the move back landing after its run: the recorded lines prove it back', async () => {
      const id = await held(1)
      fault(
        { on: 'closeBill', fault: { kind: 'hang' } },
        { on: 'moveRows', from: 2, fault: { kind: 'landsLate' } },
      )
      expect((await drive(id)).row).toMatchObject({ state: 'unconfirmed', reason: 'close_unknown' })
      expect(await answer(id, 'no_receipt')).toMatchObject({ status: 'accepted' })
      // The move back's answer is late: still on the payment table, read back on a later run.
      expect((await drive(id, 1)).row).toMatchObject({ state: 'unconfirmed', reason: 'no_receipt' })
      expect(paymentTablesEmpty()).toBe(false)
      const [recorded] = await query<{ lines: unknown }>(
        `select lines from restro.payment_steps
          where payment_id = $1 and step = 'undoIsolate' and outcome = 'attempting'`,
        [id],
      )
      expect(recorded?.lines).toEqual([
        { pos: expect.any(String), quantity: '2', amountMinor: 2200 },
      ])
      expect(
        await query(
          `select step from restro.payment_steps where payment_id = $1 and lines is not null
            and not (step = 'undoIsolate' and outcome = 'attempting')`,
          [id],
        ),
      ).toEqual([])
      // It lands; the next run finds the payment table empty and the recorded line on the table.
      await pass(id, LATE_LANDING_MS + 1_000)
      sim.host.engine.settle()
      expect(paymentTablesEmpty()).toBe(true)
      const { row } = await drive(id)
      expect(row).toMatchObject({ state: 'released', reason: 'no_receipt', payment_table_id: null })
      expect(rowsOn(POS_TABLE)).toEqual(['2001', '2002'])
      expect(calls('moveRows')).toBe(2)
      expect(await alertsOf(id)).toEqual(['payment_unconfirmed:money.follow_up'])
    })

    it('the close, landing late: a manager is asked only after the read-back window', async () => {
      // The close lands after a write's longest time but inside D115's read-back window, so only
      // waiting out the window (not the in-flight bound alone) lets it land before the question.
      const lateLandingMs = 50_000
      expect(BUDGET_WAIT_MS + TIMINGS.writeTimeoutMs + LEASE_MARGIN_MS).toBeLessThan(lateLandingMs)
      expect(lateLandingMs).toBeLessThan(TIMINGS.readBackWindowMs)
      await reset(lateLandingMs)
      const id = await held(1)
      fault(
        { on: 'closeBill', fault: { kind: 'landsLate' } },
        { on: 'moveRows', from: 2, fault: { kind: 'landsLate' } },
      )
      const { row } = await drive(id)
      expect(row).toMatchObject({ state: 'unconfirmed', reason: 'close_unknown' })
      // Inside the window the close landed before the manager was asked: a receipt printed. A
      // landing later than the window is not ruled out (C52).
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

    it('the close, landing after the read-back window, then "No receipt": the hold stays', async () => {
      await reset(PAST_WINDOW_MS)
      const id = await held(1)
      fault({ on: 'closeBill', fault: { kind: 'landsLate' } })
      expect((await drive(id)).row).toMatchObject({ state: 'unconfirmed', reason: 'close_unknown' })
      // The manager looks before the close lands: no receipt yet.
      expect(sim.host.engine.pendingLateWrites()).toBe(1)
      expect(await answer(id, 'no_receipt')).toMatchObject({ status: 'accepted' })
      // The close lands before the worker puts the lines back: the payment table reads empty.
      await pass(id, PAST_WINDOW_MS)
      sim.host.engine.settle()
      expect(sim.host.engine.pendingLateWrites()).toBe(0)
      const { row } = await drive(id)
      expect(row).toMatchObject({ state: 'unconfirmed', reason: 'lines_not_back' })
      expect(row?.payment_table_id).not.toBeNull()
      expect(await alertsOf(id)).toEqual([
        'payment_lines_not_back:money.follow_up',
        'payment_unconfirmed:money.follow_up',
      ])
      expect(await steps(id)).not.toContain('release:attempting')
      expect(engine.paymentsOf(providerRef(accountRef), id as never)).toEqual([
        expect.objectContaining({ status: 'held' }),
      ])
      expect(rowsOn(POS_TABLE)).toEqual(['2001'])
      // A late "Receipt printed" to the first question is refused: it was answered.
      expect(await answer(id, 'receipt_printed')).toMatchObject({
        status: 'refused',
        code: 'payment_answered',
      })
      // Asked again, the manager finds the receipt: captured.
      expect(await answer(id, 'receipt_printed', 'lines_not_back')).toMatchObject({
        status: 'accepted',
      })
      expect((await drive(id)).row).toMatchObject({
        state: 'captured',
        captured_minor: '2200',
        payment_table_id: null,
      })
      expect(calls('closeBill')).toBe(1)
    })

    it('"No receipt", and the close lands as the lines go back (bill_closed): the hold stays', async () => {
      await reset(PAST_WINDOW_MS)
      const id = await held(1)
      fault({ on: 'closeBill', fault: { kind: 'landsLate' } })
      expect((await drive(id)).row).toMatchObject({ state: 'unconfirmed', reason: 'close_unknown' })
      expect(await answer(id, 'no_receipt')).toMatchObject({ status: 'accepted' })
      // The close lands right after the worker read the payment table, before its move back.
      beforeCall = (method) => {
        if (method === 'undoIsolate') simClock.advance(PAST_WINDOW_MS)
      }
      const { row } = await drive(id)
      expect(await steps(id)).toContain('undoIsolate:refused:bill_closed')
      expect(row).toMatchObject({ state: 'unconfirmed', reason: 'lines_not_back' })
      expect(engine.paymentsOf(providerRef(accountRef), id as never)).toEqual([
        expect.objectContaining({ status: 'held' }),
      ])
    })

    it('"No receipt" and lines the POS would not move back: the hold stays until asked again', async () => {
      const id = await held(1)
      fault(
        { on: 'closeBill', fault: { kind: 'hang' } },
        { on: 'moveRows', from: 2, times: 100, fault: { kind: 'refuse', code: 'bill_locked' } },
      )
      expect((await drive(id)).row).toMatchObject({ state: 'unconfirmed', reason: 'close_unknown' })
      expect(await answer(id, 'no_receipt')).toMatchObject({ status: 'accepted' })
      const first = await drive(id)
      expect(first.row).toMatchObject({ state: 'unconfirmed', reason: 'lines_not_back' })
      expect(calls('moveRows')).toBeGreaterThan(2)
      expect(engine.paymentsOf(providerRef(accountRef), id as never)).toEqual([
        expect.objectContaining({ status: 'held' }),
      ])
      expect(await alertsOf(id)).toEqual([
        'payment_lines_not_back:money.follow_up',
        'payment_unconfirmed:money.follow_up',
      ])
      // A late "No receipt" to the first question (a second manager, a retry, an old push) is not
      // the second answer: nothing changes, the hold stays.
      const moves = calls('moveRows')
      expect(await answer(id, 'no_receipt')).toMatchObject({
        status: 'accepted',
        details: { changed: false },
      })
      expect(await stored(id)).toMatchObject({ state: 'unconfirmed', reason: 'lines_not_back' })
      expect((await drive(id)).row).toMatchObject({
        state: 'unconfirmed',
        reason: 'lines_not_back',
      })
      expect(engine.paymentsOf(providerRef(accountRef), id as never)).toEqual([
        expect.objectContaining({ status: 'held' }),
      ])
      // The manager checks the till again, the items missing from the table: released, stranded.
      expect(await answer(id, 'no_receipt', 'lines_not_back')).toMatchObject({
        status: 'accepted',
        details: { changed: true },
      })
      expect(await answer(id, 'no_receipt', 'lines_not_back')).toMatchObject({
        status: 'accepted',
        details: { changed: false },
      })
      expect(await answer(id, 'receipt_printed', 'lines_not_back')).toMatchObject({
        status: 'refused',
        code: 'payment_answered',
      })
      const { row } = await drive(id)
      expect(row).toMatchObject({ state: 'stranded', reason: 'stranded', settled: true })
      // No move back is tried again: the manager saw the items missing.
      expect(calls('moveRows')).toBe(moves)
      expect(engine.paymentsOf(providerRef(accountRef), id as never)).toEqual([
        expect.objectContaining({ status: 'released' }),
      ])
      expect(await alertsOf(id)).toEqual([
        'payment_lines_not_back:money.follow_up',
        'payment_stranded:alerts.answer',
        'payment_unconfirmed:money.follow_up',
      ])
      // The lines stay on the payment table for staff, and it stays the payment's.
      expect(row?.payment_table_id).not.toBeNull()
      expect(paymentTablesEmpty()).toBe(false)
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

  describe('a capture whose server error the provider keeps under its key, the hold gone', () => {
    /** Unconfirmed, a manager's "Receipt printed", and the capture's next call a server error. */
    async function receiptPrinted() {
      const id = await held(1)
      fault({ on: 'closeBill', fault: { kind: 'landsThenHangs' } })
      expect((await drive(id)).row).toMatchObject({ state: 'unconfirmed', reason: 'close_unknown' })
      expect(await answer(id, 'receipt_printed')).toMatchObject({ status: 'accepted' })
      engine.fault('capture', { kind: 'server_error' })
      return id
    }
    const holdOf = (id: string) => engine.paymentsOf(providerRef(accountRef), id as never)[0]

    it('ran out: the capture failed (hold_expired), never tried again forever', async () => {
      const id = await receiptPrinted()
      payClock.advance(engine.switches.holdDays * 24 * 60 * 60 * 1000)
      // The worker's clock past the capture deadline too.
      const before = clock
      clock = new Date(Date.parse(holdOf(id)?.captureBefore ?? '') + 1_000)
      try {
        const { row } = await drive(id)
        expect(row).toMatchObject({
          state: 'capture_failed',
          reason: 'hold_expired',
          settled: true,
        })
      } finally {
        clock = before
      }
      expect(await steps(id)).toContain('capture:unknown:gone')
      expect(await alertsOf(id)).toEqual([
        'payment_capture_failed:money.follow_up',
        'payment_unconfirmed:money.follow_up',
      ])
      expect(holdOf(id)).toMatchObject({ status: 'released', capturedMinor: 0 })
    })

    it('the payment read failed at the provider: the capture failed (not_held)', async () => {
      const id = await receiptPrinted()
      // The provider shows the payment failed.
      const failing = new Proxy(provider, {
        get(target, name) {
          const value = Reflect.get(target, name, target)
          if (name !== 'readPayment' || typeof value !== 'function') {
            return typeof value === 'function' ? value.bind(target) : value
          }
          return async (...args: Parameters<typeof provider.readPayment>) => {
            const read = await provider.readPayment(...args)
            if (!read.complete) return read
            return { ...read, value: { ...read.value, status: 'failed' as const, heldMinor: 0 } }
          }
        },
      })
      const { row } = await drive(id, 40, { providers: new Map([[SIM_PAY_KIND, failing]]) })
      expect(row).toMatchObject({ state: 'capture_failed', reason: 'not_held' })
      expect(await steps(id)).toContain('capture:unknown:gone')
      expect(await alertsOf(id)).toContain('payment_capture_failed:money.follow_up')
    })

    it('a read that fails part-way concludes nothing: tried again, then failed once it reads', async () => {
      const id = await receiptPrinted()
      payClock.advance(engine.switches.holdDays * 24 * 60 * 60 * 1000)
      engine.failReads()
      const { row, retries } = await drive(id, 3)
      expect(row).toMatchObject({ state: 'unconfirmed', reason: 'receipt_printed' })
      expect(retries).toEqual(Array(3).fill('the capture has an unknown outcome'))
      expect(await steps(id)).not.toContain('capture:unknown:gone')
      expect(await alertsOf(id)).not.toContain('payment_capture_failed:money.follow_up')
      // The reads come back; the server error stays under the key.
      engine.clearFaults()
      expect((await drive(id)).row).toMatchObject({ state: 'capture_failed' })
      expect(await steps(id)).toContain('capture:unknown:gone')
    })

    it('after a close the POS confirmed, the hold cancelled at the provider: failed (not_held)', async () => {
      const id = await held(1)
      const paymentRef = providerRef((await stored(id))?.provider_payment_ref ?? '')
      engine.fault('capture', { kind: 'server_error' })
      let done = false
      beforeCall = (method) => {
        if (method !== 'payAndClose' || done) return
        done = true
        // Cancelled at the provider after the hold was read for the close.
        engine.release({
          accountRef: providerRef(accountRef),
          paymentRef,
          idempotencyKey: `${id}:outside`,
        })
      }
      const { row } = await drive(id)
      expect(row).toMatchObject({ state: 'capture_failed', reason: 'not_held', settled: true })
      expect(await steps(id)).toEqual(
        expect.arrayContaining(['payAndClose:done', 'capture:unknown:gone']),
      )
      expect(await alertsOf(id)).toEqual(['payment_capture_failed:money.follow_up'])
      // The bill is closed: nothing is put back.
      expect(rowsOn(POS_TABLE)).toEqual(['2001'])
    })
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

  describe('a worker killed after a recorded step (the recovery alone finishes it)', () => {
    class Killed extends Error {}
    /** Nobody touched the payment for two minutes (as the owner, past the `updated_at` trigger). */
    const untouched = (id: string) =>
      withOwnerClient(db.ownerUrl, async (client) => {
        await client.query('begin')
        await client.query('set local session_replication_role = replica')
        await client.query(
          `update restro.payments set updated_at = updated_at - interval '2 minutes' where id = $1`,
          [id],
        )
        await client.query('commit')
      })

    /** Runs the payment's route until the worker dies right after it records `step` `outcome`. */
    async function killAfter(id: string, step: string, outcome: string) {
      const killed = {
        ...env(),
        onStep: async (recorded: { readonly step: string; readonly outcome: string }) => {
          if (recorded.step === step && recorded.outcome === outcome) throw new Killed(step)
        },
      }
      let died = false
      for (let run = 0; run < 10 && !died; run += 1) {
        try {
          await preparePayment(killed, target(id), deps())
        } catch (error) {
          if (error instanceof Killed) died = true
          else if (!(error instanceof PaymentStepRetry)) throw error
        }
      }
      expect(died).toBe(true)
    }
    /** The recovery's pass, after the worker was down: it queues the payment's prepare. */
    async function recoverAfterDowntime(id: string) {
      await pass(id, 120_000)
      await untouched(id)
      sent.length = 0
      await recoverPayments({ pool, log, now: () => clock, queue }, deps())
      expect(sent).toContainEqual(
        expect.objectContaining({
          name: JOB_NAMES.paymentPrepare,
          options: expect.objectContaining({ singletonKey: id }),
        }),
      )
    }

    // `payAndClose done` is recorded with the state in one transaction, so a worker killed after
    // it finds the payment `closed` already; the recorded close without its state is below (F4).
    it.each([
      ['isolateLines', 'attempting'],
      ['isolateLines', 'done'],
      ['payAndClose', 'attempting'],
      ['payAndClose', 'done'],
      ['capture', 'attempting'],
      ['capture', 'done'],
    ])('after %s %s: captured, released or unconfirmed', async (step, outcome) => {
      const id = await held(1)
      await killAfter(id, step, outcome)
      await recoverAfterDowntime(id)
      const { row } = await drive(id)
      expect(['captured', 'released', 'unconfirmed']).toContain(row?.state)
      // Each write was sent at most once more than it was attempted, and the bill closed once.
      expect(calls('closeBill')).toBeLessThanOrEqual(1)
      if (row?.state === 'captured') {
        expect(row).toMatchObject({ captured_minor: '2200', payment_table_id: null })
        expect(rowsOn(POS_TABLE)).toEqual(['2001'])
      }
      if (row?.state === 'unconfirmed') {
        // A close that was never sent: the manager is asked, never a release on its own.
        expect(row.reason).toBe('close_unknown')
        expect(engine.paymentsOf(providerRef(accountRef), id as never)).toEqual([
          expect.objectContaining({ status: 'held' }),
        ])
      }
      // Only the close, killed before it was sent, may leave the manager a question.
      if (!(step === 'payAndClose' && outcome === 'attempting')) {
        expect(row?.state).toBe('captured')
      }
    })

    it.each(['attempting', 'done'])(
      'after undoIsolate %s: released, the lines back, the hold released',
      async (outcome) => {
        const id = await held(1)
        // The bill changes at the last check: the route puts the lines back.
        slipRoundOntoPaymentTable()
        await killAfter(id, 'undoIsolate', outcome)
        await recoverAfterDowntime(id)
        const { row } = await drive(id)
        expect(row).toMatchObject({
          state: 'released',
          reason: 'check_failed',
          payment_table_id: null,
        })
        expect(calls('closeBill')).toBe(0)
        expect(rowsOn(POS_TABLE)).toEqual(['2001', '2001', '2002'])
        expect(engine.paymentsOf(providerRef(accountRef), id as never)).toEqual([
          expect.objectContaining({ status: 'released' }),
        ])
      },
    )

    // Hot spot 5 (B14c): the hardest kill, the POS closed the bill and the worker died before any
    // answer was written, so only `attempting` is on record. The close is never sent again, a
    // manager is asked only after the read-back window, nothing is released meanwhile, and
    // "Receipt printed" captures what the close took.
    it('after the close landed, with only attempting recorded: asked, never closed twice', async () => {
      const id = await held(1)
      let call: { readonly context: unknown; readonly isolated: unknown } | null = null
      beforeCall = (method, args) => {
        if (method === 'readIsolated') call = { context: args[0], isolated: args[1] }
      }
      await killAfter(id, 'payAndClose', 'attempting')
      beforeCall = () => {}
      if (call === null) throw new Error('the isolated bill was never read')
      const { context, isolated } = call as { context: never; isolated: never }
      // What the dead worker's call did: the POS closed the bill with its card payment.
      const integrations = await query<{ kind: string; host: string; config: unknown }>(
        'select kind, host, config from restro.integrations where id = $1',
        [demo.integrationId],
      )
      const connector = connectorFor(integrations[0] as never, policy)
      simClock.advance(1_100)
      const landed = await connector.payAndClose(context, {
        isolated,
        amountMinor: 2_200,
        tipMinor: 0,
        paymentType: null,
        ref: `${id}-close`,
      })
      expect(landed.kind).toBe('done')
      expect(calls('closeBill')).toBe(1)

      await recoverAfterDowntime(id)
      const { row } = await drive(id)
      expect(row).toMatchObject({ state: 'unconfirmed', reason: 'close_unknown' })
      expect(calls('closeBill')).toBe(1)
      expect(engine.paymentsOf(providerRef(accountRef), id as never)).toEqual([
        expect.objectContaining({ status: 'held' }),
      ])
      expect(await alertsOf(id)).toEqual(['payment_unconfirmed:money.follow_up'])

      expect((await answer(id, 'receipt_printed')).status).toBe('accepted')
      const after = await drive(id)
      expect(after.row).toMatchObject({ state: 'captured', captured_minor: '2200' })
      expect(calls('closeBill')).toBe(1)
    })

    /** A close answer recorded without its state (F4): the run died between them. */
    const recordClose = (id: string, outcome: 'done' | 'refused', answer: string) =>
      withOwnerClient(db.ownerUrl, async (client) => {
        await client.query(
          `insert into restro.payment_steps
             (tenant_id, venue_id, payment_id, step, outcome, answer, idempotency_key,
              source, actor, job_id)
           values ($1, $2, $3, 'payAndClose', $4, $5, $6, 'worker', 'system', 'test-seed')`,
          [tenantId, demo.venueId, id, outcome, answer, `${id}-close`],
        )
      })

    it.each([
      ['done', 'R-7781', 'R-7781'],
      ['refused', 'already_done', null],
    ] as const)(
      'routes a recorded close %s %s as proof: captured, no question (F4)',
      async (outcome, answer, receipt) => {
        const id = await held(1)
        await killAfter(id, 'payAndClose', 'attempting')
        expect(await stored(id)).toMatchObject({ state: 'checked' })
        await recordClose(id, outcome, answer)
        await recoverAfterDowntime(id)
        await drive(id, 6)
        expect(await stored(id)).toMatchObject({ state: 'captured' })
        const [kept] = await query<{ receipt_number: string | null }>(
          'select receipt_number from restro.payments where id = $1',
          [id],
        )
        expect(kept?.receipt_number ?? null).toBe(receipt)
        // The recorded answer is the outcome: the close is not sent again, and nobody is asked.
        expect(calls('closeBill')).toBe(0)
        expect(await alertsOf(id)).toEqual([])
      },
    )
  })

  describe('a hold that runs out while its payment waits (#112)', () => {
    const DAY_MS = 24 * 60 * 60 * 1000

    it('waiting for a payment table: released, reason expired, its lines free', async () => {
      for (const table of PAYMENT_TABLES)
        sim.host.engine.waiter.addRound(table, [{ article: '2001' }])
      const id = await held(1)
      expect(await preparePayment(env(), target(id), deps())).toEqual({
        kind: 'at',
        state: 'queued',
      })
      // Still held: the check changes nothing.
      expect(await checkPayment(env(), target(id), deps())).toEqual({ kind: 'at', state: 'queued' })
      payClock.advance(engine.switches.holdDays * DAY_MS)
      expect(await checkPayment(env(), target(id), deps())).toEqual({
        kind: 'at',
        state: 'released',
      })
      expect(await stored(id)).toMatchObject({ reason: 'expired', settled: true })
      expect((await lines()).every((line) => !line.beingPaid)).toBe(true)
      expect(rowsOn(POS_TABLE)).toEqual(['2001', '2002'])
    })

    it("waiting for a manager's answer: released, reason expired, both questions closed", async () => {
      const id = await held(1)
      fault({ on: 'closeBill', fault: { kind: 'hang' } })
      expect((await drive(id)).row).toMatchObject({ state: 'unconfirmed', reason: 'close_unknown' })
      expect(await alertsOf(id)).toEqual(['payment_unconfirmed:money.follow_up'])
      payClock.advance(engine.switches.holdDays * DAY_MS)
      expect(await checkPayment(env(), target(id), deps())).toEqual({
        kind: 'at',
        state: 'released',
      })
      expect(await stored(id)).toMatchObject({ reason: 'expired' })
      const open = await query<{ kind: string }>(
        'select kind from restro.alerts where subject_id = $1 and done_at is null',
        [id],
      )
      // The questions closed; the owners and the team are told the hold ran out unanswered.
      expect(open).toEqual([{ kind: 'payment_hold_expired' }])
      const logged = await query<{ closed: string }>(
        `select details->>'questionClosed' as closed from restro.log_entries
          where kind = 'payment.state' and payment_id = $1 and to_state = 'released'`,
        [id],
      )
      expect(logged).toEqual([{ closed: 'payment_unconfirmed' }])
      // A manager's late answer changes nothing.
      expect(await answer(id, 'no_receipt')).toMatchObject({ status: 'refused' })
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

  // Repair-review loops (A5). A hold is never left without a release or capture path, and the
  // money taken is the lines plus the tip in minor units (rule 8).
  describe('signed POS amounts and tips through the close and the capture', () => {
    /** The route's connector with each `readIsolated` answer's bill passed through `edit`. */
    const editingIsolated =
      (edit: (bill: { totalMinor: number; lines: unknown[] }) => object): typeof connectorFor =>
      (integration, simPolicy) => {
        const connector = connectorFor(integration, simPolicy)
        return new Proxy(connector, {
          get(target, name, receiver) {
            const value = Reflect.get(target, name, receiver)
            if (name !== 'readIsolated' || typeof value !== 'function') return value
            return async (...callArgs: unknown[]) => {
              const answer = await value.apply(target, callArgs)
              if (!answer.complete || answer.value.bill === null) return answer
              return { ...answer, value: { ...answer.value, bill: edit(answer.value.bill) } }
            }
          },
        }) as ServiceConnector
      }

    // RR-11: a discount line (negative, as `BillLineSchema` allows) on the isolated bill: a
    // waiter's discount given on the payment table before the last check. The guest did not
    // confirm it, so the check fails, the lines go back and the card is released; the route must
    // never throw on the signed amount and leave the card held with the payment `isolated`.
    // RR-11: red until its fix; the fix removes .fails.
    it.fails('a discount line on the isolated bill fails the check and releases the card', async () => {
      const id = await held(1)
      const discounted = editingIsolated((bill) => ({
        ...bill,
        totalMinor: bill.totalMinor - 100,
        lines: [
          ...bill.lines,
          {
            ref: { pos: 'discount-1' },
            item: null,
            name: 'Discount',
            quantity: '1',
            amountMinor: -100,
            enteredBy: 'staff',
            enteredAt: null,
            restroRef: null,
          },
        ],
      }))
      let thrown: unknown = null
      try {
        await drive(id, 40, { connectorFor: discounted })
      } catch (error) {
        thrown = error
      }
      const row = await stored(id)
      expect({ thrown: thrown === null ? null : String(thrown), state: row?.state }).toEqual({
        thrown: null,
        state: 'released',
      })
      expect(row).toMatchObject({ reason: 'check_failed', payment_table_id: null })
      expect(await alertsOf(id)).toEqual(['payment_check_failed:alerts.answer'])
      expect(engine.paymentsOf(providerRef(accountRef), id as never)).toEqual([
        expect.objectContaining({ status: 'released' }),
      ])
    })

    // RR-37 / M5: a guest's tip goes to the POS with the close and into the capture: the card
    // pays lines + tip, the till's card payment is that, and the tip is a row on the closed bill.
    describe('a tip above 0', () => {
      const TIP_ITEM = '2999'
      const tips = (on: boolean) =>
        query(
          `update restro.integrations
              set config = jsonb_set(config, '{service_capabilities,record_tip_on_close}', $2::jsonb)
            where id = $1`,
          [demo.integrationId, JSON.stringify(on)],
        )
      /** The sim connector of a POS that records a tip as a row of its tip article (Q41). */
      const tipping: typeof connectorFor = (integration, simPolicy) => {
        const scenario = loadScenarioFile('demo-bar')
        const connector = createSimPosConnector({
          transport: fetchTransport(`http://${integration.host}`, {
            env: simPolicy.env,
            allowHosts: simPolicy.allowHosts,
          }),
          login: readingLogin(scenario),
          switches: { ...scenario.switches, tipAsLine: true },
          tipItem: TIP_ITEM,
        })
        return new Proxy(connector, {
          get(target, name, receiver) {
            const value = Reflect.get(target, name, receiver)
            if (typeof value !== 'function') return value
            return (...args: unknown[]) => {
              simClock.advance(CALL_MS)
              return value.apply(target, args)
            }
          },
        }) as ServiceConnector
      }

      it.each([1, 50, 333])(
        'a line of 22.00 with a tip of %i: captured lines + tip, the till shows the same',
        async (tipMinor) => {
          const scenario = loadScenarioFile('demo-bar')
          sim.host.engine = buildEngine(
            {
              ...scenario,
              switches: { ...scenario.switches, tipAsLine: true, lateLandingMs: LATE_LANDING_MS },
            },
            { clock: simClock },
          )
          sim.host.engine.waiter.addRound(POS_TABLE, [
            { article: '2001' },
            { article: '2002', quantity: '2' },
          ])
          await read()
          await tips(true)
          let id: string | null
          try {
            id = await tryHeld(1, tipMinor, { connectorFor: tipping })
          } finally {
            await tips(false)
          }
          if (id === null) throw new Error('the tipped Pay was refused')
          const { row } = await drive(id, 40, { connectorFor: tipping })
          const total = 2_200 + tipMinor
          expect(row).toMatchObject({
            state: 'captured',
            amount_minor: String(total),
            captured_minor: String(total),
          })
          expect(engine.paymentsOf(providerRef(accountRef), id as never)).toEqual([
            expect.objectContaining({ status: 'captured', capturedMinor: total }),
          ])
          const closed = sim.host.engine.state.bills.filter(
            (bill) => bill.state !== 'open' && bill.payments.length > 0,
          )
          expect(closed).toHaveLength(1)
          const [bill] = closed
          expect(bill?.payments.map((payment) => payment.amountMinor)).toEqual([total])
          expect(
            bill?.rows.filter((r) => r.article === TIP_ITEM).map((r) => r.amountMinor),
          ).toEqual([tipMinor])
        },
      )
    })
  })

  // Repair-review, RR-14: a line is never in two payments (D112), and `unconfirmed` is not over: a
  // manager is still asked, and "Receipt printed" still captures its hold. So its lines stay
  // greyed while the question stands, even when they read back on the real table.
  describe('an unconfirmed payment’s lines', () => {
    async function unconfirmedWithLinesBack() {
      const id = await held(1)
      fault({ on: 'closeBill', fault: { kind: 'hang' } })
      expect((await drive(id)).row).toMatchObject({ state: 'unconfirmed', reason: 'close_unknown' })
      // A waiter puts the lines back on the guest's table while the manager is still asked.
      const till = sim.host.engine
      const onPaymentTable = till.state.bills.filter(
        (bill) => PAYMENT_TABLES.includes(bill.table) && bill.state === 'open',
      )
      for (const bill of onPaymentTable) {
        till.waiter.moveLines(
          bill.id,
          bill.rows.map((row) => ({ row: row.id })),
          POS_TABLE,
        )
      }
      await read()
      return id
    }

    // RR-14: red until its fix; the fix removes .fails.
    it.fails('stay greyed while a manager is asked: a second Pay on them is refused', async () => {
      const first = await unconfirmedWithLinesBack()
      expect(await stored(first)).toMatchObject({ state: 'unconfirmed' })
      const shown = await lines()
      expect(shown.map((line) => line.amountMinor)).toContain(2_200)
      const index = shown.findIndex((line) => line.amountMinor === 2_200)
      expect(shown[index]?.beingPaid).toBe(true)
      expect(await tryHeld(index)).toBeNull()
    })

    // RR-14: red until its fix; the fix removes .fails.
    it.fails('never leads to two cards captured for one line', async () => {
      const first = await unconfirmedWithLinesBack()
      const shown = await lines()
      const second = await tryHeld(shown.findIndex((line) => line.amountMinor === 2_200))
      if (second !== null) await drive(second)
      expect((await answer(first, 'receipt_printed')).status).toBe('accepted')
      await drive(first)
      const captured = (
        await query<{ id: string }>(
          `select id from restro.payments where id = any($1) and state = 'captured'`,
          [[first, second].filter((id) => id !== null)],
        )
      ).map((row) => row.id)
      expect(captured.length).toBeLessThanOrEqual(1)
    })
  })

  // Repair-review, hot spot 4 (RR-12): only the payment's own bill is ever moved back. The move's
  // answer is lost and it never landed; a waiter parks a bill of their own on the payment table.
  // That bill is not the payment's: it is not read as the move landing, and never lands on the
  // guest's table.
  // Repair-review, RR-18 (D125: lost access; D127: nobody is left guessing): the provider will not
  // show the hold any more (the venue's access is gone) while the payment is past `held`. The job
  // can only try again; the guest's lines stand moved off their table.
  // RR-18: red until its fix; the fix removes .fails.
  it.fails('a hold the provider stops showing, past held: someone is told, the lines do not just wait', async () => {
    const id = await held(1)
    const lost = new Proxy(provider, {
      get(target, name) {
        const value = Reflect.get(target, name, target)
        if (name === 'readPayment') {
          return async () => ({
            complete: false as const,
            reason: 'access to the account was lost',
          })
        }
        return typeof value === 'function' ? value.bind(target) : value
      },
    })
    const overrides = { providers: new Map([[SIM_PAY_KIND, lost]]) }
    for (let pass_ = 0; pass_ < 6; pass_ += 1) {
      try {
        await preparePayment(env(), target(id), deps(overrides))
      } catch (error) {
        if (!(error instanceof PaymentStepRetry)) throw error
      }
      await pass(id, 5 * 60_000)
      await recoverPayments({ pool, log, now: () => clock, queue }, deps(overrides))
    }
    const row = await stored(id)
    // Half an hour on, with the guest's lines on the payment table.
    expect(row?.state).toBe('isolated')
    expect(rowsOn(POS_TABLE)).toEqual(['2001'])
    expect(await alertsOf(id)).not.toEqual([])
  })

  // RR-12: red until its fix; the fix removes .fails.
  it.fails('a move that never landed, a waiter’s bill on the payment table: never moved to the guest', async () => {
    const id = await held(1)
    fault({ on: 'moveRows', fault: { kind: 'hang' } })
    try {
      await preparePayment(env(), target(id), deps())
    } catch (error) {
      if (!(error instanceof PaymentStepRetry)) throw error
    }
    expect(await steps(id)).toContain('isolateLines:attempting')
    expect(rowsOn(POS_TABLE)).toEqual(['2001', '2002'])
    for (const table of PAYMENT_TABLES) {
      sim.host.engine.waiter.addRound(table, [{ article: '2003' }])
    }
    const { row } = await drive(id)
    // The waiter's round stays where the waiter put it; the guest's table has only its own lines.
    expect(rowsOn(POS_TABLE).filter((article) => article === '2003')).toEqual([])
    expect(PAYMENT_TABLES.flatMap((table) => rowsOn(table))).toEqual(['2003', '2003'])
    expect(calls('closeBill')).toBe(0)
    expect(row?.state).toBe('released')
    expect(engine.paymentsOf(providerRef(accountRef), id as never)).toEqual([
      expect.objectContaining({ status: 'released' }),
    ])
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
      /** A late write lands inside the read-back window, or after it (C52). */
      lateLanding: fc.constantFrom(LATE_LANDING_MS, PAST_WINDOW_MS),
      /** How long after the managers' answers the worker's next runs come. */
      lag: fc.constantFrom(0, 30_000),
    })
    /** A refund the venue makes in its dashboard. */
    const REFUND_MINOR = 500
    const DAY_MS = 24 * 60 * 60 * 1000
    /** Where a waiter moves a line away to. */
    const OTHER_TABLE = '30002'

    // 25 nights on the real database take about 95 s alone; with the whole suite running, the
    // file's 120 s is a false failure.
    it('captures only after a close, never releases after one, shares no line and no table, takes what the till shows', async () => {
      await fc.assert(
        fc.asyncProperty(nights, async (night) => {
          await reset(night.lateLanding)
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
          // Two answers at most: the second when the items are not back on the table.
          for (let round = 0; round < 4; round += 1) {
            for (const id of ids) await drive(id)
            if (round === 0) await played.rest()
            await played.settled()
            if (round === 3) break
            for (const id of ids) await answerAsTheTillShows(id, played, night.tapsAgain)
            if (night.lag > 0) await passAll(ids, night.lag)
          }
          await played.end()
          await invariants(ids, played)
        }),
        {
          numRuns: 25,
          examples: [
            // The provider cancels the hold while a late close waits for its answer: the payment
            // is released as expired (Restro sends no release) and the owners are told (CI seed
            // -1494489421).
            [
              {
                picks: [0, null],
                pos: [{ on: 'closeBill', fault: { kind: 'landsLate' } }],
                provider: null,
                slip: false,
                order: [0],
                happenings: [
                  {
                    kind: 'provider',
                    at: { before: 'undoIsolate', nth: 1 },
                    payment: 0,
                    event: 'cancelled',
                    notice: 'now',
                  },
                ],
                tapsAgain: false,
                lateLanding: 20_000,
                lag: 0,
              },
            ],
            // A close that lands after the read-back window, after a manager answered "No receipt"
            // too early and before the worker puts the lines back.
            [
              {
                picks: [1, null],
                pos: [{ on: 'closeBill', fault: { kind: 'landsLate' } }],
                provider: null,
                slip: false,
                order: [0],
                happenings: [],
                tapsAgain: true,
                lateLanding: PAST_WINDOW_MS,
                lag: 30_000,
              },
            ],
            // Lines the POS won't move back after "No receipt": asked again, the manager sees the
            // items missing and answers "No receipt" again; the lines are stranded for staff.
            [
              {
                picks: [1, null],
                pos: [
                  { on: 'closeBill', fault: { kind: 'hang' } },
                  {
                    on: 'moveRows',
                    from: 2,
                    times: 100,
                    fault: { kind: 'refuse', code: 'bill_locked' },
                  },
                ],
                provider: null,
                slip: false,
                order: [0],
                happenings: [],
                tapsAgain: true,
                lateLanding: LATE_LANDING_MS,
                lag: 0,
              },
            ],
            // The same, with a waiter's identical round on the real table before the close: the
            // twin line is no proof that the payment's line is back.
            [
              {
                picks: [0, null],
                pos: [{ on: 'closeBill', fault: { kind: 'landsLate' } }],
                provider: null,
                slip: false,
                order: [0],
                happenings: [
                  {
                    kind: 'waiter',
                    at: { before: 'payAndClose', nth: 1 },
                    where: 'real',
                    act: 'add',
                    row: 0,
                  },
                ],
                tapsAgain: false,
                lateLanding: PAST_WINDOW_MS,
                lag: 30_000,
              },
            ],
            // "Receipt printed", then a capture whose server error the provider keeps under its key
            // while every hold runs out: the capture failed, never tried again forever (CI seed
            // 1085069335).
            [
              {
                picks: [1, 0],
                pos: [{ on: 'closeBill', fault: { kind: 'landsThenHangs' } }],
                provider: ['capture', { kind: 'server_error' }],
                slip: true,
                order: [0],
                happenings: [
                  {
                    kind: 'provider',
                    at: { before: 'undoIsolate', nth: 2 },
                    payment: 0,
                    event: 'expired',
                    notice: 'now',
                  },
                ],
                tapsAgain: false,
                lateLanding: 20_000,
                lag: 0,
              },
            ],
            // The hold runs out at the provider right before the close, and the capture gets a
            // server error: the payment must still settle, captured or failed with the owners told,
            // never stay `closed` (CI seed -950485348, replayed by the repair-review, RR-4).
            [
              {
                picks: [0, null],
                pos: [],
                provider: ['capture', { kind: 'server_error' }],
                slip: false,
                order: [0],
                happenings: [
                  {
                    kind: 'provider',
                    at: { before: 'payAndClose', nth: 1 },
                    payment: 0,
                    event: 'expired',
                    notice: 'now',
                  },
                ],
                tapsAgain: false,
                lateLanding: 20_000,
                lag: 0,
              },
            ],
          ],
        },
      )
    }, 300_000)

    /** Time passes for every payment's recorded steps and on the simulator. */
    async function passAll(ids: readonly string[], ms: number) {
      simClock.advance(ms)
      await query(
        `update restro.payment_steps set at = at - make_interval(secs => $2) where payment_id = any($1)`,
        [ids, ms / 1_000],
      )
    }

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
        // Fixed order (F6): the notice jobs started so far finish before the call goes.
        return FIXED_ORDER ? jobs : undefined
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
     * otherwise; again when the items were not back on the table after a "No receipt", naming that
     * question. Tapping again changes nothing; another manager's other answer is refused. Late taps
     * on the first question once the second is asked (a second manager, a retry, an old push), and
     * an early one on the second, change nothing.
     */
    async function answerAsTheTillShows(id: string, played: Played, tapsAgain: boolean) {
      const row = await stored(id)
      if (row?.state !== 'unconfirmed') return
      if (!['close_unknown', 'close_refused', 'lines_not_back'].includes(row.reason ?? '')) return
      const answering = row.reason === 'lines_not_back' ? 'lines_not_back' : 'close'
      const stale = async () => {
        if (answering === 'lines_not_back') {
          expect(await answer(id, 'no_receipt', 'close')).toMatchObject({
            status: 'accepted',
            details: { changed: false },
          })
          expect(await answer(id, 'receipt_printed', 'close')).toMatchObject({
            status: 'refused',
            code: 'payment_answered',
          })
        } else {
          expect(await answer(id, 'no_receipt', 'lines_not_back')).toMatchObject({
            status: 'refused',
            code: 'payment_not_asked',
          })
        }
      }
      await stale()
      expect(await stored(id)).toMatchObject({ state: 'unconfirmed', reason: row.reason })
      const value = played.till(id).closed ? 'receipt_printed' : 'no_receipt'
      expect(await answer(id, value, answering)).toMatchObject({
        status: 'accepted',
        details: { changed: true },
      })
      if (!tapsAgain) return
      expect(await answer(id, value, answering)).toMatchObject({
        status: 'accepted',
        details: { changed: false },
      })
      const other = value === 'receipt_printed' ? 'no_receipt' : 'receipt_printed'
      expect(await answer(id, other, answering)).toMatchObject({
        status: 'refused',
        code: 'payment_answered',
      })
      if (answering === 'lines_not_back') await stale()
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
      const answers = await query<{
        payment_id: string
        from_state: string
        to_state: string
        answering: string | null
      }>(
        `select payment_id, from_state, to_state, details->>'answering' as answering
           from restro.log_entries
          where kind = 'payment.answered' and payment_id = any($1) order by seq`,
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
        // The manager's last answer: a second one comes when the items were not back.
        const answeredAll = answers.filter((entry) => entry.payment_id === id)
        const answered = answeredAll.at(-1)?.to_state ?? null
        // A second "No receipt" counts only as an answer that named the second question.
        const againNoReceipt = answeredAll.some(
          (entry) =>
            entry.from_state === 'lines_not_back' &&
            entry.to_state === 'no_receipt' &&
            entry.answering === 'lines_not_back',
        )
        const closeAttempt = at('payAndClose', 'attempting')
        const done = at('payAndClose', 'done')
        const closeProof = done >= 0 ? done : at('payAndClose', 'refused', 'already_done')
        const proven = closeProof >= 0 || answered === 'receipt_printed'
        const capture = at('capture', 'attempting')
        const [provider] = engine.paymentsOf(providerRef(accountRef), id as never)
        // The one release after a close Restro did not send: the provider dropped the hold itself
        // while the close waited for an answer, and the owners are told (#112).
        const expired = row?.state === 'released' && row.reason === 'expired'
        if (expired && closeAttempt >= 0) {
          expect(played.dropped.has(id)).toBe(true)
          expect(await alertsOf(id)).toContain('payment_hold_expired:money.follow_up')
        }
        // 1. A capture only after proof of a close: the POS's, or a manager's "Receipt printed".
        if (capture >= 0) {
          expect(proven).toBe(true)
          if (answered === null) expect(closeProof).toBeLessThan(capture)
        }
        if (provider?.status === 'captured') expect(proven).toBe(true)
        // 2. No release once a close was attempted, unless a manager answered "No receipt".
        if (closeAttempt >= 0 && answered !== 'no_receipt') {
          expect(own.slice(closeAttempt).some((step) => step.step === 'release')).toBe(false)
          if (!expired) expect(row?.state).not.toBe('released')
          if (!played.dropped.has(id)) expect(provider?.status).not.toBe('released')
        }
        const till = played.till(id)
        // 7. A hold is never released while the till shows Restro's card payment on a closed bill,
        // unless a manager answered "No receipt" a second time, with the items missing.
        if (till.closed && provider?.status === 'released' && !played.dropped.has(id)) {
          expect(againNoReceipt).toBe(true)
        }
        // 5. The money matches the till: a capture is the card payment Restro's close put on the
        // bill, and a bill Restro closed is captured, or the owners are told it was not.
        if (provider?.status === 'captured') {
          expect(till.closed).toBe(true)
          expect(provider.capturedMinor).toBe(till.cardMinor)
        }
        if (till.closed && !againNoReceipt && !expired) {
          expect(['captured', 'capture_failed']).toContain(row?.state)
        }
        // After a second "No receipt" the hold was released with the items missing: staff are told
        // the lines are stranded.
        if (againNoReceipt) {
          expect(row?.state).toBe('stranded')
          expect(await alertsOf(id)).toContain('payment_stranded:alerts.answer')
        }
        if (row?.state === 'capture_failed')
          expect(await alertsOf(id)).toContain('payment_capture_failed:money.follow_up')
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
