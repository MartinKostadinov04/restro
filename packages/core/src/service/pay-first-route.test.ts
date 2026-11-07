// Pay-first items (#113) on a real Postgres, as the restro_app role: a Send splits into its
// on-the-bill round and a `pay_first` payment with its own waiting sent order, the pay-first lines
// held on the order; it is offered only where the POS opens a bill that names itself and paying
// is on; a payment that ends before the POS frees its lines; once the round is entered nothing
// releases it on its own (a lower POS total is captured, a higher one or an unknown entry is
// `unconfirmed` for a manager, whose answer settles the round's sent order). Skipped without a
// database.
import { createHash, randomUUID } from 'node:crypto'

import { withTenant } from '@restro/db'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { hasDatabase } from '../apply/test-database'
import { newId } from '../ids'
import { DEFAULT_ORDERING_SETTINGS } from '../ordering-settings'
import { hashTableCode } from '../qr'
import { openServiceWorld, type ServiceWorld } from '../testing/service-world'
import { applyService } from './apply-service'
import type { ServiceContext } from './context'
import { paymentWorkerJob } from './guest'
import { payFirstPossibleAt } from './pay-first'
import { DEFAULT_ROLE_PERMISSIONS } from './permissions'
import { readTableState } from './read'
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
  const vodka = newId('nd')

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
      [
        vodka,
        {
          priceMinor: 600,
          orderable: true,
          soldOut: false,
          name: 'Vodka',
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
  const send = (
    lines: ReturnType<typeof line>[],
    payFirst: ReturnType<typeof line>[] | null,
    tip: Record<string, unknown> = { kind: 'none' },
  ) =>
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
          : { payFirst: { lines: payFirst, tip, handleHash: handleHash() } }),
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
      .map((one) => [
        one.itemId === gin ? 'gin' : one.itemId === vodka ? 'vodka' : 'beer',
        one.qty,
        one.heldBy,
      ])
  }

  const payment = async (id: string) =>
    (
      await world.owner.query<{
        kind: string
        state: string
        reason: string | null
        amount_minor: string | null
        tip_minor: string
        sent_order_id: string | null
      }>(
        `select kind, state, reason, amount_minor, tip_minor, sent_order_id
           from restro.payments where id = $1`,
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

  /** The check on a reading of one bill of the two gins (POS item `A-gin`) for `totalMinor`. */
  const checked = (id: string, totalMinor: number, more: Record<string, unknown> = {}) =>
    step({
      type: 'payment.pay_first_checked',
      paymentId: id,
      bill: {
        bills: 1,
        totalMinor,
        paidMinor: 0,
        lines: [{ item: 'A-gin', quantity: '2', amountMinor: totalMinor }],
      },
      items: ['A-gin'],
      partialCapture: true,
      heldMinor: 1400,
      ...more,
    })
  const answer = (id: string, given: string) =>
    applyService(
      world.app,
      { type: 'payment.answer', paymentId: id, answering: 'close', answer: given },
      manager(),
    )
  const recordStep = (id: string, name: string, outcome: string) =>
    world.owner.query(
      `insert into restro.payment_steps
         (tenant_id, venue_id, payment_id, step, outcome, answer, source, actor, job_id)
       values ($1, $2, $3, $4, $5, null, 'worker', 'system', 'test-seed')`,
      [world.tenantId, world.venueId, id, name, outcome],
    )

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
    // The venue's legal details are part of what turns paying on (#198).
    await world.owner.query(
      `update restro.venues set settings = settings || '{"legalDetails":{"name":"Club EOOD","eik":"123456789","address":"Sofia, 1 Vitosha Blvd","privacyUrl":"https://club.example/privacy"}}'::jsonb where id = $1`,
      [world.venueId],
    )
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

  it('a "Send and pay" takes every pay-first line the phone has, never some of them', async () => {
    await add(beer, 1)
    await add(gin, 1)
    await add(vodka, 1)
    expect((await send([line(beer, 1)], [line(gin, 1)])).result).toMatchObject({
      status: 'refused',
      code: 'order_changed',
    })
    // Nothing went: the three lines are still on the order, free.
    expect(await orderLines()).toEqual([
      ['beer', 1, null],
      ['gin', 1, null],
      ['vodka', 1, null],
    ])
    const { result } = await send([line(beer, 1)], [line(gin, 1), line(vodka, 1)])
    expect(result).toMatchObject({ status: 'accepted' })
    expect(await orderLines()).toEqual([
      ['gin', 1, result.details.paymentId],
      ['vodka', 1, result.details.paymentId],
    ])
  })

  it("pays for some of the pay-first lines, while a friend's lines for the bill wait (#113)", async () => {
    await add(beer, 1)
    await add(gin, 1)
    await add(vodka, 1)
    const first = (await send([], [line(gin, 1)])).result
    expect(first).toMatchObject({ status: 'accepted' })
    const second = (await send([], [line(vodka, 1)])).result
    expect(second).toMatchObject({ status: 'accepted' })
    expect(await orderLines()).toEqual([
      ['beer', 1, null],
      ['gin', 1, first.details.paymentId],
      ['vodka', 1, second.details.paymentId],
    ])
    // A line another payment holds is not the phone's to pay again: none is left to pay first.
    expect((await send([], [line(gin, 1)])).result).toMatchObject({ code: 'order_empty' })
  })

  it("a Send's repeat from another table gets nothing of it: no payment, no new handle", async () => {
    await add(gin, 1)
    const actionId = randomUUID()
    const sendAs = (table: string, context: ServiceContext) =>
      applyService(
        world.app,
        {
          type: 'order.send',
          tableId: table,
          actionId,
          ageMs: 50,
          lines: [],
          payFirst: { lines: [line(gin, 1)], tip: { kind: 'none' }, handleHash: handleHash() },
        },
        context,
        { sendMenu: menu },
      )
    const first = (await sendAs(tableId, guest())).result
    expect(first).toMatchObject({ status: 'accepted' })
    const id = first.details.paymentId as string
    const hashOf = async () =>
      (
        await world.owner.query<{ handle_hash: string }>(
          'select handle_hash from restro.payments where id = $1',
          [id],
        )
      ).rows[0]?.handle_hash
    const before = await hashOf()

    // Another table's phone, with its own code and sitting, sends under the same action id.
    const other = world.tables[1] as string
    const otherCode = `code${randomUUID().replaceAll('-', '')}`
    const otherHash = await hashTableCode(otherCode)
    await world.owner.query(
      'update restro.tables set qr_token = $2, qr_code_hash = $3 where id = $1',
      [other, otherCode, otherHash],
    )
    const elsewhere: ServiceContext = {
      ...guest(),
      tableCodeHash: otherHash,
      sittingId: await world.openSitting(other),
    }
    const { result: added } = await applyService(
      world.app,
      {
        type: 'order.add',
        tableId: other,
        actionId: randomUUID(),
        ageMs: 50,
        itemId: gin,
        optionIds: [],
        qty: 1,
        note: '',
      },
      elsewhere,
    )
    expect(added.status).toBe('accepted')
    const replay = (await sendAs(other, elsewhere)).result
    expect(replay).toMatchObject({ status: 'refused', code: 'invalid_command' })
    expect(JSON.stringify(replay)).not.toContain(id)
    expect(await hashOf()).toBe(before)
  })

  it('takes a tip at Send only where the POS records it on the close (D127)', async () => {
    await add(gin, 1)
    const tip = { kind: 'percent', percent: 10 }
    expect((await send([], [line(gin, 1)], tip)).result).toMatchObject({ code: 'tip_not_offered' })
    await world.declareCapabilities({
      notesReachTicket: true,
      firstItemsOpenBill: true,
      recordTipOnClose: true,
    })
    const { result } = await send([], [line(gin, 1)], tip)
    expect(result).toMatchObject({ status: 'accepted' })
    expect(await payment(result.details.paymentId as string)).toMatchObject({ tip_minor: '70' })
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

  it('tells the composer pay-first can apply at the venue only with paying and a POS that opens a bill', async () => {
    const possible = () =>
      withTenant(world.app, world.tenantId, (tx) => payFirstPossibleAt(tx, world.venueId))
    expect(await possible()).toBe(true)
    await world.owner.query(
      `update restro.payment_accounts set state = 'lost_access' where venue_id = $1`,
      [world.venueId],
    )
    // Paused, not off: the field stays.
    expect(await possible()).toBe(true)
    await world.owner.query(
      `update restro.payment_accounts set state = 'disconnected' where venue_id = $1`,
      [world.venueId],
    )
    expect(await possible()).toBe(false)
    await world.owner.query(
      `update restro.payment_accounts set state = 'connected' where venue_id = $1`,
      [world.venueId],
    )
    await world.declareCapabilities({ notesReachTicket: true, firstItemsOpenBill: false })
    expect(await possible()).toBe(false)
  })

  it("pauses pay-first while the provider's breaker pauses paying, ordering going on (#112)", async () => {
    await add(gin, 1)
    const payFirstNow = async () => {
      const read = await readTableState(world.app, {
        tenantId: world.tenantId,
        tableId,
        tableCodeHash: codeHash,
      })
      return read !== null && !read.unchanged ? read.payFirst.state : null
    }
    expect(await payFirstNow()).toBe('on')
    await world.owner.query(
      'update restro.payment_accounts set paying_paused_at = now() where venue_id = $1',
      [world.venueId],
    )
    try {
      expect(await payFirstNow()).toBe('paused')
      expect((await send([], [line(gin, 1)])).result).toMatchObject({ code: 'paying_paused' })
      expect(await orderLines()).toEqual([['gin', 1, null]])
    } finally {
      await world.owner.query(
        'update restro.payment_accounts set paying_paused_at = null where venue_id = $1',
        [world.venueId],
      )
    }
    expect(await payFirstNow()).toBe('on')
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
      details: { state: 'unconfirmed', reason: 'entered_check_failed', why: 'not_the_round' },
    })
    expect(await alerts(id)).toEqual([{ kind: 'payment_unconfirmed', done: false }])
    // No close was attempted: no receipt was printed, and "No receipt" is not the question.
    for (const given of ['receipt_printed', 'no_receipt']) {
      expect((await answer(id, given)).result).toMatchObject({
        status: 'refused',
        code: 'payment_answer_not_asked',
      })
    }
    // "On the till": checked again; failing again, a manager is asked again.
    expect((await answer(id, 'on_till')).result).toMatchObject({
      status: 'accepted',
      details: { state: 'entered' },
    })
    expect(await alerts(id)).toEqual([{ kind: 'payment_unconfirmed', done: true }])
    expect(await checked(id, 1600)).toMatchObject({ details: { state: 'unconfirmed' } })
    expect((await alerts(id)).map((alert) => alert.done).sort()).toEqual([false, true])
    // "Not on the till": the hold is released, the round Not sent.
    expect((await answer(id, 'not_on_till')).result).toMatchObject({
      status: 'accepted',
      details: { state: 'cancelling' },
    })
    expect(await sentOrder((await payment(id))?.sent_order_id)).toMatchObject({
      state: 'not_sent',
      reason: 'not_on_till',
    })
    expect(
      await step({
        type: 'payment.settle',
        paymentId: id,
        from: 'cancelling',
        reason: 'cancelled',
      }),
    ).toMatchObject({ status: 'accepted', details: { state: 'released' } })
  })

  it('never takes a bill that is not the round for it, whatever its total', async () => {
    const id = await split()
    await entered(id)
    expect(
      await checked(id, 1400, {
        bill: {
          bills: 1,
          totalMinor: 1400,
          paidMinor: 0,
          lines: [{ item: 'A-vodka', quantity: '2', amountMinor: 1400 }],
        },
      }),
    ).toMatchObject({ details: { state: 'unconfirmed', why: 'not_the_round' } })
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
    expect((await answer(id, 'receipt_printed')).result).toMatchObject({ status: 'refused' })
    const { result } = await answer(id, 'not_on_till')
    expect(result).toMatchObject({ status: 'accepted' })
    expect(await payment(id)).toMatchObject({ state: 'cancelling', reason: 'not_on_till' })
    expect(await sentOrder(sentOrderId)).toMatchObject({ state: 'not_sent', reason: 'not_on_till' })
    expect(
      await step({
        type: 'payment.settle',
        paymentId: id,
        from: 'cancelling',
        reason: 'cancelled',
      }),
    ).toMatchObject({ status: 'accepted', details: { state: 'released' } })
  })

  it('"not on the till" puts the lines back in the bag, releases the card, and Try again sends once (RR-13)', async () => {
    const id = await split()
    await queued(id)
    await recordStep(id, 'addLines', 'unknown')
    await step({
      type: 'payment.entered',
      paymentId: id,
      outcome: 'unknown',
      billRef: null,
      code: 'not_found',
    })
    const firstSent = (await payment(id))?.sent_order_id
    // The POS may still hold the round: nothing comes back until a manager has looked.
    expect(await orderLines()).toEqual([])

    expect((await answer(id, 'not_on_till')).result).toMatchObject({ status: 'accepted' })
    expect(await orderLines()).toEqual([['gin', 2, null]])
    // A second tap changes nothing: the lines come back once.
    expect((await answer(id, 'not_on_till')).result).toMatchObject({
      status: 'accepted',
      details: { changed: false },
    })
    expect(await orderLines()).toEqual([['gin', 2, null]])

    // The card is released by the worker's next step, with the round's lines still in the bag.
    expect(
      await step({
        type: 'payment.settle',
        paymentId: id,
        from: 'cancelling',
        reason: 'cancelled',
      }),
    ).toMatchObject({ status: 'accepted', details: { state: 'released' } })
    expect(await payment(id)).toMatchObject({ state: 'released', reason: 'not_on_till' })
    expect(await orderLines()).toEqual([['gin', 2, null]])

    // Try again: one new payment for the same round, on a sent order of its own.
    const again = await send([], [line(gin, 2)])
    expect(again.result).toMatchObject({ status: 'accepted' })
    const next = again.result.details.paymentId as string
    expect(next).not.toBe(id)
    expect((await payment(next))?.sent_order_id).not.toBe(firstSent)
    expect(await orderLines()).toEqual([['gin', 2, next]])
    // A second tap finds nothing left to send: the round went once.
    expect((await send([], [line(gin, 2)])).result).toMatchObject({ status: 'refused' })
    const { rows } = await world.owner.query(
      `select count(*)::int as n from restro.payments where sitting_id = $1 and state <> 'released'`,
      [sittingId],
    )
    expect(rows[0]).toEqual({ n: 1 })
  })

  it('merges the returned lines into the bag and, for a later group, gives nothing back (RR-13)', async () => {
    const id = await split()
    await queued(id)
    await recordStep(id, 'addLines', 'unknown')
    await step({
      type: 'payment.entered',
      paymentId: id,
      outcome: 'unknown',
      billRef: null,
      code: 'not_found',
    })
    // A friend ordered the same again meanwhile: the bag holds one line of three.
    await add(gin, 1)
    expect((await answer(id, 'not_on_till')).result).toMatchObject({ status: 'accepted' })
    expect(await orderLines()).toEqual([['gin', 3, null]])

    await step({ type: 'payment.settle', paymentId: id, from: 'cancelling', reason: 'cancelled' })
    await world.owner.query(`update restro.payments set payment_table_id = null where id = $1`, [
      id,
    ])
    await send([], [line(gin, 3)]).then(({ result }) =>
      expect(result).toMatchObject({ status: 'accepted' }),
    )
    const [other] = (
      await world.owner.query<{ id: string }>(
        `select id from restro.payments where sitting_id = $1 and state = 'requested'`,
        [sittingId],
      )
    ).rows
    const otherId = other?.id as string
    await queued(otherId)
    await recordStep(otherId, 'addLines', 'unknown')
    await step({
      type: 'payment.entered',
      paymentId: otherId,
      outcome: 'unknown',
      billRef: null,
      code: 'not_found',
    })
    // A new group sits down before the manager answers: it never gets the last group's lines.
    await world.owner.query(
      `update restro.sittings set ended_at = now(), end_reason = 'staff_closed' where id = $1`,
      [sittingId],
    )
    sittingId = await world.openSitting(tableId)
    expect((await answer(otherId, 'not_on_till')).result).toMatchObject({ status: 'accepted' })
    expect(await orderLines()).toEqual([])
  })

  it('"on the till" after an unknown entry takes the round on to its check, its sent order Added', async () => {
    const id = await split()
    await queued(id)
    await recordStep(id, 'addLines', 'unknown')
    await step({
      type: 'payment.entered',
      paymentId: id,
      outcome: 'unknown',
      billRef: null,
      code: 'not_found',
    })
    expect((await answer(id, 'on_till')).result).toMatchObject({
      status: 'accepted',
      details: { state: 'entered' },
    })
    expect(await payment(id)).toMatchObject({ state: 'entered', reason: null })
    // The worker is woken for it, not left to recovery.
    expect(paymentWorkerJob({ state: 'entered', reason: null })).toBe('prepare')
    expect(await sentOrder((await payment(id))?.sent_order_id)).toMatchObject({ state: 'added' })
    // A second tap of the same answer (another manager, a retry) changes nothing; the other is
    // refused.
    expect((await answer(id, 'on_till')).result).toMatchObject({
      status: 'accepted',
      details: { state: 'entered', changed: false },
    })
    expect((await answer(id, 'not_on_till')).result).toMatchObject({
      status: 'refused',
      code: 'payment_not_unconfirmed',
    })
    expect(await checked(id, 1400)).toMatchObject({ details: { state: 'checked' } })
  })

  it('"not on the till" twice: the second changes nothing, and the worker cancels it', async () => {
    const id = await split()
    await queued(id)
    await recordStep(id, 'addLines', 'unknown')
    await step({
      type: 'payment.entered',
      paymentId: id,
      outcome: 'unknown',
      billRef: null,
      code: 'not_found',
    })
    expect((await answer(id, 'not_on_till')).result).toMatchObject({
      status: 'accepted',
      details: { state: 'cancelling', changed: true },
    })
    expect(paymentWorkerJob({ state: 'cancelling', reason: 'not_on_till' })).toBe('prepare')
    expect((await answer(id, 'not_on_till')).result).toMatchObject({
      status: 'accepted',
      details: { state: 'cancelling', changed: false },
    })
    expect((await answer(id, 'on_till')).result).toMatchObject({ status: 'refused' })
    expect(await payment(id)).toMatchObject({ state: 'cancelling', reason: 'not_on_till' })
  })

  it('a refusal after an attempted entry is unknown, never a release (D127 3.13)', async () => {
    const id = await split()
    await queued(id)
    await recordStep(id, 'addLines', 'unknown')
    expect(
      await step({
        type: 'payment.entered',
        paymentId: id,
        outcome: 'refused',
        billRef: null,
        code: 'pos_table_missing',
      }),
    ).toMatchObject({ details: { state: 'unconfirmed' } })
    expect(await payment(id)).toMatchObject({ state: 'unconfirmed', reason: 'enter_unknown' })
    expect(await alerts(id)).toEqual([{ kind: 'payment_unconfirmed', done: false }])
  })

  it('a busy payment table after an attempted entry is unknown too: never released', async () => {
    const id = await split()
    await queued(id)
    await recordStep(id, 'addLines', 'attempting')
    expect(
      await step({
        type: 'payment.entered',
        paymentId: id,
        outcome: 'refused',
        billRef: null,
        code: 'payment_table_busy',
      }),
    ).toMatchObject({ details: { state: 'unconfirmed' } })
    expect(await payment(id)).toMatchObject({ state: 'unconfirmed', reason: 'enter_unknown' })
    expect(await alerts(id)).toEqual([{ kind: 'payment_unconfirmed', done: false }])
    // No release: the worker has no step for it until a manager answers.
    expect(paymentWorkerJob({ state: 'unconfirmed', reason: 'enter_unknown' })).toBeNull()
    expect(
      await step({
        type: 'payment.settle',
        paymentId: id,
        from: 'cancelling',
        reason: 'cancelled',
      }),
    ).toMatchObject({ details: { state: 'unconfirmed', changed: false } })
  })

  it('a cancel that finds an entry attempted becomes a question; an answered one is released', async () => {
    const id = await split()
    await world.owner.query(
      `update restro.payments set state = 'cancelling', reason = 'busy', payment_table_id = $2
        where id = $1`,
      [id, paymentTableId],
    )
    await recordStep(id, 'addLines', 'attempting')
    const unknown = {
      type: 'payment.entered',
      paymentId: id,
      outcome: 'unknown',
      billRef: null,
      code: 'cancel_after_entry',
    }
    expect(await step(unknown)).toMatchObject({ details: { state: 'unconfirmed' } })
    expect(await payment(id)).toMatchObject({ state: 'unconfirmed', reason: 'enter_unknown' })
    // After "not on the till" the cancel goes ahead.
    await answer(id, 'not_on_till')
    expect(await step(unknown)).toMatchObject({ details: { state: 'cancelling', changed: false } })
    expect(
      await step({
        type: 'payment.settle',
        paymentId: id,
        from: 'cancelling',
        reason: 'cancelled',
      }),
    ).toMatchObject({ status: 'accepted', details: { state: 'released' } })
  })

  it('records an entry or a close as started once: a second run backs off (#113)', async () => {
    const id = await split()
    const attempt = (name: string) =>
      step({
        type: 'payment.step',
        paymentId: id,
        step: name,
        outcome: 'attempting',
        answer: null,
        idempotencyKey: `${id}-${name}`,
      })
    const results = await Promise.all([attempt('addLines'), attempt('addLines')])
    expect(results.map((result) => result.status).sort()).toEqual(['accepted', 'refused'])
    expect(results.find((result) => result.status === 'refused')).toMatchObject({
      code: 'step_attempted',
    })
    // A refused entry wrote nothing: it may be tried again.
    await recordStep(id, 'addLines', 'refused')
    expect(await attempt('addLines')).toMatchObject({ status: 'accepted' })
    expect(await attempt('payAndClose')).toMatchObject({ status: 'accepted' })
    await recordStep(id, 'payAndClose', 'refused')
    expect(await attempt('payAndClose')).toMatchObject({
      status: 'refused',
      code: 'step_attempted',
    })
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
