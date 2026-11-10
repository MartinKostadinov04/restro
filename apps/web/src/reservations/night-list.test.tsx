// @vitest-environment jsdom
// Venue › Reservations, the night's list (#326): the night in arrival order with every row
// readable as it stands, a chip only where the night holds something behind it, one tap to filter,
// and one banner for what the whole night is. Drawn with the real messages, so a word this screen
// has no string for fails here rather than on a tablet at 02:00.
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { RvCan, RvFrame, RvNightView, RvRowView } from '@/server/reservations/view'
import { renderWithIntl } from '@/test-utils'

import { NightList } from './night-list'
import { RV_STATUSES } from './statuses'

const toast = vi.hoisted(() => Object.assign(vi.fn(), { error: vi.fn(), dismiss: vi.fn() }))
vi.mock('sonner', () => ({ toast }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/venues/vn_demo',
  useSearchParams: () => new URLSearchParams(''),
  unstable_rethrow: vi.fn(),
}))
vi.mock('@/server/reservations/actions', () => ({
  reservationNightAction: vi.fn(async () => ({ ok: false, code: 'read_failed' })),
  reservationDetailAction: vi.fn(async () => ({ ok: false, code: 'read_failed' })),
}))

const TODAY = '2026-11-09'

const can = (over: Partial<RvCan> = {}): RvCan => ({
  tonight: true,
  manage: true,
  block: false,
  editPast: false,
  endNight: false,
  guests: false,
  ...over,
})

const frame = (over: Partial<RvFrame> = {}): RvFrame => ({
  venueId: 'vn_demo',
  timezone: 'Europe/Sofia',
  today: TODAY,
  dayEndsAt: '07:00',
  device: false,
  editPastNights: false,
  phoneRequired: true,
  can: can(),
  ...over,
})

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

const night = (over: Partial<RvNightView> = {}): RvNightView => {
  const rows = over.rows ?? [row()]
  const byStatus = Object.fromEntries(
    RV_STATUSES.map((state) => [state, rows.filter((one) => one.status === state).length]),
  ) as RvNightView['counts']['byStatus']
  return {
    day: TODAY,
    today: true,
    passed: false,
    closed: false,
    refusal: null,
    settingsMissing: false,
    hasMore: false,
    days: [TODAY],
    deleted: [],
    waiting: [],
    ...over,
    rows,
    counts: over.counts ?? {
      all: rows.length,
      late: rows.filter((one) => one.late).length,
      byStatus,
    },
  }
}

const draw = (view: RvNightView = night(), over: Partial<RvFrame> = {}) =>
  renderWithIntl(<NightList initial={view} frame={frame(over)} />)

beforeEach(() => {
  toast.error.mockReset()
  toast.dismiss.mockReset()
})

describe('the night as it opens', () => {
  it('draws the rows in the order they came, each readable without opening anything', () => {
    draw(
      night({
        rows: [
          row({ id: 'rv_a', time: '22:00', name: 'Petrov', partySize: 2, spots: ['Booth 1'] }),
          row({ id: 'rv_b', time: '23:30', name: 'Ivanova', partySize: 4, spots: ['Table 7'] }),
        ],
      }),
    )
    const rows = screen.getAllByTestId('rv-row')
    expect(rows).toHaveLength(2)
    expect(rows[0]?.textContent).toContain('22:00')
    expect(rows[0]?.textContent).toContain('Petrov')
    expect(rows[0]?.textContent).toContain('2 guests')
    expect(rows[0]?.textContent).toContain('Booth 1')
    // The state is a word on every row, never a colour on its own (D123).
    expect(rows[0]?.textContent).toContain('Coming')
    expect(rows[1]?.textContent).toContain('Ivanova')
  })

  it('names a walk-in nobody named, rather than leaving the row blank', () => {
    draw(night({ rows: [row({ id: 'rv_w', kind: 'walk_in', name: null, spots: [] })] }))
    const walkIn = screen.getByTestId('rv-row')
    expect(walkIn.textContent).toContain('No name')
    expect(walkIn.textContent).toContain('Walk-in')
  })

  it('says a party is late and that nothing is freed by itself', () => {
    draw(night({ rows: [row({ late: true })] }))
    expect(screen.getByTestId('rv-late')).toBeTruthy()
    expect(screen.getByTestId('rv-late-note').textContent).toContain('No spot is freed by itself')
  })

  it('says a cancellation was the club’s, in one word beside the state (#329)', () => {
    draw(night({ rows: [row({ status: 'cancelled', byVenue: true })] }))
    expect(screen.getByTestId('rv-row').textContent).toContain('Cancelled')
    expect(screen.getByTestId('rv-by-club').textContent).toBe('by the club')
  })

  it('says so plainly when the night holds nothing yet', () => {
    draw(night({ rows: [] }))
    expect(screen.getByText('No reservations for this night yet.')).toBeTruthy()
    expect(screen.queryByTestId('rv-list')).toBeNull()
  })
})

