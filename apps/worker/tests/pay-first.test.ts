// Pay-first items (#113) on Postgres through the worker's real code, against a real simulator
// server over HTTP and the simulated card provider. A guest's Send of a pay-first round is held at
// the provider, entered on a free payment table as one round that opens its own bill (the
// `pay-first` scenario: the first items open a bill that names itself, notes reach the ticket),
// checked against what the guest agreed, closed and captured; the payment table is free again
// once it reads empty. Where the POS can't open such a bill (Demo Bar's pilot profile) the Send is
// refused before anything is held. The fault scripts time out the entry and the close, before and
// after they land: once the round may be on the POS nothing is released on its own, so each ends
// captured or unconfirmed for a manager. While a waiter has the payment tables the payment waits
// in the queue, with nothing entered. A POS total above the hold is never charged; one below is
// captured as the POS has it.
import { createHash, randomUUID } from 'node:crypto'

import {
  DEFAULT_ORDERING_SETTINGS,
  hashTableCode,
  type IntegrationId,
  newId,
  type PaymentJob,
  posRef,
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
  type SendMenu,
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
  createSimServer,
  type FaultRule,
  loadScenarioFile,
  ManualClock as SimPosClock,
  type SimServer,
} from '@restro/sim-pos'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { InstanceBudgets, readFloorOf } from '../src/jobs/floor'
import {
  checkPayment,
  type PaymentJobDeps,
  PaymentStepRetry,
  preparePayment,
  withTableNote,
} from '../src/jobs/payments'
import type { JobQueue } from '../src/jobs/types'
import { createLogger } from '../src/logger'
import { SIM_SCENARIO_KEY, serviceConnectorFor } from '../src/service-connectors'
import {
  allowSlowSetup,
  createTestDatabase,
  hasDatabase,
  type TestDatabase,
  testSlug,
  withOwnerClient,
} from './database'

allowSlowSetup()

/** Demo Bar's two payment tables in the main hall, on the simulator. */
const PAYMENT_TABLES = ['39001', 'pay main 2']
/** The article the pay-first item is linked to: an Aperol Spritz at 11.00 on the POS. */
const ARTICLE = '2002'
const POS_PRICE = 1_100
/** How long one connector call takes on the simulator's clock: a read is two calls, the limit 5 a second. */
const CALL_MS = 500
/** Short write and read timeouts, so a hanging call is `unknown` quickly. */
const TIMINGS = { ...SERVICE_TIMINGS, readTimeoutMs: 2_000, writeTimeoutMs: 300 }
/** How much time passes between two runs of a job: its read-back, on both clocks. */
const BETWEEN_RUNS_MS = 5_000
/** The states a run ends in when nobody needs to act. */
const SETTLED = ['captured', 'released', 'stranded', 'capture_failed']

