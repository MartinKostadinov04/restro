// Staff's answer to an Unconfirmed sent order (#85, D116) on a real Postgres, as the restro_app role:
// each answer settles the order (Added or Not sent, with its reason), lifts the table's Unconfirmed
// pause, closes the order's alert and writes a Log entry naming who answered; repeating the same
// answer changes nothing; a different second answer is refused; and nothing else moves an
// Unconfirmed sent order. Skipped without a database.
import { randomUUID } from 'node:crypto'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { hasDatabase } from '../apply/test-database'
import { newId } from '../ids'
import { openServiceWorld, type ServiceWorld } from '../testing/service-world'
import type { ServiceActor, ServiceContext } from './context'
import { applyService } from './index'

describe.skipIf(!hasDatabase)("Staff's answer to an Unconfirmed sent order (as restro_app)", () => {
  let world: ServiceWorld
  let waiterUser: string
  let deviceUser: string
  let pinStaff: string
  let deviceSession: string
  let used = 0

  beforeAll(async () => {
    world = await openServiceWorld('so-answer')
    waiterUser = await world.addUser('member')
    await world.addStaff(['alerts.answer', 'tables.resume'], waiterUser)
    deviceUser = await world.addUser('member')
    pinStaff = await world.addStaff(['alerts.answer'])
    deviceSession = `sess-${randomUUID()}`
    await world.addSharedDevice(deviceSession)
  })

  afterAll(async () => {
    await world?.close()
  })

  const context = (actor: ServiceActor): ServiceContext => ({
    tenantId: world.tenantId,
    venueId: world.venueId,
    origin: 'staff',
    via: 'tonight',
    actor,
    jobId: `req-${randomUUID()}`,
  })
  const waiter = (): ServiceActor => ({
    kind: 'user',
    userId: waiterUser,
    sessionId: `sess-${randomUUID()}`,
  })
  const answer = (sentOrderId: string, value: string, actor: ServiceActor = waiter()) =>
    applyService(
      world.app,
      { type: 'sent_order.answer', sentOrderId, answer: value },
      context(actor),
    ).then((applied) => applied.result)

  /** A table with an open sitting, an order on it and an Unconfirmed sent order with its pause and alert. */
  async function unconfirmed() {
    // The world has four tables: a table used before is cleared (its sitting ended, its pause lifted).
    const tableId = world.tables[used++ % world.tables.length] as string
    await world.owner.query(
      'update restro.pauses set lifted_at = now() where target_id = $1 and lifted_at is null',
      [tableId],
    )
    await world.owner.query(
      'update restro.sittings set ended_at = now(), end_reason = $2 where table_id = $1 and ended_at is null',
      [tableId, 'staff_closed'],
    )
    const sittingId = await world.openSitting(tableId)
    const sentOrderId = await world.addSentOrder({
      tableId,
      sittingId,
      actionId: randomUUID(),
      reference: `K${(1000 + used).toString(36).toUpperCase()}`,
    })
    const line = {
      id: newId('ol'),
      itemId: newId('nd'),
      optionIds: [],
      qty: 2,
      unitMinor: 900,
      name: 'Mojito',
      optionNames: [],
    }
    await world.owner.query(
      `update restro.sent_orders set state = 'unconfirmed', reason = 'check_timed_out', lines = $2::jsonb
        where id = $1`,
      [sentOrderId, JSON.stringify([line])],
    )
    await world.owner.query(
      `insert into restro.table_orders
         (id, tenant_id, venue_id, table_id, sitting_id, lines, source, actor, job_id)
       values ($1, $2, $3, $4, $5, '[]'::jsonb, 'guest', 'guest', 'test-seed')`,
      [`to_${newId('so').slice(3)}`, world.tenantId, world.venueId, tableId, sittingId],
    )
    const pauseId = newId('pa')
    await world.owner.query(
      `insert into restro.pauses
         (id, tenant_id, venue_id, service_date, scope, target_id, cause, restro_started, details,
          source, actor, job_id)
       select $1, $2, $3, service_date, 'table', $4, 'order_unconfirmed', true, $5::jsonb,
              'worker', 'system', 'test-seed' from restro.sittings where id = $6`,
      [pauseId, world.tenantId, world.venueId, tableId, JSON.stringify({ sentOrderId }), sittingId],
    )
    const alertId = newId('al')
    await world.owner.query(
      `insert into restro.alerts
         (id, tenant_id, venue_id, service_date, kind, audience, subject_id, permission, details,
          source, actor, job_id)
       select $1, $2, $3, service_date, 'order_unconfirmed', 'venue', $4, 'alerts.answer', $5::jsonb,
              'worker', 'system', 'test-seed' from restro.sittings where id = $6`,
      [
        alertId,
        world.tenantId,
        world.venueId,
        sentOrderId,
        JSON.stringify({ sentOrderId }),
        sittingId,
      ],
    )
    return { tableId, sittingId, sentOrderId, pauseId, alertId }
  }

  const sentOrder = async (id: string) =>
    (
      await world.owner.query<{
        state: string
        reason: string | null
        settled: boolean
        actor: string
      }>(
        'select state, reason, settled_at is not null as settled, actor from restro.sent_orders where id = $1',
        [id],
      )
    ).rows[0]
  const pauseLifted = async (id: string) =>
    (
      await world.owner.query<{ lifted: boolean }>(
        'select lifted_at is not null as lifted from restro.pauses where id = $1',
        [id],
      )
    ).rows[0]?.lifted
  const alertDone = async (id: string) =>
    (
      await world.owner.query<{ done: boolean; by: string | null }>(
        'select done_at is not null as done, done_by as by from restro.alerts where id = $1',
        [id],
      )
    ).rows[0]
  const orderLines = async (tableId: string) =>
    (
      await world.owner.query<{ n: number }>(
        'select jsonb_array_length(lines) as n from restro.table_orders where table_id = $1',
        [tableId],
      )
    ).rows[0]?.n
  const logOf = async (sentOrderId: string) =>
    (
      await world.owner.query<{
        kind: string
        reason: string | null
        actor: string
        via: string | null
      }>(
        `select kind, reason, actor, via from restro.log_entries
          where tenant_id = $1 and (sent_order_id = $2) order by seq`,
        [world.tenantId, sentOrderId],
      )
    ).rows

  it('"Found on the bill" settles it Added, lifts the pause, closes the alert and logs who answered', async () => {
    const one = await unconfirmed()
    const result = await answer(one.sentOrderId, 'found')
    expect(result).toMatchObject({ status: 'accepted', details: { changed: true, state: 'added' } })
    expect(await sentOrder(one.sentOrderId)).toMatchObject({
      state: 'added',
      reason: 'staff_found',
      settled: true,
      actor: `user:${waiterUser}`,
    })
    expect(await pauseLifted(one.pauseId)).toBe(true)
    expect(await alertDone(one.alertId)).toMatchObject({ done: true, by: `user:${waiterUser}` })
    // Added: the lines stay on the bill, not back on the table's order.
    expect(await orderLines(one.tableId)).toBe(0)
    const log = await logOf(one.sentOrderId)
    expect(log).toContainEqual(
      expect.objectContaining({ kind: 'sent_order.state', reason: 'staff_found', via: 'tonight' }),
    )
    expect(log.find((entry) => entry.kind === 'sent_order.state')?.actor).toBe(`user:${waiterUser}`)
  })

  it('"Not on the bill" settles it Not sent with its lines back on the table’s order', async () => {
    const one = await unconfirmed()
    const result = await answer(one.sentOrderId, 'not_found')
    expect(result).toMatchObject({ status: 'accepted', details: { state: 'not_sent' } })
    expect(await sentOrder(one.sentOrderId)).toMatchObject({
      state: 'not_sent',
      reason: 'staff_not_found',
      settled: true,
    })
    expect(await pauseLifted(one.pauseId)).toBe(true)
    expect((await alertDone(one.alertId))?.done).toBe(true)
    expect(await orderLines(one.tableId)).toBe(1)
  })

  it('repeating the same answer changes nothing; a different one is refused', async () => {
    const one = await unconfirmed()
    await answer(one.sentOrderId, 'found')
    const entries = (await logOf(one.sentOrderId)).length
    expect(await answer(one.sentOrderId, 'found')).toMatchObject({
      status: 'accepted',
      details: { changed: false },
    })
    expect(await answer(one.sentOrderId, 'not_found')).toMatchObject({
      status: 'refused',
      code: 'sent_order_answered',
    })
    expect(await sentOrder(one.sentOrderId)).toMatchObject({
      state: 'added',
      reason: 'staff_found',
    })
    expect((await logOf(one.sentOrderId)).length).toBe(entries)
  })

  it('refuses an order that is not Unconfirmed, and one that does not exist', async () => {
    const one = await unconfirmed()
    await world.owner.query(
      `update restro.sent_orders set state = 'added', reason = null where id = $1`,
      [one.sentOrderId],
    )
    expect(await answer(one.sentOrderId, 'found')).toMatchObject({
      status: 'refused',
      code: 'sent_order_settled',
    })
    expect(await answer(newId('so'), 'found')).toMatchObject({
      status: 'refused',
      code: 'sent_order_missing',
    })
    expect(await answer(one.sentOrderId, 'maybe')).toMatchObject({
      status: 'refused',
      code: 'invalid_command',
    })
  })

  it('keeps the pause while another Unconfirmed order of the table is still open', async () => {
    const one = await unconfirmed()
    const second = await world.addSentOrder({
      tableId: one.tableId,
      sittingId: one.sittingId,
      actionId: randomUUID(),
      reference: 'ZZ99',
    })
    await world.owner.query(`update restro.sent_orders set state = 'unconfirmed' where id = $1`, [
      second,
    ])
    await answer(one.sentOrderId, 'found')
    expect(await pauseLifted(one.pauseId)).toBe(false)
    await answer(second, 'found')
    expect(await pauseLifted(one.pauseId)).toBe(true)
  })

  it('needs alerts.answer: a member without it is refused', async () => {
    const one = await unconfirmed()
    const bare = await world.addUser('member')
    await world.addStaff(['sold_out'], bare)
    const actor: ServiceActor = { kind: 'user', userId: bare, sessionId: `sess-${randomUUID()}` }
    expect(await answer(one.sentOrderId, 'found', actor)).toMatchObject({
      status: 'refused',
      code: 'permission_denied',
    })
    expect((await sentOrder(one.sentOrderId))?.state).toBe('unconfirmed')
  })

  it('on a shared device asks the person’s own PIN, and the PIN holder is named', async () => {
    const one = await unconfirmed()
    const device: ServiceActor = { kind: 'user', userId: deviceUser, sessionId: deviceSession }
    expect(await answer(one.sentOrderId, 'found', device)).toMatchObject({
      status: 'refused',
      code: 'pin_required',
    })
    const person: ServiceActor = {
      kind: 'staff',
      staffMemberId: pinStaff,
      sessionId: deviceSession,
    }
    expect(await answer(one.sentOrderId, 'found', person)).toMatchObject({ status: 'accepted' })
    expect((await sentOrder(one.sentOrderId))?.actor).toBe(`staff:${pinStaff}`)
  })

  it('is the only way out of Unconfirmed: the worker’s transition cannot move it', async () => {
    const one = await unconfirmed()
    const worker: ServiceContext = {
      tenantId: world.tenantId,
      venueId: world.venueId,
      origin: 'worker',
      actor: { kind: 'system' },
      jobId: `job-${randomUUID()}`,
    }
    for (const to of ['added', 'not_sent', 'checking']) {
      const { result } = await applyService(
        world.app,
        { type: 'sent_order.transition', sentOrderId: one.sentOrderId, fence: 1, to },
        worker,
      )
      expect(result, to).toMatchObject({ status: 'refused', code: 'sent_order_settled' })
    }
    // Nor can a guest or the worker answer for staff.
    const { result } = await applyService(
      world.app,
      { type: 'sent_order.answer', sentOrderId: one.sentOrderId, answer: 'found' },
      worker,
    )
    expect(result).toMatchObject({ status: 'refused', code: 'origin_not_allowed' })
    expect((await sentOrder(one.sentOrderId))?.state).toBe('unconfirmed')
  })
})
