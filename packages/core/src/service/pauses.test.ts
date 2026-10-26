// Integration tests of the pauses (#79, D120, D122 §6) on a real Postgres, as the restro_app role:
// staff pause all bars or one and a manager lifts it; a pause Restro started has no button, and
// only Restro's admin team lifts one by hand; the breaker's connection pause covers each venue
// of the instance, moves on each probe and lifts; waiting sent orders become Not sent with their
// lines back while one the worker started finds the pause on its way to Sending; a table's
// Unconfirmed pause lifts at a resume, after 15 minutes, when its bills close, when a waiter acts
// at the till and at the sitting's end. Skipped without a database.
import { randomUUID } from 'node:crypto'

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { hasDatabase } from '../apply/test-database'
import { newId } from '../ids'
import { DEFAULT_ORDERING_SETTINGS } from '../ordering-settings'
import { hashTableCode } from '../qr'
import { openServiceWorld, type ServiceWorld } from '../testing/service-world'
import { applyService } from './apply-service'
import type { ServiceActor, ServiceContext } from './context'
import { CONNECTION_UNSTABLE_ALERT, LIFT_REASONS, STAFF_PAUSE_CAUSE } from './pauses'
import { readTableState } from './read'
import type { SendMenu } from './send-menu'
import { ORDER_UNCONFIRMED_CAUSE } from './sent-order'

const BILL_IDS = 'pauses-test-'.padEnd(48, 'x')

