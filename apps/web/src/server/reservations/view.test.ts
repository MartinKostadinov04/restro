// What Venue › Reservations draws (#326), without a database: every state D138 names is listed, a
// row carries the hour in the venue's own zone and never a telephone number, the sheet's own view
// carries one, a cancellation the club made is marked as the club's, and what the actor holds
// decides which controls the screen draws at all.
import type {
  Permission,
  ReservationAccess,
  ReservationCounts,
  ReservationDetail,
  ReservationNightRead,
  ReservationRow,
  ReservationStatus,
} from '@restro/core/service'
import { describe, expect, it } from 'vitest'

import { RV_STATUSES, rvDetailView, rvFrameOf, rvNightView, rvRowView } from './view'

const SOFIA = 'Europe/Sofia'

const venue = {
  id: 'vn_demo',
  name: 'Demo',
  timezone: SOFIA,
  dayEndsAt: '07:00',
  currency: 'BGN',
}

const accessWith = (permissions: readonly Permission[]): ReservationAccess => ({
  venue,
  permissions,
  device: false,
  today: '2026-11-09',
  editPastNights: false,
})

const row = (over: Partial<ReservationRow> = {}): ReservationRow => ({
  id: 'rv_one',
  kind: 'booking',
  status: 'reserved',
  // 23:30 in Sofia (UTC+2 in November), so a zone read as UTC would show 21:30.
  startsAt: new Date('2026-11-09T21:30:00Z'),
  endsAt: new Date('2026-11-10T00:00:00Z'),
  partySize: 4,
  name: 'Ivanova',
  phone: '+359888123456',
  guestId: null,
  note: 'Birthday',
  reason: null,
  spots: ['Table 7'],
  seatedAt: null,
  endedAt: null,
  late: false,
  cancelledByVenue: false,
  updatedAt: new Date('2026-11-09T18:00:00Z'),
  ...over,
})

const counts = (over: Partial<ReservationCounts> = {}): ReservationCounts => ({
  all: 1,
  late: 0,
  byStatus: Object.fromEntries(RV_STATUSES.map((state) => [state, 0])) as Record<
    ReservationStatus,
    number
  >,
  ...over,
})

const night = (over: Partial<ReservationNightRead> = {}): ReservationNightRead => ({
  day: '2026-11-09',
  today: '2026-11-09',
  passed: false,
  closed: false,
  writable: null,
  settingsMissing: false,
  rows: [row()],
  counts: counts(),
  hasMore: false,
  days: ['2026-11-09'],
  ...over,
})

describe('the states the screen knows', () => {
  it('lists all eight of them (D138), in the order a night runs in', () => {
    expect([...RV_STATUSES]).toEqual([
      'reserved',
      'waiting',
      'seated',
      'finished',
      'no_show',
      'not_seated',
      'cancelled',
      'requested',
    ])
  })
})

describe('a row', () => {
  it('shows the hour in the venue’s own zone, not the server’s', () => {
    expect(rvRowView(row(), SOFIA).time).toBe('23:30')
    expect(rvRowView(row(), SOFIA).until).toBe('02:00')
    expect(rvRowView(row(), 'UTC').time).toBe('21:30')
  })

  it('carries no telephone number: only the sheet asks for one (D140)', () => {
    expect(Object.keys(rvRowView(row(), SOFIA))).not.toContain('phone')
    expect(JSON.stringify(rvRowView(row(), SOFIA))).not.toContain('359888')
  })

  it('marks a cancellation the club made, so nobody reads it as the guest’s (#329)', () => {
    const undone = row({ status: 'cancelled', cancelledByVenue: true })
    expect(rvRowView(undone, SOFIA).byVenue).toBe(true)
    expect(rvRowView(row({ status: 'cancelled' }), SOFIA).byVenue).toBe(false)
  })

  it('keeps an hour it has none for empty rather than inventing one', () => {
    const view = rvRowView(row({ endsAt: null, seatedAt: null, endedAt: null }), SOFIA)
    expect(view.until).toBeNull()
    expect(view.seatedAt).toBeNull()
    expect(view.endedAt).toBeNull()
  })
})

