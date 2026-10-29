// Integration tests of the payment reads of Tonight (#115) on a real Postgres, as the restro_app
// role: the end of the night lists what to fix from the payments' states (never from the alerts, so a
// cleared alert drops nothing), staff see no tips, managers see the money sections, one payment's
// sheet reads its steps, and a waiter sees a payment question on Tonight but cannot read the night.
// Skipped without a database.
import { createHash, randomUUID } from 'node:crypto'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { hasDatabase } from '../apply/test-database'
import { newId } from '../ids'
import { openServiceWorld, type ServiceWorld } from '../testing/service-world'
import type { ServiceActor } from './context'
import { readNightPayments, readPaymentDetail } from './night-payments'
import { readLog, readNight } from './night-read'
import { readTonight } from './read'
import { readReceiptsToBring } from './receipts'

describe.skipIf(!hasDatabase)('the payment reads of Tonight (as the restro_app role)', () => {
  let world: ServiceWorld
  let staffUser: string
  let managerUser: string
  let waiterUser: string
  let loggerUser: string
  let followUpUser: string
  let bringerUser: string
  let day: string
  const ids: Record<string, string> = {}
  const sittings = new Map<string, string>()
  const seed = ['worker', 'system', 'test-seed']

  const user = (userId: string): ServiceActor => ({
    kind: 'user',
    userId,
    sessionId: `sess-${randomUUID()}`,
  })
  const input = (actor: ServiceActor) => ({
    tenantId: world.tenantId,
    venueId: world.venueId,
    actor,
  })

  async function addPayment(
    name: string,
    fields: {
      tableIndex: number
      state: string
      reason?: string | null
      amountMinor?: number
      tipMinor?: number
      capturedMinor?: number | null
      receiptNumber?: string | null
      refundedMinor?: number
      dispute?: string | null
      captureBefore?: string | null
    },
  ) {
    const tableId = world.tables[fields.tableIndex] as string
    // One open sitting per table: the next payment of the table joins it.
    let sittingId = sittings.get(tableId)
    if (sittingId === undefined) {
      sittingId = await world.openSitting(tableId, day)
      sittings.set(tableId, sittingId)
    }
    const id = `py_${randomUUID().replaceAll('-', '')}`
    ids[name] = id
    await world.owner.query(
      `insert into restro.payments
         (id, tenant_id, venue_id, table_id, sitting_id, service_date, kind, state, reason,
          handle_hash, amount_minor, tip_minor, captured_minor, receipt_number, refunded_minor,
          dispute, currency, provider_kind, capture_before, settled_at, source, actor, job_id)
       values ($1, $2, $3, $4, $5, $6, 'on_bill', $7, $8, $9, $10, $11, $12, $13, $14, $15, 'EUR',
               'sim', $16, now(), $17, $18, $19)`,
      [
        id,
        world.tenantId,
        world.venueId,
        tableId,
        sittingId,
        day,
        fields.state,
        fields.reason ?? null,
        createHash('sha256').update(randomUUID()).digest('hex'),
        fields.amountMinor ?? 3800,
        fields.tipMinor ?? 200,
        fields.capturedMinor ?? null,
        fields.receiptNumber ?? null,
        fields.refundedMinor ?? 0,
        fields.dispute ?? null,
        fields.captureBefore ?? null,
        ...seed,
      ],
    )
    return { id, tableId }
  }

  async function addAlert(
    kind: string,
    paymentId: string,
    tableId: string,
    fields: { done?: boolean; permission?: string; details?: Record<string, unknown> } = {},
  ) {
    const id = newId('al')
    await world.owner.query(
      `insert into restro.alerts
         (id, tenant_id, venue_id, service_date, kind, audience, subject_id, permission, details,
          done_at, done_by, source, actor, job_id)
       values ($1, $2, $3, $4, $5, 'venue', $6, $7, $8::jsonb,
               case when $9::boolean then now() else null end,
               case when $9::boolean then 'system' else null end, $10, $11, $12)`,
      [
        id,
        world.tenantId,
        world.venueId,
        day,
        kind,
        paymentId,
        fields.permission ?? 'money.follow_up',
        JSON.stringify({
          paymentId,
          tableId,
          amountMinor: 3800,
          tipMinor: 200,
          captureBefore: '2026-11-02T20:00:00Z',
          ...fields.details,
        }),
        fields.done === true,
        ...seed,
      ],
    )
    return id
  }

  beforeAll(async () => {
    world = await openServiceWorld('night-payments')
    staffUser = await world.addUser('member')
    await world.addStaff(['night.view', 'alerts.answer'], staffUser)
    managerUser = await world.addUser('member')
    await world.addStaff(['night.view_full', 'log.view', 'money.follow_up'], managerUser)
    waiterUser = await world.addUser('member')
    await world.addStaff(['alerts.answer'], waiterUser)
    loggerUser = await world.addUser('member')
    await world.addStaff(['log.view'], loggerUser)
    // Follows money up but does not read the whole night: tips are not theirs (#220).
    followUpUser = await world.addUser('member')
    await world.addStaff(['night.view', 'alerts.answer', 'money.follow_up'], followUpUser)
    bringerUser = await world.addUser('member')
    await world.addStaff(['alerts.answer', 'night.view_full'], bringerUser)

    const first = await readNight(world.app, input(user(staffUser)))
    if (!first.ok) throw new Error(`refused: ${first.code}`)
    day = first.night.day

    const captured = await addPayment('captured', {
      tableIndex: 0,
      state: 'captured',
      capturedMinor: 3800,
      receiptNumber: 'R-1001',
      refundedMinor: 500,
    })
    await addPayment('noReceipt', {
      tableIndex: 1,
      state: 'captured',
      capturedMinor: 3800,
      receiptNumber: null,
    })
    const unconfirmed = await addPayment('unconfirmed', {
      tableIndex: 2,
      state: 'unconfirmed',
      reason: 'close_unknown',
      captureBefore: '2026-11-02T20:00:00Z',
    })
    await addAlert('payment_unconfirmed', unconfirmed.id, unconfirmed.tableId)
    // Its alert was cleared by the day's close, yet it must stay in the list.
    const failed = await addPayment('failed', { tableIndex: 3, state: 'capture_failed' })
    await addAlert('payment_capture_failed', failed.id, failed.tableId, {
      done: true,
      details: { clearedAt: 'day_close' },
    })
    await addPayment('released', { tableIndex: 3, state: 'released', reason: 'busy' })
    await addPayment('disputed', {
      tableIndex: 0,
      state: 'captured',
      receiptNumber: 'R-1002',
      dispute: 'open',
    })
    await world.owner.query(
      `insert into restro.log_entries
         (tenant_id, venue_id, service_date, kind, payment_id, table_id, to_state, reason, details,
          retention, source, actor, job_id)
       values ($1, $2, $3, 'payment.state', $4, $5, 'captured', null, '{}'::jsonb, 'record',
               'worker', 'system', 'test-seed')`,
      [world.tenantId, world.venueId, day, captured.id, captured.tableId],
    )
  })

  afterAll(async () => {
    await world?.close()
  })

  it("lists what to fix from the payments' states, with or without an open alert", async () => {
    const read = await readNightPayments(world.app, input(user(managerUser)))
    if (!read.ok) throw new Error(read.code)
    const problems = read.payments.fix.map((fix) => [fix.problem, fix.alert !== null])
    expect(problems).toEqual(
      expect.arrayContaining([
        ['no_receipt', false],
        ['unconfirmed', true],
        ['capture_failed', false],
      ]),
    )
    expect(read.payments.fix).toHaveLength(3)
    const unconfirmed = read.payments.fix.find((fix) => fix.problem === 'unconfirmed')
    expect(unconfirmed?.question).toBe('close')
    expect(read.payments.counts).toEqual({ all: 6, captured: 3, released: 1, unconfirmed: 1 })
  })

  it('shows the payments that did not end charged first, and all of them on request', async () => {
    const some = await readNightPayments(world.app, input(user(managerUser)))
    if (!some.ok) throw new Error(some.code)
    expect(some.payments.rows.map((row) => row.state).sort()).toEqual([
      'capture_failed',
      'released',
      'unconfirmed',
    ])
    const all = await readNightPayments(world.app, { ...input(user(managerUser)), all: 100 })
    if (!all.ok) throw new Error(all.code)
    expect(all.payments.rows).toHaveLength(6)
    expect(all.payments.hasMore).toBe(false)
  })

  it('gives staff the payments without tips, and no money sections', async () => {
    const read = await readNightPayments(world.app, { ...input(user(staffUser)), all: 100 })
    if (!read.ok) throw new Error(read.code)
    expect(read.payments.full).toBe(false)
    expect(read.payments.money).toBeNull()
    expect(read.payments.rows.every((row) => row.tipMinor === null)).toBe(true)
    const manager = await readNightPayments(world.app, { ...input(user(managerUser)), all: 100 })
    if (!manager.ok) throw new Error(manager.code)
    expect(manager.payments.rows.some((row) => row.tipMinor === 200)).toBe(true)
  })

  it('gives staff every amount of a payment without its tip, so total minus lines gives none away', async () => {
    const staff = await readNightPayments(world.app, { ...input(user(staffUser)), all: 100 })
    if (!staff.ok) throw new Error(staff.code)
    const manager = await readNightPayments(world.app, { ...input(user(managerUser)), all: 100 })
    if (!manager.ok) throw new Error(manager.code)
    // Every seeded payment is 38.00 with a 2.00 tip; the captured ones were charged 38.00 too.
    expect(manager.payments.rows.every((row) => row.amountMinor === 3800)).toBe(true)
    expect(staff.payments.rows.every((row) => row.amountMinor === 3600)).toBe(true)
    expect(staff.payments.rows.flatMap((row) => row.capturedMinor ?? [])).toEqual([3600, 3600])
    expect(manager.payments.rows.flatMap((row) => row.capturedMinor ?? [])).toEqual([3800, 3800])
    // The rows To fix are the same payments.
    expect(staff.payments.fix.every((fix) => fix.payment.amountMinor === 3600)).toBe(true)
    expect(manager.payments.fix.every((fix) => fix.payment.amountMinor === 3800)).toBe(true)
  })

  it('gives a role that follows money up but does not read the whole night no tip and no money totals', async () => {
    const tonight = await readTonight(world.app, input(user(followUpUser)))
    if (!tonight.ok) throw new Error(tonight.code)
    const question = tonight.tonight.alerts.find((alert) => alert.kind === 'payment_unconfirmed')
    expect(question?.details).toMatchObject({ amountMinor: 3600 })
    expect(question?.details).not.toHaveProperty('tipMinor')
    const night = await readNight(world.app, input(user(followUpUser)))
    if (!night.ok) throw new Error(night.code)
    // The totals hold the tips: a manager reads them, this role does not.
    expect(night.night.money).toBeNull()
    const manager = await readNight(world.app, input(user(managerUser)))
    if (!manager.ok) throw new Error(manager.code)
    expect(manager.night.money).not.toBeNull()
    // A refund may hold the tip: staff rows carry none.
    const rows = await readNightPayments(world.app, { ...input(user(followUpUser)), all: 100 })
    if (!rows.ok) throw new Error(rows.code)
    expect(rows.payments.rows.every((row) => row.refundedMinor === 0)).toBe(true)
  })

  it('gives the receipt to bring the charge without the tip to staff, with it to a reader of the night', async () => {
    await world.owner.query(
      'update restro.payments set receipt_to_bring_at = now() where id = $1',
      [ids.captured],
    )
    try {
      const amountOf = async (who: string) => {
        const read = await readReceiptsToBring(world.app, input(user(who)))
        if (!read.ok) throw new Error(read.code)
        return read.receipts.map((receipt) => receipt.amountMinor)
      }
      expect(await amountOf(staffUser)).toEqual([3600])
      expect(await amountOf(bringerUser)).toEqual([3800])
      // Tonight's own read carries the same rows.
      const tonight = await readTonight(world.app, input(user(staffUser)))
      if (!tonight.ok) throw new Error(tonight.code)
      expect(tonight.tonight.receipts?.map((receipt) => receipt.amountMinor)).toEqual([3600])
    } finally {
      await world.owner.query(
        'update restro.payments set receipt_to_bring_at = null where id = $1',
        [ids.captured],
      )
    }
  })

  it("gives staff a payment sheet's total without the tip", async () => {
    const staff = await readPaymentDetail(world.app, {
      ...input(user(staffUser)),
      paymentId: ids.captured as string,
    })
    if (!staff.ok) throw new Error(staff.code)
    expect(staff.detail?.payment).toMatchObject({ amountMinor: 3600, tipMinor: null })
    const manager = await readPaymentDetail(world.app, {
      ...input(user(managerUser)),
      paymentId: ids.captured as string,
    })
    if (!manager.ok) throw new Error(manager.code)
    expect(manager.detail?.payment).toMatchObject({ amountMinor: 3800, tipMinor: 200 })
  })

  it("gives Tonight's money rows and the Log's payment line the amount without the tip to staff", async () => {
    const waiter = await readTonight(world.app, input(user(waiterUser)))
    if (!waiter.ok) throw new Error(waiter.code)
    const question = waiter.tonight.alerts.find((alert) => alert.kind === 'payment_unconfirmed')
    expect(question?.details).toMatchObject({ amountMinor: 3600 })
    expect(question?.details).not.toHaveProperty('tipMinor')
    const manager = await readTonight(world.app, input(user(managerUser)))
    if (!manager.ok) throw new Error(manager.code)
    const asked = manager.tonight.alerts.find((alert) => alert.kind === 'payment_unconfirmed')
    expect(asked?.details).toMatchObject({ amountMinor: 3800, tipMinor: 200 })

    const amountOfPayment = async (who: string) => {
      const log = await readLog(world.app, input(user(who)))
      if (!log.ok) throw new Error(log.code)
      return log.page.rows.find((line) => line.kind === 'payment.state')?.amountMinor
    }
    expect(await amountOfPayment(loggerUser)).toBe(3600)
    expect(await amountOfPayment(managerUser)).toBe(3800)
  })

  it('reads the money alerts with their answers, the refunds and the disputes for managers', async () => {
    const read = await readNightPayments(world.app, input(user(managerUser)))
    if (!read.ok) throw new Error(read.code)
    const { money } = read.payments
    expect(money?.alerts.map((alert) => [alert.kind, alert.answer === null])).toEqual([
      ['payment_unconfirmed', true],
      // Cleared by the day's close: nobody answered it.
      ['payment_capture_failed', true],
    ])
    expect(money?.refunds.map((refund) => refund.refundedMinor)).toEqual([500])
    expect(money?.disputes.rows).toHaveLength(1)
    expect(money?.disputes.openCount).toBe(1)
  })

  it("counts the unconfirmed payments in the night's totals", async () => {
    const read = await readNight(world.app, input(user(managerUser)))
    if (!read.ok) throw new Error(read.code)
    expect(read.night.money).toMatchObject({ paymentsUnconfirmed: 1, unconfirmedMinor: 3800 })
  })

  it('lets a waiter see a payment question on Tonight but not read the night', async () => {
    const tonight = await readTonight(world.app, input(user(waiterUser)))
    if (!tonight.ok) throw new Error(tonight.code)
    expect(tonight.tonight.alerts.map((alert) => alert.kind)).toEqual(['payment_unconfirmed'])
    const night = await readNightPayments(world.app, input(user(waiterUser)))
    expect(night.ok).toBe(false)
  })

  it('reads one payment for its sheet, with its steps', async () => {
    const read = await readPaymentDetail(world.app, {
      ...input(user(managerUser)),
      paymentId: ids.captured as string,
    })
    if (!read.ok) throw new Error(read.code)
    expect(read.detail?.payment.state).toBe('captured')
    expect(read.detail?.payment.tipMinor).toBe(200)
    expect(read.detail?.steps.map((step) => step.toState)).toEqual(['captured'])
    const staff = await readPaymentDetail(world.app, {
      ...input(user(staffUser)),
      paymentId: ids.captured as string,
    })
    if (!staff.ok) throw new Error(staff.code)
    expect(staff.detail?.payment.tipMinor).toBeNull()
    const missing = await readPaymentDetail(world.app, {
      ...input(user(managerUser)),
      paymentId: 'py_doesnotexist',
    })
    if (!missing.ok) throw new Error(missing.code)
    expect(missing.detail).toBeNull()
  })
})
