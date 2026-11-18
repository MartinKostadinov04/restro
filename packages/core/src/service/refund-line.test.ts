// Restro refunds a paid line staff mark "Not served" (the 11-18 refund decision, 148), on a real
// Postgres as the restro_app role: the refund row is written first, through applyService, with the
// staff's actor and a Log entry; the amount is what the POS closed the line for (per unit for part of
// a line, half-up); the bounds hold (a captured payment, a paid line, once per line, tonight, an
// owner's switch); the worker's answer and the provider's list make it "sent" and then "confirmed"
// and never a local success; a refund carrying Restro's stamp with no row of ours switches the
// route off; and the tripwire never blocks the refund just written. Skipped without a database.
import { createHash, randomUUID } from 'node:crypto'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { hasDatabase } from '../apply/test-database'
import { newId } from '../ids'
import { openServiceWorld, type ServiceWorld } from '../testing/service-world'
import type { ServiceActor, ServiceContext } from './context'
import { applyService, type ServiceCommand } from './index'
import { refundAmountMinor, refundBoundsProblem } from './refund-line'

describe('the amount of a refund (rule 8: integer minor units, half-up)', () => {
  it('is the whole line, or the POS amount per unit times the quantity not served', () => {
    expect(refundAmountMinor(1_200, '2.000000', undefined)).toBe(1_200)
    expect(refundAmountMinor(1_200, '2.000000', '1')).toBe(600)
    // 10.01 for two, one not served: 5.005 rounds half-up to 5.01, never a float.
    expect(refundAmountMinor(1_001, '2.000000', '1')).toBe(501)
    expect(refundAmountMinor(1_000, '3.000000', '1')).toBe(333)
    expect(refundAmountMinor(1_000, '2.000000', '3')).toBeNull()
    expect(refundAmountMinor(1_000, '2.000000', '0')).toBeNull()
  })
})

describe('the bounds, in one place', () => {
  const base = {
    payment: {
      state: 'captured',
      providerPaymentRef: 'pi_1' as string | null,
      capturedMinor: 2_000,
      refundedMinor: 0,
      serviceDate: '2026-11-18',
    },
    line: { closedMinor: 1_200, closedQuantity: '2.000000' } as {
      closedMinor: number | null
      closedQuantity: string | null
    },
    amountMinor: 1_200,
    unsentMinor: 0,
    serviceDate: '2026-11-18',
  }
  it('lets a captured payment, a paid line and at most its amount through', () => {
    expect(refundBoundsProblem(base)).toBeNull()
  })
  it('refuses each way out, by code', () => {
    const problem = (change: Partial<typeof base>) => refundBoundsProblem({ ...base, ...change })
    expect(problem({ payment: { ...base.payment, state: 'released' } })).toBe(
      'payment_not_captured',
    )
    expect(problem({ payment: { ...base.payment, providerPaymentRef: null } })).toBe(
      'payment_not_captured',
    )
    expect(problem({ serviceDate: '2026-11-19' })).toBe('refund_not_tonight')
    expect(problem({ line: { closedMinor: null, closedQuantity: null } })).toBe('line_not_paid')
    expect(problem({ amountMinor: 1_201 })).toBe('refund_above_line')
    expect(problem({ amountMinor: 0 })).toBe('refund_above_line')
    expect(
      problem({ payment: { ...base.payment, refundedMinor: 1_000 }, amountMinor: 1_200 }),
    ).toBe('refund_above_payment')
    expect(problem({ unsentMinor: 900 })).toBe('refund_above_payment')
  })
})