describe.skipIf(!hasDatabase)('pay-first items on the payment route', () => {
  let db: TestDatabase
  let pool: DbPool
  let sim: SimServer
  const simClock = new SimPosClock()
  const payClock = new SimPayClock()
  const engine = new SimPayEngine({ clock: payClock })
  const provider = createSimPayProvider({ env: 'test', engine })
  const tenantId = newId('tn')
  let log: Awaited<ReturnType<typeof createLogger>>
  /** The worker's log lines, as JSON. */
  const logged: string[] = []
  const clock = new Date()
  let demo: { venueId: VenueId; integrationId: IntegrationId }
  let tableId: `tb_${string}`
  let sittingId: string
  let codeHash: string
  let accountRef: string
  let managerId: string
  const gin = newId('nd')
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
  /** The real connector; each call takes a moment on the simulator's clock. */
  const connectorFor: typeof serviceConnectorFor = (integration, simPolicy) => {
    const connector = serviceConnectorFor(integration, simPolicy)
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
    budgets: new InstanceBudgets(),
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

  /** Reads the floor, which records what the connector of the instance's scenario declares. */
  async function readFloor(scenario: string) {
    await query(
      `update restro.integrations set config = config || jsonb_build_object($2::text, $3::text)
        where id = $1`,
      [demo.integrationId, SIM_SCENARIO_KEY, scenario],
    )
    simClock.advance(1100)
    const floor = await readFloorOf(
      { pool, log, now: () => new Date() },
      { tenantId, ...demo },
      { sim: policy, budgets: new InstanceBudgets() },
    )
    expect(floor.kind).toBe('read')
  }

  beforeAll(async () => {
    db = await createTestDatabase()
    pool = createPool(db.appUrl, { applicationName: 'restro-worker-pay-first-tests', max: 4 })
    await provisionTenant(pool, { tenantId, name: 'Pay-first club' })
    await query(
      `insert into restro.auth_organization (id, name, slug) values ($1, 'Pay-first club', $2)`,
      [tenantId, `pay-first-${newId('tn').slice(3, 11)}`],
    )
    log = await createLogger({
      level: 'debug',
      pretty: false,
      destination: { write: (line: string) => logged.push(line) },
    })
    sim = createSimServer({ scenario: 'pay-first', print: () => {}, clock: simClock })
    const host = `127.0.0.1:${await sim.listen(0)}`

    const integrationId = (await createIntegration(pool, tenantId, { kind: 'sim', host })).id
    const venue = await provisionVenue(pool, tenantId, {
      name: 'Demo Bar',
      slug: testSlug('pay-first'),
    })
    await upsertBarsyVenues(pool, tenantId, integrationId, [{ bid: 1, name: 'Demo Bar' }])
    expect((await mapBarsyVenue(pool, tenantId, integrationId, 1, venue.id)).ok).toBe(true)
    demo = { venueId: venue.id as VenueId, integrationId: integrationId as IntegrationId }
    await setFloorSource(pool, tenantId, {
      venueId: demo.venueId,
      source: { halls: null, bars: null, paymentTables: ['PM1', 'PM2'] },
    })
    await readFloor('pay-first')
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
    // The pay-first item, linked to the POS's article (what a menu sync writes).
    await query(`insert into restro.nodes (id, tenant_id, node_type) values ($1, $2, 'item')`, [
      gin,
      tenantId,
    ])
    await query(
      `insert into restro.source_links (tenant_id, integration_id, external_type, external_id, node_id)
       values ($1, $2, 'article', $3, $4)`,
      [tenantId, integrationId, ARTICLE, gin],
    )

    const account = engine.addAccount()
    engine.finishConnecting(account)
    accountRef = account.provider
    await query(
      `insert into restro.payment_accounts
         (tenant_id, venue_id, provider_kind, account_ref, state, checks, connected_at, source, actor, job_id)
       values ($1, $2, $3, $4, 'connected', '{"cardPayments":true,"ticks":{"cardTypeInTill":{"at":"2026-10-27T00:00:00Z","by":"system"},"receiptEmailsOff":{"at":"2026-10-27T00:00:00Z","by":"system"}}}'::jsonb, now(), 'restro', 'system', 'test-seed')`,
      [tenantId, demo.venueId, SIM_PAY_KIND, accountRef],
    )

    managerId = `pay-first-manager-${randomUUID()}`
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

  /** A fresh night: a new till with no bills, nothing in flight, a new sitting on table 1. */
  beforeEach(async () => {
    engine.clearFaults()
    sim.host.engine = buildEngine(loadScenarioFile('pay-first'), { clock: simClock })
    await query(
      `update restro.payments set state = 'released', reason = 'test', form_values = null,
         payment_table_id = null, settled_at = coalesce(settled_at, now())
       where venue_id = $1`,
      [demo.venueId],
    )
    await query(`update restro.locks set holder = null, deadline = null where venue_id = $1`, [
      demo.venueId,
    ])
    await query(
      `update restro.alerts set done_at = now() where venue_id = $1 and done_at is null`,
      [demo.venueId],
    )
    await query(
      'update restro.pauses set lifted_at = now() where venue_id = $1 and lifted_at is null',
      [demo.venueId],
    )
    await query(
      `update restro.sittings set ended_at = now(), end_reason = 'staff_closed'
       where table_id = $1 and ended_at is null`,
      [tableId],
    )
    sittingId = newId('st')
    await query(
      `insert into restro.sittings (id, tenant_id, venue_id, table_id, service_date, opened_how, source, actor, job_id)
       values ($1, $2, $3, $4, $5, 'one', 'staff', 'system', 'test')`,
      [sittingId, tenantId, demo.venueId, tableId, new Date().toISOString().slice(0, 10)],
    )
    const code = `code${randomUUID().replaceAll('-', '')}`
    codeHash = await hashTableCode(code)
    await query('update restro.tables set qr_token = $2, qr_code_hash = $3 where id = $1', [
      tableId,
      code,
      codeHash,
    ])
  })

  const guest = (): ServiceContext => ({
    tenantId,
    venueId: demo.venueId,
    origin: 'guest',
    actor: { kind: 'guest' },
    jobId: `guest-${randomUUID()}`,
    tableCodeHash: codeHash,
    sittingId,
    consentVersion: 'v1',
  })
  /** The published menu as the Send prices it: the gin is paid first. */
  const menuAt = (priceMinor: number): SendMenu => ({
    currency: 'EUR',
    items: new Map([
      [
        gin,
        {
          priceMinor,
          orderable: true,
          soldOut: false,
          name: 'Aperol Spritz',
          options: new Map(),
          paymentMode: 'pay_first',
        },
      ],
    ]),
  })

  /** A guest adds two gins (with `note`) and sends them; the Send's answer. */
  async function send(priceMinor = POS_PRICE, note = '') {
    const added = await applyService(
      pool,
      {
        type: 'order.add',
        tableId,
        actionId: randomUUID(),
        ageMs: 50,
        itemId: gin,
        optionIds: [],
        qty: 2,
        note,
      },
      guest(),
    )
    expect(added.result.status).toBe('accepted')
    const line = { itemId: gin, optionIds: [], qty: 2, note }
    return (
      await applyService(
        pool,
        {
          type: 'order.send',
          tableId,
          actionId: randomUUID(),
          ageMs: 50,
          lines: [],
          payFirst: {
            lines: [line],
            tip: { kind: 'none' },
            handleHash: createHash('sha256').update(randomUUID()).digest('hex'),
          },
        },
        guest(),
        { sendMenu: menuAt(priceMinor) },
      )
    ).result
  }

  /** A pay-first Send, priced, held at the provider; the payment's id. */
  async function held(priceMinor = POS_PRICE, note = ''): Promise<string> {
    const result = await send(priceMinor, note)
    expect(result).toMatchObject({ status: 'accepted' })
    const id = result.status === 'accepted' ? result.details.paymentId : null
    if (typeof id !== 'string') throw new Error('no payment')
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
   * the payment is settled with its table free, or waits for a person (unconfirmed).
   */
  async function drive(id: string, runs = 40) {
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

  /** Time passes for the payment's recorded steps and on the simulator. */
  async function pass(id: string, ms: number) {
    simClock.advance(ms)
    await query(
      `update restro.payment_steps set at = at - make_interval(secs => $2) where payment_id = $1`,
      [id, ms / 1_000],
    )
  }

  const stored = async (id: string) =>
    (
      await query<{
        state: string
        reason: string | null
        amount_minor: string | null
        captured_minor: string | null
        provider_payment_ref: string | null
        payment_table_id: string | null
        sent_order_id: string | null
      }>(
        `select state, reason, amount_minor, captured_minor, provider_payment_ref, payment_table_id,
                sent_order_id
           from restro.payments where id = $1`,
        [id],
      )
    )[0]
  const sentOrderOf = async (id: string) =>
    (
      await query<{ state: string; pos_bill_ref: string | null }>(
        `select s.state, s.pos_bill_ref from restro.sent_orders s
           join restro.payments p on p.sent_order_id = s.id where p.id = $1`,
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
  const alertsOf = async (id: string) =>
    (
      await query<{ kind: string; permission: string | null }>(
        'select kind, permission from restro.alerts where subject_id = $1 and done_at is null',
        [id],
      )
    ).map((row) => `${row.kind}:${row.permission}`)
  /** The guest's order: its live lines' quantities and the payment holding each. */
  const orderLines = async () =>
    (
      await query<{ lines: { qty: number; heldBy: string | null; removedAt: number | null }[] }>(
        'select lines from restro.table_orders where sitting_id = $1',
        [sittingId],
      )
    )[0]?.lines
      .filter((line) => line.removedAt === null)
      .map((line) => [line.qty, line.heldBy]) ?? []
  /** The bills on the payment tables: state, and each row's article, quantity and note. */
  const paymentBills = () =>
    sim.host.engine.state.bills
      .filter((bill) => PAYMENT_TABLES.includes(bill.table))
      .map((bill) => ({
        state: bill.state,
        rows: bill.rows.map((row) => [row.article, row.quantity, row.note]),
      }))
  /** The POS place of the payment's payment table. */
  const paymentPlace = async (id: string) => {
    const [row] = await query<{ place_id: string }>(
      `select pl.place_id from restro.places pl
         join restro.payments p on p.payment_table_id = pl.table_id
        where p.id = $1 and pl.state <> 'deleted'`,
      [id],
    )
    if (row === undefined) throw new Error('the payment holds no payment table')
    return row.place_id
  }
  const holdOf = (id: string) => engine.paymentsOf(providerRef(accountRef), id as never)
  const calls = (method: string) =>
    sim.host.engine.calls().filter((call) => call.method === method).length
  const fault = (...rules: FaultRule[]) => sim.host.engine.faults.add(...rules)
  const answer = async (
    id: string,
    value: 'receipt_printed' | 'no_receipt' | 'on_till' | 'not_on_till',
  ) =>
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

  it('pays a round at Send: entered on a payment table, checked, closed and captured', async () => {
    const id = await held()
    // The pay-first lines wait on the order, held for the payment, until the round is entered.
    expect(await orderLines()).toEqual([[2, id]])
    const row = await drive(id)
    expect(row).toMatchObject({
      state: 'captured',
      amount_minor: '2200',
      captured_minor: '2200',
      payment_table_id: null,
    })
    expect(await steps(id)).toEqual([
      'createHold:attempting',
      'createHold:done',
      'addLines:attempting',
      'addLines:done',
      'payAndClose:attempting',
      'payAndClose:done',
      'capture:attempting',
      'capture:done',
    ])
    // One round on one payment table, its first line naming the guest's table; the bill closed.
    const bills = paymentBills()
    expect(bills).toHaveLength(1)
    expect(bills[0]?.state).toBe('closed')
    expect(bills[0]?.rows).toEqual([[ARTICLE, expect.anything(), expect.stringMatching(/1$/)]])
    expect(calls('addRows')).toBe(1)
    // The round is on the POS: its sent order is Added with the bill it opened, its lines gone.
    expect(await sentOrderOf(id)).toMatchObject({
      state: 'added',
      pos_bill_ref: expect.any(String),
    })
    expect(await orderLines()).toEqual([])
    expect(holdOf(id)).toEqual([
      expect.objectContaining({ status: 'captured', capturedMinor: 2_200 }),
    ])
  })

  it("enters the round without the table's name where the guest's note leaves no room, and says so", async () => {
    const note = 'x'.repeat(200)
    const id = await held(POS_PRICE, note)
    logged.length = 0
    expect(await drive(id)).toMatchObject({ state: 'captured' })
    expect(paymentBills()[0]?.rows).toEqual([[ARTICLE, expect.anything(), note]])
    const warned = logged.filter((line) => line.includes('the table note fits on no line'))
    expect(warned).toHaveLength(1)
    expect(JSON.parse(warned[0] ?? '{}')).toMatchObject({ level: 40, paymentId: id })
    // Never the guest's own text.
    expect(warned[0]).not.toContain(note)
  })

  it("captures the POS's lower total, never more than the guest agreed", async () => {
    const id = await held(1_200)
    expect(await stored(id)).toMatchObject({ amount_minor: '2400' })
    const row = await drive(id)
    expect(row).toMatchObject({ state: 'captured', captured_minor: '2200' })
    expect(holdOf(id)).toEqual([
      expect.objectContaining({ status: 'captured', capturedMinor: 2_200 }),
    ])
  })

  it('a POS total above the hold: unconfirmed for a manager, never charged or released', async () => {
    const id = await held(1_000)
    const row = await drive(id)
    expect(row).toMatchObject({ state: 'unconfirmed', reason: 'entered_check_failed' })
    expect(await alertsOf(id)).toEqual(['payment_unconfirmed:money.follow_up'])
    expect(calls('closeBill')).toBe(0)
    await drive(id, 3)
    expect(await stored(id)).toMatchObject({ state: 'unconfirmed' })
    expect(holdOf(id)).toEqual([expect.objectContaining({ status: 'held' })])
  })

  it('waits while a waiter has the payment tables, and enters the round once one is free', async () => {
    const id = await held()
    // A waiter's own bills on both payment tables: nothing is entered beside them.
    for (const table of PAYMENT_TABLES)
      sim.host.engine.waiter.addRound(table, [{ article: '2001' }])
    simClock.advance(1100)
    expect(await drive(id, 3)).toMatchObject({ state: 'queued', payment_table_id: null })
    expect(calls('addRows')).toBe(0)
    expect(await orderLines()).toEqual([[2, id]])

    for (const bill of sim.host.engine.state.bills.filter((one) => one.state === 'open')) {
      sim.host.engine.waiter.closeBill(bill.id)
    }
    simClock.advance(1100)
    expect(await drive(id)).toMatchObject({ state: 'captured', captured_minor: '2200' })
    expect(calls('addRows')).toBe(1)
  })

  describe('a timeout after the round may be on the POS: captured or unconfirmed, never released', () => {
    it('the entry, landing and then hanging: read back on the payment table and captured', async () => {
      const id = await held()
      fault({ on: 'addRows', fault: { kind: 'landsThenHangs' } })
      const row = await drive(id)
      expect(row).toMatchObject({ state: 'captured', captured_minor: '2200' })
      expect(calls('addRows')).toBe(1)
      expect(await steps(id)).toContain('addLines:unknown')
      expect(paymentBills().map((bill) => bill.state)).toEqual(['closed'])
    })

    it('the entry, never landing: unconfirmed, never sent again; "No receipt" cancels it', async () => {
      const id = await held()
      fault({ on: 'addRows', fault: { kind: 'hang' } })
      const row = await drive(id)
      expect(row).toMatchObject({ state: 'unconfirmed', reason: 'enter_unknown' })
      expect(await alertsOf(id)).toEqual(['payment_unconfirmed:money.follow_up'])
      expect(await sentOrderOf(id)).toMatchObject({ state: 'unconfirmed' })
      await drive(id, 3)
      expect(await stored(id)).toMatchObject({ state: 'unconfirmed', reason: 'enter_unknown' })
      expect(calls('addRows')).toBe(1)
      expect(holdOf(id)).toEqual([expect.objectContaining({ status: 'held' })])

      // No close was attempted: "No receipt" is not the question.
      expect(await answer(id, 'no_receipt')).toMatchObject({ status: 'refused' })
      // A manager finds no round at the till: the hold is released and the sent order Not sent.
      expect(await answer(id, 'not_on_till')).toMatchObject({ status: 'accepted' })
      expect(await drive(id)).toMatchObject({ state: 'released', payment_table_id: null })
      expect(await sentOrderOf(id)).toMatchObject({ state: 'not_sent' })
      expect(holdOf(id)).toEqual([expect.objectContaining({ status: 'released' })])
    })

    it('the entry unknown, then "on the till": checked, closed and captured on the round there', async () => {
      const id = await held()
      fault({ on: 'addRows', fault: { kind: 'hang' } })
      expect(await drive(id)).toMatchObject({ state: 'unconfirmed', reason: 'enter_unknown' })
      // The round reached the till after all (a waiter put it on the payment table).
      sim.host.engine.waiter.addRound(await paymentPlace(id), [{ article: ARTICLE, quantity: '2' }])
      expect(await answer(id, 'on_till')).toMatchObject({ status: 'accepted' })
      expect(await sentOrderOf(id)).toMatchObject({ state: 'added' })
      expect(await drive(id)).toMatchObject({ state: 'captured', captured_minor: '2200' })
      expect(calls('addRows')).toBe(1)
    })

    it('a refusal after the entry was attempted (the POS place gone): unconfirmed, never released', async () => {
      const id = await held()
      fault({ on: 'addRows', fault: { kind: 'hang' } })
      // One run: the entry is sent and times out, its outcome unknown for the read-back window.
      await drive(id, 1)
      expect(await steps(id)).toContain('addLines:unknown')
      const [place] = await query<{ state: string }>(
        'select state from restro.places where table_id = $1',
        [tableId],
      )
      await query(`update restro.places set state = 'deleted' where table_id = $1`, [tableId])
      try {
        expect(await drive(id, 3)).toMatchObject({ state: 'unconfirmed', reason: 'enter_unknown' })
        expect(await alertsOf(id)).toEqual(['payment_unconfirmed:money.follow_up'])
        expect(await steps(id)).not.toContainEqual(expect.stringMatching(/^release:/))
        expect(holdOf(id)).toEqual([expect.objectContaining({ status: 'held' })])
      } finally {
        await query('update restro.places set state = $2 where table_id = $1', [
          tableId,
          place?.state,
        ])
      }
    })

    it("a waiter's bill on the payment table after an unknown entry is not the round: never closed or charged", async () => {
      const id = await held()
      fault({ on: 'addRows', fault: { kind: 'hang' } })
      await drive(id, 1)
      sim.host.engine.waiter.addRound(await paymentPlace(id), [{ article: '2001' }])
      expect(await drive(id)).toMatchObject({ state: 'unconfirmed', reason: 'enter_unknown' })
      await drive(id, 3)
      expect(calls('closeBill')).toBe(0)
      expect(await steps(id)).not.toContainEqual(expect.stringMatching(/^(capture|release):/))
      expect(holdOf(id)).toEqual([expect.objectContaining({ status: 'held' })])
    })

    it('two runs at once enter the round once (#113)', async () => {
      const id = await held()
      fault({ on: 'addRows', fault: { kind: 'landsThenHangs' } })
      const run = () =>
        preparePayment(env(), target(id), deps()).catch((error: unknown) => {
          if (!(error instanceof PaymentStepRetry)) throw error
        })
      await Promise.all([run(), run()])
      expect(calls('addRows')).toBe(1)
      expect(await drive(id)).toMatchObject({ state: 'captured', captured_minor: '2200' })
      expect(calls('addRows')).toBe(1)
    })

    it.each([
      ['before it lands', { on: 'closeBill', fault: { kind: 'hang' } }],
      ['after it landed', { on: 'closeBill', fault: { kind: 'landsThenHangs' } }],
    ] as const)('the close, %s: unconfirmed with the hold kept', async (_, rule) => {
      const id = await held()
      fault(rule as FaultRule)
      const row = await drive(id)
      expect(row).toMatchObject({ state: 'unconfirmed', reason: 'close_unknown' })
      await drive(id, 3)
      expect(await stored(id)).toMatchObject({ state: 'unconfirmed', reason: 'close_unknown' })
      expect(calls('closeBill')).toBe(1)
      expect(holdOf(id)).toEqual([expect.objectContaining({ status: 'held' })])
      // "Receipt printed": the round was closed at the till, so the hold is captured.
      expect(await answer(id, 'receipt_printed')).toMatchObject({ status: 'accepted' })
      expect(await drive(id)).toMatchObject({ state: 'captured', captured_minor: '2200' })
    })
  })

  it('is not offered where the POS cannot open a bill that names itself', async () => {
    await readFloor('demo-bar')
    try {
      await expect(send()).resolves.toMatchObject({ status: 'refused', code: 'paying_not_offered' })
    } finally {
      await readFloor('pay-first')
    }
  })
})

describe("the note naming the guest's table (#113)", () => {
  const line = (note: string | null) => ({
    item: posRef(ARTICLE),
    quantity: '1',
    options: [],
    note,
  })

  it("goes before the guest's note on the first line, never cutting the guest's text", () => {
    expect(
      withTableNote([line('no ice'), line(null)], 'for Table 7').map((one) => one.note),
    ).toEqual(['for Table 7 · no ice', null])
    // A 200-character note leaves no room: the table goes on the next line, or on none.
    const long = 'x'.repeat(200)
    expect(withTableNote([line(long), line(null)], 'for Table 7').map((one) => one.note)).toEqual([
      long,
      'for Table 7',
    ])
    expect(withTableNote([line(long)], 'for Table 7').map((one) => one.note)).toEqual([long])
  })
})
