// The refund job (the 11-18 refund decision, 148) on Postgres, as the restro_app role, with a
// provider whose answers each test scripts: a refund row a person's tap wrote is sent once with its
// id as the idempotency key, recorded as sent with the provider's id, and only "confirmed" when the
// provider's list shows it (D72); a timeout is asked again with the same key and never twice made;
// a refusal marks the row failed; a refund outside Restro's own bounds is never sent; a venue whose
// route was switched off still gets the refund staff already confirmed; a provider with no line
// refund fails it with a word. Skipped without a database.
import { randomUUID } from 'node:crypto'

import {
  newId,
  type PaymentProvider,
  type PaymentWriteOutcome,
  type ProviderPayment,
  type ProviderRefund,
  providerRef,
  type RefundLineRequest,
} from '@restro/core'
import { createArea, createTable, provisionTenant, provisionVenue } from '@restro/core/apply'
import { createPool, type DbPool } from '@restro/db'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { runPaymentRefunds } from '../src/jobs/payment-refunds'
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
const ACCOUNT = 'acct_venue_refund'

describe.skipIf(!hasDatabase)('the refund job', () => {
  let db: TestDatabase
  let pool: DbPool
  let log: Awaited<ReturnType<typeof createLogger>>
  const tenantId = newId('tn')
  let venueId: string
  let tableId: string
  let sittingId: string
  let serviceDay: string

  /** What `refundLine` answers, in order; the last repeats. */
  let answers: PaymentWriteOutcome<ProviderRefund>[] = []
  const requests: RefundLineRequest[] = []
  /** The refunds the provider lists, by payment ref. */
  const listed = new Map<string, ProviderRefund[]>()
  let lineRefund = true

  const provider = (): PaymentProvider =>
    ({
      kind: KIND,
      capabilities: {
        holdDays: 7,
        partialCapture: true,
        wallets: [],
        refundNotices: false,
        lineRefund,
        minimumMinor: () => 50,
      },
      async readPayment(_account, paymentRef) {
        const row = payments.get(paymentRef.provider)
        return { complete: true, value: row as ProviderPayment }
      },
      async readRefunds(_account, paymentRef) {
        return { complete: true, value: listed.get(paymentRef.provider) ?? [] }
      },
      async refundLine(request: RefundLineRequest) {
        requests.push(request)
        const answer = answers[Math.min(requests.length - 1, answers.length - 1)]
        if (answer === undefined) throw new Error('no scripted answer')
        if (answer.kind === 'done') {
          listed.set(request.paymentRef.provider, [
            ...(listed.get(request.paymentRef.provider) ?? []),
            answer.result,
          ])
        }
        return answer
      },
    }) as unknown as PaymentProvider
  const payments = new Map<string, ProviderPayment>()

  const query = <Row extends object = Record<string, unknown>>(
    sql: string,
    values: unknown[] = [],
  ) =>
    withOwnerClient(db.ownerUrl, async (client) => (await client.query(sql, values)).rows as Row[])

  beforeAll(async () => {
    db = await createTestDatabase()
    pool = createPool(db.appUrl, { applicationName: 'restro-worker-refund-tests', max: 4 })
    await provisionTenant(pool, { tenantId, name: 'Refund club' })
    await query(
      `insert into restro.auth_organization (id, name, slug) values ($1, 'Refund club', $2)`,
      [tenantId, `refund-${newId('tn').slice(3, 11)}`],
    )
    const venue = await provisionVenue(pool, tenantId, { name: 'Club', slug: testSlug('refund') })
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
    log = await createLogger({ level: 'debug', pretty: false, destination: { write: () => {} } })
  })

  afterAll(async () => {
    await pool?.end()
    await db?.drop()
  })

  beforeEach(() => {
    requests.length = 0
    listed.clear()
    answers = []
    lineRefund = true
  })

  /** A captured payment of 22.00 with one paid line of 12.00, and a refund row of `amount` for it. */
  async function asked(
    amountMinor = 1_200,
  ): Promise<{ paymentId: string; refundId: string; ref: string }> {
    const paymentId = newId('py')
    const ref = `pay_${randomUUID().replaceAll('-', '')}`
    await query(
      `insert into restro.payments
         (id, tenant_id, venue_id, table_id, sitting_id, service_date, kind, state, handle_hash,
          amount_minor, captured_minor, currency, provider_kind, provider_payment_ref, settled_at,
          source, actor, job_id)
       values ($1, $2, $3, $4, $5, $6, 'on_bill', 'captured', encode(sha256(convert_to($1, 'UTF8')), 'hex'),
               2200, 2200, 'EUR', $7, $8, now(), 'restro', 'system', 'test-seed')`,
      [paymentId, tenantId, venueId, tableId, sittingId, serviceDay, KIND, ref],
    )
    await query(
      `insert into restro.payment_lines
         (tenant_id, venue_id, payment_id, position, quantity, pos_amount_minor, display_name,
          closed_minor, closed_quantity, open, source, actor, job_id)
       values ($1, $2, $3, 1, 2, 1200, 'Jägermeister', 1200, 2, false, 'restro', 'system', 'test-seed')`,
      [tenantId, venueId, paymentId],
    )
    const refundId = newId('rf')
    await query(
      `insert into restro.payment_refunds
         (id, tenant_id, venue_id, payment_id, origin, line_position, amount_minor, service_date,
          source, actor, job_id)
       values ($1, $2, $3, $4, 'line', 1, $5, $6, 'staff', 'user:waiter1', 'test-tap')`,
      [refundId, tenantId, venueId, paymentId, amountMinor, serviceDay],
    )
    payments.set(ref, {
      ref: providerRef(ref),
      paymentId: paymentId as ProviderPayment['paymentId'],
      status: 'captured',
      needsGuestAction: false,
      currency: 'EUR',
      amountMinor: 2_200,
      heldMinor: 0,
      capturedMinor: 2_200,
      refundedMinor: 0,
      dispute: null,
      disputeDueAt: null,
      captureBefore: null,
      threeDs: 'authenticated',
      authorisationCode: null,
    })
    return { paymentId, refundId, ref }
  }

  const rowOf = async (refundId: string) =>
    (
      await query<{
        provider_refund_ref: string | null
        failed_at: Date | null
        confirmed_at: Date | null
      }>(
        'select provider_refund_ref, failed_at, confirmed_at from restro.payment_refunds where id = $1',
        [refundId],
      )
    )[0]
  const run = () =>
    runPaymentRefunds(
      { pool, log, jobId: `refund-test-${randomUUID()}` },
      {
        providers: new Map([[KIND, provider()]]),
      },
    )
  const made = (
    refundId: string,
    ref = 're_1',
    amountMinor = 1_200,
  ): PaymentWriteOutcome<ProviderRefund> => ({
    kind: 'done',
    result: {
      ref: providerRef(ref),
      amountMinor,
      failed: false,
      restroRefundId: refundId as RefundLineRequest['refundId'],
    },
  })

  it('sends a refund once with its row id as the key, records it sent, and confirms it only when listed', async () => {
    const target = await asked()
    answers = [made(target.refundId)]
    const first = await run()
    expect(first).toMatchObject({ sent: 1, failed: 0, readBack: 1 })
    expect(requests).toHaveLength(1)
    expect(requests[0]).toMatchObject({
      refundId: target.refundId,
      idempotencyKey: target.refundId,
      amountMinor: 1_200,
      paymentRef: providerRef(target.ref),
    })
    const row = await rowOf(target.refundId)
    expect(row?.provider_refund_ref).toBe('re_1')
    expect(row?.confirmed_at).not.toBeNull()
    // Nothing is left to do: a second run asks nothing.
    expect(await run()).toMatchObject({ sent: 0, failed: 0, readBack: 0 })
    expect(requests).toHaveLength(1)
  })

  it('does not call a refund confirmed until the provider lists it', async () => {
    const target = await asked()
    answers = [made(target.refundId)]
    // The provider answers the call but its list does not show the refund yet.
    const original = listed.set.bind(listed)
    listed.set = () => listed
    await run()
    listed.set = original
    const row = await rowOf(target.refundId)
    expect(row?.provider_refund_ref).toBe('re_1')
    expect(row?.confirmed_at).toBeNull()
    // Next run only reads back: the call is not made again, and the list now shows it.
    listed.set(target.ref, [(made(target.refundId) as { result: ProviderRefund }).result])
    expect(await run()).toMatchObject({ sent: 0, readBack: 1 })
    expect(requests).toHaveLength(1)
    expect((await rowOf(target.refundId))?.confirmed_at).not.toBeNull()
  })

  it('asks again with the same key after a timeout, and the refund is made once', async () => {
    const target = await asked()
    answers = [{ kind: 'unknown', reason: 'timed out' }, made(target.refundId)]
    expect(await run()).toMatchObject({ sent: 0, waiting: 1 })
    expect((await rowOf(target.refundId))?.provider_refund_ref).toBeNull()
    expect(await run()).toMatchObject({ sent: 1 })
    expect(requests.map((request) => request.idempotencyKey)).toEqual([
      target.refundId,
      target.refundId,
    ])
    expect((await rowOf(target.refundId))?.provider_refund_ref).toBe('re_1')
  })

  it('marks a refused refund failed, and does not ask again', async () => {
    const target = await asked()
    answers = [
      {
        kind: 'refused',
        refusal: { code: 'amount_above_remaining', scope: 'payment', detail: null },
      },
    ]
    expect(await run()).toMatchObject({ sent: 0, failed: 1 })
    expect((await rowOf(target.refundId))?.failed_at).not.toBeNull()
    expect(await run()).toMatchObject({ sent: 0, failed: 0 })
    expect(requests).toHaveLength(1)
  })

  it('never sends a refund outside Restro’s own bounds', async () => {
    const target = await asked(1_300)
    answers = [made(target.refundId, 're_x', 1_300)]
    expect(await run()).toMatchObject({ sent: 0, failed: 1 })
    expect(requests).toHaveLength(0)
    expect((await rowOf(target.refundId))?.failed_at).not.toBeNull()
  })

  it('still sends a refund staff confirmed after the route was switched off', async () => {
    const target = await asked()
    answers = [made(target.refundId)]
    await query(
      `update restro.payment_accounts set refund_route_off_at = now(), refund_route_off_reason = 'night'
        where venue_id = $1`,
      [venueId],
    )
    expect(await run()).toMatchObject({ sent: 1 })
    await query(
      'update restro.payment_accounts set refund_route_off_at = null, refund_route_off_reason = null where venue_id = $1',
      [venueId],
    )
  })

  it('fails a refund with a word where the provider offers no line refund, and calls nothing', async () => {
    const target = await asked()
    lineRefund = false
    expect(await run()).toMatchObject({ failed: 1 })
    expect(requests).toHaveLength(0)
    expect((await rowOf(target.refundId))?.failed_at).not.toBeNull()
  })
})
