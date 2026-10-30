// "Call a waiter" (#81, #180; D122 §4) on a real Postgres, as the restro_app role: a venue without
// the service on refuses the call, and so does a kind its list does not hold; a call needs the
// table open for phones but not a location pass; one call is open per table and a later request is
// added to it; Handled needs `alerts.answer`, ends the whole call and is a Log entry; a call
// nobody answers lapses after the venue's time (from its newest request) or when its sitting ends,
// and the next tap makes a new one. Skipped without a database.
import { randomUUID } from 'node:crypto'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { hasDatabase } from '../apply/test-database'
import { DEFAULT_ORDERING_SETTINGS } from '../ordering-settings'
import { hashTableCode } from '../qr'
import { openServiceWorld, type ServiceWorld } from '../testing/service-world'
import type { ServiceActor, ServiceContext } from './context'
import { forgetGuestCodes, type GuestTableState, guestAct, guestState } from './guest'
import { GUEST_LIMITS, type GuestLimit, GuestLimiter, type GuestLimitName } from './guest-limits'
import { applyService, type ServiceCommand } from './index'

const LOOSE = Object.fromEntries(
  Object.entries(GUEST_LIMITS).map(([name, limit]) => [name, { ...limit, max: 10_000 }]),
) as Record<GuestLimitName, GuestLimit>

const FEATURES_ON = {
  filters: true,
  call_waiter: { enabled: true, kinds: ['waiter', 'bill', 'ice', 'water'] },
  bill: false,
  ordering: true,
  pay: false,
}

