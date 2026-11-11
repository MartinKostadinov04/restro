// @vitest-environment jsdom
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { toast } from 'sonner'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  addClosedDateAction,
  removeClosedDateAction,
  saveReservationRulesAction,
} from '@/server/settings/reservations-actions'
import type { ReservationsView } from '@/server/settings/reservations-view'
import { renderWithIntl } from '@/test-utils'

import { ReservationsPanel } from './reservations-panel'

vi.mock('@/server/settings/reservations-actions', () => ({
  saveReservationRulesAction: vi.fn(),
  addClosedDateAction: vi.fn(),
  removeClosedDateAction: vi.fn(),
}))
vi.mock('@/server/settings/plan-actions', () => ({
  startPlanAction: vi.fn(),
  savePlanAction: vi.fn(),
  saveSpotAction: vi.fn(),
  removeSpotAction: vi.fn(),
  saveSpotKindAction: vi.fn(),
  removeSpotKindAction: vi.fn(),
}))
vi.mock('@/lib/auth-client', () => ({ authClient: { signIn: { email: vi.fn() } } }))
vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), message: vi.fn() },
}))

const VENUE = 'vn_0000000000000000000001'

function view(
  settings: Partial<ReservationsView['settings']> = {},
  more: Partial<ReservationsView> = {},
): ReservationsView {
  return {
    venueId: VENUE,
    canChange: true,
    email: 'owner@example.com',
    settings: {
      saved: true,
      turnMinutes: 120,
      phoneRequired: true,
      editPastNights: false,
      privateNotesOn: true,
      closedDates: [],
      spots: [],
      ...settings,
    },
    plan: { plans: [], spots: [], kinds: [], tables: [], unreadable: 0 },
    ...more,
  }
}

const OK = { ok: true, details: {} } as const

beforeEach(() => {
  for (const action of [saveReservationRulesAction, addClosedDateAction, removeClosedDateAction]) {
    vi.mocked(action).mockReset()
    vi.mocked(action).mockResolvedValue(OK)
  }
  vi.mocked(toast.success).mockReset()
  vi.mocked(toast.error).mockReset()
})

describe('Settings › Reservations', () => {
  it('links to Hours in one line and shows no second copy of the working hours', () => {
    renderWithIntl(<ReservationsPanel view={view()} />)
    const link = screen.getByTestId('rs-hours-link')
    expect(link.getAttribute('href')).toBe(`/venues/${VENUE}?tab=settings&section=hours`)
    expect(link.parentElement?.textContent).toBe("Your club's nights are set in Hours.")
  })

  it('saves a switch at once with Undo that puts the old value back', async () => {
    const user = userEvent.setup()
    renderWithIntl(<ReservationsPanel view={view()} />)
    await user.click(screen.getByRole('switch', { name: 'Phone required' }))
    await waitFor(() =>
      expect(saveReservationRulesAction).toHaveBeenCalledWith({
        venueId: VENUE,
        phoneRequired: false,
      }),
    )
    const options = vi.mocked(toast.success).mock.calls[0]?.[1] as unknown as {
      action: { onClick: () => void }
    }
    options.action.onClick()
    await waitFor(() =>
      expect(saveReservationRulesAction).toHaveBeenLastCalledWith({
        venueId: VENUE,
        phoneRequired: true,
      }),
    )
  })

  it('names the consequence of editing a night that has passed, in one line', () => {
    renderWithIntl(<ReservationsPanel view={view()} />)
    expect(
      screen.getByText(
        'Whoever holds the right can then add, change or delete bookings of nights that are over.',
      ),
    ).toBeTruthy()
    expect(
      screen.getByRole('switch', { name: 'Allow editing a night that has passed' }),
    ).toBeTruthy()
    expect(
      screen.getByRole('switch', { name: 'The manager keeps a private guest list' }),
    ).toBeTruthy()
  })

  it('returns a switch to its saved value when the save is refused, and says why', async () => {
    vi.mocked(saveReservationRulesAction).mockResolvedValue({
      ok: false,
      error: 'permission_denied',
    })
    const user = userEvent.setup()
    renderWithIntl(<ReservationsPanel view={view()} />)
    const phone = screen.getByRole('switch', { name: 'Phone required' })
    await user.click(phone)
    await waitFor(() => expect(toast.error).toHaveBeenCalledTimes(1))
    expect(vi.mocked(toast.error).mock.calls[0]?.[0]).toBe("You can't change that.")
    expect(phone.getAttribute('aria-checked')).toBe('true')
  })

  it('saves the hold time when the field is left, and rejects what is no minutes', async () => {
    const user = userEvent.setup()
    renderWithIntl(<ReservationsPanel view={view()} />)
    const field = screen.getByLabelText('Hold a spot for')
    await user.clear(field)
    await user.type(field, '90')
    await user.tab()
    await waitFor(() =>
      expect(saveReservationRulesAction).toHaveBeenCalledWith({
        venueId: VENUE,
        turnMinutes: 90,
      }),
    )
    await user.clear(field)
    await user.type(field, '0')
    await user.tab()
    expect((await screen.findByRole('alert')).textContent).toBe(
      'Enter a whole number of minutes, from 1 to 1440.',
    )
    expect(saveReservationRulesAction).toHaveBeenCalledTimes(1)
  })

  it('asks for the hold time first when the venue has none, and keeps the other rules still', async () => {
    const user = userEvent.setup()
    renderWithIntl(<ReservationsPanel view={view({ saved: false, turnMinutes: null })} />)
    expect(screen.getByTestId('rs-hold-first').textContent).toBe(
      'Set how long a spot is held first. The other rules open after that.',
    )
    expect(screen.queryByRole('switch')).toBeNull()
    const field = screen.getByLabelText('Hold a spot for')
    await user.type(field, '120')
    await user.tab()
    await waitFor(() =>
      expect(saveReservationRulesAction).toHaveBeenCalledWith({
        venueId: VENUE,
        turnMinutes: 120,
      }),
    )
    // The first value has nothing to go back to, so its toast carries no Undo.
    expect(vi.mocked(toast.success).mock.calls[0]?.[1]).not.toHaveProperty('action')
  })
})

