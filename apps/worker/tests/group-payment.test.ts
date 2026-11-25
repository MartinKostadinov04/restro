// Sharing a bill by amount (#543, D160 §3, model (a)) on Postgres through the worker's real code,
// against a real simulator server over HTTP that closes one bill with several card payments, and
// the simulated card provider. Guests share table 1's €100 bill: each guest's card is a hold of its
// own. Holds of 40/30/15/15 close the bill once, with four card payments and one receipt, and each
// hold is captured once. A part above what is left, below €0.50, or leaving a rest below €0.50 is
// refused. Ten minutes after the first hold, staff's "Cancel sharing", the last hold withdrawn and
// a shared line voided at the POS each let every hold go: nothing is charged. The races each end
// one way. A capture refused three times raises the owners' alert with that hold's amount. Without
// the POS's several card payments on one close, sharing is not offered. Only the simulator is ever
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
  forgetGuestCodes,
  GUEST_LIMITS,
  type GuestLimit,
  GuestLimiter,
  type GuestLimitName,
  guestAct,
  guestShare,
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
import type { serviceConnectorFor } from '../src/service-connectors'
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

const KEY = 'group-payment-test-key-'.padEnd(48, 'x')
/** Demo Bar's table 1 on the simulator, of the main hall's bar. */
const POS_TABLE = '30001'
/** The main hall's payment tables. */
const PAYMENT_TABLES = ['39001', 'pay main 2']
/** A till that closes one bill with several card payments (`closeWithSeveralPayments`). */
const SEVERAL: Partial<SimSwitches> = { severalPaymentsPerClose: true }
const CALL_MS = 500
const TIMINGS = { ...SERVICE_TIMINGS, readTimeoutMs: 2_000, writeTimeoutMs: TEST_WRITE_TIMEOUT_MS }
const BETWEEN_RUNS_MS = 5_000
const SETTLED = ['captured', 'released', 'stranded', 'capture_failed']

const LOOSE = new GuestLimiter(
  Object.fromEntries(
    Object.entries(GUEST_LIMITS).map(([name, limit]) => [name, { ...limit, max: 10_000 }]),
  ) as Record<GuestLimitName, GuestLimit>,
)

type Part = number | 'rest'

