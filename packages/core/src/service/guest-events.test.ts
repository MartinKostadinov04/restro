// What the guest API and the service write path record of a night (D142; #335) on a real Postgres:
// a phone's own report (the menu opened, an item opened, a language chosen) goes in against the
// table its code names, and the writes that decide something record it themselves — a line added, a
// line taken off, a waiter called. An event goes in with the write it measures, in the same
// transaction, so the two can never disagree. Skipped without a database.
import { randomUUID } from 'node:crypto'

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { hasDatabase } from '../apply/test-database'
import { newId } from '../ids'
import { DEFAULT_ORDERING_SETTINGS } from '../ordering-settings'
import { hashTableCode } from '../qr'
import { openServiceWorld, type ServiceWorld } from '../testing/service-world'
import { DEFAULT_GUEST_FEATURES } from '../theme/presentation'
import { forgetGuestCodes, guestAct, reportGuestEvents } from './guest'
import { GUEST_LIMITS, type GuestLimit, GuestLimiter, type GuestLimitName } from './guest-limits'

/** D122's limits, loosened so a test's quick taps meet the engine's limits, not the phone's. */
const LOOSE = Object.fromEntries(
  Object.entries(GUEST_LIMITS).map(([name, limit]) => [name, { ...limit, max: 10_000 }]),
) as Record<GuestLimitName, GuestLimit>

