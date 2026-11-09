// The filters over one night (#326): every state has a chip of its own so no row is unreachable,
// "late" is a filter beside the states and not a state of its own, and a chip's number is the
// night's own count, not the number of rows the screen happens to hold.

import { describe, expect, it } from 'vitest'
import type { RvCountsView, RvRowView } from '@/server/reservations/view'
import { RV_STATUSES } from '@/server/reservations/view'

import { filterCount, filterRows, RESERVATION_FILTERS } from './night-filters'

const row = (over: Partial<RvRowView> = {}): RvRowView => ({
  id: 'rv_one',
  kind: 'booking',
  status: 'reserved',
  time: '23:30',
  until: '02:00',
  name: 'Ivanova',
  partySize: 4,
  spots: ['Table 7'],
  note: null,
  reason: null,
  late: false,
  byVenue: false,
  seatedAt: null,
  endedAt: null,
  ...over,
})

const counts = (over: Partial<RvCountsView> = {}): RvCountsView => ({
  all: 0,
  late: 0,
  byStatus: Object.fromEntries(RV_STATUSES.map((state) => [state, 0])) as RvCountsView['byStatus'],
  ...over,
})

describe('the filters', () => {
  it('are "all", "late" and one for every state (D138’s eight, not the seven the ticket names)', () => {
    expect(RESERVATION_FILTERS.slice(0, 2)).toEqual(['all', 'late'])
    expect(RESERVATION_FILTERS.slice(2)).toEqual([...RV_STATUSES])
    expect(new Set(RESERVATION_FILTERS).size).toBe(RESERVATION_FILTERS.length)
  })
})

describe('the rows a filter leaves', () => {
  const rows = [
    row({ id: 'rv_a', status: 'reserved', late: true }),
    row({ id: 'rv_b', status: 'seated' }),
    row({ id: 'rv_c', status: 'cancelled', byVenue: true }),
    row({ id: 'rv_d', status: 'reserved' }),
  ]

  it('leaves them all under "all", in the order the night came in', () => {
    expect(filterRows(rows, 'all').map((one) => one.id)).toEqual(['rv_a', 'rv_b', 'rv_c', 'rv_d'])
  })

  it('leaves one state under its own filter', () => {
    expect(filterRows(rows, 'reserved').map((one) => one.id)).toEqual(['rv_a', 'rv_d'])
    expect(filterRows(rows, 'seated').map((one) => one.id)).toEqual(['rv_b'])
    expect(filterRows(rows, 'no_show')).toEqual([])
  })

  it('leaves the late ones whatever state they are in, and leaves them under their state too', () => {
    expect(filterRows(rows, 'late').map((one) => one.id)).toEqual(['rv_a'])
    expect(filterRows(rows, 'reserved').map((one) => one.id)).toContain('rv_a')
  })

  it('keeps a cancellation the club made under Cancelled with the rest (#326: no hiding it)', () => {
    expect(filterRows(rows, 'cancelled').map((one) => one.id)).toEqual(['rv_c'])
  })
})

describe('the number on a chip', () => {
  it('is the night’s own count, so a filtered list does not change it', () => {
    const night = counts({ all: 12, late: 2, byStatus: { ...counts().byStatus, seated: 5 } })
    expect(filterCount(night, 'all')).toBe(12)
    expect(filterCount(night, 'late')).toBe(2)
    expect(filterCount(night, 'seated')).toBe(5)
  })

  it('is 0 for a state the night holds nothing of, so its chip is not drawn', () => {
    expect(filterCount(counts({ all: 3 }), 'no_show')).toBe(0)
  })
})
