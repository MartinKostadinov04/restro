// Integration tests of the guest API's module (#75) on a real Postgres, as the restro_app role:
// a table's code finds its table and a retired one finds nothing; two phones edit one order
// (identical lines merge, a repeat of an action gets its first answer, a held line can't change);
// a stale tap and a table that edits too fast are refused, the trip leaving a Log entry and one
// alert to Restro's admin team; an idle order is set aside on the next read and comes back with
// Restore. Skipped without a database. The venue here doesn't check location (#76's own tests, in
// guest-location.test.ts, do), and the per-phone limits are loose so the rate test reaches the
// engine's own.
import { randomUUID } from 'node:crypto'

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { hasDatabase } from '../apply/test-database'
import { newId } from '../ids'
import { DEFAULT_ORDERING_SETTINGS } from '../ordering-settings'
import { hashTableCode } from '../qr'
import { ORDER_CHANGES_PER_MINUTE, orderLineIdFor } from '../table-order'
import { openServiceWorld, type ServiceWorld } from '../testing/service-world'
import { applyService } from './apply-service'
import {
  forgetGuestCodes,
  type GuestTableState,
  type GuestUnchanged,
  guestAct,
  guestState,
} from './guest'
import { GUEST_LIMITS, type GuestLimit, GuestLimiter, type GuestLimitName } from './guest-limits'

/** D122's limits, loosened so a test's quick taps meet the engine's limits, not the phone's. */
const LOOSE = Object.fromEntries(
  Object.entries(GUEST_LIMITS).map(([name, limit]) => [name, { ...limit, max: 10_000 }]),
) as Record<GuestLimitName, GuestLimit>