describe.skipIf(!hasDatabase)('sharing a bill by amount', () => {
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
  let tableId: `tb_${string}`
  let code: string
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
  const env = (now: Date = clock) => ({
    pool,
    log,
    now: () => now,
    queue,
    jobId: `payment-${randomUUID()}`,
  })
  // The till's switches beyond Demo Bar's (`reset`): the connector declares from the same ones.
  let switched: Partial<SimSwitches> = SEVERAL
  const connectorFor: typeof serviceConnectorFor = (integration, simPolicy) => {
    const scenario = loadScenarioFile('demo-bar')
    const connector = createSimPosConnector({
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
    pool = createPool(db.appUrl, { applicationName: 'restro-worker-share-tests', max: 6 })
    await provisionTenant(pool, { tenantId, name: 'Sharing club' })
    await query(
      `insert into restro.auth_organization (id, name, slug) values ($1, 'Sharing club', $2)`,
      [tenantId, `sharing-${newId('tn').slice(3, 11)}`],
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
      slug: testSlug('share'),
    })
    await upsertBarsyVenues(pool, tenantId, integrationId, [{ bid: 1, name: 'Demo Bar' }])
    expect((await mapBarsyVenue(pool, tenantId, integrationId, 1, venue.id)).ok).toBe(true)
    demo = { venueId: venue.id as VenueId, integrationId: integrationId as IntegrationId }
    await setFloorSource(pool, tenantId, {
      venueId: demo.venueId,
      source: { halls: null, bars: null, paymentTables: ['PM1', 'PM2'] },
    })
    sim.host.engine = buildEngine(
      (() => {
        const scenario = loadScenarioFile('demo-bar')
        return { ...scenario, switches: { ...scenario.switches, ...SEVERAL } }
      })(),
      { clock: simClock },
    )
    await readFloor()
    const [table] = await query<{ id: `tb_${string}` }>(
      `select id from restro.tables where venue_id = $1 and number = '1'`,
      [demo.venueId],
    )
    if (table === undefined) throw new Error('no table 1')
    tableId = table.id
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
  })

  afterAll(async () => {
    await sim?.close()
    await pool?.end()
    await db?.drop()
  })

  beforeEach(() => reset())

  /**
   * A fresh till whose table 1 has a €100 bill (ten of article 2005, in `rows` rows), nothing in
   * flight, the table read, and a fresh sitting. Earlier tests' payments are over.
   */
  async function reset(switches: Partial<SimSwitches> = SEVERAL, rows = 1) {
    switched = switches
    clock = new Date()
    forgetGuestCodes()
    LOOSE.clear()
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
    await query('update restro.payment_accounts set paying_paused_at = null where venue_id = $1', [
      demo.venueId,
    ])
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
    const quantity = String(10 / rows)
    for (let row = 0; row < rows; row += 1) {
      sim.host.engine.waiter.addRound(POS_TABLE, [{ article: '2005', quantity }])
    }
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
        budgets: simBudgets(simClock),
        readingBudgets: new ReadingBudgets(),
      },
    )
    expect(outcome).toMatchObject({ kind: 'recorded', complete: true })
  }

  /** The table's bill lines as a phone sees them. */
  async function lines() {
    const answer = await guestState(pool, { code, view: 'bill', limiter: LOOSE })
    if (!answer.ok || answer.answer.unchanged) throw new Error('no state')
    return answer.answer.bill?.parts.flatMap((part) => part.lines) ?? []
  }

  const guest = (command: Record<string, unknown> & { type: string }, handle?: string) =>
    guestAct(pool, {
      code,
      command: { actionId: randomUUID(), ...command },
      ageMs: 10,
      view: 'bill',
      phone: randomUUID(),
      limiter: LOOSE,
      check: { humanToken: 'XXXX.DUMMY.TOKEN.XXXX' },
      humanCheck: async () => 'passed',
      ...(handle === undefined ? {} : { handle }),
    })

  /** A phone starts sharing "The whole bill". */
  async function startShare() {
    const shown = await lines()
    return guest({
      type: 'share.start',
      pick: { kind: 'whole' },
      seen: shown.map((l) => ({ lineId: l.id, quantity: l.quantity, amountMinor: l.amountMinor })),
    })
  }

  /** A share of the whole bill, priced: gathering. */
  async function shared(): Promise<string> {
    const answer = await startShare()
    if (!answer.ok || answer.result.status !== 'accepted') {
      throw new Error(`sharing was refused: ${JSON.stringify(answer)}`)
    }
    // The share is the table's: no phone gets its handle.
    expect(answer.handle).toBeNull()
    const id = answer.result.subjectId as string
    expect(await preparePayment(env(), target(id), deps())).toEqual({
      kind: 'at',
      state: 'awaiting_guest',
    })
    return id
  }

  /** A phone asks for its part of the share. */
  const askHold = (id: string, part: Part) =>
    guest({
      type: 'share.hold',
      paymentId: id,
      part: part === 'rest' ? { kind: 'rest' } : { kind: 'amount', minor: part },
      tipMinor: null,
      tipPercent: null,
    })

  /** A hold made at the provider and the guest's card entered: `paid`, not yet read. */
  async function carded(id: string, part: Part) {
    const answer = await askHold(id, part)
    if (!answer.ok || answer.result.status !== 'accepted' || answer.handle === null) {
      throw new Error(`the hold was refused: ${JSON.stringify(answer)}`)
    }
    const [hold] = await query<{ id: string }>(
      'select id from restro.payment_holds where action_id = $1',
      [answer.result.actionId],
    )
    if (hold === undefined) throw new Error('no hold')
    await preparePayment(env(), target(id), deps())
    const row = (await holdsOf(id)).find((h) => h.id === hold.id)
    expect(row).toMatchObject({ state: 'awaiting_guest' })
    engine.guest.pay(providerRef(row?.provider_payment_ref ?? ''))
    return { holdId: hold.id, handle: answer.handle }
  }

  /** A hold held: the guest's card entered and read back. */
  async function holding(id: string, part: Part) {
    const made = await carded(id, part)
    await checkPayment(env(), target(id), deps())
    expect((await holdsOf(id)).find((h) => h.id === made.holdId)).toMatchObject({ state: 'held' })
    return made
  }

  async function drive(id: string, runs = 60, before: () => void = () => {}) {
    for (let run = 0; run < runs; run += 1) {
      if (run > 0) await pass(id, BETWEEN_RUNS_MS)
      before()
      try {
        await preparePayment(env(), target(id), deps())
      } catch (error) {
        if (!(error instanceof PaymentStepRetry)) throw error
      }
      const row = await stored(id)
      if (row === undefined) throw new Error('the payment is gone')
      if (SETTLED.includes(row.state) && row.payment_table_id === null) break
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
  /** The gathering's ten minutes are over (the database's clock decides). */
  const overdue = (id: string) =>
    query(
      `update restro.payments set gathering_ends_at = now() - interval '1 second' where id = $1`,
      [id],
    )
  const calls = (method: string) =>
    sim.host.engine.calls().filter((call) => call.method === method).length
  const stored = async (id: string) =>
    (
      await query<{
        state: string
        reason: string | null
        amount_minor: string | null
        captured_minor: string | null
        shared_minor: string | null
        payment_table_id: string | null
        settled: boolean
      }>(
        `select state, reason, amount_minor, captured_minor, shared_minor, payment_table_id,
                settled_at is not null as settled
           from restro.payments where id = $1`,
        [id],
      )
    )[0]
  const holdsOf = (id: string) =>
    query<{
      id: string
      state: string
      reason: string | null
      amount_minor: string
      captured_minor: string | null
      provider_payment_ref: string | null
    }>(
      `select id, state, reason, amount_minor, captured_minor, provider_payment_ref
         from restro.payment_holds where payment_id = $1 order by created_at, id`,
      [id],
    )
  const steps = async (id: string) =>
    (
      await query<{ step: string; outcome: string }>(
        `select step, outcome from restro.payment_steps where payment_id = $1 order by seq`,
        [id],
      )
    ).map((row) => `${row.step}:${row.outcome}`)
  /** The open rows on a POS table, by article and quantity. */
  const rowsOn = (posTable: string) =>
    sim.host.engine.state.bills
      .filter((bill) => bill.table === posTable && bill.state === 'open')
      .flatMap((bill) => bill.rows.map((row) => `${row.article}x${row.quantity}`))
      .sort()
  const atProvider = (id: string) => engine.paymentsOf(providerRef(accountRef), id as never)
  /** What a phone of the table sees, with no hold of its own. */
  async function seen() {
    const answer = await guestShare(pool, { code, limiter: LOOSE })
    if (!answer.ok) throw new Error(`no share: ${JSON.stringify(answer)}`)
    return answer.answer
  }
  /** Everything was let go: every hold released at the provider, the bill as it was. */
  async function nothingCharged(id: string, reason: string, before: readonly string[]) {
    expect(await stored(id)).toMatchObject({ state: 'released', reason, settled: true })
    for (const hold of await holdsOf(id)) expect(hold.state).toBe('released')
    for (const made of atProvider(id)) expect(made.status).toBe('released')
    expect(calls('closeBill')).toBe(0)
    expect(rowsOn(POS_TABLE)).toEqual(before)
    expect((await lines()).every((line) => !line.beingPaid)).toBe(true)
    expect(await seen()).toMatchObject({ state: 'released', reason })
  }

  it('closes €100 once with holds of 40, 30, 15 and the rest: four card payments, one receipt', async () => {
    const id = await shared()
    expect(await stored(id)).toMatchObject({ state: 'awaiting_guest', shared_minor: '10000' })
    // Every line of the table is being paid while the share gathers.
    expect((await lines()).every((line) => line.beingPaid)).toBe(true)
    const holds = []
    for (const part of [4_000, 3_000, 1_500] as const) holds.push(await holding(id, part))
    // Every phone of the table sees what is held and what is left.
    expect(await seen()).toMatchObject({
      state: 'awaiting_guest',
      sharedMinor: 10_000,
      heldMinor: 8_500,
      leftMinor: 1_500,
      holds: 3,
      mine: null,
    })
    holds.push(await holding(id, 'rest'))
    // Covered: the payment is held for the shared amount, and today's route takes it on.
    expect(await stored(id)).toMatchObject({ state: 'held', amount_minor: '10000' })

    const row = await drive(id)
    expect(row).toMatchObject({
      state: 'captured',
      settled: true,
      payment_table_id: null,
      captured_minor: '10000',
    })
    // One close, with one card payment per hold, named by the hold; one receipt.
    expect(calls('closeBill')).toBe(1)
    expect((await steps(id)).filter((step) => step === 'payAndClose:attempting')).toHaveLength(1)
    // (The table's own bill, its lines moved off, is closed empty.)
    const closed = sim.host.engine.state.bills.filter(
      (bill) => bill.state === 'closed' && bill.payments.length > 0,
    )
    expect(closed).toHaveLength(1)
    expect(closed[0]?.receipt?.number).toEqual(expect.any(String))
    expect(closed[0]?.payments.map((p) => [p.amountMinor, p.ref])).toEqual(
      holds.map((hold, index) => [[4_000, 3_000, 1_500, 1_500][index], hold.holdId]),
    )
    // Each hold captured once, for its own amount.
    expect((await holdsOf(id)).map((h) => [h.state, h.captured_minor])).toEqual([
      ['captured', '4000'],
      ['captured', '3000'],
      ['captured', '1500'],
      ['captured', '1500'],
    ])
    expect(
      atProvider(id)
        .map((made) => [made.status, made.capturedMinor])
        .sort(),
    ).toEqual(
      [
        ['captured', 1_500],
        ['captured', 1_500],
        ['captured', 3_000],
        ['captured', 4_000],
      ].sort(),
    )
    expect((await steps(id)).filter((step) => step === 'capture:done')).toHaveLength(4)
    expect(rowsOn(POS_TABLE)).toEqual([])
    expect(PAYMENT_TABLES.every((table) => rowsOn(table).length === 0)).toBe(true)
  })

  it('refuses a part above €100, one below €0.50, and one leaving a €0.30 rest', async () => {
    const id = await shared()
    for (const [part, problem] of [
      [10_001, 'above_share'],
      [49, 'below_minimum'],
      [9_970, 'rest_below_minimum'],
    ] as const) {
      expect(await askHold(id, part)).toMatchObject({
        result: { status: 'rejected', code: problem },
      })
    }
    expect(await holdsOf(id)).toEqual([])
    // Once €40 is held, a part above the €60 left is refused too.
    await holding(id, 4_000)
    expect(await askHold(id, 6_001)).toMatchObject({
      result: { status: 'rejected', code: 'above_share' },
    })
  })

  it('lets every hold go ten minutes after the first, with €60 held: nothing charged', async () => {
    const before = rowsOn(POS_TABLE)
    const id = await shared()
    await holding(id, 4_000)
    await holding(id, 2_000)
    await overdue(id)
    await checkPayment(env(), target(id), deps())
    await drive(id)
    await nothingCharged(id, 'expired', before)
  })

  it("lets every hold go on staff's Cancel sharing", async () => {
    const before = rowsOn(POS_TABLE)
    const id = await shared()
    await holding(id, 6_000)
    const { result } = await applyService(
      pool,
      { type: 'share.cancel', tableId, paymentId: id } as ServiceCommand,
      staff(),
    )
    expect(result.status).toBe('accepted')
    await drive(id)
    await nothingCharged(id, 'cancelled', before)
  })

  it('lets everything go when the last hold is withdrawn', async () => {
    const before = rowsOn(POS_TABLE)
    const id = await shared()
    const first = await holding(id, 6_000)
    const second = await holding(id, 1_000)
    expect(await guest({ type: 'share.withdraw' }, second.handle)).toMatchObject({
      result: { status: 'accepted' },
    })
    await preparePayment(env(), target(id), deps())
    // One hold still stands: the share gathers on.
    expect(await stored(id)).toMatchObject({ state: 'awaiting_guest' })
    expect((await holdsOf(id)).map((h) => h.state)).toEqual(['held', 'released'])
    expect(await guest({ type: 'share.withdraw' }, first.handle)).toMatchObject({
      result: { status: 'accepted' },
    })
    await drive(id)
    await nothingCharged(id, 'withdrawn', before)
  })

  it('lets everything go when a shared line is voided at the POS: "The bill changed"', async () => {
    await reset(SEVERAL, 2)
    const id = await shared()
    await holding(id, 4_000)
    const bill = sim.host.engine.state.bills.find(
      (b) => b.table === POS_TABLE && b.state === 'open',
    )
    sim.host.engine.waiter.voidLine(bill?.id as string, bill?.rows[0]?.id as string)
    const after = rowsOn(POS_TABLE)
    await read()
    await drive(id)
    await nothingCharged(id, 'bill_changed', after)
  })

  describe('races, each with one outcome', () => {
    it('two holds covering at once: the share is covered once, closed once', async () => {
      const id = await shared()
      await carded(id, 5_000)
      await carded(id, 'rest')
      await Promise.all([
        checkPayment(env(), target(id), deps()),
        checkPayment(env(), target(id), deps()),
      ])
      expect(await stored(id)).toMatchObject({ state: 'held', amount_minor: '10000' })
      expect(await drive(id)).toMatchObject({ state: 'captured', captured_minor: '10000' })
      expect(calls('closeBill')).toBe(1)
      expect((await holdsOf(id)).map((h) => h.state)).toEqual(['captured', 'captured'])
    })

    it('two phones taking the rest at once: one hold, the other refused', async () => {
      const id = await shared()
      await holding(id, 4_000)
      const answers = await Promise.all([askHold(id, 'rest'), askHold(id, 'rest')])
      const accepted = answers.filter((a) => a.ok && a.result.status === 'accepted')
      expect(accepted).toHaveLength(1)
      expect(answers.filter((a) => a.ok && a.result.status === 'rejected')).toHaveLength(1)
      expect((await holdsOf(id)).length).toBe(2)
    })

    it('the cover against the expiry: covered and closed, or everything let go', async () => {
      const before = rowsOn(POS_TABLE)
      const id = await shared()
      await holding(id, 5_000)
      await carded(id, 'rest')
      await overdue(id)
      // One worker reads the last card (its clock not yet at the end); another expires the share.
      const behind = new Date(Date.now() - 60 * 60_000)
      await Promise.all([
        checkPayment(env(behind), target(id), deps()),
        preparePayment(env(new Date(Date.now() + 60_000)), target(id), deps()).catch(() => null),
      ])
      const row = await drive(id)
      await oneOutcome(id, row?.state, before, 'expired')
    })

    it('a withdrawal against the cover: withdrawn, or covered and closed', async () => {
      const before = rowsOn(POS_TABLE)
      const id = await shared()
      const first = await holding(id, 5_000)
      await carded(id, 'rest')
      const [withdrawn] = await Promise.all([
        guest({ type: 'share.withdraw' }, first.handle),
        checkPayment(env(), target(id), deps()),
      ])
      if (!withdrawn.ok) throw new Error('no answer')
      const row = await drive(id)
      if (withdrawn.result.status === 'accepted') {
        // The other hold still stands: the share gathers on, nothing closed.
        expect(row?.state).toBe('awaiting_guest')
        expect(calls('closeBill')).toBe(0)
        expect((await holdsOf(id))[0]?.state).toBe('released')
      } else {
        expect(withdrawn.result.code).toBe('too_late')
        await oneOutcome(id, row?.state, before, 'withdrawn')
      }
    })

    it("staff's cancel against the cover: let go, or covered and closed", async () => {
      const before = rowsOn(POS_TABLE)
      const id = await shared()
      await holding(id, 5_000)
      await carded(id, 'rest')
      const [cancel] = await Promise.all([
        applyService(
          pool,
          { type: 'share.cancel', tableId, paymentId: id } as ServiceCommand,
          staff(),
        ),
        checkPayment(env(), target(id), deps()),
      ])
      const row = await drive(id)
      await oneOutcome(id, row?.state, before, 'cancelled')
      expect(cancel.result.status === 'accepted').toBe(row?.state === 'released')
    })

    /** Either the share closed once with every hold captured, or nothing was charged. */
    async function oneOutcome(
      id: string,
      state: string | undefined,
      before: readonly string[],
      reason: string,
    ) {
      if (state === 'captured') {
        expect(calls('closeBill')).toBe(1)
        expect((await holdsOf(id)).every((h) => h.state === 'captured')).toBe(true)
      } else {
        await nothingCharged(id, reason, before)
      }
    }
  })

  it('releases a hold let go before the cover, and the share is done only once it is', async () => {
    const id = await shared()
    await holding(id, 5_000)
    const late = await holding(id, 2_000)
    // The guest takes their part back; the provider refuses the release and still holds the card.
    expect(await guest({ type: 'share.withdraw' }, late.handle)).toMatchObject({
      result: { status: 'accepted' },
    })
    engine.fault('release', { kind: 'refuse', code: 'not_held' })
    // Two other guests take the €50 left between them, and cover the share.
    await holding(id, 2_000)
    await holding(id, 'rest')
    expect(await stored(id)).toMatchObject({ state: 'held' })
    expect((await holdsOf(id)).map((h) => h.state)).toEqual(['held', 'releasing', 'held', 'held'])

    // The bill closes and the three held holds are captured; the share waits for the fourth.
    const row = await drive(id, 12)
    expect(row?.state).toBe('closed')
    expect(calls('closeBill')).toBe(1)
    expect((await holdsOf(id)).map((h) => h.state)).toEqual([
      'captured',
      'releasing',
      'captured',
      'captured',
    ])
    // The provider drops the card it held (its hold ran out): it is released, and the share done.
    payClock.advance(8 * 24 * 60 * 60_000)
    expect(await drive(id)).toMatchObject({ state: 'captured', captured_minor: '10000' })
    expect((await holdsOf(id)).map((h) => h.state)).toEqual([
      'captured',
      'released',
      'captured',
      'captured',
    ])
  })

  it('never settles a hold whose call may have reached the provider, even with paying paused', async () => {
    const id = await shared()
    const answer = await askHold(id, 4_000)
    if (!answer.ok || answer.result.status !== 'accepted') throw new Error('refused')
    const [hold] = await query<{ id: string }>(
      'select id from restro.payment_holds where action_id = $1',
      [answer.result.actionId],
    )
    // The worker dies right after it recorded the hold's call as attempting.
    const crash = {
      ...env(),
      onStep: async ({ step, outcome }: { step: string; outcome: string }) => {
        if (step === 'createHold' && outcome === 'attempting') throw new Error('killed')
      },
    }
    await expect(preparePayment(crash, target(id), deps())).rejects.toThrow('killed')
    // Paying is paused at the venue meanwhile.
    await query('update restro.payment_accounts set paying_paused_at = now() where venue_id = $1', [
      demo.venueId,
    ])
    // The engine refuses to settle it as never made.
    const settle = await applyService(
      pool,
      { type: 'share.hold_settle', paymentId: id, holdId: hold?.id, reason: 'paying_paused' },
      {
        tenantId,
        venueId: demo.venueId,
        origin: 'worker',
        actor: { kind: 'system' },
        jobId: `settle-${randomUUID()}`,
      },
    )
    expect(settle.result).toMatchObject({ status: 'refused', code: 'hold_not_releasing' })
    // The worker lets it go through the provider: it looks for what the call made, then settles.
    await preparePayment(env(), target(id), deps())
    await preparePayment(env(), target(id), deps())
    expect(await holdsOf(id)).toEqual([
      expect.objectContaining({ id: hold?.id, state: 'released', reason: 'hold_refused' }),
    ])
    expect(await steps(id)).toContain('findByPaymentId:done')
  })

  it("tries a refused capture again, then alerts the owners with that hold's amount", async () => {
    const id = await shared()
    const first = await holding(id, 6_000)
    await holding(id, 'rest')
    // The provider refuses every capture of the first hold.
    const row = await drive(id, 60, () => {
      engine.fault('capture', { kind: 'refuse' })
    })
    expect((await steps(id)).filter((step) => step === 'capture:refused')).toHaveLength(3)
    expect(row).toMatchObject({ state: 'capture_failed', settled: true })
    expect(calls('closeBill')).toBe(1)
    const holds = await holdsOf(id)
    expect(holds.map((h) => h.state)).toEqual(['capture_failed', 'captured'])
    const alerts = await query<{ subject_id: string; details: Record<string, unknown> }>(
      `select subject_id, details from restro.alerts where kind = 'payment_capture_failed' and venue_id = $1 and subject_id = $2`,
      [demo.venueId, first.holdId],
    )
    expect(alerts).toHaveLength(1)
    expect(alerts[0]?.details).toMatchObject({ amountMinor: 6_000, holdId: first.holdId })
  })

  it('is not offered where the POS closes a bill with one card payment only', async () => {
    await reset({})
    await readFloor()
    try {
      expect(await startShare()).toMatchObject({
        result: { status: 'rejected', code: 'share_not_offered' },
      })
    } finally {
      await reset()
      await readFloor()
    }
  })
})