describe.skipIf(!hasDatabase)('Call a waiter (as the restro_app role)', () => {
  let world: ServiceWorld
  let ownerId: string
  let memberId: string
  const limiter = new GuestLimiter(LOOSE)
  const codes = new Map<string, string>()

  beforeAll(async () => {
    world = await openServiceWorld('waiter-call')
    ownerId = await world.addUser('owner')
    // A member holds what their venue role holds: this one may open tables, not answer calls.
    memberId = await world.addUser('member')
    await world.addStaff(['tables.open_close'], memberId)
    for (const table of world.tables) {
      const code = `wcall${randomUUID().replaceAll('-', '')}`
      codes.set(table, code)
      await world.owner.query(
        'update restro.tables set qr_token = $2, qr_code_hash = $3 where id = $1',
        [table, code, await hashTableCode(code)],
      )
    }
  })

  afterAll(async () => {
    forgetGuestCodes()
    await world?.close()
  })

  const setFeatures = async (features: unknown) => {
    await world.owner.query(
      `update restro.venues set settings = jsonb_set(settings, '{guest_features}', $2::jsonb) where id = $1`,
      [world.venueId, JSON.stringify(features)],
    )
  }
  const setOrdering = async (ordering: Record<string, unknown>) => {
    await world.owner.query(
      `update restro.venues set settings = jsonb_set(settings, '{ordering}', $2::jsonb) where id = $1`,
      [world.venueId, JSON.stringify({ ...DEFAULT_ORDERING_SETTINGS, ...ordering })],
    )
  }
  const tableId = (index: number) => world.tables[index] as string
  const codeOf = (index: number) => codes.get(tableId(index)) as string

  /** A guest's tap on a table, as the shell sends it. */
  async function tap(index: number, extra: Record<string, unknown> = {}, ageMs = 50) {
    const answer = await guestAct(world.app, {
      code: codeOf(index),
      command: {
        type: 'service.request',
        actionId: randomUUID(),
        request: 'waiter',
        note: '',
        ...extra,
      },
      ageMs,
      view: 'menu',
      phone: randomUUID(),
      limiter,
    })
    if (!answer.ok) throw new Error(`the code was refused: ${answer.code}`)
    return answer
  }
  async function stateOf(index: number): Promise<GuestTableState> {
    const read = await guestState(world.app, { code: codeOf(index), view: 'menu', limiter })
    if (!read.ok || read.answer.unchanged) throw new Error('expected a full state')
    return read.answer
  }
  const callsOf = async (index: number) =>
    (
      await world.owner.query<{ id: string; state: string; actor: string; kinds: string[] }>(
        'select id, state, actor, kinds from restro.waiter_calls where table_id = $1 order by called_at, id',
        [tableId(index)],
      )
    ).rows
  const logOf = async (index: number) =>
    (
      await world.owner.query<{
        kind: string
        reason: string | null
        actor: string
        details: Record<string, string>
      }>(
        `select kind, reason, actor, details from restro.log_entries
          where table_id = $1 and kind like 'waiter_call.%' order by seq`,
        [tableId(index)],
      )
    ).rows
  const backdate = (id: string, minutes: number) =>
    world.owner.query(
      `update restro.waiter_calls
          set called_at = now() - make_interval(mins => $2),
              last_called_at = now() - make_interval(mins => $2)
        where id = $1`,
      [id, minutes],
    )

  const staff = (userId: string): ServiceContext => ({
    tenantId: world.tenantId,
    venueId: world.venueId,
    origin: 'staff',
    actor: { kind: 'user', userId, sessionId: `sess-${randomUUID()}` } satisfies ServiceActor,
    jobId: `req-${randomUUID()}`,
    signedInAt: new Date(),
  })
  const worker = (): ServiceContext => ({
    tenantId: world.tenantId,
    venueId: world.venueId,
    origin: 'worker',
    actor: { kind: 'system' },
    jobId: `lapse-${randomUUID()}`,
  })
  const run = async (command: ServiceCommand, context: ServiceContext) =>
    (await applyService(world.app, command, context)).result
  const done = (id: string) => ({ type: 'waiter_call.done', waiterCallId: id }) as ServiceCommand
  const lapse = (id: string) => ({ type: 'waiter_call.lapse', waiterCallId: id }) as ServiceCommand

  it('is refused while the venue has not switched the service on, and while the table is closed', async () => {
    await world.openSitting(tableId(0))
    const off = await tap(0)
    expect(off.result).toMatchObject({ status: 'rejected', code: 'calls_off' })
    expect(await callsOf(0)).toEqual([])

    await setFeatures(FEATURES_ON)
    const closed = await tap(1)
    expect(closed.result).toMatchObject({ status: 'rejected', code: 'table_not_open' })
    expect(await callsOf(1)).toEqual([])
  })

  it('makes a call without a location pass, and a later request joins the open call', async () => {
    await setFeatures(FEATURES_ON)
    await setOrdering({ locationCheck: true })
    const first = await tap(0, { request: 'bill', note: 'the card machine, please' })
    expect(first.result).toMatchObject({ status: 'accepted', code: null })
    // The venue checks location and this phone holds no pass: the order stays hidden, the call shows.
    expect(first.state?.location.state).toBe('needed')
    expect(first.state?.order).toBeNull()
    expect(first.state?.waiterCall).toMatchObject({ state: 'open', kinds: ['bill'] })

    const again = await tap(0)
    expect(again.result.status).toBe('accepted')
    expect(again.state?.waiterCall?.id).toBe(first.state?.waiterCall?.id)
    expect(again.state?.waiterCall?.kinds).toEqual(['waiter', 'bill'])
    const rows = await callsOf(0)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ state: 'open', actor: 'guest', kinds: ['waiter', 'bill'] })
    expect((await logOf(0)).map((entry) => [entry.kind, entry.details.kind])).toEqual([
      ['waiter_call.called', 'bill'],
      ['waiter_call.called', 'waiter'],
    ])
    // Nothing the guest typed is kept anywhere.
    const stored = await world.owner.query('select * from restro.waiter_calls where id = $1', [
      rows[0]?.id,
    ])
    expect(JSON.stringify(stored.rows)).not.toContain('card machine')
  })

  it('refuses a tap that is too old', async () => {
    const before = (await callsOf(0)).length
    const old = await tap(0, {}, 120_000)
    expect(old.result).toMatchObject({ status: 'rejected', code: 'stale_action' })
    expect(await callsOf(0)).toHaveLength(before)
  })

  it('is marked Handled only by someone who holds alerts.answer, once, with a Log entry', async () => {
    await world.openSitting(tableId(3))
    const call = (await tap(3)).state?.waiterCall
    if (call == null) throw new Error('expected the call')

    expect(await run(done(call.id), staff(memberId))).toMatchObject({
      status: 'refused',
      code: 'permission_denied',
    })
    expect((await callsOf(3))[0]?.state).toBe('open')

    expect(await run(done(call.id), staff(ownerId))).toMatchObject({
      status: 'accepted',
      details: { state: 'done', changed: true },
    })
    expect(await run(done(call.id), staff(ownerId))).toMatchObject({
      status: 'accepted',
      details: { state: 'done', changed: false },
    })
    expect((await callsOf(3))[0]?.state).toBe('done')
    expect((await stateOf(3)).waiterCall).toMatchObject({ id: call.id, state: 'done' })
    const log = await logOf(3)
    expect(log.map((entry) => entry.kind)).toEqual(['waiter_call.called', 'waiter_call.done'])
    expect(log[1]?.actor).toBe(`user:${ownerId}`)

    // A new tap after Handled is a new call.
    const next = (await tap(3)).state?.waiterCall
    expect(next).toMatchObject({ state: 'open' })
    expect(next?.id).not.toBe(call.id)
    expect(await callsOf(3)).toHaveLength(2)
  })

  it('lapses after the venue’s time: the worker lapses it, Handled is then refused, a tap starts anew', async () => {
    await setOrdering({ callLapseMinutes: 15 })
    const table = 1
    await world.openSitting(tableId(table))
    const first = (await tap(table)).state?.waiterCall
    if (first == null) throw new Error('expected the call')

    // Not due yet: nothing changes.
    expect(await run(lapse(first.id), worker())).toMatchObject({
      status: 'accepted',
      details: { changed: false },
    })
    await backdate(first.id, 16)
    expect(await run(lapse(first.id), worker())).toMatchObject({
      status: 'accepted',
      details: { changed: true },
    })
    expect(await run(lapse(first.id), worker())).toMatchObject({
      status: 'accepted',
      details: { changed: false },
    })
    expect((await stateOf(table)).waiterCall).toMatchObject({ id: first.id, state: 'lapsed' })
    expect(await run(done(first.id), staff(ownerId))).toMatchObject({
      status: 'refused',
      code: 'call_lapsed',
    })

    // A tap past the time lapses the old call itself and makes a new one.
    const second = (await tap(table)).state?.waiterCall
    expect(second).toMatchObject({ state: 'open' })
    expect(second?.id).not.toBe(first.id)
    await backdate(second?.id as string, 20)
    const third = (await tap(table)).state?.waiterCall
    expect(third?.id).not.toBe(second?.id)
    const log = await logOf(table)
    expect(log.map((entry) => `${entry.kind}:${entry.reason ?? ''}`)).toEqual([
      'waiter_call.called:',
      'waiter_call.lapsed:timeout',
      'waiter_call.called:',
      'waiter_call.lapsed:timeout',
      'waiter_call.called:',
    ])
  })

  it('lapses when the sitting ends, and the next group’s tap makes a new call', async () => {
    const table = 2
    const sittingId = await world.openSitting(tableId(table))
    const call = (await tap(table)).state?.waiterCall
    if (call == null) throw new Error('expected the call')
    await world.owner.query(
      `update restro.sittings set ended_at = now(), end_reason = 'staff_closed' where id = $1`,
      [sittingId],
    )
    // The state of a closed table shows no call.
    expect((await stateOf(table)).waiterCall).toBeNull()
    expect(await run(lapse(call.id), worker())).toMatchObject({
      status: 'accepted',
      details: { changed: true },
    })
    expect((await logOf(table)).at(-1)).toMatchObject({
      kind: 'waiter_call.lapsed',
      reason: 'sitting_ended',
    })

    // And without the worker: a call left open by an ended sitting lapses at the next group's tap.
    const second = await world.openSitting(tableId(table))
    const open = (await tap(table)).state?.waiterCall
    expect(open).toMatchObject({ state: 'open' })
    await world.owner.query(
      `update restro.sittings set ended_at = now(), end_reason = 'new_guests' where id = $1`,
      [second],
    )
    await world.openSitting(tableId(table))
    const fresh = (await tap(table)).state?.waiterCall
    expect(fresh?.id).not.toBe(open?.id)
    expect((await callsOf(table)).map((row) => row.state)).toEqual(['lapsed', 'lapsed', 'open'])
  })

  /** Ends what an earlier test left open at the table, so the next starts clean. */
  const fresh = (index: number) =>
    world.owner.query(
      `update restro.waiter_calls set state = 'lapsed' where table_id = $1 and state = 'open'`,
      [tableId(index)],
    )

  it('keeps one call per table: two requests make one call with both kinds, a repeat changes nothing', async () => {
    await setOrdering({ locationCheck: false })
    const table = 3
    await fresh(table)
    const before = (await callsOf(table)).length
    const logBefore = (await logOf(table)).length
    const ice = await tap(table, { request: 'ice' })
    const water = await tap(table, { request: 'water' })
    expect(water.state?.waiterCall?.id).toBe(ice.state?.waiterCall?.id)
    expect(water.state?.waiterCall?.kinds).toEqual(['ice', 'water'])
    const repeat = await tap(table, { request: 'ice' })
    expect(repeat.result.status).toBe('accepted')
    expect(repeat.state?.waiterCall?.kinds).toEqual(['ice', 'water'])
    expect(await logOf(table)).toHaveLength(logBefore + 2)
    const rows = await callsOf(table)
    expect(rows).toHaveLength(before + 1)
    const call = rows.at(-1)
    expect(call?.kinds).toEqual(['ice', 'water'])

    // One Handled ends the whole call and names both kinds in the Log.
    expect(await run(done(call?.id as string), staff(ownerId))).toMatchObject({
      status: 'accepted',
      details: { state: 'done', changed: true },
    })
    expect((await logOf(table)).at(-1)).toMatchObject({
      kind: 'waiter_call.done',
      details: { kinds: 'ice,water' },
    })
    expect((await stateOf(table)).waiterCall).toMatchObject({
      state: 'done',
      kinds: ['ice', 'water'],
    })
  })

  it('refuses a kind the venue does not offer, and keeps nothing', async () => {
    const table = 2
    await fresh(table)
    const before = (await callsOf(table)).length
    const refused = await tap(table, { request: 'glasses' })
    expect(refused.result).toMatchObject({ status: 'rejected', code: 'kind_not_offered' })
    expect(await callsOf(table)).toHaveLength(before)
    // A list from before this change still holds `cutlery`: it reads without it, never as off.
    await setFeatures({
      ...FEATURES_ON,
      call_waiter: { enabled: true, kinds: ['waiter', 'cutlery', 'other'] },
    })
    expect((await tap(table, { request: 'water' })).result).toMatchObject({
      code: 'kind_not_offered',
    })
    expect((await tap(table, { request: 'waiter' })).result).toMatchObject({ status: 'accepted' })
    await setFeatures(FEATURES_ON)
  })

  it('counts the lapse from the newest request', async () => {
    await setOrdering({ callLapseMinutes: 15 })
    const table = 3
    await fresh(table)
    const first = (await tap(table, { request: 'ice' })).state?.waiterCall
    if (first == null) throw new Error('expected the call')
    await backdate(first.id, 10)
    // A newer request restarts the time: the call is old, its newest request is not.
    await tap(table, { request: 'water' })
    await world.owner.query(
      `update restro.waiter_calls set called_at = now() - interval '20 minutes' where id = $1`,
      [first.id],
    )
    expect(await run(lapse(first.id), worker())).toMatchObject({ details: { changed: false } })
    await world.owner.query(
      `update restro.waiter_calls set last_called_at = now() - interval '16 minutes' where id = $1`,
      [first.id],
    )
    expect(await run(lapse(first.id), worker())).toMatchObject({ details: { changed: true } })
    expect((await logOf(table)).at(-1)).toMatchObject({
      kind: 'waiter_call.lapsed',
      reason: 'timeout',
      details: { kinds: 'ice,water' },
    })
  })

  describe('the Undo of Handled (RR-58)', () => {
    const undone = (id: string, undo: { entry: number }) =>
      ({ type: 'waiter_call.undone', waiterCallId: id, undo }) as ServiceCommand
    const handled = async (id: string) => {
      const result = await run(done(id), staff(ownerId))
      if (result.status !== 'accepted') throw new Error(`refused: ${JSON.stringify(result)}`)
      return { entry: Number(result.details.undoEntry) }
    }
    const newCall = async (index: number) => {
      await world.owner.query(
        "update restro.waiter_calls set state = 'lapsed' where table_id = $1 and state = 'open'",
        [tableId(index)],
      )
      await world.owner.query(
        'update restro.sittings set ended_at = now(), end_reason = $2 where table_id = $1 and ended_at is null',
        [tableId(index), 'staff_closed'],
      )
      await world.openSitting(tableId(index))
      await setOrdering({ locationCheck: false })
      const call = (await tap(index)).state?.waiterCall
      if (call == null) throw new Error('no call')
      return call
    }

    it('opens the same call again, with a Log entry the Log can word apart', async () => {
      const call = await newCall(2)
      const token = await handled(call.id)
      expect(token.entry).toBeGreaterThan(0)
      const result = await run(undone(call.id, token), staff(ownerId))
      expect(result).toMatchObject({
        status: 'accepted',
        details: { state: 'open', changed: true },
      })
      expect((await stateOf(2)).waiterCall).toMatchObject({ id: call.id, state: 'open' })
      const { rows } = await world.owner.query<{ done_at: Date | null; done_by: string | null }>(
        'select done_at, done_by from restro.waiter_calls where id = $1',
        [call.id],
      )
      expect(rows[0]).toEqual({ done_at: null, done_by: null })
      expect((await logOf(2)).at(-1)).toMatchObject({
        kind: 'waiter_call.done',
        details: { waiterCallId: call.id },
      })
      const { rows: last } = await world.owner.query<{ to_state: string }>(
        'select to_state from restro.log_entries where table_id = $1 order by seq desc limit 1',
        [tableId(2)],
      )
      expect(last[0]?.to_state).toBe('open')
      // And Handled again works.
      expect(await run(done(call.id), staff(ownerId))).toMatchObject({ status: 'accepted' })
    })

    it('is quick on a tablet, as Handled is', async () => {
      const call = await newCall(2)
      const session = `sess-${randomUUID()}`
      await world.addSharedDevice(session)
      const account = await world.addUser('member')
      const tablet: ServiceActor = { kind: 'user', userId: account, sessionId: session }
      const context = { ...staff(account), actor: tablet }
      const first = await run(done(call.id), context)
      if (first.status !== 'accepted') throw new Error(`refused: ${JSON.stringify(first)}`)
      expect(
        await run(undone(call.id, { entry: Number(first.details.undoEntry) }), context),
      ).toMatchObject({ status: 'accepted', details: { changed: true } })
    })

    it('is refused when the table called again, or with a token not of this answer', async () => {
      const call = await newCall(2)
      const token = await handled(call.id)
      const next = (await tap(2)).state?.waiterCall
      expect(next?.id).not.toBe(call.id)
      expect(await run(undone(call.id, token), staff(ownerId))).toMatchObject({
        code: 'undo_stale',
      })
      expect((await stateOf(2)).waiterCall).toMatchObject({ id: next?.id, state: 'open' })

      // The token of the other call's answer.
      const other = await handled(next?.id as string)
      expect(await run(undone(call.id, other), staff(ownerId))).toMatchObject({
        code: 'undo_stale',
      })
    })

    it('is refused for someone else’s answer, and once the sitting ended', async () => {
      const call = await newCall(2)
      const token = await handled(call.id)
      const otherId = await world.addUser('member')
      await world.addStaff(['alerts.answer'], otherId)
      expect(await run(undone(call.id, token), staff(otherId))).toMatchObject({
        code: 'undo_stale',
      })
      await world.owner.query(
        'update restro.sittings set ended_at = now(), end_reason = $2 where table_id = $1 and ended_at is null',
        [tableId(2), 'staff_closed'],
      )
      expect(await run(undone(call.id, token), staff(ownerId))).toMatchObject({
        code: 'undo_stale',
      })
    })
  })
})