describe('the filters', () => {
  const busy = night({
    rows: [
      row({ id: 'rv_a', status: 'reserved', late: true }),
      row({ id: 'rv_b', status: 'seated' }),
      row({ id: 'rv_c', status: 'seated' }),
    ],
  })

  it('carry their count and are drawn only where the night holds something behind them', () => {
    draw(busy)
    expect(screen.getByTestId('rv-filter-all').textContent).toBe('All3')
    expect(screen.getByTestId('rv-filter-seated').textContent).toBe('Seated2')
    expect(screen.getByTestId('rv-filter-late').textContent).toBe('Late1')
    expect(screen.queryByTestId('rv-filter-no_show')).toBeNull()
    expect(screen.queryByTestId('rv-filter-cancelled')).toBeNull()
  })

  it('leave the rows of one state on one tap, and say which filter is on', async () => {
    draw(busy)
    await userEvent.click(screen.getByTestId('rv-filter-seated'))
    expect(screen.getAllByTestId('rv-row')).toHaveLength(2)
    expect(screen.getByTestId('rv-filter-seated').getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByTestId('rv-filter-all').getAttribute('aria-pressed')).toBe('false')
  })

  it('say when a filter leaves nothing, without taking the filters away', async () => {
    draw(night({ rows: [row({ status: 'seated' }), row({ id: 'rv_b', status: 'reserved' })] }))
    await userEvent.click(screen.getByTestId('rv-filter-seated'))
    await userEvent.click(screen.getByTestId('rv-filter-reserved'))
    expect(screen.getAllByTestId('rv-row')).toHaveLength(1)
    expect(screen.getByTestId('rv-filter-seated')).toBeTruthy()
  })
})

describe('what the whole night is', () => {
  it('says a night that has passed may be read, not changed', () => {
    draw(night({ day: '2026-11-08', today: false, passed: true, refusal: 'night_passed' }))
    const banner = screen.getByTestId('rv-banner')
    expect(banner.getAttribute('data-kind')).toBe('passed')
    expect(banner.textContent).toContain('It can be read, not changed.')
  })

  it('says the club allows corrections where it does and this role may make them', () => {
    draw(night({ day: '2026-11-08', today: false, passed: true, refusal: null }), {
      editPastNights: true,
      can: can({ editPast: true }),
    })
    expect(screen.getByTestId('rv-banner').getAttribute('data-kind')).toBe('open')
    expect(screen.getByTestId('rv-banner').textContent).toContain('allows changes to it')
  })

  it('says which it is where the club allows corrections but the role does not make them', () => {
    draw(night({ day: '2026-11-08', today: false, passed: true, refusal: 'past_night_denied' }), {
      editPastNights: true,
    })
    expect(screen.getByTestId('rv-banner').textContent).toContain('your role does not make them')
  })

  it('says the venue has no turn time yet, so nothing can be booked (D135)', () => {
    draw(night({ settingsMissing: true, refusal: 'settings_missing' }))
    expect(screen.getByTestId('rv-banner').getAttribute('data-kind')).toBe('settings')
  })

  it('says the night’s book was closed, whatever the owner’s switch says (D138)', () => {
    draw(night({ day: '2026-11-08', today: false, passed: true, closed: true }), {
      editPastNights: true,
    })
    expect(screen.getByTestId('rv-banner').getAttribute('data-kind')).toBe('closed')
  })

  it('draws no banner on a night that is on', () => {
    draw()
    expect(screen.queryByTestId('rv-banner')).toBeNull()
  })
})

describe('what the role may do', () => {
  it('offers "New reservation" to a role that may take one', () => {
    draw()
    expect(screen.getAllByTestId('rv-new').length).toBeGreaterThan(0)
  })

  it('offers it to a role that only works tonight (#328)', () => {
    draw(night(), { can: can({ manage: false }) })
    expect(screen.getAllByTestId('rv-new').length).toBeGreaterThan(0)
  })

  it('offers it to a role that does not work tonight’s reservations to nobody, on an empty night either', () => {
    draw(night(), { can: can({ tonight: false, manage: false }) })
    expect(screen.queryByTestId('rv-new')).toBeNull()
  })

  it('offers no way to start one on an empty night to such a role', () => {
    draw(night({ rows: [] }), { can: can({ tonight: false, manage: false }) })
    expect(screen.queryByTestId('rv-new')).toBeNull()
  })

  it('does not offer it on a night that cannot be written', () => {
    draw(night({ passed: true, today: false, refusal: 'night_passed' }))
    expect(screen.queryByTestId('rv-new')).toBeNull()
  })
})

describe('in Bulgarian', () => {
  it('draws the night in Bulgarian, with no key left in English', () => {
    renderWithIntl(<NightList initial={night({ rows: [row({ late: true })] })} frame={frame()} />, {
      locale: 'bg',
    })
    expect(screen.getByTestId('rv-filter-all').textContent).toContain('Всички')
    expect(screen.getByTestId('rv-row').textContent).toContain('гости')
    expect(screen.getByTestId('rv-late-note').textContent).toContain('не се освобождава само')
  })
})