describe.skipIf(!hasDatabase)('the guest API module (as the restro_app role)', () => {
  let world: ServiceWorld
  let tableId: string
  let code: string
  const limiter = new GuestLimiter(LOOSE)
  const item = newId('nd')
  const other = newId('nd')

  /** Gives a table a fresh code (the plain form; the seal job's work is not needed here). */
  async function setCode(table: string): Promise<string> {
    const fresh = `code${randomUUID().replaceAll('-', '')}`
    await world.owner.query(
      'update restro.tables set qr_token = $2, qr_code_hash = $3 where id = $1',
      [table, fresh, await hashTableCode(fresh)],
    )
    return fresh
  }

  async function state(view: 'menu' | 'order' = 'order'): Promise<GuestTableState> {
    const read = await guestState(world.app, { code, view, limiter })
    if (!read.ok || read.answer.unchanged) throw new Error('expected a full state')
    return read.answer
  }

  async function act(command: Record<string, unknown>, ageMs = 50) {
    const answer = await guestAct(world.app, {
      code,
      command: { actionId: randomUUID(), ...command } as never,
      ageMs,
      view: 'order',
      phone: randomUUID(),
      limiter,
      check: { humanToken: 'XXXX.DUMMY.TOKEN.XXXX' },
      humanCheck: async () => 'passed',
    })
    if (!answer.ok) throw new Error(`the code was refused: ${answer.code}`)
    return answer
  }

  /** The order of a state where the venue doesn't check location (so it is always there). */
  function orderOf(read: GuestTableState): NonNullable<GuestTableState['order']> {
    if (read.order === null) throw new Error('expected the order')
    return read.order
  }

  beforeAll(async () => {
    world = await openServiceWorld('guest')
    tableId = world.tables[0] as string
    await world.owner.query(
      `update restro.venues set settings = jsonb_set(settings, '{ordering}', $2::jsonb) where id = $1`,
      [world.venueId, JSON.stringify({ ...DEFAULT_ORDERING_SETTINGS, locationCheck: false })],
    )
  })

  afterAll(async () => {
    await world?.close()
  })

  beforeEach(async () => {
    forgetGuestCodes()
    limiter.clear()
    // Each test starts on a table of its own state: a fresh sitting and a fresh code.
    await world.owner.query(
      'update restro.sittings set ended_at = now(), end_reason = $2 where table_id = $1 and ended_at is null',
      [tableId, 'staff_closed'],
    )
    await world.openSitting(tableId)
    code = await setCode(tableId)
  })

  it('answers a misshapen or unknown code as retired, before and without a table', async () => {
    expect(await guestState(world.app, { code: 'no', view: 'menu' })).toEqual({
      ok: false,
      code: 'code_retired',
    })
    expect(await guestState(world.app, { code: 'unknown-code-1234', view: 'menu' })).toEqual({
      ok: false,
      code: 'code_retired',
    })
  })

  it('reads the open table with an empty order, and unchanged while its version stands', async () => {
    const first = await state('menu')
    expect(first).toMatchObject({
      unchanged: false,
      next: 10_000,
      ordering: { state: 'on' },
      order: { lines: [], removed: [], earlier: null },
      sentOrders: [],
      bill: null,
    })
    expect(first.location).toMatchObject({ state: 'off', passSeconds: null, venueName: 'Club' })
    const again = await guestState(world.app, { code, view: 'order', since: first.version })
    expect(again).toEqual({
      ok: true,
      answer: {
        unchanged: true,
        version: first.version,
        next: 2_000,
        location: 'off',
      } satisfies GuestUnchanged,
    })
  })

  it('asks for a fresh bill reading while a phone polls the bill with its version', async () => {
    // The sitting opened a minute ago; its bill was read 20 s ago, with a bill that did not
    // change the version. Each poll on the bill asks again; a fresh reading asks nothing.
    await world.owner.query(
      `update restro.sittings set opened_at = now() - interval '1 minute'
        where table_id = $1 and ended_at is null`,
      [tableId],
    )
    const recordReading = (age: string) =>
      world.owner.query(
        `insert into restro.bill_readings
           (tenant_id, venue_id, table_id, read_at, complete, source, actor, job_id)
         values ($1, $2, $3, now() - $4::interval, true, 'worker', 'system', 'test-reading')
         on conflict (tenant_id, table_id) do update set read_at = excluded.read_at`,
        [world.tenantId, world.venueId, tableId, age],
      )
    await recordReading('20 seconds')
    const { version } = await state('menu')
    const queued: string[] = []
    const queueReading = async (target: { readonly tableId: string }) => {
      queued.push(target.tableId)
    }
    const poll = await guestState(world.app, {
      code,
      view: 'bill',
      since: version,
      queueReading,
      limiter,
    })
    expect(poll).toMatchObject({ ok: true, answer: { unchanged: true, version } })
    expect(queued).toEqual([tableId])

    await recordReading('1 second')
    await guestState(world.app, { code, view: 'bill', since: version, queueReading, limiter })
    await guestState(world.app, { code, view: 'menu', since: version, queueReading, limiter })
    expect(queued).toEqual([tableId])
  })

  it('shares one order between two phones: adds merge, a repeat gets its first answer', async () => {
    const actionId = randomUUID()
    const add = { type: 'order.add', actionId, itemId: item, optionIds: [], qty: 1, note: '' }
    const first = await act(add)
    expect(first.result).toEqual({
      actionId,
      status: 'accepted',
      code: null,
      subjectId: orderLineIdFor(actionId),
      ref: null,
    })
    // The same tap again (a retry): the first answer, and no second line or quantity.
    const repeat = await act(add)
    expect(repeat.result.subjectId).toBe(orderLineIdFor(actionId))
    // Another phone adds the same thing: it merges into the line.
    await act({ type: 'order.add', itemId: item, optionIds: [], qty: 2, note: '' })
    await act({ type: 'order.add', itemId: other, optionIds: [], qty: 1, note: 'no ice' })
    const shared = orderOf(await state())
    expect(shared.lines.map((line) => [line.itemId, line.qty, line.note])).toEqual([
      [item, 3, ''],
      [other, 1, 'no ice'],
    ])
    expect(shared.lines[0]?.id).toBe(orderLineIdFor(actionId))
  })

  it('changes, removes and undoes a line, and refuses an edit of a line that is gone', async () => {
    const added = await act({ type: 'order.add', itemId: item, optionIds: [], qty: 2, note: '' })
    const lineId = added.result.subjectId as string
    await act({ type: 'order.change', lineId, delta: 1 })
    expect(orderOf(await state()).lines[0]?.qty).toBe(3)
    const removed = await act({ type: 'order.remove', lineId })
    expect(removed.state?.order?.lines).toEqual([])
    expect(removed.state?.order?.removed).toMatchObject([{ id: lineId, qty: 3 }])
    const undone = await act({ type: 'order.undo', lineId })
    expect(undone.result.status).toBe('accepted')
    expect(undone.state?.order?.lines).toMatchObject([{ id: lineId, qty: 3 }])
    const gone = await act({ type: 'order.change', lineId: newId('ol'), delta: 1 })
    expect(gone.result).toMatchObject({ status: 'rejected', code: 'order_changed' })
  })

  it('refuses any edit of a line a payment holds', async () => {
    const added = await act({ type: 'order.add', itemId: item, optionIds: [], qty: 1, note: '' })
    const lineId = added.result.subjectId as string
    const payment = newId('py')
    await world.owner.query(
      `update restro.table_orders
          set lines = jsonb_set(lines, '{0,heldBy}', to_jsonb($2::text))
        where table_id = $1`,
      [tableId, payment],
    )
    expect(orderOf(await state()).lines[0]?.held).toBe(payment)
    for (const command of [
      { type: 'order.change', lineId, delta: 1 },
      { type: 'order.remove', lineId },
    ]) {
      expect((await act(command)).result).toMatchObject({ status: 'rejected', code: 'line_held' })
    }
  })

  it('refuses a tap older than 30 s without remembering it, so a fresh retry goes through', async () => {
    const actionId = randomUUID()
    const add = { type: 'order.add', actionId, itemId: item, optionIds: [], qty: 1, note: '' }
    expect((await act(add, 31_000)).result).toMatchObject({
      status: 'rejected',
      code: 'stale_action',
    })
    expect((await act(add, 100)).result).toMatchObject({ status: 'accepted' })
  })

  it('refuses the 61st change in a minute, logging the trip and raising one alert to Restro', async () => {
    const added = await act({ type: 'order.add', itemId: item, optionIds: [], qty: 1, note: '' })
    const lineId = added.result.subjectId as string
    for (let n = 1; n < ORDER_CHANGES_PER_MINUTE; n += 1) {
      const delta = n % 2 === 0 ? -1 : 1
      expect((await act({ type: 'order.change', lineId, delta })).result.status).toBe('accepted')
    }
    const tripped = await act({ type: 'order.change', lineId, delta: 1 })
    expect(tripped.result).toMatchObject({ status: 'rejected', code: 'rate_limited' })
    expect(tripped.retryAfter).toBe(10)
    await act({ type: 'order.change', lineId, delta: 1 })

    const logged = await world.owner.query(
      `select count(*)::int as n from restro.log_entries
        where table_id = $1 and kind = 'guard.tripped' and reason = 'order_rate'`,
      [tableId],
    )
    expect(logged.rows[0]?.n).toBe(1)
    const alerts = await world.owner.query<{ audience: string }>(
      `select audience from restro.alerts
        where subject_id = $1 and kind = 'order_rate' and done_at is null`,
      [tableId],
    )
    expect(alerts.rows).toEqual([{ audience: 'restro' }])
  })

  it('answers a code that is no longer the table’s as retired, even while it is remembered', async () => {
    await state()
    await setCode(tableId)
    const answer = await guestAct(world.app, {
      code,
      command: {
        type: 'order.add',
        actionId: randomUUID(),
        itemId: item,
        optionIds: [],
        qty: 1,
        note: '',
      },
      ageMs: 10,
      view: 'order',
      phone: randomUUID(),
      limiter,
    })
    expect(answer).toEqual({ ok: false, code: 'code_retired' })
    expect(await guestState(world.app, { code, view: 'order', limiter })).toEqual({
      ok: false,
      code: 'code_retired',
    })
  })

  it('answers a Send as not_built until #77 builds it, past Turnstile', async () => {
    const answer = await act({ type: 'order.send' })
    expect(answer.result).toMatchObject({ status: 'rejected', code: 'not_built' })
  })

  it('sets an idle order aside on the next read, and brings it back with Restore', async () => {
    await act({ type: 'order.add', itemId: item, optionIds: [], qty: 2, note: '' })
    await world.owner.query(
      `update restro.table_orders set idle_expires_at = now() - interval '1 second'
        where table_id = $1`,
      [tableId],
    )
    const aside = orderOf(await state())
    expect(aside.lines).toEqual([])
    expect(aside.earlier?.lines).toMatchObject([{ itemId: item, qty: 2 }])
    const setAsideAt = aside.earlier?.setAsideAt as number
    const restored = await act({ type: 'order.restore', setAsideAt })
    expect(restored.result.status).toBe('accepted')
    expect(restored.state?.order?.lines).toMatchObject([{ itemId: item, qty: 2 }])
    expect(restored.state?.order?.earlier).toBeNull()
  })

  it('lets the worker set an idle order aside as the system, and changes nothing when none is due', async () => {
    await act({ type: 'order.add', itemId: item, optionIds: [], qty: 1, note: '' })
    const system = {
      tenantId: world.tenantId,
      venueId: world.venueId,
      origin: 'worker',
      actor: { kind: 'system' },
      jobId: 'order-tidy-test',
    } as const
    const early = await applyService(world.app, { type: 'order.tidy', tableId }, system)
    expect(early.result).toMatchObject({ status: 'accepted', details: { changed: false } })
    await world.owner.query(
      `update restro.table_orders set idle_expires_at = now() - interval '1 second'
        where table_id = $1`,
      [tableId],
    )
    const due = await applyService(world.app, { type: 'order.tidy', tableId }, system)
    expect(due.result).toMatchObject({ status: 'accepted', details: { changed: true } })
    expect(orderOf(await state()).earlier).not.toBeNull()
  })
})
