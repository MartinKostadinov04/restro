// The provider notices job (#108) on Postgres, as the restro_app role, with a provider that reads
// back what each test sets: a refund and a dispute are recorded as the reading's absolute values,
// a duplicate or an older notice read late changes nothing, a kind with no handler and a notice
// for no account of ours are marked handled, an incomplete reading and a payment not captured yet
// leave the notice for the next run, and a provider this worker does not have is not read at all.
// Notices that keep waiting never hide newer ones: a run pages past them, and goes on next time
// from where its cap stopped it.
import { randomUUID } from 'node:crypto'

import {
  newId,
  type PaymentProvider,
  type ProviderNotice,
  type ProviderPayment,
  providerRef,
} from '@restro/core'
import { createArea, createTable, provisionTenant, provisionVenue } from '@restro/core/apply'
import { recordProviderNotice } from '@restro/core/service/notices'
import { createPool, type DbPool } from '@restro/db'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  handleProviderNotices,
  type NoticeProviders,
  newNoticeRunState,
  type ProviderNoticesDeps,
} from '../src/jobs/provider-notices'
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

const KIND = 'test-pay'
const ACCOUNT = 'acct_venue_1'

describe.skipIf(!hasDatabase)('the provider notices job', () => {
  let db: TestDatabase
  let pool: DbPool
  let log: Awaited<ReturnType<typeof createLogger>>
  const logLines: string[] = []
  const tenantId = newId('tn')
  let venueId: string
  let tableId: string
  let sittingId: string
  let serviceDay: string
  let clock = new Date()

  /** What the provider reads back, by object ref; `incomplete` for a failed read. */
  const readings = new Map<string, ProviderPayment | null | 'incomplete'>()
  const asked: { account: string; notice: ProviderNotice }[] = []
  const provider: Pick<PaymentProvider, 'readNoticeSubject'> = {
    async readNoticeSubject(accountRef, notice) {
      asked.push({ account: accountRef.provider, notice })
      const value = notice.objectRef === null ? null : readings.get(notice.objectRef.provider)
      if (value === 'incomplete') return { complete: false, reason: 'the provider timed out' }
      return { complete: true, value: value ?? null }
    },
  }
  const providers: NoticeProviders = new Map([[KIND, provider]])

  const query = <Row extends object = Record<string, unknown>>(
    sql: string,
    values: unknown[] = [],
  ) =>
    withOwnerClient(db.ownerUrl, async (client) => (await client.query(sql, values)).rows as Row[])

  beforeAll(async () => {
    db = await createTestDatabase()
    pool = createPool(db.appUrl, { applicationName: 'restro-worker-notice-tests', max: 4 })
    await provisionTenant(pool, { tenantId, name: 'Notice club' })
    await query(
      `insert into restro.auth_organization (id, name, slug) values ($1, 'Notice club', $2)`,
      [tenantId, `notice-${newId('tn').slice(3, 11)}`],
    )
    const venue = await provisionVenue(pool, tenantId, { name: 'Club', slug: testSlug('notice') })
    venueId = venue.id
    const area = await createArea(pool, tenantId, venueId, 'Hall')
    if (!area.ok) throw new Error('no area')
    const table = await createTable(pool, tenantId, {
      areaId: area.area.id,
      name: null,
      number: '1',
    })
    if (!table.ok) throw new Error('no table')
    tableId = table.table.id
    sittingId = newId('st')
    const [day] = await query<{ day: string }>(
      `insert into restro.sittings (id, tenant_id, venue_id, table_id, service_date, opened_how, source, actor, job_id)
       values ($1, $2, $3, $4, current_date, 'one', 'restro', 'system', 'test-seed')
       returning service_date::text as day`,
      [sittingId, tenantId, venueId, tableId],
    )
    serviceDay = day?.day ?? ''
    await query(
      `insert into restro.payment_accounts
         (tenant_id, venue_id, provider_kind, account_ref, state, source, actor, job_id)
       values ($1, $2, $3, $4, 'connected', 'restro', 'system', 'test-seed')`,
      [tenantId, venueId, KIND, ACCOUNT],
    )
    log = await createLogger({
      level: 'debug',
      pretty: false,
      destination: { write: (line: string) => void logLines.push(line) },
    })
  })

  afterAll(async () => {
    await pool?.end()
    await db?.drop()
  })

  /** A payment of ours, captured for 2 000 (or only held), as the paying route will write it. */
  async function payment(captured = true): Promise<{ id: string; ref: string }> {
    const id = newId('py')
    const ref = `pay_${randomUUID().replaceAll('-', '')}`
    await query(
      `insert into restro.payments
         (id, tenant_id, venue_id, table_id, sitting_id, service_date, kind, state, handle_hash,
          amount_minor, captured_minor, currency, provider_kind, provider_payment_ref, settled_at,
          source, actor, job_id)
       values ($1, $2, $3, $4, $5, $6, 'on_bill', $7, encode(sha256(convert_to($1, 'UTF8')), 'hex'),
               2000, $8, 'EUR', $9, $10, case when $11::boolean then now() else null end,
               'restro', 'system', 'test-seed')`,
      [
        id,
        tenantId,
        venueId,
        tableId,
        sittingId,
        serviceDay,
        captured ? 'captured' : 'held',
        captured ? 2_000 : null,
        KIND,
        ref,
        captured,
      ],
    )
    return { id, ref }
  }

  const reading = (
    target: { id: string; ref: string },
    refundedMinor: number,
    dispute: ProviderPayment['dispute'] = null,
  ): ProviderPayment => ({
    ref: providerRef(target.ref),
    paymentId: target.id as ProviderPayment['paymentId'],
    status: 'captured',
    needsGuestAction: false,
    currency: 'EUR',
    amountMinor: 2_000,
    heldMinor: 0,
    capturedMinor: 2_000,
    refundedMinor,
    dispute,
    disputeDueAt: dispute === null ? null : '2026-11-05T09:00:00.000Z',
    captureBefore: null,
    threeDs: 'authenticated',
    authorisationCode: null,
  })

  /** Stores a notice as the route does; returns its event id. */
  async function notice(
    kind: 'refund' | 'dispute' | 'payment' | 'other',
    objectRef: string,
    options: { account?: string | null; providerKind?: string } = {},
  ): Promise<string> {
    const id = `evt_${randomUUID().replaceAll('-', '')}`
    const account = options.account === undefined ? ACCOUNT : options.account
    await recordProviderNotice(pool, {
      providerKind: options.providerKind ?? KIND,
      live: false,
      notice: {
        id,
        type: `${kind}.event`,
        kind,
        accountRef: account === null ? null : providerRef(account),
        objectRef: providerRef(objectRef),
      },
      jobId: `rq-${randomUUID()}`,
    })
    return id
  }

  const run = (state = newNoticeRunState(), limits: ProviderNoticesDeps['limits'] = undefined) =>
    handleProviderNotices(
      { pool, log, now: () => clock, jobId: 'jb-test' },
      limits === undefined ? { providers } : { providers, limits },
      state,
    )
  const handled = async (eventId: string) =>
    (
      await query<{ handled: boolean }>(
        'select handled_at is not null as handled from restro.provider_notices where event_id = $1',
        [eventId],
      )
    )[0]?.handled
  const stored = async (id: string) =>
    (
      await query<{ refunded_minor: string; dispute: string | null; source: string }>(
        'select refunded_minor, dispute, source from restro.payments where id = $1',
        [id],
      )
    )[0]

  it('records a refund as the reading says, and a duplicate or an older notice changes nothing', async () => {
    const target = await payment()
    readings.set('re_1', reading(target, 500))
    const first = await notice('refund', 're_1')
    expect(await run()).toMatchObject({ recorded: 1, waiting: 0 })
    expect(await handled(first)).toBe(true)
    expect(await stored(target.id)).toEqual({
      refunded_minor: '500',
      dispute: null,
      source: 'worker',
    })
    expect(asked.at(-1)?.account).toBe(ACCOUNT)

    // A second refund: both notices read the payment as it stands, the total.
    readings.set('re_1', reading(target, 1_200))
    readings.set('re_2', reading(target, 1_200))
    const second = await notice('refund', 're_2')
    const late = await notice('refund', 're_1')
    expect(await run()).toMatchObject({ recorded: 1, unchanged: 1 })
    expect([await handled(second), await handled(late)]).toEqual([true, true])
    expect(await stored(target.id)).toMatchObject({ refunded_minor: '1200' })
    // Nothing is handled twice.
    expect(await run()).toMatchObject({ recorded: 0, unchanged: 0 })
  })

  it('marks the refund whose amount the total fell by, and warns, marking none, when no row has it (#222)', async () => {
    const target = await payment()
    const rows = () =>
      query<{ amount_minor: string; failed: boolean }>(
        `select amount_minor, failed_at is not null as failed from restro.payment_refunds
          where payment_id = $1 order by seen_at, id`,
        [target.id],
      )
    readings.set('rf_a', reading(target, 500))
    await notice('refund', 'rf_a')
    await run()
    readings.set('rf_b', reading(target, 800))
    await notice('refund', 'rf_b')
    await run()
    // The first refund fails: the total falls by its 500, and only that row is marked.
    readings.set('rf_c', reading(target, 300))
    await notice('refund', 'rf_c')
    expect(await run()).toMatchObject({ recorded: 1 })
    expect(await rows()).toEqual([
      { amount_minor: '500', failed: true },
      { amount_minor: '300', failed: false },
    ])
    // A fall by an amount no row has marks nothing and makes no row; the worker warns.
    logLines.length = 0
    readings.set('rf_d', reading(target, 100))
    await notice('refund', 'rf_d')
    expect(await run()).toMatchObject({ recorded: 1 })
    expect((await rows()).map((row) => row.failed)).toEqual([true, false])
    expect(logLines.join('')).toContain('no refund row matches')
  })

  it("queues a guest payment's check for a payment notice, and leaves it waiting without a queue", async () => {
    const target = await payment(false)
    readings.set('pi_1', {
      ...reading(target, 0),
      status: 'held',
      heldMinor: 2_000,
      capturedMinor: 0,
    })
    const waiting = await notice('payment', 'pi_1')
    expect(await run()).toMatchObject({ waiting: 1, queued: 0 })
    expect(await handled(waiting)).toBe(false)

    const sent: { name: string; data: object; options?: object }[] = []
    const counts = await handleProviderNotices(
      {
        pool,
        log,
        now: () => clock,
        jobId: 'jb-test',
        queue: {
          async send(name, data, options) {
            sent.push({ name, data, ...(options === undefined ? {} : { options }) })
            return 'job-1'
          },
        },
      },
      { providers },
    )
    expect(counts).toMatchObject({ queued: 1 })
    expect(await handled(waiting)).toBe(true)
    // The check reads the provider again itself: the notice's own reading records nothing.
    expect(sent).toEqual([
      {
        name: 'payment-check',
        data: { tenantId, venueId, paymentId: target.id },
        options: { singletonKey: target.id, group: { id: target.id } },
      },
    ])
  })

  it('records a dispute opened and then lost', async () => {
    const target = await payment()
    readings.set('dp_1', reading(target, 0, 'open'))
    await notice('dispute', 'dp_1')
    await run()
    expect(await stored(target.id)).toMatchObject({ dispute: 'open' })
    // The provider's answer-by date and the opening time are kept (#222).
    const [times] = await query<{ opened: Date | null; due: Date | null; closed: Date | null }>(
      `select dispute_opened_at as opened, dispute_due_at as due, dispute_closed_at as closed
         from restro.payments where id = $1`,
      [target.id],
    )
    expect(times?.opened).toBeInstanceOf(Date)
    expect(times?.due?.toISOString()).toBe('2026-11-05T09:00:00.000Z')
    expect(times?.closed).toBeNull()
    readings.set('dp_1', reading(target, 0, 'lost'))
    await notice('dispute', 'dp_1')
    await run()
    expect(await stored(target.id)).toMatchObject({ dispute: 'lost', refunded_minor: '0' })
  })

  it('marks handled a kind with no handler, a notice for no account of ours, and one about none of our payments', async () => {
    const before = asked.length
    const other = await notice('other', 'ch_9')
    const stranger = await notice('refund', 're_9', { account: 'acct_someone_else' })
    const noAccount = await notice('refund', 're_9', { account: null })
    readings.set('re_10', null)
    const notOurs = await notice('refund', 're_10')
    expect(await run()).toMatchObject({ no_handler: 1, unknown_account: 2, not_ours: 1 })
    for (const id of [other, stranger, noAccount, notOurs]) expect(await handled(id)).toBe(true)
    // Only the one for our account was read back.
    expect(asked.length - before).toBe(1)
  })

  it('leaves for the next run an incomplete reading and a payment not captured yet, and does not read an unknown provider', async () => {
    const target = await payment()
    readings.set('re_20', 'incomplete')
    const incomplete = await notice('refund', 're_20')
    const elsewhere = await notice('refund', 're_21', { providerKind: 'later-pay' })
    const held = await payment(false)
    readings.set('re_22', reading(held, 0))
    const early = await notice('refund', 're_22')
    const state = newNoticeRunState()
    expect(await run(state)).toMatchObject({ waiting: 2, late: 0 })
    for (const id of [incomplete, elsewhere, early]) expect(await handled(id)).toBe(false)

    // A day later they are logged as late, each once a day; once the reading succeeds, the
    // notice is handled.
    clock = new Date(Date.now() + 25 * 60 * 60 * 1000)
    readings.set('re_20', reading(target, 300))
    const lateLines = () =>
      logLines.filter((line) => line.includes('still not handled after a day'))
    expect(await run(state)).toMatchObject({ recorded: 1, waiting: 1, late: 1 })
    expect(await handled(incomplete)).toBe(true)
    expect(lateLines()).toHaveLength(1)
    expect(await run(state)).toMatchObject({ waiting: 1, late: 1 })
    expect(lateLines()).toHaveLength(1)
    clock = new Date(clock.getTime() + 25 * 60 * 60 * 1000)
    await run(state)
    expect(lateLines()).toHaveLength(2)
    clock = new Date()
    await query('update restro.provider_notices set handled_at = now() where event_id = any($1)', [
      [elsewhere, early],
    ])
  })

  it('marks handled a reading that does not match our payment, and logs the reason only', async () => {
    const target = await payment()
    readings.set('re_30', { ...reading(target, 0), capturedMinor: 1_999, refundedMinor: 100 })
    const mismatch = await notice('refund', 're_30')
    expect(await run()).toMatchObject({ refused: 1 })
    expect(await handled(mismatch)).toBe(true)
    expect(await stored(target.id)).toMatchObject({ refunded_minor: '0' })
    const line = logLines.find((entry) => entry.includes('payment_mismatch'))
    expect(line).toContain('captured_amount')
    expect(line).not.toContain(target.ref)
  })

  it('refuses a reading that shows more refunded than was captured (RR-40)', async () => {
    const target = await payment()
    const captured = reading(target, 0).capturedMinor ?? 0
    readings.set('re_31', { ...reading(target, 0), refundedMinor: captured + 500 })
    const mismatch = await notice('refund', 're_31')
    expect(await run()).toMatchObject({ refused: 1 })
    expect(await handled(mismatch)).toBe(true)
    expect(await stored(target.id)).toMatchObject({ refunded_minor: '0' })
  })

  it('refuses a reading of another provider payment under our payment’s id (RR-40)', async () => {
    const target = await payment()
    readings.set('re_32', { ...reading(target, 500), ref: providerRef('pi_another') })
    const mismatch = await notice('refund', 're_32')
    expect(await run()).toMatchObject({ refused: 1 })
    expect(await handled(mismatch)).toBe(true)
    expect(await stored(target.id)).toMatchObject({ refunded_minor: '0' })
    expect(logLines.some((entry) => entry.includes('another_provider_payment'))).toBe(true)
  })

  /** Stores `count` refund notices whose reading stays incomplete; returns their event ids. */
  async function waitingNotices(count: number): Promise<string[]> {
    readings.set('re_wait', 'incomplete')
    const ids: string[] = []
    for (let i = 0; i < count; i += 1) ids.push(await notice('refund', 're_wait'))
    return ids
  }
  const handleAll = (ids: string[]) =>
    query('update restro.provider_notices set handled_at = now() where event_id = any($1)', [ids])

  it('records a newer notice in the same run behind more than a page of notices that wait', async () => {
    const waiting = await waitingNotices(120)
    const target = await payment()
    readings.set('re_40', reading(target, 700))
    const newer = await notice('refund', 're_40')
    expect(await run()).toMatchObject({ recorded: 1, waiting: 120 })
    expect(await handled(newer)).toBe(true)
    expect(await stored(target.id)).toMatchObject({ refunded_minor: '700' })
    await handleAll(waiting)
  })

  it('goes on from where its cap stopped it, and round to the start', async () => {
    const limits = { page: 2, perRun: 3 }
    const state = newNoticeRunState()
    const waiting = await waitingNotices(5)
    const target = await payment()
    readings.set('re_50', reading(target, 900))
    const newer = await notice('refund', 're_50')
    // Run 1 looks at three that wait; run 2 the other two and the newer one.
    expect(await run(state, limits)).toMatchObject({ waiting: 3, recorded: 0 })
    expect(await run(state, limits)).toMatchObject({ waiting: 2, recorded: 1 })
    expect(await handled(newer)).toBe(true)
    // Run 3 goes round to the start: the first three again, within its cap.
    expect(await run(state, limits)).toMatchObject({ waiting: 3, recorded: 0 })
    expect(state.resumeAfter).toBeGreaterThan(0)
    await handleAll(waiting)
  })
})