describe.skipIf(!hasDatabase)('pauses (as the restro_app role)', () => {
  let world: ServiceWorld
  let ownerId: string
  let operatorId: string
  const codes = new Map<string, string>()
  const sittingOf = new Map<string, string>()
  const integrationId = newId('in')
  const beer = newId('nd')

  const menu: SendMenu = {
    currency: 'EUR',
    items: new Map([
      [beer, { priceMinor: 450, orderable: true, soldOut: false, name: 'Beer', options: new Map() }],
    ]),
  }

  const table = (index: number) => world.tables[index] as string

  const guest = (tableId: string): ServiceContext => ({
    tenantId: world.tenantId,
    venueId: world.venueId,
    origin: 'guest',
    actor: { kind: 'guest' },
    jobId: `guest-${randomUUID()}`,
    tableCodeHash: codes.get(tableId) as string,
    sittingId: sittingOf.get(tableId) as string,
    consentVersion: 'v1',
  })
  const staff = (actor: ServiceActor): ServiceContext => ({
    tenantId: world.tenantId,
    venueId: world.venueId,
    origin: 'staff',
    actor,
    jobId: `req-${randomUUID()}`,
    via: 'tonight',
  })
  const owner = () =>
    staff({ kind: 'user', userId: ownerId, sessionId: `sess-${randomUUID()}` })
  const operator = () => staff({ kind: 'operator', userId: operatorId })
  const worker = (venueId = world.venueId): ServiceContext => ({
    tenantId: world.tenantId,
    venueId,
    origin: 'worker',
    actor: { kind: 'system' },
    jobId: `jb-${randomUUID()}`,
  })
  const integration = (): ServiceContext => ({
    ...worker(),
    actor: { kind: 'integration', integrationId },
  })

  async function run(command: Record<string, unknown>, context: ServiceContext) {
    return (await applyService(world.app, command, context, { billIdKey: BILL_IDS })).result
  }

  /** Puts one beer on the table's order and sends it; returns the sent order's id. */
  async function sendBeer(tableId: string): Promise<string> {
    const added = await run(
      {
        type: 'order.add',
        tableId,
        actionId: randomUUID(),
        ageMs: 50,
        itemId: beer,
        optionIds: [],
        qty: 1,
        note: '',
      },
      guest(tableId),
    )
    expect(added.status).toBe('accepted')
    const { result } = await applyService(
      world.app,
      {
        type: 'order.send',
        tableId,
        actionId: randomUUID(),
        ageMs: 50,
        lines: [{ itemId: beer, optionIds: [], qty: 1, note: '' }],
      },
      guest(tableId),
      { sendMenu: menu },
    )
    expect(result).toMatchObject({ status: 'accepted' })
    return result.details.sentOrderId as string
  }

  async function trySend(tableId: string) {
    return (
      await applyService(
        world.app,
        {
          type: 'order.send',
          tableId,
          actionId: randomUUID(),
          ageMs: 50,
          lines: [{ itemId: beer, optionIds: [], qty: 1, note: '' }],
        },
        guest(tableId),
        { sendMenu: menu },
      )
    ).result
  }

  async function sentOrder(id: string) {
    const { rows } = await world.owner.query(
      'select state, reason from restro.sent_orders where id = $1',
      [id],
    )
    return rows[0] as { state: string; reason: string | null }
  }

  async function liveLines(tableId: string): Promise<number> {
    const { rows } = await world.owner.query(
      `select lines from restro.table_orders where table_id = $1 and sitting_id = $2`,
      [tableId, sittingOf.get(tableId)],
    )
    const lines = (rows[0]?.lines ?? []) as { removedAt: number | null }[]
    return lines.filter((line) => line.removedAt === null).length
  }

  async function activePauses(targetId: string) {
    const { rows } = await world.owner.query(
      `select id, scope, cause, restro_started, lift_reason, details from restro.pauses
        where target_id = $1 and lifted_at is null order by cause`,
      [targetId],
    )
    return rows as {
      id: string
      scope: string
      cause: string
      restro_started: boolean
      details: Record<string, unknown>
    }[]
  }

  async function liftedReason(id: string) {
    const { rows } = await world.owner.query(
      'select lift_reason, lifted_at from restro.pauses where id = $1',
      [id],
    )
    return rows[0] as { lift_reason: string | null; lifted_at: Date | null }
  }

  async function seedPause(tableId: string, cause: string, minutesAgo = 0): Promise<string> {
    const id = newId('pa')
    await world.owner.query(
      `insert into restro.pauses (id, tenant_id, venue_id, service_date, scope, target_id, cause,
         restro_started, started_at, details, source, actor, job_id)
       values ($1, $2, $3, current_date, 'table', $4, $5, true,
               now() - make_interval(mins => $6), '{}'::jsonb, 'restro', 'system', 'test-seed')`,
      [id, world.tenantId, world.venueId, tableId, cause, minutesAgo],
    )
    return id
  }

  async function version(tableId: string): Promise<number> {
    const state = await readTableState(world.app, { tenantId: world.tenantId, tableId })
    if (state === null) throw new Error(`no table ${tableId}`)
    return state.version
  }

  async function tablePauses(tableId: string) {
    const state = await readTableState(world.app, { tenantId: world.tenantId, tableId })
    return (state?.pauses ?? []).map((pause) => pause.scope)
  }

  beforeAll(async () => {
    world = await openServiceWorld('pauses')
    ownerId = await world.addUser('owner')
    operatorId = await world.addUser()
    await world.addOperator(operatorId)
    await world.owner.query(
      `update restro.venues set settings = jsonb_set(settings, '{ordering}', $2::jsonb) where id = $1`,
      [
        world.venueId,
        JSON.stringify({ ...DEFAULT_ORDERING_SETTINGS, locationCheck: false, pacePer15Minutes: null }),
      ],
    )
    for (const tableId of world.tables) {
      const code = `code${randomUUID().replaceAll('-', '')}`
      const hash = await hashTableCode(code)
      codes.set(tableId, hash)
      await world.owner.query(
        'update restro.tables set qr_token = $2, qr_code_hash = $3 where id = $1',
        [tableId, code, hash],
      )
    }
  })

  afterAll(async () => {
    await world?.close()
  })

  beforeEach(async () => {
    // Each test starts with fresh sittings, no pause, no slot holder and nothing in flight.
    await world.owner.query(
      `update restro.sent_orders set state = 'not_sent', reason = 'test_reset', settled_at = now()
        where venue_id = $1 and state in ('waiting', 'sending', 'checking')`,
      [world.venueId],
    )
    await world.owner.query(
      'update restro.pauses set lifted_at = now() where tenant_id = $1 and lifted_at is null',
      [world.tenantId],
    )
    await world.owner.query(
      `update restro.locks set holder = null, deadline = null, released_at = now()
        where scope = 'order_slot' and key = any($1)`,
      [world.tables],
    )
    await world.owner.query(
      `update restro.sittings set ended_at = now(), end_reason = 'staff_closed'
        where venue_id = $1 and ended_at is null`,
      [world.venueId],
    )
    for (const tableId of world.tables) sittingOf.set(tableId, await world.openSitting(tableId))
  })

  describe('a staff pause', () => {
    it('pauses all bars: waiting orders are Not sent with their lines back, Send refuses', async () => {
      const waiting = await sendBeer(table(0))
      const before = await version(table(0))

      const paused = await run({ type: 'ordering.pause', barId: null }, owner())
      expect(paused).toMatchObject({ status: 'accepted', details: { already: false, settled: 1 } })
      expect(await sentOrder(waiting)).toEqual({ state: 'not_sent', reason: 'ordering_paused' })
      expect(await liveLines(table(0))).toBe(1)
      expect(await version(table(0))).toBeGreaterThan(before)
      expect(await activePauses(world.venueId)).toMatchObject([
        { scope: 'venue', cause: STAFF_PAUSE_CAUSE, restro_started: false },
      ])
      expect(await trySend(table(1))).toMatchObject({ code: 'ordering_paused' })
      expect(await tablePauses(table(2))).toEqual(['venue'])

      // A repeat finds the pause.
      const again = await run({ type: 'ordering.pause', barId: null }, owner())
      expect(again).toMatchObject({ details: { already: true, pauseId: paused.details.pauseId } })

      // A manager lifts it, and ordering is on again.
      const lifted = await run(
        { type: 'ordering.lift', pauseId: paused.details.pauseId },
        owner(),
      )
      expect(lifted).toMatchObject({ status: 'accepted', details: { lifted: true } })
      expect(await liftedReason(paused.details.pauseId as string)).toMatchObject({
        lift_reason: LIFT_REASONS.lifted,
      })
      expect(await tablePauses(table(2))).toEqual([])
      await sendBeer(table(2))
    })

    it('pauses one bar: its tables only; a bar of another venue is missing', async () => {
      const barId = newId('br')
      await world.owner.query(
        `insert into restro.bars (id, tenant_id, venue_id, name, source_key) values ($1, $2, $3, 'Main bar', $1)`,
        [barId, world.tenantId, world.venueId],
      )
      await world.owner.query('update restro.tables set bar_id = $2 where id = $1', [
        table(3),
        barId,
      ])
      try {
        expect(await run({ type: 'ordering.pause', barId: newId('br') }, owner())).toMatchObject({
          code: 'bar_missing',
        })
        const paused = await run({ type: 'ordering.pause', barId }, owner())
        expect(paused).toMatchObject({ status: 'accepted' })
        expect(await tablePauses(table(3))).toEqual(['bar'])
        expect(await tablePauses(table(0))).toEqual([])
        expect(await trySend(table(3))).toMatchObject({ code: 'ordering_paused' })
      } finally {
        await world.owner.query('update restro.tables set bar_id = null where id = $1', [table(3)])
      }
    })

    it('leaves an order the worker started to its worker: the move to Sending finds the pause', async () => {
      const id = await sendBeer(table(0))
      const taken = await run({ type: 'sent_order.start', tableId: table(0) }, worker())
      expect(taken).toMatchObject({ details: { state: 'taken', sentOrderId: id } })

      const paused = await run({ type: 'ordering.pause', barId: null }, owner())
      expect(paused).toMatchObject({ details: { settled: 0 } })
      expect(await sentOrder(id)).toMatchObject({ state: 'waiting' })

      const moved = await run(
        {
          type: 'sent_order.transition',
          sentOrderId: id,
          fence: taken.details.fence,
          to: 'sending',
          billBeforeMinor: 0,
        },
        worker(),
      )
      expect(moved).toMatchObject({ status: 'accepted', details: { state: 'not_sent' } })
      expect(await sentOrder(id)).toEqual({ state: 'not_sent', reason: 'ordering_paused' })
      expect(await liveLines(table(0))).toBe(1)
      const { rows } = await world.owner.query(
        `select holder from restro.locks where scope = 'order_slot' and key = $1`,
        [table(0)],
      )
      expect(rows[0]?.holder).toBeNull()
    })
  })

  describe('the connection pause', () => {
    const breaker = { open: { since: 1 } }
    const pauseCommand = (unstable = false) => ({
      type: 'connection.pause',
      integrationId,
      cause: 'pos_unreachable',
      unstable,
      nextProbeAt: new Date(Date.now() + 15_000).toISOString(),
      breaker,
    })

    it('covers the venue, has no button for the venue and lifts on good probes', async () => {
      const waiting = await sendBeer(table(1))
      const paused = await run(pauseCommand(), worker())
      expect(paused).toMatchObject({ status: 'accepted', details: { already: false, settled: 1 } })
      const pauseId = paused.details.pauseId as string
      expect(await sentOrder(waiting)).toEqual({ state: 'not_sent', reason: 'ordering_paused' })
      expect(await activePauses(integrationId)).toMatchObject([
        {
          scope: 'connection',
          cause: 'pos_unreachable',
          restro_started: true,
          details: { breaker, venueIds: [world.venueId] },
        },
      ])
      expect(await tablePauses(table(0))).toEqual(['connection'])
      expect(await trySend(table(0))).toMatchObject({ code: 'ordering_paused' })

      // A repeat changes nothing; a manager has no button; Restro's admin team does.
      expect(await run(pauseCommand(), worker())).toMatchObject({
        details: { already: true, pauseId },
      })
      expect(await run({ type: 'ordering.lift', pauseId }, owner())).toMatchObject({
        code: 'restro_pause',
      })

      // A probe moves it on; three good ones lift it.
      const progress = await run(
        {
          type: 'pause.transition',
          pauseId,
          probeCount: 2,
          nextProbeAt: new Date(Date.now() + 15_000).toISOString(),
          breaker: { open: { since: 1, goodInRow: 2 } },
          lift: false,
        },
        worker(),
      )
      expect(progress).toMatchObject({ details: { lifted: false } })
      const { rows } = await world.owner.query(
        'select probe_count, next_probe_at, details from restro.pauses where id = $1',
        [pauseId],
      )
      expect(rows[0]).toMatchObject({
        probe_count: 2,
        details: { breaker: { open: { goodInRow: 2 } }, venueIds: [world.venueId] },
      })
      expect(rows[0]?.next_probe_at).toBeInstanceOf(Date)

      const before = await version(table(0))
      const lift = {
        type: 'pause.transition',
        pauseId,
        probeCount: 3,
        nextProbeAt: null,
        breaker: { open: null },
        lift: true,
      }
      expect(await run(lift, worker())).toMatchObject({ details: { lifted: true, already: false } })
      expect(await liftedReason(pauseId)).toMatchObject({ lift_reason: LIFT_REASONS.probesGood })
      expect(await version(table(0))).toBeGreaterThan(before)
      expect(await tablePauses(table(0))).toEqual([])
      // A repeat (or another venue's lift) finds it lifted.
      expect(await run(lift, worker())).toMatchObject({ details: { lifted: true, already: true } })
    })

    it('lets Restro’s admin team lift it by hand; the breaker then hears it was lifted', async () => {
      const paused = await run(pauseCommand(), worker())
      const pauseId = paused.details.pauseId as string
      expect(await run({ type: 'ordering.lift', pauseId }, operator())).toMatchObject({
        details: { lifted: true },
      })
      const probe = await run(
        {
          type: 'pause.transition',
          pauseId,
          probeCount: 1,
          nextProbeAt: new Date().toISOString(),
          breaker: {},
          lift: false,
        },
        worker(),
      )
      expect(probe).toMatchObject({ details: { lifted: true, already: true } })
    })

    it('covers a second venue of the instance on the same row', async () => {
      const other = await openServiceWorldVenue(world)
      const paused = await run(pauseCommand(), worker())
      const joined = await run(pauseCommand(), worker(other))
      expect(joined).toMatchObject({ details: { already: true, pauseId: paused.details.pauseId } })
      expect(await activePauses(integrationId)).toMatchObject([
        { details: { venueIds: [world.venueId, other] } },
      ])
      const otherPauses = await world.owner.query(
        `select count(*)::int as n from restro.pauses where target_id = $1 and lifted_at is null`,
        [integrationId],
      )
      expect(otherPauses.rows[0]?.n).toBe(1)
    })

    it('alerts Restro’s admin team once when it pauses unstably', async () => {
      await run(pauseCommand(true), worker())
      await run(pauseCommand(true), worker())
      const { rows } = await world.owner.query(
        `select audience, subject_id from restro.alerts where kind = $1 and subject_id = $2`,
        [CONNECTION_UNSTABLE_ALERT, integrationId],
      )
      expect(rows).toEqual([{ audience: 'restro', subject_id: integrationId }])
    })
  })

  describe('a table pause', () => {
    it('lifts at a staff resume, all but a vanished table’s', async () => {
      const unconfirmed = await seedPause(table(0), ORDER_UNCONFIRMED_CAUSE)
      const guard = await seedPause(table(0), 'guard_tripped')
      const vanished = await seedPause(table(0), 'table_vanished')
      const resumed = await run({ type: 'table.resume', tableId: table(0) }, owner())
      expect(resumed).toMatchObject({ details: { lifted: 2 } })
      expect(await liftedReason(unconfirmed)).toMatchObject({
        lift_reason: LIFT_REASONS.staffResumed,
      })
      expect(await liftedReason(guard)).toMatchObject({ lift_reason: LIFT_REASONS.staffResumed })
      expect(await liftedReason(vanished)).toMatchObject({ lifted_at: null })
    })

    it('lifts an Unconfirmed pause after 15 minutes, never a guard trip', async () => {
      const old = await seedPause(table(0), ORDER_UNCONFIRMED_CAUSE, 16)
      const fresh = await seedPause(table(1), ORDER_UNCONFIRMED_CAUSE, 5)
      const guard = await seedPause(table(2), 'guard_tripped', 60)
      expect(await run({ type: 'sweep' }, worker())).toMatchObject({ details: { lifted: 1 } })
      expect(await liftedReason(old)).toMatchObject({ lift_reason: LIFT_REASONS.timedOut })
      expect(await liftedReason(fresh)).toMatchObject({ lifted_at: null })
      expect(await liftedReason(guard)).toMatchObject({ lifted_at: null })
    })

    it('lifts at the sitting’s end', async () => {
      const pause = await seedPause(table(0), 'guard_tripped')
      expect(await run({ type: 'table.close', tableId: table(0) }, owner())).toMatchObject({
        status: 'accepted',
      })
      expect(await liftedReason(pause)).toMatchObject({ lift_reason: LIFT_REASONS.sittingEnded })
    })

    const bill = (lines: Record<string, unknown>[]) => ({
      complete: true,
      currency: 'EUR',
      bills: [
        {
          pos: 'b1',
          totalMinor: 450 * lines.length,
          paidMinor: 0,
          openedAt: null,
          openedByRestro: true,
          paymentInFlight: false,
          lines,
        },
      ],
    })
    const line = (pos: string, enteredBy: 'restro' | 'staff' | null, enteredAt: string | null) => ({
      pos,
      itemPos: null,
      posName: 'Beer',
      quantity: '1',
      amountMinor: 450,
      enteredBy,
      enteredAt,
      restroRef: null,
    })

    it('lifts an Unconfirmed pause when a waiter acts at the till', async () => {
      const record = (reading: unknown) =>
        run({ type: 'reading.record', tableId: table(0), reading }, integration())
      expect(await record(bill([line('l1', 'restro', null)]))).toMatchObject({
        status: 'accepted',
      })
      const pause = await seedPause(table(0), ORDER_UNCONFIRMED_CAUSE)
      // A line Restro entered, or one entered before the pause, is no waiter's act.
      await record(bill([line('l1', 'restro', null), line('l2', 'restro', null)]))
      await record(
        bill([
          line('l1', 'restro', null),
          line('l2', 'restro', null),
          line('l3', 'staff', new Date(Date.now() - 3_600_000).toISOString()),
        ]),
      )
      expect(await liftedReason(pause)).toMatchObject({ lifted_at: null })
      await record(
        bill([
          line('l1', 'restro', null),
          line('l2', 'restro', null),
          line('l3', 'staff', new Date(Date.now() - 3_600_000).toISOString()),
          line('l4', 'staff', new Date(Date.now() + 1_000).toISOString()),
        ]),
      )
      expect(await liftedReason(pause)).toMatchObject({ lift_reason: LIFT_REASONS.waiterActed })
    })

    it('keeps an Unconfirmed pause on an empty table that never had a bill', async () => {
      const pause = await seedPause(table(1), ORDER_UNCONFIRMED_CAUSE)
      await run(
        {
          type: 'reading.record',
          tableId: table(1),
          reading: { complete: true, currency: 'EUR', bills: [] },
        },
        integration(),
      )
      expect(await liftedReason(pause)).toMatchObject({ lifted_at: null })
    })
  })
})

/** A second venue of the world's tenant, for a connection shared by two venues. */
async function openServiceWorldVenue(world: ServiceWorld): Promise<string> {
  const { provisionVenue } = await import('../apply/provision')
  const venue = await provisionVenue(world.app, world.tenantId, {
    name: 'Second club',
    slug: `second-${randomUUID().slice(0, 8)}`,
  })
  return venue.id
}
