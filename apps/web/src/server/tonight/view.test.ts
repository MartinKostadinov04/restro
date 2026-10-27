// The Tonight view builder (#85): the order of "Needs you" (plan §4), a table's tile (plan §5), the
// pause banners (plan §3, §12 B) and the out-of-stock notice (plan §12 A), from a reading of Tonight.
import type { Tonight } from '@restro/core/service'
import { describe, expect, it } from 'vitest'

import { buildTonightView, ROW_RANK } from './view'

const NOW = new Date('2026-10-27T21:30:00Z')
const BAR1 = 'br_000000000000000000001'
const BAR2 = 'br_000000000000000000002'
const VENUE = 'vn_0123456789ABCDEFGHIJKL'

const table = (n: number, barId: string | null, open: boolean) => ({
  id: `tb_00000000000000000000${n}`,
  label: `Table ${n}`,
  numbered: false,
  barId,
  isPaymentTable: false,
  sitting: open
    ? {
        id: `st_0000000000000000000${n}`,
        openedAt: new Date('2026-10-27T20:00:00Z'),
        openedHow: 'one',
      }
    : null,
})

function tonight(overrides: Partial<Tonight> = {}): Tonight {
  return {
    serviceDate: '2026-10-27',
    permissions: ['tables.open_close', 'tables.resume', 'ordering.pause', 'alerts.answer'],
    device: false,
    bars: [
      { id: BAR1, name: 'Main bar' },
      { id: BAR2, name: 'Second bar' },
    ],
    tables: [table(1, BAR1, true), table(2, BAR1, false), table(3, BAR2, true)],
    sentOrders: [],
    alerts: [],
    waiterCalls: [],
    pauses: [],
    log: null,
    ...overrides,
  }
}

const view = (t: Tonight, timezone = 'Europe/Sofia') =>
  buildTonightView({
    tonight: t,
    venueId: VENUE,
    timezone,
    source: 'Mistral',
    currency: 'EUR',
    now: NOW,
  })

const pause = (over: Record<string, unknown>) => ({
  id: 'pa_00000000000000000001',
  scope: 'bar',
  cause: 'staff',
  restroStarted: false,
  startedAt: new Date('2026-10-27T20:10:00Z'),
  targetId: BAR1,
  startedBy: 'Maria',
  ...over,
})

describe('Needs you, in the order of what costs most to leave', () => {
  it('puts a sent order to check before an approval, a paused table and a call', () => {
    const t = tonight({
      alerts: [
        {
          id: 'al_1',
          kind: 'order_unconfirmed',
          subjectId: 'so_1',
          permission: 'alerts.answer',
          raisedAt: new Date('2026-10-27T21:20:00Z'),
          details: {
            reference: 'K7F2',
            tableId: 'tb_000000000000000000001',
            items: [{ name: 'Mojito', options: ['no ice'], qty: 2 }],
            billBeforeMinor: 4600,
            sentAt: '2026-10-27T21:19:00Z',
          },
        },
      ],
      sentOrders: [
        {
          id: 'so_2',
          tableId: 'tb_000000000000000000003',
          kind: 'order',
          state: 'awaiting_approval',
          reason: null,
          reference: 'AAAA',
          totalMinor: 900,
          createdAt: new Date('2026-10-27T21:10:00Z'),
          settledAt: null,
        },
      ],
      waiterCalls: [
        {
          id: 'wc_1',
          tableId: 'tb_000000000000000000003',
          calledAt: new Date('2026-10-27T21:00:00Z'),
        },
      ],
      pauses: [
        pause({
          id: 'pa_2',
          scope: 'table',
          cause: 'guard_tripped',
          targetId: 'tb_000000000000000000003',
          startedBy: null,
        }),
      ],
    })
    const rows = view(t).rows
    expect(rows.map((row) => row.kind)).toEqual(['check', 'approval', 'paused', 'call'])
    expect(rows.map((row) => ROW_RANK[row.kind])).toEqual([1, 2, 3, 4])
    // The sent order to check carries what a waiter needs at the till, with the time in the
    // venue's zone (UTC+2 after the clocks change on 25 October).
    expect(rows[0]?.check).toMatchObject({
      reference: 'K7F2',
      billBeforeMinor: 4600,
      sentAt: '23:19',
      items: [{ name: 'Mojito', options: ['no ice'], qty: 2 }],
    })
  })

  it('orders calls of one rank oldest first', () => {
    const t = tonight({
      waiterCalls: [
        {
          id: 'wc_b',
          tableId: 'tb_000000000000000000003',
          calledAt: new Date('2026-10-27T21:10:00Z'),
        },
        {
          id: 'wc_a',
          tableId: 'tb_000000000000000000001',
          calledAt: new Date('2026-10-27T21:05:00Z'),
        },
      ],
    })
    expect(view(t).rows.map((row) => row.id)).toEqual(['wc_a', 'wc_b'])
  })

  it('shows no call to someone who does not answer them', () => {
    expect(view(tonight({ waiterCalls: null })).rows).toEqual([])
  })
})

