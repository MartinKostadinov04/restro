// Pay-first items (#113) on a real Postgres, as the restro_app role: a Send splits into its
// on-the-bill round and a `pay_first` payment with its own waiting sent order, the pay-first lines
// held on the order; it is offered only where the POS opens a bill that names itself and paying
// is on; a payment that ends before the POS frees its lines; once the round is entered nothing
// releases it on its own (a lower POS total is captured, a higher one or an unknown entry is
// `unconfirmed` for a manager, whose answer settles the round's sent order). Skipped without a
// database.
import { createHash, randomUUID } from 'node:crypto'

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { hasDatabase } from '../apply/test-database'
import { newId } from '../ids'
import { DEFAULT_ORDERING_SETTINGS } from '../ordering-settings'
import { hashTableCode } from '../qr'
import { openServiceWorld, type ServiceWorld } from '../testing/service-world'
import { applyService } from './apply-service'
import type { ServiceContext } from './context'
import { DEFAULT_ROLE_PERMISSIONS } from './permissions'
import type { SendMenu } from './send-menu'

describe.skipIf(!hasDatabase)('pay-first items (as the restro_app role)', () => {
  let world: ServiceWorld
  let tableId: string
  let paymentTableId: string
  let sittingId: string
  let codeHash: string
  let managerId: string
  const beer = newId('nd')
  const gin = newId('nd')

  const menu: SendMenu = {
    currency: 'EUR',
    items: new Map([
      [
        beer,
        { priceMinor: 450, orderable: true, soldOut: false, name: 'Beer', options: new Map() },
      ],
      [
        gin,
        {
          priceMinor: 700,
          orderable: true,
          soldOut: false,
          name: 'Gin tonic',
          options: new Map(),
          paymentMode: 'pay_first',
        },
      ],
    ]),
  }

  const guest = (): ServiceContext => ({
    tenantId: world.tenantId,
    venueId: world.venueId,
    origin: 'guest',
    actor: { kind: 'guest' },
    jobId: `guest-${randomUUID()}`,
    tableCodeHash: codeHash,
    sittingId,
    consentVersion: 'v1',
  })
  const worker = (): ServiceContext => ({
    tenantId: world.tenantId,
    venueId: world.venueId,
    origin: 'worker',
    actor: { kind: 'system' },
    jobId: `pay-first-worker-${randomUUID()}`,
  })
  const manager = (): ServiceContext => ({
    tenantId: world.tenantId,
    venueId: world.venueId,
    origin: 'staff',
    actor: { kind: 'user', userId: managerId, sessionId: 'session-1' },
    jobId: `pay-first-staff-${randomUUID()}`,
    via: 'tonight',
  })
  const step = async (command: Record<string, unknown>) =>
    (await applyService(world.app, command, worker())).result

  async function add(itemId: string, qty: number) {
    const { result } = await applyService(
      world.app,
      {
        type: 'order.add',
        tableId,
        actionId: randomUUID(),
        ageMs: 50,
        itemId,
        optionIds: [],
        qty,
        note: '',
      },
      guest(),
    )
    expect(result.status).toBe('accepted')
  }

  const line = (itemId: string, qty: number) => ({ itemId, optionIds: [], qty, note: '' })
  /** A fresh handle's hash, as the guest API makes one for each Send that pays. */
  const handleHash = () => createHash('sha256').update(randomUUID()).digest('hex')

  /** A Send of `lines` on the bill and `payFirst` paid first. */
  const send = (lines: ReturnType<typeof line>[], payFirst: ReturnType<typeof line>[] | null) =>
    applyService(
      world.app,
      {
        type: 'order.send',
        tableId,
        actionId: randomUUID(),
        ageMs: 50,
        lines,
        ...(payFirst === null
          ? {}
          : { payFirst: { lines: payFirst, tip: { kind: 'none' }, handleHash: handleHash() } }),
      },
      guest(),
      { sendMenu: menu },
    )

  /** The order's live lines: item, quantity and the payment holding it. */
  async function orderLines() {
    const { rows } = await world.owner.query(
      'select lines from restro.table_orders where table_id = $1 and sitting_id = $2',
      [tableId, sittingId],
    )
    const lines = (rows[0]?.lines ?? []) as {
      itemId: string
      qty: number
      heldBy: string | null
      removedAt: number | null
    }[]
    return lines
      .filter((one) => one.removedAt === null)
      .map((one) => [one.itemId === gin ? 'gin' : 'beer', one.qty, one.heldBy])
  }

  const payment = async (id: string) =>
    (
      await world.owner.query<{
        kind: string
        state: string
        reason: string | null
        amount_minor: string | null
        sent_order_id: string | null
      }>(
        'select kind, state, reason, amount_minor, sent_order_id from restro.payments where id = $1',
        [id],
      )
    ).rows[0]
  const sentOrder = async (id: string | null | undefined) =>
    (
      await world.owner.query<{
        kind: string
        state: string
        reason: string | null
        pos_bill_ref: string | null
        total_minor: string
      }>(
        'select kind, state, reason, pos_bill_ref, total_minor from restro.sent_orders where id = $1',
        [id],
      )
    ).rows[0]
  const alerts = async (id: string) =>
    (
      await world.owner.query<{ kind: string; done: boolean }>(
        'select kind, done_at is not null as done from restro.alerts where subject_id = $1',
        [id],
      )
    ).rows

  /** A Send of a beer on the bill and two gins paid first; the payment's id. */
  async function split(): Promise<string> {
    await add(beer, 1)
    await add(gin, 2)
    const { result } = await send([line(beer, 1)], [line(gin, 2)])
    expect(result).toMatchObject({ status: 'accepted' })
    const id = result.details.paymentId
    if (typeof id !== 'string') throw new Error('no payment')
    return id
  }

  /** The payment taken on to `queued` on the payment table (the hold's steps are #110's). */
  async function queued(id: string) {
    await world.owner.query(
      `update restro.payments
          set state = 'queued', amount_minor = 1400, provider_payment_ref = 'simpay_' || id,
              payment_table_id = $2
        where id = $1`,
      [id, paymentTableId],
    )
  }

  async function entered(id: string) {
    await queued(id)
    expect(
      await step({
        type: 'payment.entered',
        paymentId: id,
        outcome: 'entered',
        billRef: 'B9',
        code: null,
      }),
    ).toMatchObject({ status: 'accepted', details: { state: 'entered' } })
  }

  const checked = (id: string, totalMinor: number, more: Record<string, unknown> = {}) =>
    step({
      type: 'payment.pay_first_checked',
      paymentId: id,
      bill: {
        bills: 1,
        totalMinor,
        paidMinor: 0,
        lines: [{ quantity: '2', amountMinor: totalMinor }],
      },
      partialCapture: true,
      heldMinor: 1400,
      ...more,
    })

  beforeAll(async () => {
    world = await openServiceWorld('pay-first')
    tableId = world.tables[0] as string
    paymentTableId = world.tables[3] as string
    managerId = await world.addUser('member')
    await world.addStaff(DEFAULT_ROLE_PERMISSIONS.manager, managerId)
    await world.owner.query(
      `update restro.venues set settings = jsonb_set(settings, '{ordering}', $2::jsonb) where id = $1`,
      [
        world.venueId,
        JSON.stringify({
          ...DEFAULT_ORDERING_SETTINGS,
          locationCheck: false,
          pacePer15Minutes: null,
        }),
      ],
    )
    await world.declareCapabilities({ notesReachTicket: true, firstItemsOpenBill: true })
    await world.owner.query(
      `insert into restro.payment_accounts
         (tenant_id, venue_id, provider_kind, account_ref, state, checks, connected_at, source, actor, job_id)
       values ($1, $2, 'sim-pay', 'acct_payfirst1', 'connected', '{"cardPayments":true,"ticks":{"cardTypeInTill":{"at":"2026-10-27T00:00:00Z","by":"system"},"receiptEmailsOff":{"at":"2026-10-27T00:00:00Z","by":"system"}}}'::jsonb, now(), 'restro', 'system', 'test-seed')`,
      [world.tenantId, world.venueId],
    )
    await world.owner.query('update restro.tables set is_payment_table = true where id = $1', [
      paymentTableId,
    ])
    const code = `code${randomUUID().replaceAll('-', '')}`
    codeHash = await hashTableCode(code)
    await world.owner.query(
      'update restro.tables set qr_token = $2, qr_code_hash = $3 where id = $1',
      [tableId, code, codeHash],
    )
  })

  afterAll(async () => {
    await world?.close()
  })

  beforeEach(async () => {
    await world.declareCapabilities({ notesReachTicket: true, firstItemsOpenBill: true })
    await world.owner.query(
      `update restro.payment_accounts set state = 'connected' where venue_id = $1`,
      [world.venueId],
    )
    await world.owner.query(
      `update restro.payments set state = 'released', reason = 'test', settled_at = now(),
          payment_table_id = null
        where venue_id = $1 and settled_at is null`,
      [world.venueId],
    )
    await world.owner.query(
      `update restro.sent_orders set state = 'not_sent', reason = 'test_reset', settled_at = now()
        where table_id = $1 and state in ('waiting', 'sending', 'checking', 'unconfirmed')`,
      [tableId],
    )
    await world.owner.query(
      'update restro.sittings set ended_at = now(), end_reason = $2 where table_id = $1 and ended_at is null',
      [tableId, 'staff_closed'],
    )
    sittingId = await world.openSitting(tableId)
  })

  it('splits a Send: the bill round as before, the pay-first lines a payment of their own', async () => {
    const id = await split()
    const row = await payment(id)
    expect(row).toMatchObject({ kind: 'pay_first', state: 'requested' })
    expect(await sentOrder(row?.sent_order_id)).toMatchObject({
      kind: 'pay_first',
      state: 'waiting',
      total_minor: '1400',
    })
    const { rows } = await world.owner.query<{ kind: string; state: string }>(
      `select kind, state from restro.sent_orders where sitting_id = $1 order by kind`,
      [sittingId],
    )
    expect(rows).toEqual([
      { kind: 'on_bill', state: 'waiting' },
      { kind: 'pay_first', state: 'waiting' },
    ])
    // The beer left for the bill; the gins wait on the order, held by the payment.
    expect(await orderLines()).toEqual([['gin', 2, id]])
    const lines = await world.owner.query(
      'select pos_line_ref, quantity, pos_amount_minor from restro.payment_lines where payment_id = $1',
      [id],
    )
    expect(
      lines.rows.map((row) => [
        row.pos_line_ref,
        Number(row.quantity),
        Number(row.pos_amount_minor),
      ]),
    ).toEqual([[null, 2, 1400]])
    // Priced from what the guest saw, never from a reading of the POS.
    expect(
      await step({
        type: 'payment.price',
        paymentId: id,
        lines: [],
        providerMinimumMinor: 50,
        tipAllowed: false,
      }),
    ).toMatchObject({ status: 'accepted', details: { state: 'priced', amountMinor: 1400 } })
  })

  it('takes a Send of pay-first lines alone, and refuses one that names them for the bill', async () => {
    await add(gin, 1)
    expect((await send([line(gin, 1)], null)).result).toMatchObject({ code: 'order_changed' })
    const { result } = await send([], [line(gin, 1)])
    expect(result).toMatchObject({ status: 'accepted' })
    expect(result.details.sentOrderId).toBeUndefined()
    expect(typeof result.details.paymentId).toBe('string')
  })

  it('offers pay-first only where the POS opens a bill that names itself and paying is on', async () => {
    await add(gin, 1)
    await world.declareCapabilities({ notesReachTicket: true, firstItemsOpenBill: false })
    expect((await send([], [line(gin, 1)])).result).toMatchObject({ code: 'paying_not_offered' })
    await world.declareCapabilities({ notesReachTicket: true, firstItemsOpenBill: true })
    await world.owner.query(
      `update restro.payment_accounts set state = 'lost_access' where venue_id = $1`,
      [world.venueId],
    )
    expect((await send([], [line(gin, 1)])).result).toMatchObject({ code: 'paying_paused' })
    // Nothing was taken: the gin is still on the order, free.
    expect(await orderLines()).toEqual([['gin', 1, null]])
  })

  it('frees the lines of a payment that ends before the POS, its sent order Not sent', async () => {
    const id = await split()
    expect(
      await step({
        type: 'payment.price',
        paymentId: id,
        lines: [],
        providerMinimumMinor: 100_000,
        tipAllowed: false,
      }),
    ).toMatchObject({ status: 'accepted', details: { state: 'released' } })
    expect(await sentOrder((await payment(id))?.sent_order_id)).toMatchObject({
      state: 'not_sent',
      reason: 'below_minimum',
    })
    expect(await orderLines()).toEqual([['gin', 2, null]])
  })

  it('a refused entry releases the hold and gives the lines back', async () => {
    const id = await split()
    await queued(id)
    expect(
      await step({
        type: 'payment.entered',
        paymentId: id,
        outcome: 'refused',
        billRef: null,
        code: 'payment_table_busy',
      }),
    ).toMatchObject({ details: { state: 'cancelling' } })
    expect(await payment(id)).toMatchObject({ state: 'cancelling', reason: 'busy' })
    expect(
      await step({
        type: 'payment.settle',
        paymentId: id,
        from: 'cancelling',
        reason: 'cancelled',
      }),
    ).toMatchObject({ status: 'accepted', details: { state: 'released' } })
    expect(await orderLines()).toEqual([['gin', 2, null]])
  })

  it('once entered, the round is Added and leaves the order; a lower POS total is captured', async () => {
    const id = await split()
    await entered(id)
    expect(await sentOrder((await payment(id))?.sent_order_id)).toMatchObject({
      state: 'added',
      pos_bill_ref: 'B9',
    })
    expect(await orderLines()).toEqual([])
    expect(await checked(id, 1200)).toMatchObject({
      status: 'accepted',
      details: { state: 'checked', amountMinor: 1200 },
    })
    expect(await payment(id)).toMatchObject({ state: 'checked', amount_minor: '1200' })
  })

  it('never releases a round entered on its own: a higher total is unconfirmed, for a manager', async () => {
    const id = await split()
    await entered(id)
    expect(await checked(id, 1600)).toMatchObject({
      details: { state: 'unconfirmed', reason: 'entered_check_failed', why: 'pos_higher' },
    })
    expect(await alerts(id)).toEqual([{ kind: 'payment_unconfirmed', done: false }])
    const { result } = await applyService(
      world.app,
      { type: 'payment.answer', paymentId: id, answering: 'close', answer: 'receipt_printed' },
      manager(),
    )
    expect(result).toMatchObject({ status: 'accepted' })
    expect(await payment(id)).toMatchObject({ state: 'unconfirmed', reason: 'receipt_printed' })
    expect(await alerts(id)).toEqual([{ kind: 'payment_unconfirmed', done: true }])
  })

  it('an entry with an unknown outcome is unconfirmed; "No receipt" cancels the round', async () => {
    const id = await split()
    await queued(id)
    await world.owner.query(
      `insert into restro.payment_steps
         (tenant_id, venue_id, payment_id, step, outcome, answer, source, actor, job_id)
       values ($1, $2, $3, 'addLines', 'unknown', 'late', 'worker', 'system', 'test-seed')`,
      [world.tenantId, world.venueId, id],
    )
    expect(
      await step({
        type: 'payment.entered',
        paymentId: id,
        outcome: 'unknown',
        billRef: null,
        code: 'not_found',
      }),
    ).toMatchObject({ details: { state: 'unconfirmed' } })
    const sentOrderId = (await payment(id))?.sent_order_id
    expect(await sentOrder(sentOrderId)).toMatchObject({ state: 'unconfirmed' })
    // The round may be on the POS: its lines left the order, and nothing releases it unasked.
    expect(await orderLines()).toEqual([])
    expect(await alerts(id)).toEqual([{ kind: 'payment_unconfirmed', done: false }])
    const { result } = await applyService(
      world.app,
      { type: 'payment.answer', paymentId: id, answering: 'close', answer: 'no_receipt' },
      manager(),
    )
    expect(result).toMatchObject({ status: 'accepted' })
    expect(await payment(id)).toMatchObject({ state: 'cancelling', reason: 'no_receipt' })
    expect(await sentOrder(sentOrderId)).toMatchObject({ state: 'not_sent', reason: 'no_receipt' })
    expect(
      await step({
        type: 'payment.settle',
        paymentId: id,
        from: 'cancelling',
        reason: 'cancelled',
      }),
    ).toMatchObject({ status: 'accepted', details: { state: 'released' } })
  })

  it('refuses to release a cancelled payment whose entry was attempted, unless a manager said so', async () => {
    const id = await split()
    await world.owner.query(
      `update restro.payments set state = 'cancelling', reason = 'cancelled' where id = $1`,
      [id],
    )
    await world.owner.query(
      `insert into restro.payment_steps
         (tenant_id, venue_id, payment_id, step, outcome, answer, source, actor, job_id)
       values ($1, $2, $3, 'addLines', 'attempting', null, 'worker', 'system', 'test-seed')`,
      [world.tenantId, world.venueId, id],
    )
    expect(
      await step({
        type: 'payment.settle',
        paymentId: id,
        from: 'cancelling',
        reason: 'cancelled',
      }),
    ).toMatchObject({ status: 'refused', code: 'enter_attempted' })
  })
})
