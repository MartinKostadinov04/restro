// What shows as paid in the app is what the POS closed (#197), on a real Postgres as the restro_app
// role: the last check records, line by line, what the POS will close (`payment_lines.closed_minor`
// and `closed_quantity`), and the bill's "Paid in the app" lines and the paying phone's
// confirmation read only those lines, at those amounts, once the real `payment.captured` has run.
// A voided or dropped line is never shown as paid, a lower POS price shows at the POS's price, and
// the lines plus the tip are the total. Skipped without a database.
import { randomUUID } from 'node:crypto'

import { withTenantWrite } from '@restro/db/write'
import { sql } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { hasDatabase } from '../apply/test-database'
import { newId } from '../ids'
import { DEFAULT_ORDERING_SETTINGS } from '../ordering-settings'
import { hashTableCode } from '../qr'
import { openServiceWorld, type ServiceWorld } from '../testing/service-world'
import { applyService } from './apply-service'
import {
  forgetGuestCodes,
  type GuestTableState,
  guestPayment,
  guestState,
  hashPaymentHandle,
} from './guest'
import { GUEST_LIMITS, type GuestLimit, GuestLimiter, type GuestLimitName } from './guest-limits'

const KEY = 'closed-test-key-'.padEnd(48, 'x')
const LOOSE = Object.fromEntries(
  Object.entries(GUEST_LIMITS).map(([name, limit]) => [name, { ...limit, max: 10_000 }]),
) as Record<GuestLimitName, GuestLimit>

const WINE = { en_US: 'House wine', bg_BG: 'Домашно вино' }
const MOJITO = { en_US: 'Mojito', bg_BG: 'Мохито' }
const GIN = { en_US: 'Gin', bg_BG: 'Джин' }

