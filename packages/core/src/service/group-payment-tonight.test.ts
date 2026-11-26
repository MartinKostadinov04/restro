// A group payment in Tonight (#545; D160 §2 and §3, decision log 2.16) on a real Postgres, as the
// restro_app role:
// - a payment covering several tables of a linked group leaves a receipt row for every table it
//   covered, each naming its own table and the one that paid, and one "Brought" clears them all;
// - a share still gathering its holds reads what is held of how much, the tables it covers and when
//   the guests' time ends, for every role, never who holds; one covered or let go no longer does;
// - "Cancel sharing" is the right to open and close tables and needs no PIN on the shared tablet;
// - a table closed because a payment made at another table of its group settled its bill says so.
// Skipped without a database.
import { createHash, randomUUID } from 'node:crypto'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { hasDatabase } from '../apply/test-database'
import { newId } from '../ids'
import { serviceDate } from '../service-day'
import { openServiceWorld, type ServiceWorld } from '../testing/service-world'
import type { ServiceActor, ServiceContext } from './context'
import {
  applyService,
  readReceiptsToBring,
  readTableState,
  readTonight,
  type ServiceCommand,
} from './index'
import { DEFAULT_ROLE_PERMISSIONS } from './permissions'

describe.skipIf(!hasDatabase)('A group payment in Tonight (as the restro_app role)', () => {
  let world: ServiceWorld
  let staffId: string
  let viewerId: string
  let day: string
  const deviceSession = `device-${randomUUID()}`
  const sittings = new Map<number, string>()

  beforeAll(async () => {
    world = await openServiceWorld('group-payment-tonight')
    staffId = await world.addUser('member')
    await world.addStaff(DEFAULT_ROLE_PERMISSIONS.staff, staffId)
    // Reads Tonight and answers alerts, but may not open or close a table.
    viewerId = await world.addUser('member')
    await world.addStaff(['alerts.answer', 'night.view'], viewerId)
    await world.addSharedDevice(deviceSession)
    const { rows } = await world.owner.query<{ timezone: string; ends: string }>(
      'select timezone, service_day_ends_at::text as ends from restro.venues where id = $1',
      [world.venueId],
    )
    day = serviceDate(new Date(), rows[0]?.timezone as string, rows[0]?.ends as string)
  })

  afterAll(async () => {
    // The shared clean-up does not know the holds, which hang on the payments it deletes.
    await world?.owner.query('delete from restro.payment_holds where tenant_id = $1', [
      world.tenantId,
    ])
    await world?.close()
  })

  const context = (actor: ServiceActor, origin: ServiceContext['origin'] = 'staff') =>
    ({
      tenantId: world.tenantId,
      venueId: world.venueId,
      origin,
      actor,
      jobId: `group-${randomUUID()}`,
      ...(origin === 'staff' ? { via: 'tonight' } : {}),
    }) as ServiceContext
  const user = (userId: string, sessionId = 'session-1'): ServiceActor => ({
    kind: 'user',
    userId,
    sessionId,
  })
  const run = async (command: ServiceCommand, ctx: ServiceContext) =>
    (await applyService(world.app, command, ctx)).result
  const table = (n: number) => world.tables[n] as string

  async function sittingOf(n: number): Promise<string> {
    const held = sittings.get(n)
    if (held !== undefined) return held
    const id = await world.openSitting(table(n))
    sittings.set(n, id)
    return id
  }

  /** A payment made at table `at` whose lines are on `covered` tables, one line on each. */
  async function payment(
    at: number,
    covered: readonly number[],
    state: 'closed' | 'awaiting_guest',
    shared: number | null = null,
  ): Promise<string> {
    const id = newId('py')
    await world.owner.query(
      `insert into restro.payments
         (id, tenant_id, venue_id, table_id, sitting_id, service_date, kind, state, handle_hash,
          amount_minor, tip_minor, shared_minor, gathering_ends_at, currency, provider_kind,
          receipt_number, source, actor, job_id)
       values ($1, $2, $3, $4, $5, $6, 'on_bill', $7, $8, $9, 0, $10, $11, 'EUR', 'sim-pay',
               $12, 'restro', 'system', 'test-seed')`,
      [
        id,
        world.tenantId,
        world.venueId,
        table(at),
        await sittingOf(at),
        day,
        state,
        createHash('sha256').update(id).digest('hex'),
        shared === null ? 3600 : null,
        shared,
        shared === null ? null : new Date(Date.now() + 8 * 60_000).toISOString(),
        shared === null ? 'R-000999' : null,
      ],
    )
    let position = 0
    for (const n of covered) {
      position += 1
      await world.owner.query(
        `insert into restro.payment_lines
           (tenant_id, venue_id, payment_id, table_id, position, pos_line_ref, quantity,
            pos_amount_minor, display_name, source, actor, job_id)
         values ($1, $2, $3, $4, $5, $6, 1, $7, 'Gin tonic', 'restro', 'system', 'test-seed')`,
        [world.tenantId, world.venueId, id, table(n), position, `line-${id}-${position}`, 1800],
      )
    }
    return id
  }
  const hold = async (paymentId: string, state: string, amount: number, tip = 0) => {
    const id = newId('ph')
    await world.owner.query(
      `insert into restro.payment_holds
         (id, tenant_id, venue_id, payment_id, state, handle_hash, amount_minor, tip_minor, currency,
          provider_kind, settled_at, source, actor, job_id)
       values ($1, $2, $3, $4, $5, $6, $7, $8, 'EUR', 'sim-pay',
               case when $5 = 'released' then now() end, 'restro', 'system', 'test-seed')`,
      [
        id,
        world.tenantId,
        world.venueId,
        paymentId,
        state,
        createHash('sha256').update(id).digest('hex'),
        amount,
        tip,
      ],
    )
    return id
  }
  const capture = (id: string) =>
    run(
      {
        type: 'payment.captured',
        paymentId: id,
        outcome: 'captured',
        capturedMinor: 3600,
        code: null,
      } as ServiceCommand,
      context({ kind: 'system' }, 'worker'),
    )
  const tonight = async (actor: ServiceActor) => {
    const read = await readTonight(world.app, {
      tenantId: world.tenantId,
      venueId: world.venueId,
      actor,
    })
    if (!read.ok) throw new Error(`refused: ${read.code}`)
    return read.tonight
  }
  const receiptsOf = async (id: string) => {
    const read = await readReceiptsToBring(world.app, {
      tenantId: world.tenantId,
      venueId: world.venueId,
      actor: user(staffId),
    })
    if (!read.ok) throw new Error(read.code)
    return read.receipts.filter((receipt) => receipt.paymentId === id)
  }

  it('leaves a receipt row for every table one payment covered, the paying table the payer of each', async () => {
    const id = await payment(0, [0, 1], 'closed')
    expect(await capture(id)).toMatchObject({ status: 'accepted' })
    const rows = await receiptsOf(id)
    expect(rows.map((row) => row.tableId).sort()).toEqual([table(0), table(1)].sort())
    for (const row of rows) {
      expect(row.payer.tableId).toBe(table(0))
      expect(row.paymentNumber).toBe(rows[0]?.paymentNumber)
      expect(row.amountMinor).toBe(3600)
    }
    // Each names its own table: the table's number, as its tile does.
    expect(rows.find((row) => row.tableId === table(1))).toMatchObject({ number: '2' })
    // The same, as Tonight reads it.
    const read = await tonight(user(staffId))
    expect((read.receipts ?? []).filter((row) => row.paymentId === id)).toHaveLength(2)
  })

  it('clears the payment from every table at one "Brought", and Undo puts every row back', async () => {
    const id = await payment(1, [1, 2, 3], 'closed')
    await capture(id)
    expect(await receiptsOf(id)).toHaveLength(3)
    const done = await run(
      { type: 'receipt.brought', paymentId: id } as ServiceCommand,
      context(user(staffId, deviceSession)),
    )
    expect(done).toMatchObject({ status: 'accepted', details: { changed: true } })
    expect(await receiptsOf(id)).toHaveLength(0)
    await run(
      { type: 'receipt.unbrought', paymentId: id } as ServiceCommand,
      context(user(staffId, deviceSession)),
    )
    expect(await receiptsOf(id)).toHaveLength(3)
  })

  it('leaves one row for a payment of one table, as it always did', async () => {
    const id = await payment(2, [2], 'closed')
    await capture(id)
    const rows = await receiptsOf(id)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ tableId: table(2) })
    expect(rows[0]?.payer.tableId).toBe(table(2))
  })

  it('reads a gathering share to every role: what is held of how much, the tables, the end', async () => {
    const id = await payment(0, [0, 1], 'awaiting_guest', 10000)
    await hold(id, 'held', 6000, 500)
    await hold(id, 'held', 1000)
    // A hold still being asked for, or let go, is not held.
    await hold(id, 'requested', 2000)
    await hold(id, 'released', 900)
    for (const who of [staffId, viewerId]) {
      const shares = (await tonight(user(who))).shares ?? []
      const share = shares.find((one) => one.paymentId === id)
      expect(share).toMatchObject({
        tableId: table(0),
        // Tips are the guests' own: the parts are 5500 and 1000, never the 6500 charged.
        heldMinor: 6500,
        sharedMinor: 10000,
        currency: 'EUR',
      })
      expect([...(share?.tableIds ?? [])].sort()).toEqual([table(0), table(1)].sort())
      expect(share?.endsAt).toBeInstanceOf(Date)
      // It names nobody who holds: not a hold's id, handle or state.
      expect(JSON.stringify(share)).not.toMatch(/ph_|handle|requested|released/)
    }
  })

  it('stops reading a share once it is covered or let go', async () => {
    const covered = await payment(1, [1], 'awaiting_guest', 5000)
    await world.owner.query(`update restro.payments set state = 'held' where id = $1`, [covered])
    const gone = await payment(2, [2], 'awaiting_guest', 5000)
    await world.owner.query(
      `update restro.payments set state = 'cancelling', reason = 'cancelled' where id = $1`,
      [gone],
    )
    const ids = ((await tonight(user(staffId))).shares ?? []).map((share) => share.paymentId)
    expect(ids).not.toContain(covered)
    expect(ids).not.toContain(gone)
  })

  it('lets the right to open and close tables cancel a share, on the tablet with no PIN, and nobody else', async () => {
    const id = await payment(2, [2, 3], 'awaiting_guest', 10000)
    const command = { type: 'share.cancel', tableId: table(3), paymentId: id } as ServiceCommand
    // A role that may not open and close a table is refused, and the share stays.
    expect(await run(command, context(user(viewerId)))).toMatchObject({ status: 'refused' })
    expect(((await tonight(user(staffId))).shares ?? []).map((s) => s.paymentId)).toContain(id)
    // The shared tablet's own account, with nobody's PIN on it: accepted.
    const device = await run(command, context(user(staffId, deviceSession)))
    expect(device).toMatchObject({ status: 'accepted' })
    expect(((await tonight(user(staffId))).shares ?? []).map((s) => s.paymentId)).not.toContain(id)
    // A second cancel finds it over: nothing changes, and it says so.
    expect(await run(command, context(user(staffId)))).toMatchObject({
      status: 'accepted',
      details: { changed: false },
    })
  })

  it('refuses to cancel a share the cards already cover: the engine decides, once', async () => {
    const id = await payment(3, [3], 'awaiting_guest', 5000)
    await hold(id, 'held', 5000)
    await world.owner.query(`update restro.payments set state = 'held' where id = $1`, [id])
    expect(
      await run(
        { type: 'share.cancel', tableId: table(3), paymentId: id } as ServiceCommand,
        context(user(staffId)),
      ),
    ).toMatchObject({ status: 'refused', code: 'too_late' })
  })

  it('tells a closed table its bill was paid with the party, and says nothing to one that was not', async () => {
    const paidAt = await payment(0, [0, 3], 'closed')
    await capture(paidAt)
    // Table 4's sitting ended because its bill closed, as the readings end it.
    await sittingOf(3)
    await world.owner.query(
      `update restro.sittings set ended_at = now(), end_reason = 'bill_closed' where id = $1`,
      [sittings.get(3)],
    )
    const read = await readTableState(world.app, { tenantId: world.tenantId, tableId: table(3) })
    if (read === null || read.unchanged) throw new Error('no state')
    expect(read.sitting).toBeNull()
    expect(read.paidTogether).toBe(true)
    // A closed table that took no part reads as it did.
    const other = await readTableState(world.app, { tenantId: world.tenantId, tableId: table(2) })
    if (other === null || other.unchanged) throw new Error('no state')
    expect(other.paidTogether).toBeUndefined()
  })
})
