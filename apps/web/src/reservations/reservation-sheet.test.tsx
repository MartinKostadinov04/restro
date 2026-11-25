// @vitest-environment jsdom
// The sheet keeps itself current while it is open, and says who changed the reservation meanwhile.
// Only somebody else's change is news (the screen round's S18): the hostess's own write already
// said itself in its toast, so a line she wrote — on her own sign-in, or as the person a shared
// device remembers, which the read marks `mine` — never raises the notice.
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
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
      onConfirm={vi.fn()}
      onDecline={vi.fn()}
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

describe('the sheet, for a party sitting down', () => {
  // A walk-in another hostess seated, read by someone who may not manage: "Free the table" is the
  // only thing under "…", so the "…" itself shows whether it is offered.
  async function openSeated(spots: readonly string[]) {
    const base = detail([])
    vi.mocked(reservationDetailAction).mockResolvedValue({
      ok: true,
      frame: { ...frame, can: { ...frame.can, manage: false } },
      detail: {
        ...base,
        row: { ...base.row, kind: 'walk_in', status: 'seated', spots },
        spotIds: spots.map((_, i) => `sp_${i}`),
        mine: false,
      },
    })
    renderWithIntl(
      <ReservationSheet
        frame={{ ...frame, can: { ...frame.can, manage: false } }}
        reservationId="rv_one"
        writable
        busy={false}
        onEdit={vi.fn()}
        onCopy={vi.fn()}
        onNoShow={vi.fn()}
        onPutBack={vi.fn()}
        onCancel={vi.fn()}
        onConfirm={vi.fn()}
        onDecline={vi.fn()}
        onDelete={vi.fn()}
        onArrive={null}
        onGuests={null}
        onFree={vi.fn()}
        onChangeTables={null}
        onPayRule={vi.fn()}
        onClose={vi.fn()}
      />,
    )
    await waitFor(() => expect(vi.mocked(reservationDetailAction)).toHaveBeenCalled())
  }

  it('offers to free the table while the party holds one', async () => {
    await openSeated(['Маса 7'])
    await waitFor(() => expect(screen.getByTestId('rv-more')).toBeTruthy())
  })

  // Freeing returns the spots and leaves the party seated (D134), so once they are back there is
  // nothing left to free (the screen round's R4).
  it('does not offer it once the party holds no spot', async () => {
    await openSeated([])
    await waitFor(() => expect(screen.getByText('None yet')).toBeTruthy())
    expect(screen.queryByTestId('rv-more')).toBeNull()
  })
})

describe('the sheet, on a colleague’s booking', () => {
  // The buttons are the ones the server lets the role run (S20 of the 11-18 screen round):
  // editing and cancelling take tonight's key or the booking book's; deleting another's booking
  // takes the booking book's alone.
  async function openTheirs(can: { tonight: boolean; manage: boolean }) {
    const roleFrame = { ...frame, can: { ...frame.can, ...can } }
    vi.mocked(reservationDetailAction).mockResolvedValue({
      ok: true,
      frame: roleFrame,
      detail: { ...detail([]), mine: false },
    })
    renderWithIntl(
      <ReservationSheet
        frame={roleFrame}
        reservationId="rv_one"
        writable
        busy={false}
        onEdit={vi.fn()}
        onCopy={vi.fn()}
        onNoShow={vi.fn()}
        onPutBack={vi.fn()}
        onCancel={vi.fn()}
        onConfirm={vi.fn()}
        onDecline={vi.fn()}
        onDelete={vi.fn()}
        onArrive={null}
        onGuests={null}
        onFree={null}
        onChangeTables={null}
        onPayRule={vi.fn()}
        onClose={vi.fn()}
      />,
    )
    await waitFor(() => expect(screen.getByTestId('rv-edit')).toBeTruthy())
    expect(screen.getByTestId('rv-cancel')).toBeTruthy()
  }

  it('lets the booking book’s key alone edit, cancel and delete it', async () => {
    await openTheirs({ tonight: false, manage: true })
    await userEvent.setup().click(screen.getByTestId('rv-more'))
    expect(await screen.findByTestId('rv-delete')).toBeTruthy()
  })

  it('lets tonight’s key alone edit and cancel it, and not delete it', async () => {
    await openTheirs({ tonight: true, manage: false })
    await userEvent.setup().click(screen.getByTestId('rv-more'))
    expect(await screen.findByTestId('rv-copy-open')).toBeTruthy()
    expect(screen.queryByTestId('rv-delete')).toBeNull()
  })
})

