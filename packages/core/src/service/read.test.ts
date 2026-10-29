// Integration tests of the service read side on a real Postgres, as the restro_app role: a phone's
// poll answers `unchanged` while the table's version stands, and Tonight shows each actor only
// what they may see (alerts by permission, waiter calls for `alerts.answer`, the Log for
// `log.view`, Restro's own alerts for its admin team). Skipped without a database.
import { randomUUID } from 'node:crypto'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { hasDatabase } from '../apply/test-database'
import { newId } from '../ids'
import { openServiceWorld, type ServiceWorld } from '../testing/service-world'
import type { ServiceActor } from './context'
import { readTableState, readTonight } from './read'

describe.skipIf(!hasDatabase)('the service read side (as the restro_app role)', () => {
  let world: ServiceWorld
  let ownerId: string
  let waiterId: string
  let barmanId: string
  let idleId: string
  let operatorId: string
  let day: string
  const alertIds: Record<string, string> = {}
  let waiterCallId: string

  beforeAll(async () => {
    world = await openServiceWorld('read')
    ownerId = await world.addUser('owner')
    waiterId = await world.addUser('member')
    await world.addStaff(['tables.open_close', 'alerts.answer'], waiterId)
    barmanId = await world.addUser('member')
    await world.addStaff(['sold_out'], barmanId)
    idleId = await world.addUser('member')
    operatorId = await world.addUser()
    await world.addOperator(operatorId)

    const first = await readTonight(world.app, {
      tenantId: world.tenantId,
      venueId: world.venueId,
      actor: user(ownerId),
    })
    if (!first.ok) throw new Error(`owner refused: ${first.code}`)
    day = first.tonight.serviceDate

    const tableId = world.tables[0] as string
    const sittingId = await world.openSitting(tableId, day)
    const seed = ['worker', 'system', 'test-seed']
    for (const [name, permission, audience] of [
      ['answer', 'alerts.answer', 'venue'],
      ['money', 'money.follow_up', 'venue'],
      ['open', null, 'venue'],
      ['restro', null, 'restro'],
    ] as const) {
      alertIds[name] = newId('al')
      await world.owner.query(
        `insert into restro.alerts
           (id, tenant_id, venue_id, service_date, kind, audience, subject_id, permission,
            source, actor, job_id)
         values ($1, $2, $3, $4, 'send_failed', $5, $6, $7, $8, $9, $10)`,
        [
          alertIds[name],
          world.tenantId,
          world.venueId,
          day,
          audience,
          tableId,
          permission,
          ...seed,
        ],
      )
    }
    waiterCallId = newId('wc')
    await world.owner.query(
      `insert into restro.waiter_calls
         (id, tenant_id, venue_id, table_id, sitting_id, service_date, source, actor, job_id)
       values ($1, $2, $3, $4, $5, $6, 'guest', 'guest', 'test-seed')`,
      [waiterCallId, world.tenantId, world.venueId, tableId, sittingId, day],
    )
    await world.owner.query(
      `insert into restro.log_entries
         (tenant_id, venue_id, service_date, kind, table_id, via, retention, source, actor, job_id)
       values ($1, $2, $3, 'waiter_call.called', $4, 'guest_page', 'night', 'guest', 'guest',
               'test-seed')`,
      [world.tenantId, world.venueId, day, tableId],
    )
  })

  afterAll(async () => {
    await world?.close()
  })

  function user(userId: string, sessionId = `sess-${randomUUID()}`): ServiceActor {
    return { kind: 'user', userId, sessionId }
  }

  const tonightOf = async (actor: ServiceActor) => {
    const read = await readTonight(world.app, {
      tenantId: world.tenantId,
      venueId: world.venueId,
      actor,
    })
    if (!read.ok) throw new Error(`refused: ${read.code}`)
    return read.tonight
  }
  const alertNames = (alerts: readonly { id: string }[]) =>
    Object.entries(alertIds)
      .filter(([, id]) => alerts.some((alert) => alert.id === id))
      .map(([name]) => name)
      .sort()

  it('shows the owner every venue alert, the waiter calls and the Log', async () => {
    const tonight = await tonightOf(user(ownerId))
    expect(alertNames(tonight.alerts)).toEqual(['answer', 'money', 'open'])
    expect(tonight.waiterCalls?.map((call) => call.id)).toEqual([waiterCallId])
    expect(tonight.log).toHaveLength(1)
    expect(tonight.tables).toHaveLength(4)
    expect(tonight.tables[0]?.sitting).not.toBeNull()
    expect(tonight.tables[1]?.sitting).toBeNull()
  })

  it('shows a waiter the alerts they may answer and the waiter calls, but no Log', async () => {
    const tonight = await tonightOf(user(waiterId))
    expect(tonight.permissions.slice().sort()).toEqual(['alerts.answer', 'tables.open_close'])
    expect(alertNames(tonight.alerts)).toEqual(['answer', 'open'])
    expect(tonight.waiterCalls).toHaveLength(1)
    expect(tonight.log).toBeNull()
  })

  it('leaves the waiter calls out for someone who does not answer them', async () => {
    const tonight = await tonightOf(user(barmanId))
    expect(alertNames(tonight.alerts)).toEqual(['open'])
    expect(tonight.waiterCalls).toBeNull()
    expect(tonight.log).toBeNull()
  })

  it("shows Restro's admin team its own alerts as well", async () => {
    const tonight = await tonightOf({ kind: 'operator', userId: operatorId })
    expect(alertNames(tonight.alerts)).toEqual(['open', 'restro'])
  })

  it("shows a shared device's own account what Staff see, without the Log (#85)", async () => {
    const session = `sess-${randomUUID()}`
    await world.addSharedDevice(session)
    const tonight = await tonightOf(user(ownerId, session))
    expect(tonight.device).toBe(true)
    expect(tonight.permissions).toEqual(
      expect.arrayContaining(['alerts.answer', 'tables.open_close', 'ordering.pause']),
    )
    expect(tonight.permissions).not.toContain('ordering.lift')
    expect(tonight.permissions).not.toContain('log.view')
    expect(tonight.log).toBeNull()
    expect(tonight.waiterCalls).toHaveLength(1)
    expect((await tonightOf(user(ownerId))).device).toBe(false)
  })

  it('names the bars and who started a staff pause, and nobody for one Restro started', async () => {
    const barId = newId('br')
    const memberId = await world.addStaff(['ordering.pause'])
    await world.owner.query(
      `insert into restro.bars (id, tenant_id, venue_id, name, source_key) values ($1, $2, $3, 'Main bar', 'main')`,
      [barId, world.tenantId, world.venueId],
    )
    const insert = `insert into restro.pauses
        (id, tenant_id, venue_id, service_date, scope, target_id, cause, restro_started, source, actor, job_id)
      values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'test-seed')`
    const staffPause = newId('pa')
    const restroPause = newId('pa')
    await world.owner.query(insert, [
      staffPause,
      world.tenantId,
      world.venueId,
      day,
      'bar',
      barId,
      'staff',
      false,
      'staff',
      `staff:${memberId}`,
    ])
    await world.owner.query(insert, [
      restroPause,
      world.tenantId,
      world.venueId,
      day,
      'venue',
      world.venueId,
      'staff_restro',
      true,
      'worker',
      'system',
    ])
    const tonight = await tonightOf(user(ownerId))
    expect(tonight.bars).toEqual([{ id: barId, name: 'Main bar' }])
    const byId = new Map(tonight.pauses.map((pause) => [pause.id, pause]))
    expect(byId.get(staffPause)).toMatchObject({
      scope: 'bar',
      targetId: barId,
      startedBy: 'Waiter',
    })
    expect(byId.get(restroPause)).toMatchObject({ restroStarted: true, startedBy: null })
    await world.owner.query('delete from restro.pauses where id = any($1)', [
      [staffPause, restroPause],
    ])
  })

  it('shows a shared device the money alerts and the managers’ to-dos, without a tip; a staff phone not (#85)', async () => {
    const subject = newId('py')
    const seed = ['worker', 'system', 'test-seed']
    await world.owner.query(
      `insert into restro.alerts
         (id, tenant_id, venue_id, service_date, kind, audience, subject_id, permission, details,
          source, actor, job_id)
       values ($1, $2, $3, $4, 'payment_unconfirmed', 'venue', $5, 'money.follow_up', $6::jsonb, $7, $8, $9)`,
      [
        newId('al'),
        world.tenantId,
        world.venueId,
        day,
        subject,
        JSON.stringify({ paymentId: subject, amountMinor: 3800, tipMinor: 200, currency: 'EUR' }),
        ...seed,
      ],
    )
    const session = `sess-${randomUUID()}`
    await world.addSharedDevice(session)
    const device = await tonightOf(user(ownerId, session))
    const money = device.alerts.find((alert) => alert.kind === 'payment_unconfirmed')
    // The charge less its tip (#220): the total would give the tip away.
    expect(money?.details).toMatchObject({ amountMinor: 3600 })
    expect(money?.details).not.toHaveProperty('tipMinor')
    // A member with Staff's rights on a phone of their own sees that a payment question waits (#115),
    // without a tip, but no other manager's alert.
    const phone = await tonightOf(user(waiterId))
    const seen = phone.alerts.find((alert) => alert.kind === 'payment_unconfirmed')
    expect(seen?.details).not.toHaveProperty('tipMinor')
    expect(seen?.details).toMatchObject({ amountMinor: 3600 })
    await world.owner.query(
      "update restro.alerts set kind = 'payment_capture_failed' where kind = 'payment_unconfirmed' and tenant_id = $1",
      [world.tenantId],
    )
    expect((await tonightOf(user(waiterId))).alerts.map((alert) => alert.kind)).not.toContain(
      'payment_capture_failed',
    )
    await world.owner.query(
      "delete from restro.alerts where kind = 'payment_unconfirmed' and tenant_id = $1",
      [world.tenantId],
    )
  })

  it('tells when Restro found an Unconfirmed sent order on the bill (#135), changing nothing (#85)', async () => {
    const tableId = world.tables[1] as string
    const sittingId = await world.openSitting(tableId, day)
    const sentOrderId = await world.addSentOrder({
      tableId,
      sittingId,
      actionId: randomUUID(),
      reference: 'LATE',
      serviceDate: day,
    })
    await world.owner.query("update restro.sent_orders set state = 'unconfirmed' where id = $1", [
      sentOrderId,
    ])
    await world.owner.query(
      `insert into restro.alerts
         (id, tenant_id, venue_id, service_date, kind, audience, subject_id, permission, details,
          source, actor, job_id)
       values ($1, $2, $3, $4, 'order_unconfirmed', 'venue', $5, 'alerts.answer', $6::jsonb,
               'worker', 'system', 'test-seed')`,
      [
        newId('al'),
        world.tenantId,
        world.venueId,
        day,
        sentOrderId,
        JSON.stringify({ sentOrderId }),
      ],
    )
    expect((await tonightOf(user(ownerId))).landedLate).toEqual([])
    await world.owner.query(
      `insert into restro.log_entries
         (tenant_id, venue_id, service_date, kind, sent_order_id, table_id, retention, source, actor, job_id)
       values ($1, $2, $3, 'sent_order.landed_late', $4, $5, 'night', 'worker', 'system', 'test-seed')`,
      [world.tenantId, world.venueId, day, sentOrderId, tableId],
    )
    const landed = (await tonightOf(user(waiterId))).landedLate
    expect(landed.map((entry) => entry.sentOrderId)).toEqual([sentOrderId])
    expect(landed[0]?.at).toBeInstanceOf(Date)
  })

  it('refuses a guest, a member with no permission here, and an outsider', async () => {
    const base = { tenantId: world.tenantId, venueId: world.venueId }
    expect(await readTonight(world.app, { ...base, actor: { kind: 'guest' } })).toEqual({
      ok: false,
      code: 'origin_not_allowed',
    })
    expect(await readTonight(world.app, { ...base, actor: user(idleId) })).toEqual({
      ok: false,
      code: 'permission_denied',
    })
    const outsider = await world.addUser()
    expect(await readTonight(world.app, { ...base, actor: user(outsider) })).toEqual({
      ok: false,
      code: 'actor_unknown',
    })
    expect(
      await readTonight(world.app, { ...base, venueId: newId('vn'), actor: user(ownerId) }),
    ).toEqual({ ok: false, code: 'venue_missing' })
  })

  it("answers a phone's poll with unchanged while the version stands", async () => {
    const tableId = world.tables[0] as string
    const state = await readTableState(world.app, { tenantId: world.tenantId, tableId })
    if (state === null || state.unchanged) throw new Error('expected a full state')
    expect(state.sitting).not.toBeNull()
    expect(state.order).toBeNull()
    expect(
      await readTableState(world.app, { tenantId: world.tenantId, tableId, since: state.version }),
    ).toMatchObject({ unchanged: true, version: state.version, nextChangeAt: null })
    expect(
      await readTableState(world.app, {
        tenantId: world.tenantId,
        tableId,
        since: state.version + 1,
      }),
    ).toMatchObject({ unchanged: false })
  })

  it('reads no table of another tenant (row-level security)', async () => {
    const elsewhere = await openServiceWorld('read-other')
    try {
      expect(
        await readTableState(world.app, {
          tenantId: world.tenantId,
          tableId: elsewhere.tables[0] as string,
        }),
      ).toBeNull()
    } finally {
      await elsewhere.close()
    }
  })
})