describe('a night', () => {
  it('keeps core’s order and says whether the night shown is tonight', () => {
    const early = row({ id: 'rv_a', startsAt: new Date('2026-11-09T19:00:00Z') })
    const later = row({ id: 'rv_b', startsAt: new Date('2026-11-09T21:00:00Z') })
    const view = rvNightView(night({ rows: [early, later] }), SOFIA)
    expect(view.rows.map((one) => one.id)).toEqual(['rv_a', 'rv_b'])
    expect(view.today).toBe(true)
    expect(rvNightView(night({ day: '2026-11-08', passed: true }), SOFIA).today).toBe(false)
  })

  it('passes on why a night may not be written to, and the missing turn time (D135)', () => {
    const passed = rvNightView(night({ passed: true, writable: 'night_passed' }), SOFIA)
    expect(passed.refusal).toBe('night_passed')
    expect(rvNightView(night({ settingsMissing: true }), SOFIA).settingsMissing).toBe(true)
    expect(rvNightView(night(), SOFIA).refusal).toBeNull()
  })
})

describe('one reservation’s sheet', () => {
  const detail = (over: Partial<ReservationDetail> = {}): ReservationDetail => ({
    row: row(),
    serviceDate: '2026-11-09',
    madeBy: { kind: 'person', name: 'Mila' },
    email: 'guest@example.test',
    history: [
      {
        seq: 1,
        at: new Date('2026-11-09T16:00:00Z'),
        kind: 'reservation.created',
        fromState: null,
        toState: 'reserved',
        reason: null,
        who: { kind: 'person', name: 'Mila' },
        via: null,
      },
      {
        seq: 2,
        at: new Date('2026-11-09T21:40:00Z'),
        kind: 'reservation.status',
        fromState: 'reserved',
        toState: 'seated',
        reason: null,
        who: { kind: 'person', name: 'Mila' },
        via: 'tablet',
      },
    ],
    ...over,
  })

  it('has the telephone number and the email, for its two buttons alone', () => {
    const view = rvDetailView(detail(), SOFIA)
    expect(view.phone).toBe('+359888123456')
    expect(view.email).toBe('guest@example.test')
    expect(view.row.name).toBe('Ivanova')
  })

  it('keeps the Log’s order and its hours, and never a contact detail in a line (D140)', () => {
    const view = rvDetailView(detail(), SOFIA)
    expect(view.history.map((line) => [line.seq, line.time])).toEqual([
      [1, '18:00'],
      [2, '23:40'],
    ])
    expect(JSON.stringify(view.history)).not.toContain('359888')
    expect(JSON.stringify(view.history)).not.toContain('guest@example.test')
  })

  it('says nothing about who took it where the Log does not know', () => {
    expect(rvDetailView(detail({ madeBy: null }), SOFIA).made).toBeNull()
  })
})

describe('what the actor holds', () => {
  it('draws a control only for the permission behind it (#324)', () => {
    const none = rvFrameOf(accessWith([]), 'vn_demo')
    expect(none.can).toEqual({ manage: false, block: false, editPast: false, endNight: false })

    const some = rvFrameOf(
      accessWith(['reservations.tonight', 'reservations.manage', 'reservations.edit_past']),
      'vn_demo',
    )
    expect(some.can).toEqual({ manage: true, block: false, editPast: true, endNight: false })
  })

  it('carries the venue’s clock and the owner’s switch, not the server’s', () => {
    const frame = rvFrameOf({ ...accessWith([]), editPastNights: true, device: true }, 'vn_demo')
    expect(frame).toMatchObject({
      venueId: 'vn_demo',
      timezone: SOFIA,
      today: '2026-11-09',
      dayEndsAt: '07:00',
      device: true,
      editPastNights: true,
    })
  })
})
