// What a provider's notice tells about a payment (#108), through `applyService` as the restro_app
// role on a real Postgres: the reading's absolute refund total and dispute are recorded, a repeat
// or an older reading of the same values changes nothing, a payment that is not the provider's,
// not captured or captured for another amount is refused, and only the worker may send it.
// Skipped without a database.
import { createHash, randomUUID } from 'node:crypto'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { hasDatabase } from '../apply/test-database'
import { newId } from '../ids'
import { openServiceWorld, type ServiceWorld } from '../testing/service-world'
import type { ServiceContext } from './context'
import { applyService } from './index'

type Listed = { ref: string; amountMinor: number; failed: boolean }

describe.skipIf(!hasDatabase)('recording a payment as the provider reads it back', () => {
  let world: ServiceWorld

  beforeAll(async () => {
    world = await openServiceWorld('payobserve')
  })
  afterAll(async () => {
    await world?.close()
  })

  const worker = (): ServiceContext => ({
    tenantId: world.tenantId,
    venueId: world.venueId,
    origin: 'worker',
    actor: { kind: 'system' },
    jobId: `jb-${randomUUID()}`,
    via: 'provider',
  })

  // A payment as the paying route will write it, seeded here: a paying table is written only by
  // core/service and its tests (write-targets.test.ts).
  const payment = async (capturedMinor: number | null = 2_000) => {
    const [table] = world.tables
    if (table === undefined) throw new Error('no table')
    const open = await world.owner.query(
      'select id, service_date::text as day from restro.sittings where table_id = $1 and ended_at is null',
      [table],
    )
    const sitting =
      (open.rows[0] as { id: string; day: string } | undefined) ??
      (
        await world.owner.query(
          'select id, service_date::text as day from restro.sittings where id = $1',
          [await world.openSitting(table)],
        )
      ).rows[0]
    const id = newId('py')
    const providerPaymentRef = `simpay_${randomUUID().replaceAll('-', '')}`
    const captured = capturedMinor !== null
    await world.owner.query(
      `insert into restro.payments
         (id, tenant_id, venue_id, table_id, sitting_id, service_date, kind, state, handle_hash,
          amount_minor, captured_minor, currency, provider_kind, provider_payment_ref, settled_at,
          source, actor, job_id)
       values ($1, $2, $3, $4, $5, $6, 'on_bill', $7, $8, 2000, $9, 'EUR', 'sim-pay', $10,
               case when $11::boolean then now() else null end, 'restro', 'system', 'test-seed')`,
      [
        id,
        world.tenantId,
        world.venueId,
        table,
        sitting.id,
        sitting.day,
        captured ? 'captured' : 'held',
        createHash('sha256').update(id).digest('hex'),
        capturedMinor,
        providerPaymentRef,
        captured,
      ],
    )
    return { id, providerPaymentRef }
  }
  const refund = (ref: string, amountMinor: number): Listed => ({ ref, amountMinor, failed: false })
  const observe = (
    target: { id: string; providerPaymentRef: string },
    reading: { refunds: readonly Listed[] | null; dispute: 'open' | 'won' | 'lost' | null },
    overrides: Record<string, unknown> = {},
  ) => ({
    type: 'payment.observe',
    paymentId: target.id,
    providerKind: 'sim-pay',
    providerPaymentRef: target.providerPaymentRef,
    capturedMinor: 2_000,
    ...reading,
    ...overrides,
  })
  const stored = async (id: string) =>
    (
      await world.owner.query(
        'select refunded_minor, dispute, source, actor from restro.payments where id = $1',
        [id],
      )
    ).rows[0] as { refunded_minor: string; dispute: string | null; source: string; actor: string }

  it('records the refunds and the dispute as read, and a repeat changes nothing', async () => {
    const target = await payment()
    const first = await applyService(
      world.app,
      observe(target, { refunds: [refund('re_1', 500)], dispute: null }),
      worker(),
    )
    expect(first.result).toMatchObject({
      status: 'accepted',
      details: { changed: true, refundedMinor: 500, dispute: null },
    })
    expect(await stored(target.id)).toEqual({
      refunded_minor: '500',
      dispute: null,
      source: 'worker',
      actor: 'system',
    })

    // A later reading carries all of them, never the step: 500 + 700 is read as 1 200.
    const both = [refund('re_1', 500), refund('re_2', 700)]
    const later = observe(target, { refunds: both, dispute: 'open' })
    expect((await applyService(world.app, later, worker())).result).toMatchObject({
      status: 'accepted',
      details: { changed: true, refundedMinor: 1_200, dispute: 'open' },
    })
    expect((await applyService(world.app, later, worker())).result).toMatchObject({
      status: 'accepted',
      details: { changed: false },
    })
    expect(await stored(target.id)).toMatchObject({ refunded_minor: '1200', dispute: 'open' })

    const closed = observe(target, { refunds: null, dispute: 'lost' })
    await applyService(world.app, closed, worker())
    expect(await stored(target.id)).toMatchObject({ refunded_minor: '1200', dispute: 'lost' })
  })

  it("refuses a payment that is missing, another provider's, not captured or captured otherwise", async () => {
    const target = await payment()
    const reading = { refunds: [refund('re_1', 100)], dispute: null }
    const missing = observe({ ...target, id: newId('py') }, reading)
    expect((await applyService(world.app, missing, worker())).result).toMatchObject({
      status: 'refused',
      code: 'payment_missing',
    })
    for (const [overrides, reason] of [
      [{ providerPaymentRef: 'simpay_other' }, 'another_provider_payment'],
      [{ providerKind: 'other-pay' }, 'another_provider_payment'],
      [{ capturedMinor: 1_999 }, 'captured_amount'],
      [{ refunds: [refund('re_1', 2_000), refund('re_2', 1)] }, 'captured_amount'],
    ] as const) {
      const { result } = await applyService(
        world.app,
        observe(target, reading, overrides),
        worker(),
      )
      expect(result, JSON.stringify(overrides)).toMatchObject({
        status: 'refused',
        code: 'payment_mismatch',
        details: { reason },
      })
    }
    const held = await payment(null)
    expect((await applyService(world.app, observe(held, reading), worker())).result).toMatchObject({
      status: 'refused',
      code: 'payment_not_captured',
    })
    expect(await stored(target.id)).toMatchObject({ refunded_minor: '0', dispute: null })
    expect(await stored(held.id)).toMatchObject({ refunded_minor: '0', dispute: null })
  })

  it('takes the step from the worker only', async () => {
    const target = await payment()
    const command = observe(target, { refunds: [refund('re_1', 100)], dispute: null })
    const guest = await applyService(world.app, command, {
      ...worker(),
      origin: 'guest',
      actor: { kind: 'guest' },
      via: undefined,
    })
    expect(guest.result).toMatchObject({ status: 'refused', code: 'origin_not_allowed' })
    expect(await stored(target.id)).toMatchObject({ refunded_minor: '0' })
  })
})