describe.skipIf(!hasDatabase)('paid lines are what the POS closed (as the restro_app role)', () => {
  let world: ServiceWorld
  let tableId: string
  let code: string
  let sittingId: string
  const integrationId = newId('in')
  const limiter = new GuestLimiter(LOOSE)
  /** The handle of the payment seeded last: one per payment (its hash is unique). */
  let handle = ''

  /** The table's POS bill, as the worker reads it. */
  const LINES = [
    { pos: 'L1', quantity: '2', amountMinor: 1_000 },
    { pos: 'L2', quantity: '1', amountMinor: 450 },
    { pos: 'L3', quantity: '1', amountMinor: 300 },
  ]

  const context = () => ({
    tenantId: world.tenantId,
    venueId: world.venueId,
    origin: 'worker' as const,
    actor: { kind: 'system' as const },
    jobId: `payment-${randomUUID()}`,
  })
  const worker = async (command: Record<string, unknown>) =>
    (await applyService(world.app, command, context())).result

  async function record() {
    const { result } = await applyService(
      world.app,
      {
        type: 'reading.record',
        tableId,
        reading: {
          complete: true as const,
          currency: 'EUR',
          bills: [
            {
              pos: 'B1',
              totalMinor: 1_750,
              paidMinor: 0,
              openedAt: '2026-10-26T20:00:00.000Z',
              openedByRestro: false,
              paymentInFlight: false,
              lines: LINES.map((line) => ({
                pos: line.pos,
                itemPos: null,
                posName: `till name ${line.pos}`,
                quantity: line.quantity,
                amountMinor: line.amountMinor,
                enteredBy: 'staff',
                enteredAt: null,
                restroRef: null,
              })),
            },
          ],
        },
      },
      {
        tenantId: world.tenantId,
        venueId: world.venueId,
        origin: 'worker',
        actor: { kind: 'integration', integrationId },
        jobId: `table-read-${randomUUID()}`,
      },
      { billIdKey: KEY },
    )
    if (result.status !== 'accepted') throw new Error(`refused: ${JSON.stringify(result)}`)
  }

  /** A payment of the table's open sitting, seeded at `state`, with its lines (position from 1). */
  async function seed(
    kind: 'on_bill' | 'pay_first',
    state: string,
    lines: readonly {
      readonly pos: string | null
      readonly quantity: string
      readonly amountMinor: number
      readonly name: Record<string, string> | null
    }[],
    tipMinor = 100,
  ): Promise<{ id: string; amountMinor: number }> {
    const id = newId('py')
    handle = randomUUID().replaceAll('-', '').slice(0, 22)
    const amountMinor = lines.reduce((sum, line) => sum + line.amountMinor, 0) + tipMinor
    const sent =
      kind === 'pay_first'
        ? await world.addSentOrder({
            tableId,
            sittingId,
            actionId: `act${randomUUID().replaceAll('-', '')}`,
            reference: randomUUID().slice(0, 3).toUpperCase(),
          })
        : null
    await world.owner.query(
      `insert into restro.payments
         (id, tenant_id, venue_id, table_id, sitting_id, sent_order_id, service_date, kind, state,
          handle_hash, amount_minor, tip_minor, currency, provider_kind, provider_payment_ref,
          source, actor, job_id)
       values ($1, $2, $3, $4, $5, $6, current_date, $7, $8, $9, $10, $11, 'EUR', 'sim-pay',
          'simpay_' || $1, 'restro', 'system', 'test-seed')`,
      [
        id,
        world.tenantId,
        world.venueId,
        tableId,
        sittingId,
        sent,
        kind,
        state,
        hashPaymentHandle(handle),
        amountMinor,
        tipMinor,
      ],
    )
    for (const [index, line] of lines.entries()) {
      await world.owner.query(
        `insert into restro.payment_lines
           (tenant_id, venue_id, payment_id, position, pos_line_ref, quantity, pos_amount_minor,
            display_name, name, source, actor, job_id)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, 'restro', 'system', 'test-seed')`,
        [
          world.tenantId,
          world.venueId,
          id,
          index + 1,
          line.pos,
          line.quantity,
          line.amountMinor,
          line.name?.en_US ?? 'Other item',
          line.name === null ? null : JSON.stringify(line.name),
        ],
      )
    }
    return { id, amountMinor }
  }

  const close = (id: string) =>
    worker({
      type: 'payment.closed',
      paymentId: id,
      outcome: 'done',
      code: null,
      receiptNumber: 'R-1',
      fiscalMemoryNumber: null,
    })
  const capture = (id: string, capturedMinor: number) =>
    worker({
      type: 'payment.captured',
      paymentId: id,
      outcome: 'captured',
      capturedMinor,
      code: null,
    })

  async function friendState(): Promise<GuestTableState> {
    const read = await guestState(world.app, { code, view: 'bill', limiter })
    if (!read.ok || read.answer.unchanged) throw new Error('no table state')
    return read.answer
  }
  const payerAnswer = async () => {
    const answer = await guestPayment(world.app, { code, handle, limiter })
    if (!answer.ok) throw new Error(`no payment: ${answer.code}`)
    return answer.answer
  }
  const closedOf = async (id: string) =>
    (
      await world.owner.query<{
        position: number
        closed_minor: string | null
        closed_quantity: string | null
      }>(
        'select position, closed_minor, closed_quantity from restro.payment_lines where payment_id = $1 order by position',
        [id],
      )
    ).rows.map((row) => [
      row.position,
      row.closed_minor === null ? null : Number(row.closed_minor),
      row.closed_quantity === null ? null : Number(row.closed_quantity),
    ])
  /** The lines plus the tip are the total the paying phone sees. */
  const sums = (answer: Awaited<ReturnType<typeof payerAnswer>>) =>
    answer.lines.reduce((sum, line) => sum + line.amountMinor, 0) + answer.tipMinor

  beforeAll(async () => {
    world = await openServiceWorld('paid-lines')
    tableId = world.tables[0] as string
    await world.owner.query(
      `update restro.venues set settings = jsonb_set(settings, '{ordering}', $2::jsonb) where id = $1`,
      [world.venueId, JSON.stringify({ ...DEFAULT_ORDERING_SETTINGS, locationCheck: false })],
    )
    await withTenantWrite(world.app, world.tenantId, (tx) =>
      tx.execute(sql`
        insert into restro.integrations (id, tenant_id, kind, host)
        values (${integrationId}, ${world.tenantId}, 'sim', '127.0.0.1:9')`),
    )
  })

  afterAll(async () => {
    await world?.close()
  })

  beforeEach(async () => {
    forgetGuestCodes()
    limiter.clear()
    await world.owner.query(
      `update restro.payments set state = 'released', reason = 'test', form_values = null,
         settled_at = now() where table_id = $1 and settled_at is null`,
      [tableId],
    )
    await world.owner.query(
      'update restro.sittings set ended_at = now(), end_reason = $2 where table_id = $1 and ended_at is null',
      [tableId, 'staff_closed'],
    )
    sittingId = await world.openSitting(tableId)
    const fresh = `code${randomUUID().replaceAll('-', '')}`
    await world.owner.query(
      'update restro.tables set qr_token = $2, qr_code_hash = $3 where id = $1',
      [tableId, fresh, await hashTableCode(fresh)],
    )
    code = fresh
    await record()
  })

  it('shows every line of an on-bill payment the POS closed whole, in the guest’s languages', async () => {
    const { id, amountMinor } = await seed('on_bill', 'isolated', [
      { pos: 'L1', quantity: '2', amountMinor: 1_000, name: WINE },
      { pos: 'L2', quantity: '1', amountMinor: 450, name: null },
    ])
    const isolated = {
      bills: 1,
      totalMinor: 1_450,
      paidMinor: 0,
      lines: [
        { quantity: '2', amountMinor: 1_000 },
        { quantity: '1', amountMinor: 450 },
      ],
    }
    expect(
      await worker({
        type: 'payment.checked',
        paymentId: id,
        isolated,
        real: [],
        partialCapture: true,
        heldMinor: amountMinor,
      }),
    ).toMatchObject({ status: 'accepted', details: { state: 'checked' } })
    expect(await close(id)).toMatchObject({ details: { state: 'closed' } })
    // Before the capture nothing is paid yet.
    expect((await friendState()).bill?.paidLines).toEqual([])
    expect(await capture(id, amountMinor)).toMatchObject({ details: { state: 'captured' } })
    expect((await friendState()).bill?.paidLines).toEqual([
      { name: WINE, quantity: '2', amountMinor: 1_000 },
      { name: null, quantity: '1', amountMinor: 450 },
    ])
    const answer = await payerAnswer()
    expect(answer).toMatchObject({ state: 'captured', amountMinor, tipMinor: 100 })
    expect(sums(answer)).toBe(amountMinor)
  })

  it('does not show an on-bill line the POS voided before the close, and the lines plus the tip are the total', async () => {
    const { id } = await seed('on_bill', 'isolated', [
      { pos: 'L1', quantity: '2', amountMinor: 1_000, name: WINE },
      { pos: 'L2', quantity: '1', amountMinor: 450, name: MOJITO },
      { pos: 'L3', quantity: '1', amountMinor: 300, name: GIN },
    ])
    // The waiter voided the Mojito: the payment table's bill no longer holds it, nor does the real one.
    const checked = await worker({
      type: 'payment.checked',
      paymentId: id,
      isolated: {
        bills: 1,
        totalMinor: 1_300,
        paidMinor: 0,
        lines: [
          { quantity: '2', amountMinor: 1_000 },
          { quantity: '1', amountMinor: 300 },
        ],
      },
      real: [],
      partialCapture: true,
      heldMinor: 1_850,
    })
    expect(checked).toMatchObject({ details: { state: 'checked', amountMinor: 1_400 } })
    expect(await closedOf(id)).toEqual([
      [1, 1_000, 2],
      [2, null, null],
      [3, 300, 1],
    ])
    expect(await close(id)).toMatchObject({ details: { state: 'closed' } })
    expect(await capture(id, 1_400)).toMatchObject({ details: { state: 'captured' } })

    expect((await friendState()).bill?.paidLines).toEqual([
      { name: WINE, quantity: '2', amountMinor: 1_000 },
      { name: GIN, quantity: '1', amountMinor: 300 },
    ])
    const answer = await payerAnswer()
    expect(answer.lines.map((line) => line.name)).toEqual([WINE, GIN])
    expect(answer.amountMinor).toBe(1_400)
    expect(sums(answer)).toBe(1_400)
    // Nothing identifies a payer or the POS.
    const text = JSON.stringify(await friendState())
    // Whole JSON string values: a random id can contain the letters of a short ref (`rd_…L1…`).
    for (const ref of ['L1', 'L2', 'till name', handle]) {
      expect(text).not.toContain(JSON.stringify(ref))
    }
  })

  it('records the check again when it is re-run, replacing what the first run recorded', async () => {
    const { id, amountMinor } = await seed('on_bill', 'isolated', [
      { pos: 'L1', quantity: '2', amountMinor: 1_000, name: WINE },
      { pos: 'L2', quantity: '1', amountMinor: 450, name: MOJITO },
    ])
    const check = (lines: readonly { quantity: string; amountMinor: number }[], total: number) =>
      worker({
        type: 'payment.checked',
        paymentId: id,
        isolated: { bills: 1, totalMinor: total, paidMinor: 0, lines },
        real: [],
        partialCapture: true,
        heldMinor: amountMinor,
      })
    await check(
      [
        { quantity: '2', amountMinor: 1_000 },
        { quantity: '1', amountMinor: 450 },
      ],
      1_450,
    )
    expect(await closedOf(id)).toEqual([
      [1, 1_000, 2],
      [2, 450, 1],
    ])
    // Checked again before the close (the run died): the POS has since voided the second line.
    await check([{ quantity: '2', amountMinor: 1_000 }], 1_000)
    expect(await closedOf(id)).toEqual([
      [1, 1_000, 2],
      [2, null, null],
    ])
  })

  it('does not show a pay-first line the POS dropped', async () => {
    const { id } = await seed('pay_first', 'entered', [
      { pos: null, quantity: '1', amountMinor: 800, name: GIN },
      { pos: null, quantity: '1', amountMinor: 400, name: MOJITO },
    ])
    const checked = await worker({
      type: 'payment.pay_first_checked',
      paymentId: id,
      bill: {
        bills: 1,
        totalMinor: 800,
        paidMinor: 0,
        lines: [{ item: 'A-gin', quantity: '1', amountMinor: 800 }],
      },
      items: ['A-gin', 'A-mojito'],
      partialCapture: true,
      heldMinor: 1_300,
    })
    expect(checked).toMatchObject({ details: { state: 'checked', amountMinor: 900 } })
    expect(await closedOf(id)).toEqual([
      [1, 800, 1],
      [2, null, null],
    ])
    await close(id)
    expect(await capture(id, 900)).toMatchObject({ details: { state: 'captured' } })
    expect((await friendState()).bill?.paidLines).toEqual([
      { name: GIN, quantity: '1', amountMinor: 800 },
    ])
    expect(sums(await payerAnswer())).toBe(900)
  })

  it('shows a pay-first line at the lower price the POS closed it for', async () => {
    const { id } = await seed('pay_first', 'entered', [
      { pos: null, quantity: '1', amountMinor: 800, name: GIN },
      { pos: null, quantity: '1', amountMinor: 400, name: MOJITO },
    ])
    const checked = await worker({
      type: 'payment.pay_first_checked',
      paymentId: id,
      bill: {
        bills: 1,
        totalMinor: 1_100,
        paidMinor: 0,
        lines: [
          { item: 'A-gin', quantity: '1', amountMinor: 700 },
          { item: 'A-mojito', quantity: '1', amountMinor: 400 },
        ],
      },
      items: ['A-gin', 'A-mojito'],
      partialCapture: true,
      heldMinor: 1_300,
    })
    expect(checked).toMatchObject({ details: { state: 'checked', amountMinor: 1_200 } })
    await close(id)
    expect(await capture(id, 1_200)).toMatchObject({ details: { state: 'captured' } })
    expect((await friendState()).bill?.paidLines).toEqual([
      { name: GIN, quantity: '1', amountMinor: 700 },
      { name: MOJITO, quantity: '1', amountMinor: 400 },
    ])
    expect(sums(await payerAnswer())).toBe(1_200)
  })

  it('shows a pay-first round the POS took whole, and the payer’s confirmation lines match', async () => {
    const { id, amountMinor } = await seed('pay_first', 'entered', [
      { pos: null, quantity: '2', amountMinor: 1_600, name: GIN },
    ])
    expect(
      await worker({
        type: 'payment.pay_first_checked',
        paymentId: id,
        bill: {
          bills: 1,
          totalMinor: 1_600,
          paidMinor: 0,
          lines: [{ item: 'A-gin', quantity: '2', amountMinor: 1_600 }],
        },
        items: ['A-gin'],
        partialCapture: true,
        heldMinor: amountMinor,
      }),
    ).toMatchObject({ details: { state: 'checked', amountMinor } })
    await close(id)
    await capture(id, amountMinor)
    expect((await friendState()).bill?.paidLines).toEqual([
      { name: GIN, quantity: '2', amountMinor: 1_600 },
    ])
    const answer = await payerAnswer()
    expect(answer).toMatchObject({ mode: 'pay_first', state: 'captured' })
    expect(sums(answer)).toBe(amountMinor)
  })

  it('shows a payment that is not captured as nothing paid, and the time only once it is', async () => {
    const { id, amountMinor } = await seed('on_bill', 'isolated', [
      { pos: 'L3', quantity: '1', amountMinor: 300, name: GIN },
    ])
    await worker({
      type: 'payment.checked',
      paymentId: id,
      isolated: {
        bills: 1,
        totalMinor: 300,
        paidMinor: 0,
        lines: [{ quantity: '1', amountMinor: 300 }],
      },
      real: [],
      partialCapture: true,
      heldMinor: amountMinor,
    })
    await close(id)
    expect((await friendState()).bill?.paidLines).toEqual([])
    expect((await payerAnswer()).paidAt).toBeNull()
    await capture(id, amountMinor)
    const answer = await payerAnswer()
    const settled = (
      await world.owner.query<{ settled_at: Date }>(
        'select settled_at from restro.payments where id = $1',
        [id],
      )
    ).rows[0]
    expect(answer).toMatchObject({
      timeZone: 'Europe/Sofia',
      paidAt: settled?.settled_at.toISOString(),
    })
  })

  it('takes the paid lines away with the sitting', async () => {
    const { id, amountMinor } = await seed('on_bill', 'isolated', [
      { pos: 'L3', quantity: '1', amountMinor: 300, name: GIN },
    ])
    await worker({
      type: 'payment.checked',
      paymentId: id,
      isolated: {
        bills: 1,
        totalMinor: 300,
        paidMinor: 0,
        lines: [{ quantity: '1', amountMinor: 300 }],
      },
      real: [],
      partialCapture: true,
      heldMinor: amountMinor,
    })
    await close(id)
    await capture(id, amountMinor)
    expect((await friendState()).bill?.paidLines).toHaveLength(1)
    await world.owner.query(
      'update restro.sittings set ended_at = now(), end_reason = $2 where table_id = $1 and ended_at is null',
      [tableId, 'staff_closed'],
    )
    sittingId = await world.openSitting(tableId)
    await record()
    expect((await friendState()).bill?.paidLines).toEqual([])
  })

  it('refuses a closed amount without a closed quantity, and a name that is no object', async () => {
    const { id } = await seed('on_bill', 'isolated', [
      { pos: 'L3', quantity: '1', amountMinor: 300, name: GIN },
    ])
    await expect(
      world.owner.query(
        'update restro.payment_lines set closed_minor = 300 where payment_id = $1',
        [id],
      ),
    ).rejects.toThrow(/payment_lines_closed/)
    await expect(
      world.owner.query(
        `update restro.payment_lines set name = '[]'::jsonb where payment_id = $1`,
        [id],
      ),
    ).rejects.toThrow(/payment_lines_name/)
  })
})