describe('the sheet, on an online request (#578)', () => {
  async function openRequest(
    can: { tonight: boolean; manage: boolean },
    email: string | null,
    onDecline = vi.fn(),
  ) {
    const roleFrame = { ...frame, can: { ...frame.can, ...can } }
    const base = detail([])
    vi.mocked(reservationDetailAction).mockResolvedValue({
      ok: true,
      frame: roleFrame,
      detail: { ...base, row: { ...base.row, status: 'requested' }, email, mine: false },
    })
    renderWithIntl(
      <ReservationSheet
        frame={roleFrame}
        reservationId="rv_one"
        writable
        busy={false}
        onEdit={vi.fn()}
        onCopy={vi.fn()}
        onNoShow={vi.fn()}
        onPutBack={vi.fn()}
        onCancel={vi.fn()}
        onConfirm={vi.fn()}
        onDecline={onDecline}
        onDelete={vi.fn()}
        onArrive={null}
        onGuests={null}
        onFree={null}
        onChangeTables={vi.fn()}
        onPayRule={vi.fn()}
        onClose={vi.fn()}
      />,
    )
    await waitFor(() => expect(screen.getByText('Requested')).toBeTruthy())
  }

  it('offers Confirm first and Decline beside it, and neither Cancel nor Change tables', async () => {
    await openRequest({ tonight: true, manage: false }, 'ivanova@example.com')
    const confirm = screen.getByTestId('rv-sheet-confirm')
    expect(confirm.textContent).toBe('Confirm')
    expect(screen.getByTestId('rv-sheet-decline').textContent).toBe('Decline')
    // Confirm is the one filled button: Edit steps back beside it.
    expect(confirm.compareDocumentPosition(screen.getByTestId('rv-edit'))).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    )
    expect(screen.queryByTestId('rv-cancel')).toBeNull()
    expect(screen.queryByTestId('rv-sheet-change-tables')).toBeNull()
    expect(screen.queryByTestId('rv-answer-who')).toBeNull()
  })

  it('asks once before declining, naming the guest and the email he gets', async () => {
    const onDecline = vi.fn()
    await openRequest({ tonight: true, manage: false }, 'ivanova@example.com', onDecline)
    const user = userEvent.setup()
    await user.click(screen.getByTestId('rv-sheet-decline'))
    const dialog = await screen.findByTestId('rv-decline-dialog')
    expect(dialog.textContent).toContain('Decline Ivanova’s request?')
    expect(dialog.textContent).toContain(
      'Ivanova gets an email that the request could not be taken.',
    )
    expect(screen.getByTestId('rv-decline-dialog-keep').textContent).toBe('Keep the request')
    await user.click(screen.getByTestId('rv-decline-dialog-do'))
    expect(onDecline).toHaveBeenCalledWith('rv_one', 'Ivanova', expect.any(Function))
  })

  it('does not promise an email to a guest who left none', async () => {
    await openRequest({ tonight: true, manage: false }, null)
    await userEvent.setup().click(screen.getByTestId('rv-sheet-decline'))
    const dialog = await screen.findByTestId('rv-decline-dialog')
    expect(dialog.textContent).not.toContain('gets an email')
  })

  it('tells a role that may not answer who may, with no buttons', async () => {
    await openRequest({ tonight: false, manage: false }, null)
    expect(screen.queryByTestId('rv-sheet-confirm')).toBeNull()
    expect(screen.queryByTestId('rv-sheet-decline')).toBeNull()
    expect(screen.getByTestId('rv-answer-who').textContent).toContain('confirms or declines')
  })
})
