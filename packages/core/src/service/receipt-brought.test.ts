// "Bring the receipt" and "Brought" (#200) on a real Postgres, as the restro_app role: a capture
// with the POS's receipt number raises a paper receipt to bring (none without the number, none when
// an electronic receipt was sent); staff mark it Brought with no PIN on a shared device and the Log
// names the account; a repeat changes nothing; Undo puts it back; a payment that never left a
// receipt is refused; the reads list Tonight's open receipts and the end of the night's, with no
// amount; the table refuses a Brought mark on a payment with no receipt to bring. Skipped without a
// database.
import { createHash, randomUUID } from 'node:crypto'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { provisionVenue } from '../apply/provision'
import { createArea, createTable } from '../apply/tables'
import { hasDatabase, testSlug } from '../apply/test-database'
import { newId } from '../ids'
import { serviceDate } from '../service-day'
import { openServiceWorld, type ServiceWorld } from '../testing/service-world'
import type { ServiceActor, ServiceContext } from './context'
import {
  applyService,
  readNightPayments,
  readNightPaymentsReport,
  readReceiptsNotBrought,
  readReceiptsToBring,
  readTonight,
  type ServiceCommand,
} from './index'
import { paymentNumberOf } from './payment-number'
import { DEFAULT_ROLE_PERMISSIONS } from './permissions'

