// @vitest-environment jsdom
// The sheet keeps itself current while it is open, and says who changed the reservation meanwhile.
// Only somebody else's change is news (the screen round's S18): the hostess's own write already
// said itself in its toast, so a line she wrote — on her own sign-in, or as the person a shared
// device remembers, which the read marks `mine` — never raises the notice.
import { screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { reservationDetailAction } from '@/server/reservations/actions'
import type { RvDetailView, RvFrame, RvHistoryView } from '@/server/reservations/view'
import { renderWithIntl } from '@/test-utils'

import { ReservationSheet } from './reservation-sheet'

vi.mock('@/server/reservations/actions', () => ({ reservationDetailAction: vi.fn() }))
// The poll, fast enough for a test; the read is answered at once, without its retry.
vi.mock('@/tonight/live-feed', () => ({ FEED_POLL_MS: 20 }))
vi.mock('@/tonight/read-attempt', () => ({
  READ_FAILED: { ok: false, error: 'failed' },
  readAttempt: (read: () => Promise<unknown>) => read(),
}))

const frame: RvFrame = {
  venueId: 'vn_demo',
  timezone: 'Europe/Sofia',
  today: '2026-11-20',
  dayEndsAt: '07:00',
  device: false,
  editPastNights: false,
  phoneRequired: true,
  can: {
    tonight: true,
    manage: true,
    block: false,
    editPast: false,
    endNight: false,
    guests: false,
    payRule: false,
    plan: false,
  },
}

const line = (seq: number, mine: boolean, name: string): RvHistoryView => ({
  seq,
  time: '22:00',
  kind: 'reservation.changed',
  fromState: 'reserved',
  toState: 'reserved',
  reason: null,
  by: { who: { kind: 'person', name }, telegram: false },
  mine,
})

const detail = (history: readonly RvHistoryView[]): RvDetailView => ({
  row: {
    id: 'rv_one',
    kind: 'booking',
    status: 'reserved',
    time: '23:00',
    until: null,
    name: 'Ivanova',
    partySize: 4,
    spots: ['Маса 7'],
    note: null,
    reason: null,
    late: false,
    byVenue: false,
    seatedAt: null,
    endedAt: null,
  },
  day: '2026-11-20',
  made: null,
  phone: null,
  email: null,
  guestId: null,
  spotIds: ['sp_7'],
  version: '1',
  mine: true,
  payRule: { rule: null, beaten: [] },
  history,
  endedByNightEnd: false,
})

/** Opens the sheet on the first version, then answers every later read with the second. */
async function openAndChange(next: RvHistoryView) {
  const first = detail([line(1, true, 'Maria')])
  const second = detail([line(1, true, 'Maria'), next])
  vi.mocked(reservationDetailAction)
    .mockResolvedValueOnce({ ok: true, frame, detail: first })
    .mockResolvedValue({ ok: true, frame, detail: second })
  renderWithIntl(
    <ReservationSheet
      frame={frame}
      reservationId="rv_one"
      writable
      busy={false}
      onEdit={vi.fn()}
      onCopy={vi.fn()}
      onNoShow={vi.fn()}
      onPutBack={vi.fn()}
      onCancel={vi.fn()}
      onDelete={vi.fn()}
      onArrive={null}
      onGuests={null}
      onFree={null}
      onChangeTables={null}
      onPayRule={vi.fn()}
      onClose={vi.fn()}
    />,
  )
  // The first read, then at least one poll after it that returned the second version.
  await waitFor(() =>
    expect(vi.mocked(reservationDetailAction).mock.calls.length).toBeGreaterThanOrEqual(3),
  )
}

beforeEach(() => {
  vi.mocked(reservationDetailAction).mockReset()
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })),
  )
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('the sheet, while it is open', () => {
  it('raises no notice for a line the reader wrote', async () => {
    await openAndChange(line(2, true, 'Maria'))
    expect(screen.queryByTestId('rv-stale')).toBeNull()
  })

  it('says who changed it when somebody else did', async () => {
    await openAndChange(line(2, false, 'Petar'))
    await waitFor(() => expect(screen.getByTestId('rv-stale').textContent).toContain('Petar'))
  })
})