describe('closed dates', () => {
  it('invites the first one when there are none', () => {
    renderWithIntl(<ReservationsPanel view={view()} />)
    const empty = screen.getByTestId('rs-closed-empty')
    expect(empty.textContent).toContain('Add the nights your club is closed')
    expect(within(empty).getByRole('button', { name: 'Add a closed date' })).toBeTruthy()
  })

  it('adds a night through the one-field dialog, with Undo that removes it', async () => {
    const user = userEvent.setup()
    renderWithIntl(<ReservationsPanel view={view()} />)
    await user.click(screen.getByTestId('rs-closed-add'))
    await user.type(screen.getByLabelText('Night'), '2026-12-24')
    await user.click(screen.getByTestId('rs-closed-confirm'))
    await waitFor(() =>
      expect(addClosedDateAction).toHaveBeenCalledWith({ venueId: VENUE, date: '2026-12-24' }),
    )
    const options = vi.mocked(toast.success).mock.calls[0]?.[1] as unknown as {
      action: { onClick: () => void }
    }
    options.action.onClick()
    await waitFor(() =>
      expect(removeClosedDateAction).toHaveBeenCalledWith({ venueId: VENUE, date: '2026-12-24' }),
    )
  })

  it('does not offer a night that is already closed, so Undo never opens the wrong one', async () => {
    const user = userEvent.setup()
    renderWithIntl(<ReservationsPanel view={view({ closedDates: ['2026-12-24'] })} />)
    await user.click(screen.getByTestId('rs-closed-add'))
    await user.type(screen.getByLabelText('Night'), '2026-12-24')
    await user.click(screen.getByTestId('rs-closed-confirm'))
    expect((await screen.findAllByRole('alert'))[0]?.textContent).toBe(
      'That night is already on the list.',
    )
    expect(addClosedDateAction).not.toHaveBeenCalled()
  })

  it('lists a season newest first and removes one in a tap, with Undo that adds it back', async () => {
    const user = userEvent.setup()
    const dates = ['2027-01-09', '2026-12-31', '2026-12-24']
    renderWithIntl(<ReservationsPanel view={view({ closedDates: dates })} />)
    const rows = screen.getAllByTestId('rs-closed-row')
    expect(rows.map((row) => row.getAttribute('data-date'))).toEqual(dates)
    await user.click(within(rows[1] as HTMLElement).getByTestId('rs-closed-remove'))
    await waitFor(() =>
      expect(removeClosedDateAction).toHaveBeenCalledWith({ venueId: VENUE, date: '2026-12-31' }),
    )
    const options = vi.mocked(toast.success).mock.calls[0]?.[1] as unknown as {
      action: { onClick: () => void }
    }
    options.action.onClick()
    await waitFor(() =>
      expect(addClosedDateAction).toHaveBeenCalledWith({ venueId: VENUE, date: '2026-12-31' }),
    )
  })
})

describe('the floor plan', () => {
  // The editor's own behaviour is `plan-editor/plan-card.test.tsx`'s; here, only that it is the
  // section's last card and the old seats list is gone (#397).
  it('shows the plan card in place of the seats list', () => {
    renderWithIntl(<ReservationsPanel view={view()} />)
    expect(screen.getByTestId('pe-card')).toBeTruthy()
    expect(screen.getByTestId('pe-start')).toBeTruthy()
    expect(screen.queryByTestId('rs-seats')).toBeNull()
  })
})

describe('a role without the right', () => {
  it('reads the same values as text, with no control and one line saying who may change them', () => {
    renderWithIntl(
      <ReservationsPanel
        view={view(
          {
            editPastNights: true,
            closedDates: ['2026-12-24'],
          },
          { canChange: false },
        )}
      />,
    )
    expect(screen.getByTestId('settings-readonly').textContent).toBe(
      'Only someone with the right to change settings can change these.',
    )
    expect(screen.queryByRole('switch')).toBeNull()
    expect(screen.queryByRole('textbox')).toBeNull()
    expect(screen.queryByTestId('rs-closed-add')).toBeNull()
    expect(screen.queryByTestId('rs-closed-remove')).toBeNull()
    expect(screen.getByTestId('rs-hold-value').textContent).toBe('120 min')
    expect(screen.getByTestId('rs-past-value').textContent).toBe('On')
    expect(screen.queryByTestId('pe-start')).toBeNull()
    expect(screen.getByTestId('pe-empty').textContent).toContain(
      'Someone who may change the reservation settings draws it here.',
    )
  })
})