describe.skipIf(!hasDatabase)('"Not served" (as the restro_app role)', () => {
  let world: ServiceWorld
  let waiterId: string
  let readerId: string
  let ownerId: string

  beforeAll(async () => {
    world = await openServiceWorld('refund-line')
    waiterId = await world.addUser('member')
    await world.addStaff(['alerts.answer'], waiterId)
    readerId = await world.addUser('member')
    await world.addStaff(['log.view'], readerId)
    ownerId = await world.addUser('owner')
  })
  afterAll(async () => {
    await world?.close()
  })

  const user = (userId: string): ServiceActor => ({ kind: 'user', userId, sessionId: 'session-1' })
  const context = (actor: ServiceActor, origin: ServiceContext['origin'] = 'staff') =>
    ({
      tenantId: world.tenantId,
      venueId: world.venueId,
      origin,
      actor,
      jobId: `refund-line-${randomUUID()}`,
      via: origin === 'staff' ? 'tonight' : 'worker',
    }) as ServiceContext
  const run = async (command: unknown, ctx: ServiceContext) =>
    (await applyService(world.app, command as ServiceCommand, ctx)).result
  const tap = (paymentId: string, position = 1, quantity?: string, by = waiterId) =>
    run(
      {
        type: 'payment.refund_line',
        paymentId,
        position,
        ...(quantity === undefined ? {} : { quantity }),
      },
      context(user(by)),
    )
  const worker = () => context({ kind: 'system' }, 'worker')
  const refundIdOf = (result: unknown) =>
    (result as { details: { refundId: string } }).details.refundId

  async function sittingOf(table: string) {
    const open = await world.owner.query(
      'select id, service_date::text as day from restro.sittings where table_id = $1 and ended_at is null',
      [table],
    )
    const found =
      (open.rows[0] as { id: string; day: string } | undefined) ??
      (
        await world.owner.query(
          'select id, service_date::text as day from restro.sittings where id = $1',
          [await world.openSitting(table)],
        )
      ).rows[0]
    return { ...found, table }
  }

  /** A payment row; `capturedMinor` null leaves it uncaptured. */
  async function insertPayment(options: {
    table: number
    state?: string
    day?: string
    amountMinor: number
  }): Promise<{ id: string; ref: string }> {
    const s = await sittingOf(world.tables[options.table] as string)
    const id = newId('py')
    const ref = `simpay_${randomUUID().replaceAll('-', '')}`
    const state = options.state ?? 'captured'
    await world.owner.query(
      `insert into restro.payments
         (id, tenant_id, venue_id, table_id, sitting_id, service_date, kind, state, handle_hash,
          amount_minor, tip_minor, captured_minor, refunded_minor, currency, provider_kind,
          provider_payment_ref, receipt_number, fiscal_memory_number, settled_at, source, actor, job_id)
       values ($1, $2, $3, $4, $5, $6::date, 'on_bill', $7, $8, $9, 0, $10, 0, 'EUR', 'sim-pay', $11,
               'R-000777', 'FM-12345', now(), 'restro', 'system', 'test-seed')`,
      [
        id,
        world.tenantId,
        world.venueId,
        s.table,
        s.id,
        options.day ?? s.day,
        state,
        createHash('sha256').update(id).digest('hex'),
        options.amountMinor,
        state === 'captured' ? options.amountMinor : null,
        ref,
      ],
    )
    return { id, ref }
  }

  /**
   * A captured payment of 22.00 whose lines the POS closed: line 1 two Jägermeister for 12.00, line 2
   * one beer for 10.00; `lines` changes them.
   */
  async function paid(
    options: {
      table?: number
      state?: string
      day?: string
      lines?: readonly { closedMinor: number | null; quantity: string }[]
    } = {},
  ): Promise<{ id: string; ref: string }> {
    const lines = options.lines ?? [
      { closedMinor: 1_200, quantity: '2' },
      { closedMinor: 1_000, quantity: '1' },
    ]
    const total = lines.reduce((sum, line) => sum + (line.closedMinor ?? 0), 0)
    const made = await insertPayment({
      table: options.table ?? 0,
      amountMinor: Math.max(total, 100),
      ...(options.state === undefined ? {} : { state: options.state }),
      ...(options.day === undefined ? {} : { day: options.day }),
    })
    for (const [index, line] of lines.entries()) {
      await world.owner.query(
        `insert into restro.payment_lines
           (tenant_id, venue_id, payment_id, position, quantity, pos_amount_minor, display_name,
            closed_minor, closed_quantity, open, source, actor, job_id)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, false, 'restro', 'system', 'test-seed')`,
        [
          world.tenantId,
          world.venueId,
          made.id,
          index + 1,
          line.quantity,
          line.closedMinor ?? 100,
          index === 0 ? 'Jägermeister' : 'Beer',
          line.closedMinor,
          line.closedMinor === null ? null : line.quantity,
        ],
      )
    }
    return made
  }

  const rowsOf = async (paymentId: string) =>
    (
      await world.owner.query<{
        id: string
        origin: string
        line_position: number | null
        amount_minor: string
        provider_refund_ref: string | null
        failed_at: Date | null
        confirmed_at: Date | null
        actor: string
        source: string
      }>(
        `select id, origin, line_position, amount_minor, provider_refund_ref, failed_at, confirmed_at,
                actor, source
           from restro.payment_refunds where payment_id = $1 order by seen_at, id`,
        [paymentId],
      )
    ).rows
  const logOf = async (paymentId: string, kind: string) =>
    (
      await world.owner.query<{
        actor: string
        to_state: string | null
        details: Record<string, unknown>
      }>(
        'select actor, to_state, details from restro.log_entries where payment_id = $1 and kind = $2 order by seq',
        [paymentId, kind],
      )
    ).rows
  const alertsOf = async (kind: string, subject?: string) =>
    (
      await world.owner.query<{ id: string; done_at: Date | null; subject_id: string }>(
        subject === undefined
          ? 'select id, done_at, subject_id from restro.alerts where venue_id = $1 and kind = $2'
          : 'select id, done_at, subject_id from restro.alerts where venue_id = $1 and kind = $2 and subject_id = $3',
        subject === undefined ? [world.venueId, kind] : [world.venueId, kind, subject],
      )
    ).rows
  /** The venue's payment account, with Restro's refunds on or off. */
  const account = async (state: 'on' | 'off' = 'on') => {
    await world.owner.query('delete from restro.payment_accounts where venue_id = $1', [
      world.venueId,
    ])
    await world.owner.query(
      `insert into restro.payment_accounts
         (tenant_id, venue_id, provider_kind, account_ref, state, connected_at, source, actor, job_id,
          refund_route_off_at, refund_route_off_reason)
       values ($1, $2, 'sim-pay', 'simacct_refund435', 'connected', now(), 'restro', 'system', 'test-seed',
               $3::timestamptz, $4)`,
      [
        world.tenantId,
        world.venueId,
        state === 'off' ? new Date() : null,
        state === 'off' ? 'night' : null,
      ],
    )
  }
  const routeOff = async () =>
    (
      await world.owner.query<{ off: boolean; reason: string | null }>(
        'select refund_route_off_at is not null as off, refund_route_off_reason as reason from restro.payment_accounts where venue_id = $1',
        [world.venueId],
      )
    ).rows[0]

  /** A big night captured, so one small refund does not trip the wire. */
  async function bigNight(): Promise<void> {
    await insertPayment({ table: 3, amountMinor: 50_000_000 })
  }

  it('writes the refund row first, with the staff actor, one Log entry and the manager’s storno to-do', async () => {
    await account()
    await bigNight()
    const target = await paid()
    const result = await tap(target.id)
    expect(result).toMatchObject({
      status: 'accepted',
      details: { amountMinor: 1_200, paymentId: target.id },
    })
    const rows = await rowsOf(target.id)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      origin: 'line',
      line_position: 1,
      amount_minor: '1200',
      provider_refund_ref: null,
      failed_at: null,
      confirmed_at: null,
      actor: `user:${waiterId}`,
      source: 'staff',
    })
    // Every refund is in the Log with its actor (rule 2).
    expect(await logOf(target.id, 'payment.refund_requested')).toMatchObject([
      {
        actor: `user:${waiterId}`,
        to_state: 'requested',
        details: { amountMinor: 1_200, line: 1 },
      },
    ])
    // The existing storno to-do: an alert for the group, and the row Tonight reads it from.
    expect(await alertsOf('payment_refunded', target.id)).toHaveLength(1)
  })

  it('refunds part of a line per unit, half-up, and only once per line', async () => {
    await account()
    await bigNight()
    const target = await paid({ lines: [{ closedMinor: 1_001, quantity: '2' }] })
    expect(await tap(target.id, 1, '1')).toMatchObject({
      status: 'accepted',
      details: { amountMinor: 501 },
    })
    expect(await tap(target.id, 1, '1')).toMatchObject({
      status: 'refused',
      code: 'refund_already',
    })
  })

  it('refuses each way out of the bounds, and writes nothing', async () => {
    await account()
    await bigNight()
    const target = await paid({
      lines: [
        { closedMinor: 1_000, quantity: '1' },
        { closedMinor: null, quantity: '1' },
      ],
    })
    // a line the POS dropped was never paid
    expect(await tap(target.id, 2)).toMatchObject({ status: 'refused', code: 'line_not_paid' })
    expect(await tap(target.id, 9)).toMatchObject({ status: 'refused', code: 'line_missing' })
    expect(await tap(target.id, 1, '2')).toMatchObject({
      status: 'refused',
      code: 'refund_above_line',
    })
    // a payment not captured, or captured on another night
    const held = await paid({ state: 'released' })
    expect(await tap(held.id)).toMatchObject({ status: 'refused', code: 'payment_not_captured' })
    const old = await paid({ day: '2020-01-01' })
    expect(await tap(old.id)).toMatchObject({ status: 'refused', code: 'refund_not_tonight' })
    expect(await rowsOf(target.id)).toHaveLength(0)
    expect(await rowsOf(held.id)).toHaveLength(0)
    expect(await rowsOf(old.id)).toHaveLength(0)
  })

  it('is refused to a person without the right', async () => {
    await account()
    const target = await paid()
    expect(await tap(target.id, 1, undefined, readerId)).toMatchObject({
      status: 'refused',
      code: 'permission_denied',
    })
    expect(await rowsOf(target.id)).toHaveLength(0)
  })

  it('records the provider’s answer: sent with its id, then confirmed only when the list shows it (D72)', async () => {
    await account()
    await bigNight()
    const target = await paid()
    const refundId = refundIdOf(await tap(target.id))
    const sent = await run(
      { type: 'payment.refund_sent', refundId, outcome: 'sent', providerRefundRef: 're_line_1' },
      worker(),
    )
    expect(sent).toMatchObject({ status: 'accepted', details: { changed: true } })
    // a repeat changes nothing
    expect(
      await run(
        { type: 'payment.refund_sent', refundId, outcome: 'sent', providerRefundRef: 're_line_1' },
        worker(),
      ),
    ).toMatchObject({ details: { changed: false } })
    expect((await rowsOf(target.id))[0]).toMatchObject({
      provider_refund_ref: 're_line_1',
      confirmed_at: null,
    })
    // Sent is not refunded: nothing says "refunded" until the provider's list does.
    const observe = () => ({
      type: 'payment.observe',
      paymentId: target.id,
      providerKind: 'sim-pay',
      providerPaymentRef: target.ref,
      capturedMinor: 2_200,
      refunds: [{ ref: 're_line_1', amountMinor: 1_200, failed: false, restroRefundId: refundId }],
      dispute: null,
      disputeDueAt: null,
    })
    expect(await run(observe(), worker())).toMatchObject({
      status: 'accepted',
      details: { refundsConfirmed: 1, refundsStray: 0 },
    })
    const rows = await rowsOf(target.id)
    expect(rows).toHaveLength(1)
    expect(rows[0]?.confirmed_at).not.toBeNull()
    expect((await logOf(target.id, 'payment.refund_sent')).map((entry) => entry.to_state)).toEqual([
      'sent',
      'confirmed',
    ])
    // the same reading again changes nothing
    expect(await run(observe(), worker())).toMatchObject({ details: { changed: false } })
  })

  it('names a row by its stamp when the answer of the call was lost, and makes no second row', async () => {
    await account()
    await bigNight()
    const target = await paid()
    const refundId = refundIdOf(await tap(target.id))
    const read = await run(
      {
        type: 'payment.observe',
        paymentId: target.id,
        providerKind: 'sim-pay',
        providerPaymentRef: target.ref,
        capturedMinor: 2_200,
        refunds: [
          { ref: 're_lost_1', amountMinor: 1_200, failed: false, restroRefundId: refundId },
        ],
        dispute: null,
        disputeDueAt: null,
      },
      worker(),
    )
    expect(read).toMatchObject({ status: 'accepted', details: { refundsStray: 0 } })
    const rows = await rowsOf(target.id)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ provider_refund_ref: 're_lost_1' })
    expect(rows[0]?.confirmed_at).not.toBeNull()
    expect((await routeOff())?.off).toBe(false)
  })

  it('a refund that did not go through closes its to-do, and the line can be asked again', async () => {
    await account()
    await bigNight()
    const target = await paid()
    const refundId = refundIdOf(await tap(target.id))
    expect(
      await run(
        {
          type: 'payment.refund_sent',
          refundId,
          outcome: 'failed',
          code: 'amount_above_remaining',
        },
        worker(),
      ),
    ).toMatchObject({ status: 'accepted', details: { changed: true } })
    expect((await rowsOf(target.id))[0]?.failed_at).not.toBeNull()
    const open = (await alertsOf('payment_refunded', target.id)).filter((a) => a.done_at === null)
    expect(open).toHaveLength(0)
    // A failed row is not "a refund of the line": the person may ask again.
    expect(await tap(target.id)).toMatchObject({ status: 'accepted' })
    expect((await rowsOf(target.id)).filter((row) => row.failed_at === null)).toHaveLength(1)
  })

  it('switches the route off past the night’s figures without blocking the refund just written', async () => {
    await account()
    // This payment is the only thing the night captured: 12.00 of it is past 5 %.
    const target = await paid({ table: 2 })
    await world.owner.query(
      "update restro.payments set state = 'released', captured_minor = null, refunded_minor = 0 where venue_id = $1 and id <> $2 and state = 'captured'",
      [world.venueId, target.id],
    )
    expect(await tap(target.id)).toMatchObject({ status: 'accepted' })
    expect((await routeOff())?.off).toBe(true)
    expect(await alertsOf('payment_refund_route_off')).not.toHaveLength(0)
    // New refunds are stopped from inside Restro …
    const next = await paid({ table: 1 })
    expect(await tap(next.id)).toMatchObject({ status: 'refused', code: 'refund_route_off' })
    // … and the one written before is still there, to be sent.
    expect(await rowsOf(target.id)).toHaveLength(1)
  })

  it('an owner switches the route back on, and nobody else can', async () => {
    await account('off')
    const target = await paid()
    expect(await tap(target.id)).toMatchObject({ status: 'refused', code: 'refund_route_off' })
    expect(
      await run({ type: 'payment_account.refund_route_on' }, context(user(waiterId))),
    ).toMatchObject({ status: 'refused', code: 'permission_denied' })
    expect(
      await run({ type: 'payment_account.refund_route_on' }, context(user(ownerId))),
    ).toMatchObject({ status: 'accepted', details: { changed: true } })
    expect((await routeOff())?.off).toBe(false)
    await bigNight()
    expect(await tap(target.id)).toMatchObject({ status: 'accepted' })
  })

  it('a refund with our stamp and no row of ours switches the route off and tells the owners', async () => {
    await account()
    await world.owner.query(
      "delete from restro.alerts where venue_id = $1 and kind like 'payment_refund_%'",
      [world.venueId],
    )
    await bigNight()
    const target = await paid()
    const read = await run(
      {
        type: 'payment.observe',
        paymentId: target.id,
        providerKind: 'sim-pay',
        providerPaymentRef: target.ref,
        capturedMinor: 2_200,
        refunds: [
          { ref: 're_stray', amountMinor: 700, failed: false, restroRefundId: newId('rf') },
        ],
        dispute: null,
        disputeDueAt: null,
      },
      worker(),
    )
    expect(read).toMatchObject({ status: 'accepted', details: { refundsStray: 1 } })
    expect(await routeOff()).toMatchObject({ off: true, reason: 'stray' })
    expect(await alertsOf('payment_refund_route_off', target.id)).toHaveLength(1)
    expect(await alertsOf('payment_refund_alarm', target.id)).toHaveLength(1)
    // The refund was real money: it has its row and its storno to-do like the venue's own.
    expect(await rowsOf(target.id)).toHaveLength(1)
  })

  it('raises the alarm once, at three refunds past 1 % and short of the switch-off', async () => {
    await account()
    await world.owner.query(
      "delete from restro.alerts where venue_id = $1 and kind like 'payment_refund_%'",
      [world.venueId],
    )
    // The night starts clean: earlier tests' refunds are not this night's.
    await world.owner.query('delete from restro.payment_refunds where venue_id = $1', [
      world.venueId,
    ])
    // Nothing else captured tonight but 1,000.00 and the three payments of 10.00 below (about 3 %).
    await world.owner.query(
      "update restro.payments set state = 'released', captured_minor = null, refunded_minor = 0 where venue_id = $1 and state = 'captured'",
      [world.venueId],
    )
    await insertPayment({ table: 3, amountMinor: 100_000 })
    const before = (await alertsOf('payment_refund_alarm')).length
    for (const table of [0, 1, 2]) {
      const target = await paid({ table, lines: [{ closedMinor: 1_000, quantity: '1' }] })
      const answer = await tap(target.id)
      expect(answer, JSON.stringify(answer)).toMatchObject({ status: 'accepted' })
    }
    expect((await alertsOf('payment_refund_alarm')).length).toBe(before + 1)
    expect((await routeOff())?.off).toBe(false)
  })
})