describe.skipIf(!hasDatabase)('the events of a night (as the restro_app role)', () => {
  let world: ServiceWorld
  let tableId: string
  let code: string
  const limiter = new GuestLimiter(LOOSE)
  const item = newId('nd')

  async function setCode(table: string): Promise<string> {
    const fresh = `code${randomUUID().replaceAll('-', '')}`
    await world.owner.query(
      'update restro.tables set qr_token = $2, qr_code_hash = $3 where id = $1',
      [table, fresh, await hashTableCode(fresh)],
    )
    return fresh
  }

  async function act(command: Record<string, unknown>, view: 'order' | 'menu' = 'order') {
    const answer = await guestAct(world.app, {
      code,
      command: { actionId: randomUUID(), ...command } as never,
      ageMs: 50,
      view,
      phone: randomUUID(),
      limiter,
      check: { humanToken: 'XXXX.DUMMY.TOKEN.XXXX' },
      humanCheck: async () => 'passed',
    })
    if (!answer.ok) throw new Error(`the code was refused: ${answer.code}`)
    return answer
  }

  /** Every event of the venue so far: the kind and the fields that kind fills. */
  async function recorded(): Promise<readonly Record<string, unknown>[]> {
    const { rows } = await world.owner.query(
      `select kind, table_id, sitting_id, node_id, locale, outcome, source, actor, job_id
         from restro.guest_events where venue_id = $1 order by seq`,
      [world.venueId],
    )
    return rows as readonly Record<string, unknown>[]
  }

  const kinds = async () => (await recorded()).map((row) => row.kind)

  beforeAll(async () => {
    world = await openServiceWorld('guest-events-service')
    tableId = world.tables[0] as string
    await world.owner.query(
      `update restro.venues set settings = jsonb_set(settings, '{ordering}', $2::jsonb) where id = $1`,
      [world.venueId, JSON.stringify({ ...DEFAULT_ORDERING_SETTINGS, locationCheck: false })],
    )
    // "Call a waiter" is on, so the guest command reaches its handler.
    await world.owner.query(
      `update restro.venues set settings = jsonb_set(settings, '{guest_features}', $2::jsonb) where id = $1`,
      [
        world.venueId,
        JSON.stringify({
          ...DEFAULT_GUEST_FEATURES,
          ordering: true,
          call_waiter: { enabled: true, kinds: ['waiter'] },
        }),
      ],
    )
  })

  afterAll(async () => {
    await world?.close()
  })

  beforeEach(async () => {
    forgetGuestCodes()
    limiter.clear()
    await world.owner.query('delete from restro.guest_events where venue_id = $1', [world.venueId])
    await world.owner.query(
      'update restro.sittings set ended_at = now(), end_reason = $2 where table_id = $1 and ended_at is null',
      [tableId, 'staff_closed'],
    )
    await world.owner.query('delete from restro.table_orders where table_id = $1', [tableId])
    await world.openSitting(tableId)
    code = await setCode(tableId)
  })

  it('records the three things a phone reports itself, against its own table', async () => {
    const answer = await reportGuestEvents(world.app, {
      code,
      limiter,
      events: [
        { kind: 'menu.opened', ageMs: 20 },
        { kind: 'item.opened', itemId: item, ageMs: 10 },
        { kind: 'language.chosen', locale: 'en_US', ageMs: 0 },
      ],
    })
    expect(answer).toEqual({ ok: true, recorded: 3 })
    const rows = await recorded()
    expect(rows.map((row) => row.kind)).toEqual(['menu.opened', 'item.opened', 'language.chosen'])
    for (const row of rows) {
      expect(row.table_id).toBe(tableId)
      expect(row.sitting_id).not.toBeNull()
      expect(row.source).toBe('guest')
      expect(row.actor).toBe('guest')
      expect(String(row.job_id)).toMatch(/^guest-events-/)
    }
    expect(rows[1]?.node_id).toBe(item)
    expect(rows[2]?.locale).toBe('en_US')
  })

  it('writes nothing for a code that is not a table’s', async () => {
    expect(
      await reportGuestEvents(world.app, {
        code: 'unknown-code-1234',
        limiter,
        events: [{ kind: 'menu.opened', ageMs: 0 }],
      }),
    ).toEqual({ ok: false, code: 'code_retired' })
    expect(await recorded()).toEqual([])
  })

  it('records a line added and a line taken off, and nothing for an edit that moved neither', async () => {
    const added = await act({ type: 'order.add', itemId: item, optionIds: [], qty: 2, note: '' })
    const lineId = added.result.subjectId as string
    expect(await kinds()).toEqual(['order.line_added'])
    await act({ type: 'order.change', lineId, delta: 1 })
    expect(await kinds()).toEqual(['order.line_added', 'order.line_added'])
    await act({ type: 'order.change', lineId, delta: -1 })
    await act({ type: 'order.remove', lineId })
    expect(await kinds()).toEqual([
      'order.line_added',
      'order.line_added',
      'order.line_removed',
      'order.line_removed',
    ])
    // An Undo puts the line back, so it reads as an add; a repeat of the same tap adds nothing.
    await act({ type: 'order.undo', lineId })
    expect(await kinds()).toHaveLength(5)
    expect((await kinds()).at(-1)).toBe('order.line_added')
    // A refused edit records nothing: the line it names is not on the order.
    await act({ type: 'order.change', lineId: newId('ol'), delta: 1 })
    expect(await kinds()).toHaveLength(5)
    // Every event of the write path carries the guest as its source, the command as its job, and
    // the dish it moved — the pair's whole point, since an unsent line leaves no service row.
    const rows = await recorded()
    for (const row of rows) {
      expect(row.source).toBe('guest')
      expect(String(row.job_id).length).toBeGreaterThan(0)
      expect(row.sitting_id).not.toBeNull()
      expect(row.node_id).toBe(item)
    }
  })

  it('records a dish per dish an edit moved, naming each one', async () => {
    const other = newId('nd')
    await act({ type: 'order.add', itemId: item, optionIds: [], qty: 1, note: '' })
    const second = await act({ type: 'order.add', itemId: other, optionIds: [], qty: 1, note: '' })
    await act({ type: 'order.remove', lineId: second.result.subjectId as string })
    expect((await recorded()).map((row) => [row.kind, row.node_id])).toEqual([
      ['order.line_added', item],
      ['order.line_added', other],
      ['order.line_removed', other],
    ])
  })

  it('records a waiter called once per call, not once per tap', async () => {
    // The shell's own command (`service.request`), which the guest API maps to `waiter.call`.
    const tap = async () => {
      const answer = await act({ type: 'service.request', request: 'waiter', note: '' }, 'menu')
      // A refusal here would leave the event list empty for a reason that is not the model's.
      expect(answer.result.status, answer.result.code ?? '').toBe('accepted')
    }
    await tap()
    expect(await kinds()).toEqual(['waiter.call_opened'])
    // The same call, asked again: one call, one event.
    await tap()
    expect(await kinds()).toEqual(['waiter.call_opened'])
  })

  it('records one Send attempt with its outcome, however the Send ends', async () => {
    const line = { itemId: item, optionIds: [], qty: 1, note: '' }
    await act({ type: 'order.add', ...line })
    // No POS serves this venue, so the Send may well be refused; either way it was attempted once.
    await act({ type: 'order.send', lines: [line] })
    const sends = (await recorded()).filter((row) => row.kind === 'order.send_attempted')
    expect(sends).toHaveLength(1)
    expect(String(sends[0]?.outcome)).toMatch(/^[a-z][a-z0-9_]{0,63}$/)
    expect(sends[0]?.source).toBe('guest')
  })

  it('keeps the event and the write it measures in one transaction', async () => {
    await act({ type: 'order.add', itemId: item, optionIds: [], qty: 1, note: '' })
    const [{ orders, events }] = (
      await world.owner.query(
        `select (select count(*)::int from restro.table_orders where table_id = $1) as orders,
                (select count(*)::int from restro.guest_events
                  where venue_id = $2 and kind = 'order.line_added') as events`,
        [tableId, world.venueId],
      )
    ).rows as [{ orders: number; events: number }]
    expect(orders).toBe(1)
    expect(events).toBe(1)
  })
})
