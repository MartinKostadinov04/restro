// The venue's electronic receipt through the payment route (#186; D127, "Martin 10-29") on
// Postgres through the worker's real code, against a real simulator server over HTTP and the
// simulated card provider: the guest's email goes into the one close and is gone from every stored
// row, event, Log entry, step, queued job and log line once the payment ends, and at the latest
// when the payment is older than any payment can take. The POS sends the receipt itself, or
// returns its file and Restro sends it unchanged through a fake sender; where no electronic
// receipt reached the guest, the waiter brings paper.
import { randomUUID } from 'node:crypto'

import {
  DEFAULT_ORDERING_SETTINGS,
  hashTableCode,
  type IntegrationId,
  newId,
  type PaymentJob,
  providerRef,
  SERVICE_TIMINGS,
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
  forgetGuestCodes,
  GUEST_LIMITS,
  type GuestLimit,
  GuestLimiter,
  type GuestLimitName,
  guestAct,
  guestPayment,
  guestState,
} from '@restro/core/service'
import { createPool, type DbPool, PAYMENT_EMAIL_STATES } from '@restro/db'
import {
  createSimPayProvider,
  SIM_PAY_KIND,
  ManualClock as SimPayClock,
  SimPayEngine,
} from '@restro/sim-pay'
import {
  buildEngine,
  createSimServer,
  loadScenarioFile,
  ManualClock as SimPosClock,
  type SimServer,
} from '@restro/sim-pos'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { InstanceBudgets, readFloorOf } from '../src/jobs/floor'
import { recoverPayments } from '../src/jobs/payment-recovery'
import {
  checkPayment,
  type PaymentJobDeps,
  PaymentStepRetry,
  preparePayment,
} from '../src/jobs/payments'
import { ReadingBudgets, readTableOf, TABLE_READ_MIN_GAP_MS } from '../src/jobs/readings'
import type { JobQueue } from '../src/jobs/types'
import { createLogger } from '../src/logger'
import { EmailSendError } from '../src/receipts/email-sender'
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

const KEY = 'receipt-email-test-key-'.padEnd(48, 'x')
const POS_TABLE = '30001'
/** An address no other text in the database or in a log can hold by chance. */
const EMAIL = 'receipt-guest-7f3a91@example.test'
const TIMINGS = { ...SERVICE_TIMINGS, readTimeoutMs: 2_000, writeTimeoutMs: 300 }
const CALL_MS = 500
const BETWEEN_RUNS_MS = 5_000
const SETTLED = ['captured', 'released', 'stranded', 'capture_failed']

const LOOSE = new GuestLimiter(
  Object.fromEntries(
    Object.entries(GUEST_LIMITS).map(([name, limit]) => [name, { ...limit, max: 10_000 }]),
  ) as Record<GuestLimitName, GuestLimit>,
)