describe.skipIf(!hasDatabase)('Bring the receipt (as the restro_app role)', () => {
  let world: ServiceWorld
  let ownerId: string
  let staffId: string
  let mayNotId: string
  let day: string
  const sittings = new Map<number, string>()
  const deviceSession = `device-${randomUUID()}`

  beforeAll(async () => {
    world = await openServiceWorld('receipt-brought')
    ownerId = await world.addUser('owner')
    staffId = await world.addUser('member')
    await world.addStaff(DEFAULT_ROLE_PERMISSIONS.staff, staffId)
    // Holds the Log and nothing that answers an alert.
    mayNotId = await world.addUser('member')
    await world.addStaff(['log.view'], mayNotId)
    await world.addSharedDevice(deviceSession)
    const { rows } = await world.owner.query<{ timezone: string; ends: string }>(
      'select timezone, service_day_ends_at::text as ends from restro.venues where id = $1',
      [world.venueId],
    )
    day = serviceDate(new Date(), rows[0]?.timezone as string, rows[0]?.ends as string)
  })

  afterAll(async () => {
    await world?.close()
  })

  const context = (actor: ServiceActor, origin: ServiceContext['origin'] = 'staff') =>
    ({
      tenantId: world.tenantId,
      venueId: world.venueId,
      origin,
      actor,
      jobId: `receipt-${randomUUID()}`,
      ...(origin === 'staff' ? { via: 'tonight' } : {}),
    }) as ServiceContext
  const user = (userId: string, sessionId = 'session-1'): ServiceActor => ({
    kind: 'user',
    userId,
    sessionId,
  })
  const worker = (): ServiceContext => context({ kind: 'system' }, 'worker')
  const run = async (command: ServiceCommand, ctx: ServiceContext) =>
    (await applyService(world.app, command, ctx)).result

  /** The table's open sitting: one at a time, so every payment of a table shares it. */
  async function sittingOf(table: number): Promise<string> {
    const held = sittings.get(table)
    if (held !== undefined) return held
    const id = await world.openSitting(world.tables[table] as string)
    sittings.set(table, id)
    return id
  }

  /**
   * A bill closed on the POS and waiting for its capture; or, with `printed`, one a manager
   * answered "Receipt printed" (unconfirmed, no receipt number read).
   */
  async function closed(
    receiptNumber: string | null = 'R-000123',
    table = 0,
    serviceDay = day,
    printed = false,
  ): Promise<string> {
    const id = newId('py')
    await world.owner.query(
      `insert into restro.payments
         (id, tenant_id, venue_id, table_id, sitting_id, service_date, kind, state, handle_hash,
          amount_minor, tip_minor, currency, provider_kind, receipt_number, reason, settled_at,
          source, actor, job_id)
       values ($1, $2, $3, $4, $5, $6, 'on_bill', $9, $7, 1500, 100, 'EUR', 'sim-pay', $8, $10,
          case when $9 = 'unconfirmed' then now() end, 'restro', 'system', 'test-seed')`,
      [
        id,
        world.tenantId,
        world.venueId,
        world.tables[table],
        await sittingOf(table),
        serviceDay,
        createHash('sha256').update(id).digest('hex'),
        receiptNumber,
        printed ? 'unconfirmed' : 'closed',
        printed ? 'receipt_printed' : null,
      ],
    )
    return id
  }
  const capture = (id: string, more: Record<string, unknown> = {}) =>
    run(
      {
        type: 'payment.captured',
        paymentId: id,
        outcome: 'captured',
        capturedMinor: 1450,
        code: null,
        ...more,
      } as ServiceCommand,
      worker(),
    )
  /** A captured payment with a receipt to bring. */
  async function toBring(table = 0, serviceDay = day): Promise<string> {
    const id = await closed('R-000123', table, serviceDay)
    expect(await capture(id)).toMatchObject({ status: 'accepted' })
    return id
  }
  const brought = (id: string) => ({ type: 'receipt.brought', paymentId: id }) as ServiceCommand
  const unbrought = (id: string) => ({ type: 'receipt.unbrought', paymentId: id }) as ServiceCommand
  const row = async (id: string) =>
    (
      await world.owner.query<{
        to_bring: Date | null
        brought_at: Date | null
        brought_by: string | null
      }>(
        `select receipt_to_bring_at as to_bring, receipt_brought_at as brought_at,
                receipt_brought_by as brought_by
           from restro.payments where id = $1`,
        [id],
      )
    ).rows[0]
  const logOf = async (id: string) =>
    (
      await world.owner.query<{
        kind: string
        from_state: string | null
        to_state: string | null
        actor: string
        via: string | null
      }>(
        `select kind, from_state, to_state, actor, via from restro.log_entries
          where payment_id = $1 and kind = 'receipt.brought' order by seq`,
        [id],
      )
    ).rows
  const openIds = async (actor: ServiceActor = user(staffId)) => {
    const read = await readReceiptsToBring(world.app, {
      tenantId: world.tenantId,
      venueId: world.venueId,
      actor,
    })
    if (!read.ok) throw new Error(`refused: ${read.code}`)
    return read.receipts.map((receipt) => receipt.paymentId)
  }

  it('raises a receipt to bring at capture when the POS gave its number', async () => {
    const id = await closed()
    expect((await row(id))?.to_bring).toBeNull()
    expect(await capture(id)).toMatchObject({ status: 'accepted' })
    expect((await row(id))?.to_bring).toBeInstanceOf(Date)
    // The capture's Log line says so; a repeat of the capture changes nothing.
    const { rows } = await world.owner.query<{ details: Record<string, unknown> }>(
      `select details from restro.log_entries
        where payment_id = $1 and kind = 'payment.state' and to_state = 'captured'`,
      [id],
    )
    expect(rows).toHaveLength(1)
    expect(rows[0]?.details).toMatchObject({ receiptToBring: true })
    const first = (await row(id))?.to_bring
    expect(await capture(id)).toMatchObject({ status: 'accepted', details: { changed: false } })
    expect((await row(id))?.to_bring).toEqual(first)
  })

  it('raises one for a capture with no receipt number too, as after a manager’s "Receipt printed"', async () => {
    const noNumber = await closed(null)
    await capture(noNumber)
    const printed = await closed(null, 0, day, true)
    await capture(printed)
    for (const id of [noNumber, printed]) {
      expect((await row(id))?.to_bring).toBeInstanceOf(Date)
      expect(await openIds()).toContain(id)
    }
    const read = await readReceiptsToBring(world.app, {
      tenantId: world.tenantId,
      venueId: world.venueId,
      actor: user(staffId),
    })
    if (!read.ok) throw new Error(read.code)
    expect(read.receipts.find((receipt) => receipt.paymentId === printed)).toMatchObject({
      receiptNumber: null,
      amountMinor: 1450,
    })
    expect(await run(brought(printed), context(user(staffId)))).toMatchObject({
      details: { changed: true },
    })
  })

  it('raises none once an electronic receipt was sent, or before the capture', async () => {
    const sent = await closed('R-000124')
    await capture(sent, { electronicReceipt: true })
    const waiting = await closed('R-000125')
    expect((await row(sent))?.to_bring).toBeNull()
    expect(await openIds()).not.toContain(sent)
    // Brought on either is refused: there is nothing to bring.
    for (const id of [sent, waiting]) {
      expect(await run(brought(id), context(user(staffId)))).toMatchObject({
        status: 'refused',
        code: 'no_receipt_to_bring',
      })
    }
  })

  it('marks it Brought, names the account and takes it off Tonight', async () => {
    const id = await toBring()
    expect(await openIds()).toContain(id)
    const result = await run(brought(id), context(user(staffId)))
    expect(result).toMatchObject({ status: 'accepted', details: { brought: true, changed: true } })
    expect(await row(id)).toMatchObject({ brought_by: `user:${staffId}` })
    expect((await row(id))?.brought_at).toBeInstanceOf(Date)
    expect(await openIds()).not.toContain(id)
    expect(await logOf(id)).toEqual([
      expect.objectContaining({
        kind: 'receipt.brought',
        from_state: 'to_bring',
        to_state: 'brought',
        actor: `user:${staffId}`,
        via: 'tonight',
      }),
    ])
  })

  it('treats a repeat as done: nothing changes, nothing is logged twice', async () => {
    const id = await toBring()
    await run(brought(id), context(user(staffId)))
    const at = (await row(id))?.brought_at
    expect(await run(brought(id), context(user(ownerId)))).toMatchObject({
      status: 'accepted',
      details: { changed: false },
    })
    expect((await row(id))?.brought_at).toEqual(at)
    expect((await row(id))?.brought_by).toBe(`user:${staffId}`)
    expect(await logOf(id)).toHaveLength(1)
  })

  it('undoes it: the receipt is back on Tonight and the Log says so', async () => {
    const id = await toBring()
    await run(brought(id), context(user(staffId)))
    expect(await run(unbrought(id), context(user(staffId)))).toMatchObject({
      status: 'accepted',
      details: { brought: false, changed: true },
    })
    expect(await row(id)).toMatchObject({ brought_at: null, brought_by: null })
    expect(await openIds()).toContain(id)
    expect((await logOf(id)).map((entry) => [entry.from_state, entry.to_state])).toEqual([
      ['to_bring', 'brought'],
      ['brought', 'to_bring'],
    ])
    // Undo again, or Undo of a receipt never marked, changes nothing.
    expect(await run(unbrought(id), context(user(staffId)))).toMatchObject({
      details: { changed: false },
    })
    expect(await logOf(id)).toHaveLength(2)
    // It can be marked again after an Undo.
    expect(await run(brought(id), context(user(staffId)))).toMatchObject({
      details: { changed: true },
    })
  })

  it('needs no PIN on a shared device: the device’s own account is named', async () => {
    const id = await toBring()
    expect(await run(brought(id), context(user(ownerId, deviceSession)))).toMatchObject({
      status: 'accepted',
      details: { changed: true },
    })
    expect(await row(id)).toMatchObject({ brought_by: `user:${ownerId}` })
    expect((await logOf(id))[0]).toMatchObject({ actor: `user:${ownerId}` })
    expect(await run(unbrought(id), context(user(ownerId, deviceSession)))).toMatchObject({
      status: 'accepted',
      details: { changed: true },
    })
  })

  it('refuses an actor without alerts.answer, the worker, and a payment that is not the venue’s', async () => {
    const id = await toBring()
    expect(await run(brought(id), context(user(mayNotId)))).toMatchObject({
      status: 'refused',
      code: 'permission_denied',
    })
    expect(await run(brought(id), worker())).toMatchObject({
      status: 'refused',
      code: 'origin_not_allowed',
    })
    expect(await run(brought(newId('py')), context(user(staffId)))).toMatchObject({
      status: 'refused',
      code: 'payment_missing',
    })
    expect(await row(id)).toMatchObject({ brought_at: null })
  })

  it('does not touch a payment of another venue of the same organisation', async () => {
    const venue = await provisionVenue(world.app, world.tenantId, {
      name: 'Second club',
      slug: testSlug('receipt-second'),
    })
    const area = await createArea(world.app, world.tenantId, venue.id, 'Hall')
    if (!area.ok) throw new Error('area refused')
    const table = await createTable(world.app, world.tenantId, {
      areaId: area.area.id,
      name: null,
      number: '1',
    })
    if (!table.ok) throw new Error('table refused')
    const sitting = newId('st')
    await world.owner.query(
      `insert into restro.sittings (id, tenant_id, venue_id, table_id, service_date, opened_how, source, actor, job_id)
       values ($1, $2, $3, $4, $5, 'one', 'restro', 'system', 'test-seed')`,
      [sitting, world.tenantId, venue.id, table.table.id, day],
    )
    const other = newId('py')
    await world.owner.query(
      `insert into restro.payments
         (id, tenant_id, venue_id, table_id, sitting_id, service_date, kind, state, handle_hash,
          amount_minor, captured_minor, currency, provider_kind, settled_at, receipt_to_bring_at,
          source, actor, job_id)
       values ($1, $2, $3, $4, $5, $6, 'on_bill', 'captured', $7, 1000, 1000, 'EUR', 'sim-pay',
          now(), now(), 'restro', 'system', 'test-seed')`,
      [
        other,
        world.tenantId,
        venue.id,
        table.table.id,
        sitting,
        day,
        createHash('sha256').update(other).digest('hex'),
      ],
    )
    // The first venue's staff can neither mark it, nor undo it, nor see it.
    for (const command of [brought(other), unbrought(other)]) {
      expect(await run(command, context(user(staffId)))).toMatchObject({
        status: 'refused',
        code: 'payment_missing',
      })
    }
    expect(await row(other)).toMatchObject({ brought_at: null })
    expect(await openIds()).not.toContain(other)
  })

  it('lists Tonight’s receipts oldest first with the receipt number and amount, for alerts.answer only', async () => {
    const first = await toBring(1)
    const second = await toBring(2)
    const old = await toBring(3, '2000-01-01')
    const read = await readReceiptsToBring(world.app, {
      tenantId: world.tenantId,
      venueId: world.venueId,
      actor: user(staffId),
    })
    if (!read.ok) throw new Error(read.code)
    const ids = read.receipts.map((receipt) => receipt.paymentId)
    expect(ids.indexOf(first)).toBeLessThan(ids.indexOf(second))
    // An earlier night's receipt is not Tonight's.
    expect(ids).not.toContain(old)
    expect(read.receipts.find((receipt) => receipt.paymentId === first)).toMatchObject({
      paymentNumber: paymentNumberOf(first),
      tableId: world.tables[1],
      receiptNumber: 'R-000123',
      // What was charged, not what was held.
      amountMinor: 1450,
      currency: 'EUR',
    })
    const refusedRead = await readReceiptsToBring(world.app, {
      tenantId: world.tenantId,
      venueId: world.venueId,
      actor: user(mayNotId),
    })
    expect(refusedRead).toEqual({ ok: false, code: 'permission_denied' })
  })

  it('lists the night’s receipts never brought, by table, without an amount', async () => {
    const fresh = await toBring(1, '2001-02-03')
    const done = await toBring(2, '2001-02-03')
    await run(brought(done), context(user(staffId)))
    const read = await readReceiptsNotBrought(world.app, {
      tenantId: world.tenantId,
      venueId: world.venueId,
      actor: user(staffId),
      day: '2001-02-03',
    })
    if (!read.ok) throw new Error(read.code)
    expect(read.notBrought.day).toBe('2001-02-03')
    expect(read.notBrought.hasMore).toBe(false)
    expect(read.notBrought.rows).toEqual([
      {
        paymentId: fresh,
        paymentNumber: paymentNumberOf(fresh),
        tableId: world.tables[1],
        // A numbered table has no name.
        name: null,
        number: '2',
      },
    ])
    // No amount, tip or receipt number leaves with the list (Telegram shows none).
    expect(JSON.stringify(read.notBrought)).not.toMatch(/1450|amount|tip|R-000123/)
    // A role without the night's view is refused.
    expect(
      await readReceiptsNotBrought(world.app, {
        tenantId: world.tenantId,
        venueId: world.venueId,
        actor: user(mayNotId),
      }),
    ).toEqual({ ok: false, code: 'permission_denied' })
  })

  it('reads today when the day asked for is no date or lies ahead', async () => {
    const mine = await toBring(0)
    for (const asked of ['not-a-date', '2999-12-31', "2001-02-03'; --", '']) {
      const read = await readReceiptsNotBrought(world.app, {
        tenantId: world.tenantId,
        venueId: world.venueId,
        actor: user(staffId),
        day: asked,
      })
      if (!read.ok) throw new Error(read.code)
      expect(read.notBrought.day, asked).toBe(day)
      expect(
        read.notBrought.rows.map((row) => row.paymentId),
        asked,
      ).toContain(mine)
    }
  })

  it('puts the receipts on Tonight for those who answer, and takes a marked one off it', async () => {
    const id = await toBring(1)
    const tonight = async (actor: ServiceActor) => {
      const read = await readTonight(world.app, {
        tenantId: world.tenantId,
        venueId: world.venueId,
        actor,
      })
      if (!read.ok) throw new Error(read.code)
      return read.tonight.receipts
    }
    expect((await tonight(user(staffId)))?.map((receipt) => receipt.paymentId)).toContain(id)
    // Someone who holds no `alerts.answer` is given none, not an empty list.
    expect(await tonight(user(mayNotId))).toBeNull()
    await run(brought(id), context(user(staffId)))
    expect((await tonight(user(staffId)))?.map((receipt) => receipt.paymentId)).not.toContain(id)
  })

  it('lists the receipts not brought on the end of the night’s payments and in the group’s message', async () => {
    const left = await toBring(1, '2002-03-04')
    const done = await toBring(2, '2002-03-04')
    await run(brought(done), context(user(staffId)))
    const read = await readNightPayments(world.app, {
      tenantId: world.tenantId,
      venueId: world.venueId,
      actor: user(staffId),
      day: '2002-03-04',
    })
    if (!read.ok) throw new Error(read.code)
    expect(read.payments.notBrought.map((entry) => entry.paymentId)).toEqual([left])
    expect(read.payments.notBrought[0]?.paymentNumber).toBe(paymentNumberOf(left))
    // The group's message gets the table and the number, never an amount.
    const report = await readNightPaymentsReport(world.app, {
      tenantId: world.tenantId,
      venueId: world.venueId,
      day: '2002-03-04',
    })
    expect(report.fix).toEqual([
      expect.objectContaining({
        what: 'receipt_not_brought',
        number: '2',
        paymentNumber: paymentNumberOf(left),
      }),
    ])
    expect(JSON.stringify(report)).not.toMatch(/1450|amount|tip/)
  })

  it('is kept honest by the table: Brought needs a receipt to bring and an account, a receipt to bring a captured payment', async () => {
    // Closed, not captured yet: nothing to bring and nothing to mark.
    const none = await closed(null)
    await expect(
      world.owner.query(
        `update restro.payments set receipt_brought_at = now(), receipt_brought_by = 'user:u1' where id = $1`,
        [none],
      ),
    ).rejects.toThrow(/payments_receipt_brought/)
    const id = await toBring()
    await expect(
      world.owner.query(`update restro.payments set receipt_brought_at = now() where id = $1`, [
        id,
      ]),
    ).rejects.toThrow(/payments_receipt_brought/)
    await expect(
      world.owner.query(`update restro.payments set receipt_to_bring_at = now() where id = $1`, [
        none,
      ]),
    ).rejects.toThrow(/payments_receipt_brought/)
  })
})
