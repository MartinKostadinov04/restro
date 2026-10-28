// The payment jobs (#110) on Postgres through their real code, against a real simulator server over
// HTTP (`createSimServer`) and the simulated payment provider (`@restro/sim-pay`): a guest's Pay is
// priced from a fresh reading of the table and held at the provider, each provider write recorded
// `attempting` before the call; the guest at the card form gets it `held`; a cancel releases the
// provider's payment; a hold the provider refuses ungreys the lines; a hold whose outcome is unknown
// is made once however often it is retried; a tip is refused where the connector records none; and a
// `sim` instance is refused in production.
import { randomUUID } from 'node:crypto'

import {
  DEFAULT_ORDERING_SETTINGS,
  hashTableCode,
  type IntegrationId,
  newId,
  type PaymentJob,
  providerRef,
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
  guestState,
} from '@restro/core/service'
import { createPool, type DbPool } from '@restro/db'
import {
  createSimPayProvider,
  SIM_PAY_KIND,
  ManualClock as SimPayClock,
  SimPayEngine,
} from '@restro/sim-pay'
import { createSimServer, ManualClock as SimPosClock, type SimServer } from '@restro/sim-pos'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { InstanceBudgets, readFloorOf } from '../src/jobs/floor'
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

allowSlowSetup()

const KEY = 'payments-test-key-'.padEnd(48, 'x')
/** Demo Bar's table 1 on the simulator. */
const POS_TABLE = '30001'

const LOOSE = new GuestLimiter(
  Object.fromEntries(
    Object.entries(GUEST_LIMITS).map(([name, limit]) => [name, { ...limit, max: 10_000 }]),
  ) as Record<GuestLimitName, GuestLimit>,
)