describe.skipIf(!hasDatabase).each([
  { shape: 'the POS sends the receipt', scenario: 'receipt-sent', file: false },
  { shape: 'the POS returns its file and Restro sends it', scenario: 'receipt-file', file: true },
])('the electronic receipt: $shape', ({ scenario, file }) => {
  let db: TestDatabase
  let pool: DbPool
  let sim: SimServer
  const simClock = new SimPosClock()
  const payClock = new SimPayClock()
  const engine = new SimPayEngine({ clock: payClock })
  const provider = createSimPayProvider({ env: 'test', engine })
  const tenantId = newId('tn')
  let clock = new Date()
  let demo: { venueId: VenueId; integrationId: IntegrationId }
  let tableId: `tb_${string}`
  let code: string
  let accountRef: string
  const logLines: string[] = []
  let log: Awaited<ReturnType<typeof createLogger>>
  const sender = createFakeEmailSender()
  const sent: { name: string; data: object }[] = []
  const queue: JobQueue = {
    async send(name, data) {
      sent.push({ name, data })
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
  const deps = (overrides: Partial<PaymentJobDeps> = {}): PaymentJobDeps => ({
    sim: policy,
    providers: new Map([[SIM_PAY_KIND, provider]]),
    budgets: new InstanceBudgets(),
    timings: TIMINGS,
    sleep: async (ms) => {
      simClock.advance(ms)
    },
    receiptSender: file ? sender : null,
    receiptRetryDelaysMs: [0, 0],
    ...overrides,
  })
  const target = (paymentId: string): PaymentJob => ({
    tenantId,
    venueId: demo.venueId,
    paymentId: paymentId as PaymentJob['paymentId'],
  })

  async function readFloor(receiptSender = file) {
    simClock.advance(1100)
    return readFloorOf(
      { pool, log, now: () => clock },
      { tenantId, ...demo },
      { sim: policy, budgets: new InstanceBudgets(), receiptSender },
    )
  }

  beforeAll(async () => {
    db = await createTestDatabase()
    pool = createPool(db.appUrl, { applicationName: 'restro-worker-receipt-email-tests', max: 4 })
    await provisionTenant(pool, { tenantId, name: 'Receipt club' })
    await query(
      `insert into restro.auth_organization (id, name, slug) values ($1, 'Receipt club', $2)`,
      [tenantId, `receipt-${newId('tn').slice(3, 11)}`],
    )
    log = await createLogger({
      level: 'trace',
      pretty: false,
      destination: { write: (line: string) => void logLines.push(line) },
    })
    sim = createSimServer({ scenario: scenario, print: () => {}, clock: simClock })
    const host = `127.0.0.1:${await sim.listen(0)}`
    const integrationId = (await createIntegration(pool, tenantId, { kind: 'sim', host })).id
    // The connector declares what the scenario's switches say (`sim_scenario`).
    await query(`update restro.integrations set config = config || $2::jsonb where id = $1`, [
      integrationId,
      JSON.stringify({ sim_scenario: scenario }),
    ])
    const venue = await provisionVenue(pool, tenantId, {
      name: 'Demo Bar',
      slug: testSlug('receipt'),
    })
    await upsertBarsyVenues(pool, tenantId, integrationId, [{ bid: 1, name: 'Demo Bar' }])
    expect((await mapBarsyVenue(pool, tenantId, integrationId, 1, venue.id)).ok).toBe(true)
    demo = { venueId: venue.id as VenueId, integrationId: integrationId as IntegrationId }
    await setFloorSource(pool, tenantId, {
      venueId: demo.venueId,
      source: { halls: null, bars: null, paymentTables: ['PM1', 'PM2'] },
    })
    expect((await readFloor()).kind).toBe('read')
    const [table] = await query<{ id: `tb_${string}` }>(
      `select id from restro.tables where venue_id = $1 and number = '1'`,
      [demo.venueId],
    )
    if (table === undefined) throw new Error('no table 1')
    tableId = table.id
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
    logLines.length = 0
    sender.sent.length = 0
    sender.failWith = null
    engine.clearFaults()
    const resolved = loadScenarioFile(scenario)
    sim.host.engine = buildEngine(resolved, { clock: simClock })
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
    simClock.advance(1100)
    clock = new Date(clock.getTime() + TABLE_READ_MIN_GAP_MS + 1)
    expect(
      await readTableOf(
        { pool, log, now: () => clock },
        { tenantId, venueId: demo.venueId, tableId },
        {
          sim: policy,
          billIdKey: KEY,
          budgets: new InstanceBudgets(),
          readingBudgets: new ReadingBudgets(),
        },
      ),
    ).toMatchObject({ kind: 'recorded', complete: true })
  }

  /** A guest's Pay of the second line, with or without an email; the result is the payment's id. */
  let lastHandle: string | null = null
  async function pay(receiptEmail?: string): Promise<{ id: string | null; code: string | null }> {
    const state = await guestState(pool, { code, view: 'bill', limiter: LOOSE })
    if (!state.ok || state.answer.unchanged) throw new Error('no state')
    const shown = state.answer.bill?.parts.flatMap((part) => part.lines) ?? []
    const picked = [shown[1] as (typeof shown)[number]]
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
        ...(receiptEmail === undefined ? {} : { receiptEmail }),
      },
      ageMs: 10,
      view: 'bill',
      phone: randomUUID(),
      limiter: LOOSE,
      check: { humanToken: 'XXXX.DUMMY.TOKEN.XXXX' },
      humanCheck: async () => 'passed',
    })
    if (!answer.ok) throw new Error(`the Pay failed: ${answer.code}`)
    lastHandle = answer.handle
    if (answer.result.status !== 'accepted') return { id: null, code: answer.result.code ?? null }
    return { id: answer.result.subjectId as string, code: null }
  }

  /** The payment held at the provider, ready for the route. */
  async function held(receiptEmail?: string): Promise<string> {
    const { id, code: refusal } = await pay(receiptEmail)
    if (id === null) throw new Error(`the Pay was refused: ${refusal}`)
    expect(await preparePayment(env(), target(id), deps())).toEqual({
      kind: 'at',
      state: 'awaiting_guest',
    })
    engine.guest.pay(providerRef((await stored(id))?.provider_payment_ref ?? ''))
    expect(await checkPayment(env(), target(id), deps())).toEqual({ kind: 'at', state: 'held' })
    return id
  }

  async function drive(id: string, overrides: Partial<PaymentJobDeps> = {}) {
    for (let run = 0; run < 40; run += 1) {
      if (run > 0) {
        simClock.advance(BETWEEN_RUNS_MS)
        await query(
          `update restro.payment_steps set at = at - make_interval(secs => $2) where payment_id = $1`,
          [id, BETWEEN_RUNS_MS / 1_000],
        )
      }
      try {
        await preparePayment(env(), target(id), deps(overrides))
      } catch (error) {
        if (!(error instanceof PaymentStepRetry)) throw error
      }
      const row = await stored(id)
      if (row !== undefined && SETTLED.includes(row.state) && row.payment_table_id === null) break
    }
    return stored(id)
  }

  const stored = async (id: string) =>
    (
      await query<{
        state: string
        receipt_email: string | null
        payment_table_id: string | null
        to_bring: boolean
        provider_payment_ref: string | null
      }>(
        `select state, receipt_email, payment_table_id, provider_payment_ref,
                receipt_to_bring_at is not null as to_bring
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
  /** What the paying phone's own payment says of the receipt, as the guest page reads it. */
  async function receiptEmailed() {
    const answer = await guestPayment(pool, { code, handle: lastHandle ?? '', limiter: LOOSE })
    if (!answer.ok) throw new Error('the payment was not read')
    return answer.answer.receiptEmailed
  }
  const receiptBill = () => sim.host.engine.state.bills.find((bill) => bill.receipt !== null)

  /**
   * Every text the database and the worker's logs hold, looked through for the address: each row
   * of every table of the app's schema and of pg-boss's, as the database prints it, and every log
   * line (so a Log entry, an event, a step, a queued job and a log line are all covered).
   */
  async function wherever(needle: string): Promise<string[]> {
    const found: string[] = []
    const tables = await query<{ table_schema: string; table_name: string }>(
      `select table_schema, table_name from information_schema.tables
        where table_schema in ('restro', 'pgboss') and table_type = 'BASE TABLE'`,
    )
    for (const { table_schema: schema, table_name: name } of tables) {
      const rows = await query<{ n: string }>(
        `select count(*)::text as n from "${schema}"."${name}" t where t::text like $1`,
        [`%${needle}%`],
      )
      if (rows[0]?.n !== '0') found.push(`${schema}.${name}`)
    }
    if (logLines.some((line) => line.includes(needle))) found.push('a log line')
    if (sent.some((job) => JSON.stringify(job).includes(needle))) found.push('a queued job')
    return found
  }

  it('the capability is recorded as offered (a file shape only with a sender configured)', async () => {
    const recorded = async () =>
      (
        await query<{ on: boolean | null }>(
          `select (config->'service_capabilities'->>'electronic_receipt')::boolean as on
             from restro.integrations where id = $1`,
          [demo.integrationId],
        )
      )[0]?.on
    expect(await recorded()).toBe(true)
    if (file) {
      // No sender: the file could not reach the guest, so the field is not offered.
      await readFloor(false)
      expect(await recorded()).toBe(false)
      await readFloor()
      expect(await recorded()).toBe(true)
    }
  })

  it('pays with an email: the receipt goes out, the address is in no row, event, log or job afterwards', async () => {
    const id = await held(EMAIL)
    // While the payment waits, the address is on the payment's own row, and nowhere else.
    expect((await stored(id))?.receipt_email).toBe(EMAIL)
    expect(await wherever(EMAIL)).toEqual(['restro.payments'])

    const row = await drive(id)
    expect(row).toMatchObject({ state: 'captured', receipt_email: null, to_bring: false })
    expect(await steps(id)).toContain(`receiptEmail:done:${file ? 'file_sent' : 'pos_sent'}`)
    // The paying phone is told what went out: Restro sent the file, or the POS was asked to send it.
    expect(await receiptEmailed()).toBe(file ? 'sent' : 'requested')
    // The POS got the address with the close; the receipt is the POS's own.
    expect(receiptBill()?.receipt).toMatchObject({
      email: EMAIL,
      delivery: file ? 'returned' : 'sent',
    })
    if (file) {
      expect(sender.sent).toHaveLength(1)
      const message = sender.sent[0]
      expect(message).toMatchObject({
        to: EMAIL,
        venueName: 'Demo Bar',
        idempotencyKey: `${id}-receipt`,
        file: { contentType: 'application/pdf' },
      })
      expect(Buffer.from(message?.file.contentBase64 ?? '', 'base64').toString()).toContain(
        'sim-pos electronic receipt',
      )
    } else {
      expect(sender.sent).toHaveLength(0)
    }
    // After the payment ends the address is in no stored row, event, Log entry, step, queued job
    // or log line.
    expect(await wherever(EMAIL)).toEqual([])
  })

  it('pays without an email: the paper close, the waiter brings the receipt, nothing is sent', async () => {
    const id = await held()
    const row = await drive(id)
    expect(row).toMatchObject({ state: 'captured', receipt_email: null, to_bring: true })
    expect((await steps(id)).some((step) => step.startsWith('receiptEmail'))).toBe(false)
    expect(await receiptEmailed()).toBeNull()
    expect(sender.sent).toHaveLength(0)
    expect(receiptBill()?.receipt).toMatchObject({ email: null, delivery: null })
  })

  it('refuses an address that is not one; where the POS no longer issues the receipt the address is dropped and the guest pays with paper', async () => {
    for (const bad of ['not an email', 'a@example.test, b@example.test', ' a@example.test']) {
      const refused = await pay(bad)
      expect(refused).toEqual({ id: null, code: 'invalid_command' })
    }
    // The capability recorded as not declared since the phone was offered the field: the Pay is
    // accepted, the address is dropped (never stored), and the close is the paper one.
    await query(
      `update restro.integrations set config = jsonb_set(config, '{service_capabilities,electronic_receipt}', 'false') where id = $1`,
      [demo.integrationId],
    )
    let id: string | null = null
    try {
      const started = await pay(EMAIL)
      expect(started.code).toBeNull()
      id = started.id
    } finally {
      await readFloor()
    }
    if (id === null) throw new Error('the Pay was refused')
    expect((await stored(id))?.receipt_email).toBeNull()
    expect(await wherever(EMAIL)).toEqual([])
    expect(await wherever('not an email')).toEqual([])
  })

  it('a printer that is down: the close is done, no receipt is issued, paper is brought, the address is gone', async () => {
    const id = await held(EMAIL)
    sim.host.engine.waiter.setPrinterDown(true)
    const row = await drive(id)
    expect(row).toMatchObject({ state: 'captured', receipt_email: null, to_bring: true })
    expect(await steps(id)).toContain('receiptEmail:refused:not_issued')
    expect(await receiptEmailed()).toBeNull()
    expect(sender.sent).toHaveLength(0)
    expect(await wherever(EMAIL)).toEqual([])
  })

  if (file) {
    it('a busy service is tried again, then the receipt is sent once', async () => {
      sender.failWith = new EmailSendError(503, true, 'busy')
      const id = await held(EMAIL)
      let failures = 0
      const failing = {
        async sendReceipt(message: Parameters<typeof sender.sendReceipt>[0]) {
          failures += 1
          if (failures <= 2) throw new EmailSendError(503, true, 'busy')
          await sender.sendReceipt(message)
        },
      }
      sender.failWith = null
      const row = await drive(id, { receiptSender: failing })
      expect(failures).toBe(3)
      expect(row).toMatchObject({ state: 'captured', receipt_email: null, to_bring: false })
      expect(await steps(id)).toContain('receiptEmail:done:file_sent')
      expect(sender.sent).toHaveLength(1)
      expect(await wherever(EMAIL)).toEqual([])
    })

    it('a refusal is final: paper is brought, a log line holds a code and never the address', async () => {
      const id = await held(EMAIL)
      sender.failWith = new EmailSendError(429, false, 'daily_quota_exceeded, status 429')
      const row = await drive(id)
      expect(row).toMatchObject({ state: 'captured', receipt_email: null, to_bring: true })
      expect(await steps(id)).toContain('receiptEmail:refused:send_failed')
      expect(sender.sent).toHaveLength(0)
      expect(logLines.some((line) => line.includes('the receipt email was not sent'))).toBe(true)
      expect(await wherever(EMAIL)).toEqual([])
    })

    it('with no sender configured the POS is not given the address: paper', async () => {
      const id = await held(EMAIL)
      const row = await drive(id, { receiptSender: null })
      expect(row).toMatchObject({ state: 'captured', receipt_email: null, to_bring: true })
      expect(receiptBill()?.receipt).toMatchObject({ email: null })
      expect(await wherever(EMAIL)).toEqual([])
    })
  }

  it('any end of a payment erases the address in the same update, and the check refuses a bad one', async () => {
    const id = await held(EMAIL)
    // A cancel (a state outside the ones that may hold it) erases it at once.
    await query(`update restro.payments set state = 'cancelling' where id = $1`, [id])
    expect((await stored(id))?.receipt_email).toBeNull()
    // Written back in such a state it is erased again by the same update (the trigger), and an
    // address that is not plausible is refused by the check wherever it is.
    await query(`update restro.payments set receipt_email = $2 where id = $1`, [id, EMAIL])
    expect((await stored(id))?.receipt_email).toBeNull()
    await expect(
      query(`update restro.payments set state = 'requested', receipt_email = 'x' where id = $1`, [
        id,
      ]),
    ).rejects.toThrow(/payments_receipt_email/)
  })

  it('the trigger erases in exactly the states the check lets the address stay in', async () => {
    const [{ def }] = (await query<{ def: string }>(
      `select pg_get_functiondef('restro.payments_erase_receipt_email()'::regprocedure) as def`,
    )) as [{ def: string }]
    const list = /NOT IN \(([^)]*)\)/.exec(def)?.[1] ?? ''
    const erased = [...list.matchAll(/'([a-z_]+)'/g)].map((m) => m[1] as string)
    expect(erased.length).toBeGreaterThan(0)
    expect([...erased].sort()).toEqual([...PAYMENT_EMAIL_STATES].sort())
  })

  it('a payment that never reaches its close loses the address once it is older than any payment takes', async () => {
    const { id } = await pay(EMAIL)
    if (id === null) throw new Error('the Pay was refused')
    expect((await stored(id))?.receipt_email).toBe(EMAIL)
    // Young: kept. Past the bound: erased by the recovery, the payment itself untouched.
    await recoverPayments({ pool, log, now: () => clock, queue }, deps())
    expect((await stored(id))?.receipt_email).toBe(EMAIL)
    await query(
      `update restro.payments set created_at = now() - interval '31 minutes' where id = $1`,
      [id],
    )
    await recoverPayments({ pool, log, now: () => clock, queue }, deps())
    expect(await stored(id)).toMatchObject({ state: 'requested', receipt_email: null })
    expect(await wherever(EMAIL)).toEqual([])
  })
})