describe('the tiles', () => {
  it('shows closed, open and the words that need a person, the worst one winning', () => {
    const t = tonight({
      waiterCalls: [
        {
          id: 'wc_1',
          tableId: 'tb_000000000000000000001',
          calledAt: new Date('2026-10-27T21:00:00Z'),
        },
      ],
      pauses: [
        pause({
          id: 'pa_u',
          scope: 'table',
          cause: 'order_unconfirmed',
          targetId: 'tb_000000000000000000001',
          startedBy: null,
        }),
      ],
    })
    const states = Object.fromEntries(
      view(t)
        .groups.flatMap((g) => g.tables)
        .map((x) => [x.label, x.state]),
    )
    expect(states).toEqual({ 'Table 1': 'check', 'Table 2': 'closed', 'Table 3': 'open' })
  })

  it('counts open tables and groups them by bar, with a bar of none after the named ones', () => {
    const t = tonight({
      tables: [table(1, BAR1, true), table(2, null, true), table(3, BAR2, false)],
    })
    const v = view(t)
    expect(v.openCount).toBe(2)
    expect(v.tableCount).toBe(3)
    expect(v.groups.map((g) => [g.name, g.tables.length])).toEqual([
      ['Main bar', 1],
      ['Second bar', 1],
      [null, 1],
    ])
  })

  it('reads a table whose bar is gone as having none', () => {
    const t = tonight({ bars: [], tables: [table(1, BAR1, true)] })
    expect(view(t).groups.map((g) => g.name)).toEqual([null])
  })
})

describe('the pause banners', () => {
  it('shows one per staff pause, naming the bar, and marks that bar paused', () => {
    const v = view(tonight({ pauses: [pause({})] }))
    expect(v.banners).toEqual([
      {
        id: 'pa_00000000000000000001',
        kind: 'staff',
        barId: BAR1,
        barName: 'Main bar',
        who: 'Maria',
        at: '22:10',
      },
    ])
    expect(v.groups.map((g) => [g.name, g.paused])).toEqual([
      ['Main bar', true],
      ['Second bar', false],
    ])
    // Its open table reads Paused; the other bar's stays as it was.
    const tiles = v.groups.flatMap((g) => g.tables)
    expect(tiles.map((x) => x.state)).toEqual(['paused', 'closed', 'open'])
    // Pause ordering stays offered for the bar that is not paused, and not for all bars.
    expect(v.pausableBars).toEqual([{ id: BAR2, name: 'Second bar' }])
  })

  it('hides the bar banners an all-bars pause covers', () => {
    const v = view(
      tonight({
        pauses: [
          pause({ id: 'pa_v', scope: 'venue', targetId: VENUE }),
          pause({ id: 'pa_b', scope: 'bar', targetId: BAR2 }),
        ],
      }),
    )
    expect(v.banners.map((b) => b.id)).toEqual(['pa_v'])
    expect(v.canPauseAll).toBe(false)
    expect(v.pausableBars).toEqual([])
  })

  it("shows Restro's connection pause alone, with no one named and nothing to start", () => {
    const v = view(
      tonight({
        pauses: [
          pause({
            id: 'pa_r',
            scope: 'connection',
            cause: 'breaker',
            restroStarted: true,
            startedBy: null,
          }),
          pause({ id: 'pa_s', scope: 'venue', targetId: VENUE }),
        ],
      }),
    )
    expect(v.banners.map((b) => [b.id, b.kind])).toEqual([['pa_r', 'restro']])
    expect(v.canPauseAll).toBe(false)
  })
})

describe('the out-of-stock notice', () => {
  const stock = (n: number, name: string) => ({
    id: `al_stock${n}`,
    kind: 'item_out_of_stock',
    subjectId: `nd_${n}`,
    permission: 'alerts.answer',
    raisedAt: new Date(`2026-10-27T21:0${n}:00Z`),
    details: { itemId: `nd_${n}`, name },
  })

  it('is one entry that lists the items in the order they ran out, not a row', () => {
    const v = view(tonight({ alerts: [stock(2, 'Negroni'), stock(1, 'Mojito')] }))
    expect(v.outOfStock).toEqual(['Mojito', 'Negroni'])
    expect(v.rows).toEqual([])
  })

  it('is empty when nothing ran out', () => {
    expect(view(tonight()).outOfStock).toEqual([])
  })
})

describe('what the actor may do', () => {
  it('follows the permissions and says whether it is a shared device', () => {
    const v = view(tonight({ permissions: ['alerts.answer'], device: true }))
    expect(v.device).toBe(true)
    expect(v.can).toEqual({
      openClose: false,
      resume: false,
      pause: false,
      lift: false,
      answer: true,
    })
  })
})

describe('Pause ordering while Restro has paused', () => {
  it('offers no pause at all', () => {
    const v = view(
      tonight({
        pauses: [
          pause({
            id: 'pa_r',
            scope: 'connection',
            cause: 'breaker',
            restroStarted: true,
            startedBy: null,
          }),
        ],
      }),
    )
    expect(v.canPauseAll).toBe(false)
    expect(v.pausableBars).toEqual([])
  })
})