describe.skipIf(!hasDatabase)('the payment jobs', () => {
  let db: TestDatabase
  let pool: DbPool
  let sim: SimServer
  const simClock = new SimPosClock()
  const engine = new SimPayEngine({ clock: new SimPayClock() })
  const provider = createSimPayProvider({ env: 'test', engine })
  let host: string
  const tenantId = newId('tn')
  let log: Awaited<ReturnType<typeof createLogger>>
  let clock = new Date()
  let demo: { venueId: VenueId; integrationId: IntegrationId }
  let tableId: `tb_${string}`
  let code: string
  let accountRef: string
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
  const deps = (overrides: Partial<PaymentJobDeps> = {}): PaymentJobDeps => ({
    sim: policy,
    providers: new Map([[SIM_PAY_KIND, provider]]),
    budgets: new InstanceBudgets(),
    ...overrides,
  })
  const target = (paymentId: string): PaymentJob => ({
    tenantId,
    venueId: demo.venueId,
    paymentId: paymentId as PaymentJob['paymentId'],
  })

  beforeAll(async () => {
    db = await createTestDatabase()
    pool = createPool(db.appUrl, { applicationName: 'restro-worker-payment-tests', max: 4 })
    await provisionTenant(pool, { tenantId, name: 'Paying club' })
    await query(
      `insert into restro.auth_organization (id, name, slug) values ($1, 'Paying club', $2)`,
      [tenantId, `paying-${newId('tn').slice(3, 11)}`],
    )
    log = await createLogger({ level: 'debug', pretty: false, destination: { write: () => {} } })
    sim = createSimServer({ scenario: 'demo-bar', print: () => {}, clock: simClock })
    host = `127.0.0.1:${await sim.listen(0)}`

    const integrationId = (await createIntegration(pool, tenantId, { kind: 'sim', host })).id
    const venue = await provisionVenue(pool, tenantId, { name: 'Demo Bar', slug: testSlug('pay') })
    await upsertBarsyVenues(pool, tenantId, integrationId, [{ bid: 1, name: 'Demo Bar' }])
    expect((await mapBarsyVenue(pool, tenantId, integrationId, 1, venue.id)).ok).toBe(true)
    demo = { venueId: venue.id as VenueId, integrationId: integrationId as IntegrationId }
    await setFloorSource(pool, tenantId, {
      venueId: demo.venueId,
      source: { halls: null, bars: null, paymentTables: [] },
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
    // Paying is on only with a payment table in every bar (D125 2.3): one for each of the two.
    await query(
      `update restro.tables set is_payment_table = true where venue_id = $1 and number in ('PM1', 'PU1')`,
      [demo.venueId],
    )
    // Paying is never located; the bill a phone reads here is not hidden behind the check either.
    await query(
      `update restro.venues set settings = jsonb_set(settings, '{ordering}', $2::jsonb) where id = $1`,
      [demo.venueId, JSON.stringify({ ...DEFAULT_ORDERING_SETTINGS, locationCheck: false })],
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
  })

  afterAll(async () => {
    await sim?.close()
    await pool?.end()
    await db?.drop()
  })

  beforeEach(async () => {
    forgetGuestCodes()
    LOOSE.clear()
    sent.length = 0
    engine.clearFaults()
    sim.host.load('demo-bar')
    await query(
      `update restro.payments set state = 'released', reason = 'test', form_values = null,
         settled_at = now() where table_id = $1 and settled_at is null`,
      [tableId],
    )
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
    // A waiter's round on the POS, read onto the table's bill.
    sim.host.engine.waiter.addRound(POS_TABLE, [
      { article: '2001' },
      { article: '2002', quantity: '2' },
    ])
    await read()
  })

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

  /** The table's bill lines as a phone sees them. */
  async function lines() {
    const read = await guestState(pool, { code, view: 'bill', limiter: LOOSE })
    if (!read.ok || read.answer.unchanged) throw new Error('no state')
    return read.answer.bill?.parts.flatMap((part) => part.lines) ?? []
  }

  /** A guest's Pay of the bill's line at `index` (every line by default), with its handle. */
  async function pay(index: number | 'all' = 0, tipMinor: number | null = null) {
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
    if (!answer.ok || answer.result.status !== 'accepted' || answer.handle === null) {
      throw new Error(`the Pay was refused: ${JSON.stringify(answer)}`)
    }
    return { id: answer.result.subjectId as string, handle: answer.handle }
  }

  const stored = async (id: string) =>
    (
      await query<{
        state: string
        reason: string | null
        amount_minor: string | null
        provider_payment_ref: string | null
        form_values: Record<string, string> | null
      }>(
        'select state, reason, amount_minor, provider_payment_ref, form_values from restro.payments where id = $1',
        [id],
      )
    )[0]
  const steps = async (id: string) =>
    (
      await query<{
        step: string
        outcome: string
        answer: string | null
        idempotency_key: string
      }>(
        `select step, outcome, answer, idempotency_key from restro.payment_steps
          where payment_id = $1 order by seq`,
        [id],
      )
    ).map((row) => [row.step, row.outcome, row.answer, row.idempotency_key])

  it('prices the Pay from a fresh reading, holds it, and the guest at the form gets it held', async () => {
    const { id } = await pay(1)
    expect(await preparePayment(env(), target(id), deps())).toEqual({
      kind: 'at',
      state: 'awaiting_guest',
    })
    const row = await stored(id)
    // Two of article 2002 at 11.00 each: the POS's own amount for the line.
    expect(row).toMatchObject({ state: 'awaiting_guest', amount_minor: '2200' })
    expect(row?.form_values).not.toBeNull()
    expect(await steps(id)).toEqual([
      ['createHold', 'attempting', null, `${id}:hold`],
      ['createHold', 'done', null, `${id}:hold`],
    ])
    // The confirm deadline's check is queued under its own key.
    expect(sent).toContainEqual(
      expect.objectContaining({
        name: 'payment-check',
        options: expect.objectContaining({ singletonKey: `${id}:deadline` }),
      }),
    )

    // Still at the form: the check changes nothing.
    expect(await checkPayment(env(), target(id), deps())).toEqual({
      kind: 'at',
      state: 'awaiting_guest',
    })
    engine.guest.pay(providerRef(row?.provider_payment_ref ?? ''))
    expect(await checkPayment(env(), target(id), deps())).toEqual({ kind: 'at', state: 'held' })
    expect(await stored(id)).toMatchObject({ state: 'held', form_values: null })
  })

  it('releases the provider payment of a cancelled Pay, and the lines ungrey', async () => {
    const { id, handle } = await pay(0)
    await preparePayment(env(), target(id), deps())
    expect((await lines())[0]?.beingPaid).toBe(true)
    const cancel = await guestAct(pool, {
      code,
      command: { type: 'pay.cancel', actionId: randomUUID() },
      ageMs: 10,
      view: 'bill',
      phone: randomUUID(),
      limiter: LOOSE,
      handle,
      queuePayment: async () => {},
    })
    expect(cancel).toMatchObject({ ok: true, result: { status: 'accepted' } })
    expect(await stored(id)).toMatchObject({ state: 'cancelling', form_values: null })
    expect(await preparePayment(env(), target(id), deps())).toEqual({
      kind: 'at',
      state: 'released',
    })
    const ref = providerRef((await stored(id))?.provider_payment_ref ?? '')
    expect(engine.paymentsOf(providerRef(accountRef), id as never)).toEqual([
      expect.objectContaining({ ref, status: 'released' }),
    ])
    expect((await steps(id)).filter(([step]) => step === 'release')).toEqual([
      ['release', 'attempting', null, `${id}:release`],
      ['release', 'done', null, `${id}:release`],
    ])
    expect((await lines()).every((line) => !line.beingPaid)).toBe(true)
  })

  /** A Pay at the card form that the guest cancels: `cancelling`, with its provider payment. */
  async function cancelled() {
    const { id, handle } = await pay(0)
    await preparePayment(env(), target(id), deps())
    const answer = await guestAct(pool, {
      code,
      command: { type: 'pay.cancel', actionId: randomUUID() },
      ageMs: 10,
      view: 'bill',
      phone: randomUUID(),
      limiter: LOOSE,
      handle,
      queuePayment: async () => {},
    })
    expect(answer).toMatchObject({ ok: true, result: { status: 'accepted' } })
    return { id, ref: providerRef((await stored(id))?.provider_payment_ref ?? '') }
  }

  it('settles a cancelled Pay whose release is refused once the provider holds nothing', async () => {
    // The release is refused, but the payment failed at the provider already: nothing is held.
    const over = await cancelled()
    engine.guest.decline(over.ref)
    engine.fault('release', { kind: 'refuse', code: 'not_supported' })
    expect(await preparePayment(env(), target(over.id), deps())).toEqual({
      kind: 'at',
      state: 'released',
    })
    expect((await steps(over.id)).filter(([step]) => step === 'release')).toEqual([
      ['release', 'attempting', null, `${over.id}:release`],
      ['release', 'refused', 'not_supported', `${over.id}:release`],
    ])
  })

  it('leaves a cancelled Pay whose release is refused while the provider still has it', async () => {
    // It stays `cancelling` for the recovery to read back (#112).
    const open = await cancelled()
    engine.fault('release', { kind: 'refuse', code: 'not_supported' })
    expect(await preparePayment(env(), target(open.id), deps())).toEqual({
      kind: 'at',
      state: 'cancelling',
    })
    expect(engine.paymentsOf(providerRef(accountRef), open.id as never)).toEqual([
      expect.objectContaining({ status: 'awaiting_guest' }),
    ])
  })

  it('settles a hold the provider refuses, and ungreys the lines', async () => {
    const { id } = await pay(0)
    engine.fault('createHold', { kind: 'refuse', code: 'account_restricted' })
    expect(await preparePayment(env(), target(id), deps())).toEqual({
      kind: 'at',
      state: 'released',
    })
    expect(await stored(id)).toMatchObject({ reason: 'paying_paused' })
    expect(await steps(id)).toEqual([
      ['createHold', 'attempting', null, `${id}:hold`],
      ['createHold', 'refused', 'account_restricted', `${id}:hold`],
    ])
    expect((await lines()).every((line) => !line.beingPaid)).toBe(true)
  })

  it('makes a hold whose outcome was unknown once, however often it is retried', async () => {
    const { id } = await pay(0)
    engine.fault('createHold', { kind: 'land_then_timeout' })
    await expect(preparePayment(env(), target(id), deps())).rejects.toBeInstanceOf(PaymentStepRetry)
    expect(await stored(id)).toMatchObject({ state: 'priced' })
    expect(await preparePayment(env(), target(id), deps())).toEqual({
      kind: 'at',
      state: 'awaiting_guest',
    })
    expect(engine.paymentsOf(providerRef(accountRef), id as never)).toHaveLength(1)
    expect((await steps(id)).map(([, outcome]) => outcome)).toEqual([
      'attempting',
      'unknown',
      'attempting',
      'done',
    ])
  })

  it('releases a tipped Pay where the connector records no tip', async () => {
    const { id } = await pay(0, 100)
    const noTip: typeof serviceConnectorFor = (integration, sim) => {
      const connector = serviceConnectorFor(integration, sim)
      return { ...connector, capabilities: { ...connector.capabilities, recordTipOnClose: false } }
    }
    expect(await preparePayment(env(), target(id), deps({ connectorFor: noTip }))).toEqual({
      kind: 'at',
      state: 'released',
    })
    expect(await stored(id)).toMatchObject({ reason: 'paying_not_offered' })
    expect(engine.paymentsOf(providerRef(accountRef), id as never)).toEqual([])
  })

  it('refuses a sim instance in production before its host is asked', async () => {
    const { id } = await pay(0)
    await expect(
      preparePayment(env(), target(id), deps({ sim: { env: 'production', allowHosts: [] } })),
    ).rejects.toThrow(/never used in production/)
    expect(await stored(id)).toMatchObject({ state: 'requested' })
  })
})
