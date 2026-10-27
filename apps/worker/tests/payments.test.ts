// The payment jobs (#110) on Postgres through their real code, against a real simulator server over
// HTTP (`createSimServer`) and the simulated payment provider (`@restro/sim-pay`): a guest's Pay is
// priced from a fresh reading of the table and held at the provider, each provider write recorded
// `attempting` before the call; the guest at the card form gets it `held`; a cancel releases the
// provider's payment; a hold the provider refuses ungreys the lines; a hold whose outcome is unknown
// is never asked for again: it is found and released (D127 3.15); a tip is refused where the
// connector records none; and a `sim` instance is refused in production.
// The recovery (#112): a worker killed right after it recorded any step of the hold or the cancel
// leaves a payment the recovery's pass alone brings to `released`; a release the provider refuses
// is read back, never sent again, until the provider drops the hold (`released`, reason `expired`).
// The provider's breaker trips on failed calls at one venue account and lifts on good probes; it
// pauses paying in the app only, never ordering, and never another venue's account.
import { randomUUID } from 'node:crypto'

import {
  DEFAULT_ORDERING_SETTINGS,
  hashTableCode,
  type IntegrationId,
  JOB_NAMES,
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
import { PaymentBreakers } from '../src/jobs/payment-breaker'
import { recoverPayments } from '../src/jobs/payment-recovery'
import { checkPayment, type PaymentJobDeps, preparePayment } from '../src/jobs/payments'
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
  const payClock = new SimPayClock()
  const engine = new SimPayEngine({ clock: payClock })
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
         (tenant_id, venue_id, provider_kind, account_ref, state, connected_at, source, actor, job_id)
       values ($1, $2, $3, $4, 'connected', now(), 'restro', 'system', 'test-seed')`,
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

  /** Nobody touched the payment for two minutes (as the owner, past the `updated_at` trigger). */
  const untouched = (id: string) =>
    withOwnerClient(db.ownerUrl, async (client) => {
      await client.query('begin')
      await client.query('set local session_replication_role = replica')
      await client.query(
        `update restro.payments set updated_at = updated_at - interval '2 minutes' where id = $1`,
        [id],
      )
      await client.query(
        `update restro.payment_steps set at = at - interval '2 minutes' where payment_id = $1`,
        [id],
      )
      await client.query('commit')
    })

  /** A worker that dies right after it recorded `step` with `outcome`. */
  class Killed extends Error {}
  const killedAfter = (step: string, outcome: string) => ({
    ...env(),
    onStep: async (recorded: { readonly step: string; readonly outcome: string }) => {
      if (recorded.step === step && recorded.outcome === outcome) throw new Killed(step)
    },
  })
  /**
   * The recovery's pass after the worker was down for two minutes: it queues the payment's
   * prepare, and the job runs it (as pg-boss would) until it stops moving.
   */
  async function recover(id: string) {
    await untouched(id)
    sent.length = 0
    await recoverPayments({ pool, log, now: () => clock, queue }, deps())
    expect(sent).toContainEqual(
      expect.objectContaining({
        name: JOB_NAMES.paymentPrepare,
        options: expect.objectContaining({ singletonKey: id }),
      }),
    )
    return preparePayment(env(), target(id), deps())
  }

  describe('a worker killed after a recorded step (the recovery alone finishes it)', () => {
    it.each([
      ['createHold', 'attempting'],
      ['createHold', 'done'],
    ])(
      'the hold, after %s %s: found and released, never asked for again',
      async (step, outcome) => {
        const { id } = await pay(0)
        await expect(
          preparePayment(killedAfter(step, outcome), target(id), deps()),
        ).rejects.toThrow(Killed)
        expect(await stored(id)).toMatchObject({ state: 'priced' })
        expect(await recover(id)).toEqual({ kind: 'at', state: 'released' })
        // Never a second hold: what the first call made is released.
        const made = engine.paymentsOf(providerRef(accountRef), id as never)
        expect(made.every((payment) => payment.status === 'released')).toBe(true)
        expect(made.length).toBeLessThanOrEqual(1)
        expect(
          (await steps(id)).filter(([s, o]) => s === 'createHold' && o === 'attempting'),
        ).toHaveLength(1)
        expect((await lines()).every((line) => !line.beingPaid)).toBe(true)
      },
    )

    it.each([
      ['release', 'attempting'],
      ['release', 'done'],
    ])('the cancel, after %s %s: released', async (step, outcome) => {
      const { id, ref } = await cancelled()
      await expect(preparePayment(killedAfter(step, outcome), target(id), deps())).rejects.toThrow(
        Killed,
      )
      expect(await stored(id)).toMatchObject({ state: 'cancelling' })
      expect(await recover(id)).toEqual({ kind: 'at', state: 'released' })
      expect(engine.paymentsOf(providerRef(accountRef), id as never)).toEqual([
        expect.objectContaining({ ref, status: 'released' }),
      ])
    })

    it('the cancel of a hold with an unknown outcome, after findByPaymentId attempting: released', async () => {
      const { id } = await pay(0)
      engine.fault('createHold', { kind: 'land_then_timeout' })
      await expect(
        preparePayment(killedAfter('findByPaymentId', 'attempting'), target(id), deps()),
      ).rejects.toThrow(Killed)
      expect(await stored(id)).toMatchObject({ state: 'cancelling' })
      expect(await recover(id)).toEqual({ kind: 'at', state: 'released' })
      expect(engine.paymentsOf(providerRef(accountRef), id as never)).toEqual([
        expect.objectContaining({ status: 'released' }),
      ])
    })
  })

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

  it('reads a refused release back, never sends it again, and settles it once the hold is gone', async () => {
    // It stays `cancelling` for the recovery to read back, and the owners and the team are told.
    const open = await cancelled()
    // The guest's card was held as the guest cancelled.
    engine.guest.pay(open.ref)
    engine.fault('release', { kind: 'refuse', code: 'not_supported' })
    expect(await preparePayment(env(), target(open.id), deps())).toEqual({
      kind: 'at',
      state: 'cancelling',
    })
    expect(engine.paymentsOf(providerRef(accountRef), open.id as never)).toEqual([
      expect.objectContaining({ status: 'held' }),
    ])
    const alerts = async () =>
      query<{ kind: string; open: boolean }>(
        `select kind, done_at is null as open from restro.alerts where subject_id = $1`,
        [open.id],
      )
    expect(await alerts()).toEqual([{ kind: 'payment_release_refused', open: true }])
    // The recovery reads it back later, never at once.
    await untouched(open.id)
    sent.length = 0
    await recoverPayments({ pool, log, now: () => clock, queue }, deps())
    expect(sent).toContainEqual(
      expect.objectContaining({
        name: JOB_NAMES.paymentPrepare,
        options: expect.objectContaining({ singletonKey: open.id, startAfter: 600 }),
      }),
    )
    // Still held: read, not released again.
    expect(await preparePayment(env(), target(open.id), deps())).toEqual({
      kind: 'at',
      state: 'cancelling',
    })
    // The hold runs out at the provider: released, reason expired, and the alert closes.
    payClock.advance(engine.switches.holdDays * 24 * 3_600_000)
    expect(await preparePayment(env(), target(open.id), deps())).toEqual({
      kind: 'at',
      state: 'released',
    })
    expect(await stored(open.id)).toMatchObject({ state: 'released', reason: 'expired' })
    expect(await alerts()).toEqual([{ kind: 'payment_release_refused', open: false }])
    expect((await steps(open.id)).filter(([step]) => step === 'release')).toEqual([
      ['release', 'attempting', null, `${open.id}:release`],
      ['release', 'refused', 'not_supported', `${open.id}:release`],
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

  it('never asks again for a hold whose outcome was unknown: it finds it and releases it', async () => {
    // D127 3.15: the key is never sent again; the guest is offered "Try again" (#112).
    const { id } = await pay(0)
    engine.fault('createHold', { kind: 'land_then_timeout' })
    expect(await preparePayment(env(), target(id), deps())).toEqual({
      kind: 'at',
      state: 'released',
    })
    expect(await stored(id)).toMatchObject({ state: 'released', reason: 'hold_refused' })
    expect(engine.paymentsOf(providerRef(accountRef), id as never)).toEqual([
      expect.objectContaining({ status: 'released' }),
    ])
    expect(await steps(id)).toEqual([
      ['createHold', 'attempting', null, `${id}:hold`],
      ['createHold', 'unknown', 'unknown', `${id}:hold`],
      ['findByPaymentId', 'attempting', null, `${id}:find`],
      ['findByPaymentId', 'done', 'found', `${id}:find`],
      ['release', 'attempting', null, `${id}:release`],
      ['release', 'done', null, `${id}:release`],
    ])
    expect((await lines()).every((line) => !line.beingPaid)).toBe(true)
  })

  describe("the provider's breaker (D120's rule, per venue account)", () => {
    const seconds = (n: number) => {
      clock = new Date(clock.getTime() + n * 1_000)
    }
    const pausedAt = async (venueId: string) =>
      (
        await query<{ paused: boolean }>(
          'select paying_paused_at is not null as paused from restro.payment_accounts where venue_id = $1',
          [venueId],
        )
      )[0]?.paused

    it('pauses paying in the app after a minute of failed calls, never ordering, then lifts', async () => {
      const breakers = new PaymentBreakers(() => 0.5)
      // Another venue with its own account at the same provider.
      const other = await provisionVenue(pool, tenantId, { name: 'Other', slug: testSlug('other') })
      const otherAccount = engine.addAccount()
      engine.finishConnecting(otherAccount)
      await query(
        `insert into restro.payment_accounts
           (tenant_id, venue_id, provider_kind, account_ref, state, connected_at, source, actor, job_id)
         values ($1, $2, $3, $4, 'connected', now(), 'restro', 'system', 'test-seed')`,
        [tenantId, other.id, SIM_PAY_KIND, otherAccount.provider],
      )
      const pausesBefore = await query('select id from restro.pauses where venue_id = $1', [
        demo.venueId,
      ])
      try {
        const { id } = await pay(0)
        await preparePayment(env(), target(id), deps({ breakers }))
        // Every read fails part-way: the guest's checks fail for a minute, three times or more.
        engine.failReads()
        for (const gap of [0, 20, 20, 21]) {
          seconds(gap)
          await expect(checkPayment(env(), target(id), deps({ breakers }))).rejects.toThrow()
        }
        expect(await pausedAt(demo.venueId)).toBe(true)
        expect(await pausedAt(other.id)).toBe(false)
        const raised = await query<{ kind: string; permission: string }>(
          `select kind, permission from restro.alerts
            where kind = 'paying_paused' and subject_id = $1 and done_at is null`,
          [demo.venueId],
        )
        expect(raised).toEqual([{ kind: 'paying_paused', permission: 'money.follow_up' }])
        // A new Pay is refused; ordering is not paused.
        await expect(pay(1)).rejects.toThrow(/paying_paused/)
        expect(
          await query('select id from restro.pauses where venue_id = $1', [demo.venueId]),
        ).toEqual(pausesBefore)

        // Probes fail while the provider is down, then three good ones lift it.
        const ref = { tenantId, venueId: demo.venueId }
        const probeEnv = { pool, log, now: () => clock }
        for (let n = 0; n < 3; n += 1) {
          seconds(61)
          await breakers.probeIfDue(probeEnv, ref, provider, providerRef(accountRef))
        }
        expect(await pausedAt(demo.venueId)).toBe(true)
        engine.clearFaults()
        for (let n = 0; n < 12 && (await pausedAt(demo.venueId)) === true; n += 1) {
          seconds(16)
          await breakers.probeIfDue(probeEnv, ref, provider, providerRef(accountRef))
        }
        expect(await pausedAt(demo.venueId)).toBe(false)
        expect(
          await query(
            `select id from restro.alerts
              where kind = 'paying_paused' and subject_id = $1 and done_at is null`,
            [demo.venueId],
          ),
        ).toEqual([])
      } finally {
        engine.clearFaults()
        await query('update restro.payment_accounts set paying_paused_at = null, breaker = null')
      }
    })
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
