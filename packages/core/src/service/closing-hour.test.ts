// The closing hour (#82, D122 §4) on a real Postgres, as the restro_app role: at the venue's
// closing time the worker's `hours.close_tables` ends every open sitting with the reason
// `closing_hour` and a Log entry per table; before it, on a closed weekday and in a venue with no
// hours it changes nothing; a repeat finds nothing to close; and only the worker may send it.
// Skipped without a database.
import { createHash, randomUUID } from 'node:crypto'

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { hasDatabase } from '../apply/test-database'
import { newId } from '../ids'
import { DEFAULT_ORDERING_SETTINGS, type ServiceHours } from '../ordering-settings'
import { openServiceWorld, type ServiceWorld } from '../testing/service-world'
import { applyService } from './apply-service'
import type { ServiceContext } from './context'

// Friday and Saturday nights: open 22:00, last orders 04:30, closes 05:30 (Sofia, service day 07:00).
const NIGHT = { opens: '22:00', lastOrders: '04:30', closes: '05:30' }
const CLOSED = DEFAULT_ORDERING_SETTINGS.serviceHours
const HOURS: ServiceHours = { ...CLOSED, fri: NIGHT, sat: NIGHT }

describe.skipIf(!hasDatabase)('the closing hour (as the restro_app role)', () => {
  let world: ServiceWorld

  const setHours = async (serviceHours: ServiceHours) => {
    await world.owner.query(
      `update restro.venues set settings = jsonb_set(settings, '{ordering}', $2::jsonb) where id = $1`,
      [world.venueId, JSON.stringify({ ...DEFAULT_ORDERING_SETTINGS, serviceHours })],
    )
  }
  const worker = (now: Date): ServiceContext => ({
    tenantId: world.tenantId,
    venueId: world.venueId,
    origin: 'worker',
    actor: { kind: 'system' },
    jobId: `jb-${randomUUID()}`,
    now,
  })
  const closeTables = async (iso: string) =>
    (await applyService(world.app, { type: 'hours.close_tables' }, worker(new Date(iso)))).result
  const openTables = async (count: number) => {
    const ids: string[] = []
    for (const tableId of world.tables.slice(0, count)) ids.push(await world.openSitting(tableId))
    return ids
  }
  const sittingState = async (id: string) =>
    (
      await world.owner.query<{
        ended_at: Date | null
        end_reason: string | null
      }>('select ended_at, end_reason from restro.sittings where id = $1', [id])
    ).rows[0]

  beforeAll(async () => {
    world = await openServiceWorld('closing-hour')
  })
  afterAll(async () => {
    await world?.close()
  })
  beforeEach(async () => {
    await world.owner.query(
      `update restro.sittings set ended_at = now(), end_reason = 'staff_closed'
        where venue_id = $1 and ended_at is null`,
      [world.venueId],
    )
    await setHours(HOURS)
  })

  it('closes every table at the closing hour, one Log entry each, reason closing_hour', async () => {
    const sittings = await openTables(3)
    // Closes 05:30 Saturday = 02:30Z (summer time).
    const result = await closeTables('2026-10-24T02:30:00Z')
    expect(result).toMatchObject({
      status: 'accepted',
      details: { closed: 3 },
    })
    for (const id of sittings) {
      expect(await sittingState(id)).toMatchObject({
        end_reason: 'closing_hour',
      })
      const { rows } = await world.owner.query(
        `select kind, reason, actor from restro.log_entries where sitting_id = $1 and kind = 'sitting.ended'`,
        [id],
      )
      expect(rows).toEqual([{ kind: 'sitting.ended', reason: 'closing_hour', actor: 'system' }])
    }
  })

  it('changes nothing before the closing hour, whatever the phase of the night', async () => {
    const sittings = await openTables(2)
    for (const iso of ['2026-10-23T12:00:00Z', '2026-10-24T01:45:00Z', '2026-10-24T02:29:59Z']) {
      expect(await closeTables(iso)).toMatchObject({
        status: 'accepted',
        details: { closed: 0 },
      })
    }
    for (const id of sittings) expect((await sittingState(id))?.ended_at).toBeNull()
  })

  it('finds nothing to close when asked again', async () => {
    await openTables(2)
    expect(await closeTables('2026-10-24T02:31:00Z')).toMatchObject({
      details: { closed: 2 },
    })
    expect(await closeTables('2026-10-24T02:32:00Z')).toMatchObject({
      details: { closed: 0 },
    })
  })

  it('closes a table staff opened after the closing hour, at the next run', async () => {
    await openTables(1)
    expect(await closeTables('2026-10-24T03:00:00Z')).toMatchObject({
      details: { closed: 1 },
    })
    await openTables(1)
    expect(await closeTables('2026-10-24T03:01:00Z')).toMatchObject({
      details: { closed: 1 },
    })
  })

  // Repair-review, hot spot 7 (D122: "the closing time closes every table for phones"; a table with
  // a payment waits only for its close and capture): a hold that meets the closing hour.
  describe('a payment still going at the closing hour', () => {
    const paying = async (tableId: string, sittingId: string) => {
      const id = `py_${randomUUID().replaceAll('-', '')}`
      await world.owner.query(
        `insert into restro.payments
           (id, tenant_id, venue_id, table_id, sitting_id, service_date, kind, state, handle_hash,
            action_id, amount_minor, tip_minor, currency, provider_kind, source, actor, job_id)
         values ($1, $2, $3, $4, $5, '2026-10-23', 'on_bill', 'unconfirmed', $6, $7, 1200, 0, 'EUR',
                 'sim', 'guest', 'guest', 'test-seed')`,
        [
          id,
          world.tenantId,
          world.venueId,
          tableId,
          sittingId,
          createHash('sha256').update(randomUUID()).digest('hex'),
          randomUUID(),
        ],
      )
      return id
    }
    const settle = (id: string) =>
      world.owner.query(
        `update restro.payments set state = 'captured', captured_minor = 1200, settled_at = now()
          where id = $1`,
        [id],
      )

    it('keeps the table, then closes it on the next tick of the same night', async () => {
      const [sitting] = await openTables(1)
      const id = await paying(world.tables[0] as string, sitting as string)
      expect(await closeTables('2026-10-24T02:31:00Z')).toMatchObject({ details: { closed: 0 } })
      expect((await sittingState(sitting as string))?.ended_at).toBeNull()
      await settle(id)
      expect(await closeTables('2026-10-24T02:40:00Z')).toMatchObject({ details: { closed: 1 } })
      expect(await sittingState(sitting as string)).toMatchObject({ end_reason: 'closing_hour' })
    })

    it('still closes it when the payment only ends after 07:00', async () => {
      const [sitting] = await openTables(1)
      const id = await paying(world.tables[0] as string, sitting as string)
      expect(await closeTables('2026-10-24T02:31:00Z')).toMatchObject({ details: { closed: 0 } })
      // A manager answers the morning after; the worker's tick goes on, past 07:00 (04:00Z).
      await settle(id)
      expect(await closeTables('2026-10-24T04:01:00Z')).toMatchObject({ details: { closed: 1 } })
      expect(await sittingState(sitting as string)).toMatchObject({ end_reason: 'closing_hour' })
    })
  })

  it('leaves a closed weekday alone: no night, no closing hour', async () => {
    const sittings = await openTables(1)
    // Thursday evening, and Sunday noon after Saturday's service day ended: no hours then.
    expect(await closeTables('2026-10-22T20:00:00Z')).toMatchObject({
      details: { closed: 0 },
    })
    expect(await closeTables('2026-10-25T12:00:00Z')).toMatchObject({
      details: { closed: 0 },
    })
    expect((await sittingState(sittings[0] as string))?.ended_at).toBeNull()
  })

  it('does nothing for a venue that has set no hours', async () => {
    await setHours(CLOSED)
    const sittings = await openTables(1)
    expect(await closeTables('2026-10-24T03:00:00Z')).toMatchObject({
      details: { closed: 0 },
    })
    expect((await sittingState(sittings[0] as string))?.ended_at).toBeNull()
  })

  it("counts the closing hour in the venue's zone across the autumn clock change", async () => {
    // Saturday 2026-10-24's night closes 05:30 on Sunday, after the clocks went back: 03:30Z.
    const sittings = await openTables(1)
    expect(await closeTables('2026-10-25T02:30:00Z')).toMatchObject({
      details: { closed: 0 },
    })
    expect(await closeTables('2026-10-25T03:30:00Z')).toMatchObject({
      details: { closed: 1 },
    })
    expect((await sittingState(sittings[0] as string))?.end_reason).toBe('closing_hour')
  })

  describe('a payment still in progress (D122: a sitting ends only after the close and capture)', () => {
    const seedPayment = async (tableId: string, sittingId: string, state: string) => {
      const id = newId('py')
      await world.owner.query(
        `insert into restro.payments
           (id, tenant_id, venue_id, table_id, sitting_id, service_date, kind, state, handle_hash,
            currency, provider_kind, source, actor, job_id)
         select $1, $2, $3, $4, $5, service_date, 'on_bill', $6, $7, 'EUR', 'sim', 'restro', 'system', 'test-seed'
           from restro.sittings where id = $5`,
        [
          id,
          world.tenantId,
          world.venueId,
          tableId,
          sittingId,
          state,
          createHash('sha256').update(id).digest('hex'),
        ],
      )
      return id
    }
    const settle = (id: string) =>
      world.owner.query(
        `update restro.payments set state = 'captured', captured_minor = 0, amount_minor = 0,
                settled_at = now(), retain_until = now() + interval '18 months' where id = $1`,
        [id],
      )

    it('keeps the paying table open and closes the others on the first tick', async () => {
      const [paying, other, another] = await openTables(3)
      await seedPayment(world.tables[0] as string, paying as string, 'awaiting_guest')
      expect(await closeTables('2026-10-24T02:30:00Z')).toMatchObject({ details: { closed: 2 } })
      expect((await sittingState(paying as string))?.ended_at).toBeNull()
      expect((await sittingState(other as string))?.end_reason).toBe('closing_hour')
      expect((await sittingState(another as string))?.end_reason).toBe('closing_hour')
    })

    it('waits while the payment is held, and closes the table at the tick after it settles', async () => {
      const [paying] = await openTables(1)
      const payment = await seedPayment(world.tables[0] as string, paying as string, 'held')
      expect(await closeTables('2026-10-24T02:30:00Z')).toMatchObject({ details: { closed: 0 } })
      expect(await closeTables('2026-10-24T02:31:00Z')).toMatchObject({ details: { closed: 0 } })
      expect((await sittingState(paying as string))?.ended_at).toBeNull()

      await settle(payment)
      expect(await closeTables('2026-10-24T02:32:00Z')).toMatchObject({ details: { closed: 1 } })
      expect(await sittingState(paying as string)).toMatchObject({ end_reason: 'closing_hour' })
    })

    it('closes a table whose only payment already settled', async () => {
      const [paid] = await openTables(1)
      await settle(await seedPayment(world.tables[0] as string, paid as string, 'held'))
      expect(await closeTables('2026-10-24T02:30:00Z')).toMatchObject({ details: { closed: 1 } })
    })

    it('leaves staff closes as they are: Close all ends a paying table too', async () => {
      const [paying] = await openTables(1)
      await seedPayment(world.tables[0] as string, paying as string, 'awaiting_guest')
      const result = (
        await applyService(
          world.app,
          { type: 'tables.close_all' },
          {
            tenantId: world.tenantId,
            venueId: world.venueId,
            origin: 'staff',
            actor: { kind: 'user', userId: await world.addUser('owner'), sessionId: 'sess-1' },
            jobId: `req-${randomUUID()}`,
            signedInAt: new Date(),
          },
        )
      ).result
      expect(result).toMatchObject({ status: 'accepted', details: { closed: 1 } })
      expect((await sittingState(paying as string))?.end_reason).toBe('staff_closed')
    })
  })

  it("is the worker's alone", async () => {
    const { result } = await applyService(
      world.app,
      { type: 'hours.close_tables' },
      {
        ...worker(new Date('2026-10-24T03:00:00Z')),
        origin: 'guest',
        actor: { kind: 'guest' },
        tableCodeHash: 'a'.repeat(64),
      },
    )
    expect(result.status).toBe('refused')
  })
})
