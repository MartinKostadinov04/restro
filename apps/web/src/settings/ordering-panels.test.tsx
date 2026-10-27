// @vitest-environment jsdom
import { DEFAULT_ORDERING_SETTINGS, type OrderingSettings } from '@restro/core'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { toast } from 'sonner'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { saveOrderingAction } from '@/server/settings/ordering-actions'
import type { OrderingView } from '@/server/settings/ordering-view'
import { renderWithIntl } from '@/test-utils'

import { hoursProblemOf, isNextMorning, nearestOpenDay, noNightOpen } from './hours'
import { HoursPanel } from './hours-panel'
import { OrderingPanel } from './ordering-panel'

vi.mock('@/server/settings/ordering-actions', () => ({ saveOrderingAction: vi.fn() }))
vi.mock('@/lib/auth-client', () => ({ authClient: { signIn: { email: vi.fn() } } }))
vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), message: vi.fn() },
}))

const VENUE = 'vn_0000000000000000000001'
const THU = { opens: '23:00', lastOrders: '04:30', closes: '05:00' }

function view(
  overrides: Partial<OrderingSettings> = {},
  more: Partial<OrderingView> = {},
): OrderingView {
  return {
    venueId: VENUE,
    settings: { ...DEFAULT_ORDERING_SETTINGS, ...overrides },
    dayEndsAt: '07:00',
    timezone: 'Europe/Sofia',
    currency: 'EUR',
    canChange: true,
    hasPos: true,
    openNow: false,
    spotSetAt: null,
    email: 'owner@example.com',
    ...more,
  }
}

const OK = { ok: true, details: {} } as const

beforeEach(() => {
  vi.mocked(saveOrderingAction).mockReset()
  vi.mocked(saveOrderingAction).mockResolvedValue(OK)
  vi.mocked(toast.success).mockReset()
  vi.mocked(toast.error).mockReset()
})

describe('the hours helpers', () => {
  it('words what serviceHoursProblem says, under the right field', () => {
    expect(hoursProblemOf(THU, '07:00:00')).toBeNull()
    expect(hoursProblemOf({ ...THU, lastOrders: '22:00' }, '07:00')).toEqual({
      field: 'lastOrders',
      key: 'st_err_last',
    })
    expect(hoursProblemOf({ ...THU, closes: '03:00' }, '07:00')).toEqual({
      field: 'closes',
      key: 'st_err_close',
    })
    expect(hoursProblemOf({ ...THU, closes: '07:00' }, '07:00')).toEqual({
      field: 'closes',
      key: 'st_err_dayend',
    })
    expect(
      hoursProblemOf({ opens: '23:00', lastOrders: '06:50', closes: '06:55' }, '07:00'),
    ).toEqual({ field: 'lastOrders', key: 'st_err_15' })
  })

  it('knows a time after midnight and the nearest open day', () => {
    expect(isNextMorning('04:30', '23:00')).toBe(true)
    expect(isNextMorning('23:30', '23:00')).toBe(false)
    const hours = { ...DEFAULT_ORDERING_SETTINGS.serviceHours, thu: THU }
    expect(noNightOpen(DEFAULT_ORDERING_SETTINGS.serviceHours)).toBe(true)
    expect(noNightOpen(hours)).toBe(false)
    expect(nearestOpenDay(hours, 'fri')).toEqual(THU)
    expect(nearestOpenDay(DEFAULT_ORDERING_SETTINGS.serviceHours, 'fri')).toBeNull()
  })
})

describe('Settings › Hours', () => {
  it('says phones cannot order while no night is open', () => {
    renderWithIntl(<HoursPanel view={view()} />)
    expect(screen.getByTestId('hours-none').textContent).toBe(
      "Phones can't order until you open at least one night.",
    )
    expect(within(screen.getByTestId('hours-days')).getAllByText('Closed')).toHaveLength(7)
  })

  it('opens a night through the dialog and saves only the hours', async () => {
    const user = userEvent.setup()
    renderWithIntl(<HoursPanel view={view()} />)
    await user.click(screen.getByRole('switch', { name: 'Thursday' }))
    await user.type(screen.getByLabelText('Opens'), '23:00')
    await user.type(screen.getByLabelText('Last orders'), '04:30')
    await user.type(screen.getByLabelText('Closes'), '05:00')
    await user.click(screen.getByRole('checkbox', { name: 'Fri' }))
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(saveOrderingAction).toHaveBeenCalledTimes(1))
    const sent = vi.mocked(saveOrderingAction).mock.calls[0]?.[0] as {
      changes: { serviceHours: Record<string, unknown> }
    }
    expect(sent.changes.serviceHours.thu).toEqual(THU)
    expect(sent.changes.serviceHours.fri).toEqual(THU)
    expect(sent.changes.serviceHours.sat).toBeNull()
  })

  it('shows the problem under its field and keeps the dialog, saving nothing', async () => {
    const user = userEvent.setup()
    renderWithIntl(<HoursPanel view={view()} />)
    await user.click(screen.getByRole('switch', { name: 'Friday' }))
    await user.type(screen.getByLabelText('Opens'), '23:00')
    await user.type(screen.getByLabelText('Last orders'), '06:50')
    await user.type(screen.getByLabelText('Closes'), '06:55')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect((await screen.findAllByRole('alert'))[0]?.textContent).toBe(
      'Last orders must be at least 15 minutes before the night ends (07:00).',
    )
    expect(saveOrderingAction).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Save' })).toBeTruthy()
  })

  it('closes a night at once, with Undo that puts the hours back', async () => {
    const user = userEvent.setup()
    const settings = { serviceHours: { ...DEFAULT_ORDERING_SETTINGS.serviceHours, fri: THU } }
    renderWithIntl(<HoursPanel view={view(settings)} />)
    expect(
      screen.getByText('23:00 – 05:00 (next morning) · last orders 04:30 (next morning)'),
    ).toBeTruthy()
    await user.click(screen.getByRole('switch', { name: 'Friday' }))
    await waitFor(() =>
      expect(saveOrderingAction).toHaveBeenCalledWith({
        venueId: VENUE,
        changes: { serviceHours: { ...settings.serviceHours, fri: null } },
      }),
    )
    await waitFor(() => expect(toast.success).toHaveBeenCalled())
    const options = vi.mocked(toast.success).mock.calls[0]?.[1] as unknown as {
      action: { onClick: () => void }
    }
    options.action.onClick()
    await waitFor(() =>
      expect(saveOrderingAction).toHaveBeenLastCalledWith({
        venueId: VENUE,
        changes: { serviceHours: settings.serviceHours },
      }),
    )
  })

  it('says "Applies from now." when a night is open and its hours change', async () => {
    const user = userEvent.setup()
    const settings = { serviceHours: { ...DEFAULT_ORDERING_SETTINGS.serviceHours, fri: THU } }
    renderWithIntl(<HoursPanel view={view(settings, { openNow: true })} />)
    await user.click(screen.getByRole('switch', { name: 'Friday' }))
    await waitFor(() => expect(toast.success).toHaveBeenCalled())
    expect(vi.mocked(toast.success).mock.calls[0]?.[0]).toBe('Saved Applies from now.')
  })

  it('shows the pre-opening check only for a venue with a POS', () => {
    const { unmount } = renderWithIntl(<HoursPanel view={view()} />)
    expect(screen.getByTestId('hours-preopen').textContent).toBe(
      'From 2 h before opening Restro checks the connection to barsy every 10 min; if it still fails 30 min before opening, you get an alert.',
    )
    unmount()
    renderWithIntl(<HoursPanel view={view({}, { hasPos: false })} />)
    expect(screen.queryByTestId('hours-preopen')).toBeNull()
  })

  it('shows read-only values with one line and no controls for a role without the right', () => {
    const settings = { serviceHours: { ...DEFAULT_ORDERING_SETTINGS.serviceHours, fri: THU } }
    renderWithIntl(<HoursPanel view={view(settings, { canChange: false })} />)
    expect(screen.getByTestId('settings-readonly').textContent).toBe(
      'Only someone with the right to change settings can change these.',
    )
    expect(screen.queryByRole('switch')).toBeNull()
    expect(screen.queryByRole('button', { name: /Change/ })).toBeNull()
  })

  it('writes the same in Bulgarian', () => {
    renderWithIntl(<HoursPanel view={view()} />, { locale: 'bg' })
    expect(screen.getByRole('heading', { name: 'Работно време' })).toBeTruthy()
    expect(screen.getByTestId('hours-none').textContent).toBe(
      'Телефоните не могат да поръчват, докато не отворите поне една вечер.',
    )
  })
})

describe('Settings › Ordering', () => {
  it('shows D118’s defaults and the unset spot with its warning and one primary action', () => {
    renderWithIntl(<OrderingPanel view={view()} />)
    expect(screen.getByTestId('ord-cap-value').textContent).toBe('€150.00')
    expect(screen.getByTestId('ord-spot-unset').textContent).toContain(
      "Set the venue's spot, or nobody can order",
    )
    expect(screen.getByRole('button', { name: "I'm at the venue – use this spot" })).toBeTruthy()
    expect(screen.getByRole('switch', { name: 'Only at tables a waiter has opened' })).toBeTruthy()
  })

  it('changes the cap in place: Enter saves through the money module, Escape cancels', async () => {
    const user = userEvent.setup()
    renderWithIntl(<OrderingPanel view={view()} />)
    await user.click(screen.getByRole('button', { name: 'Change the largest order' }))
    const input = screen.getByLabelText('Largest order on the bill without paying first')
    await user.clear(input)
    await user.type(input, '200,50{Enter}')
    await waitFor(() =>
      expect(saveOrderingAction).toHaveBeenCalledWith({
        venueId: VENUE,
        changes: { capMinor: 20_050 },
      }),
    )
    vi.mocked(saveOrderingAction).mockClear()
    await user.click(screen.getByRole('button', { name: 'Change the largest order' }))
    await user.type(
      screen.getByLabelText('Largest order on the bill without paying first'),
      '9{Escape}',
    )
    expect(saveOrderingAction).not.toHaveBeenCalled()
  })

  it('refuses a cap that is not an amount', async () => {
    const user = userEvent.setup()
    renderWithIntl(<OrderingPanel view={view()} />)
    await user.click(screen.getByRole('button', { name: 'Change the largest order' }))
    const input = screen.getByLabelText('Largest order on the bill without paying first')
    await user.clear(input)
    await user.type(input, 'lots{Enter}')
    expect((await screen.findByRole('alert')).textContent).toBe(
      'Enter an amount above zero and up to €10,000.00.',
    )
    expect(saveOrderingAction).not.toHaveBeenCalled()
  })

  it('switches the cap off and the location check off, with the consequence shown at once', async () => {
    const user = userEvent.setup()
    renderWithIntl(<OrderingPanel view={view({ locationCheck: false })} />)
    await user.click(screen.getByRole('button', { name: 'More' }))
    expect(screen.getByTestId('ord-loc-off').textContent).toBe(
      "Anyone with a photo of a table code could order onto that table's bill.",
    )
    await user.click(
      screen.getByRole('switch', { name: 'Largest order on the bill without paying first' }),
    )
    await waitFor(() =>
      expect(saveOrderingAction).toHaveBeenCalledWith({
        venueId: VENUE,
        changes: { capMinor: null },
      }),
    )
  })

  it('sets the spot from where the owner stands, and refuses a rough reading', async () => {
    const user = userEvent.setup()
    const getCurrentPosition = vi.fn()
    Object.defineProperty(navigator, 'geolocation', {
      value: { getCurrentPosition },
      configurable: true,
    })
    renderWithIntl(<OrderingPanel view={view()} />)
    const button = screen.getByRole('button', { name: "I'm at the venue – use this spot" })

    getCurrentPosition.mockImplementationOnce((ok: PositionCallback) =>
      ok({
        coords: { latitude: 42.69751, longitude: 23.32415, accuracy: 340 },
      } as GeolocationPosition),
    )
    await user.click(button)
    expect(toast.error).toHaveBeenCalledWith(
      'The reading is too rough (340 m). Step away from walls or turn Wi-Fi on, and try again.',
      { duration: Number.POSITIVE_INFINITY },
    )
    expect(saveOrderingAction).not.toHaveBeenCalled()

    getCurrentPosition.mockImplementationOnce((ok: PositionCallback) =>
      ok({
        coords: { latitude: 42.69751, longitude: 23.32415, accuracy: 12 },
      } as GeolocationPosition),
    )
    await user.click(button)
    await waitFor(() =>
      expect(saveOrderingAction).toHaveBeenCalledWith({
        venueId: VENUE,
        changes: { spot: { lat: 42.69751, lng: 23.32415 } },
      }),
    )

    getCurrentPosition.mockImplementationOnce(
      (_: PositionCallback, refuse: PositionErrorCallback) =>
        refuse({ code: 1 } as GeolocationPositionError),
    )
    await user.click(button)
    expect(toast.error).toHaveBeenLastCalledWith(
      "Your browser didn't share the location. Allow it for this site, or set the spot on a phone at the venue.",
      { duration: Number.POSITIVE_INFINITY },
    )
  })

  it('shows a set spot with its date and a plain map link, no map', () => {
    renderWithIntl(
      <OrderingPanel
        view={view(
          { spot: { lat: 42.69751, lng: 23.32415 } },
          { spotSetAt: '2026-10-27T21:40:00.000Z' },
        )}
      />,
    )
    const line = screen.getByTestId('ord-spot-set')
    expect(line.textContent).toContain('Set on')
    const link = within(line).getByRole('link', { name: 'See on a map' })
    expect(link.getAttribute('href')).toContain('openstreetmap.org')
    expect(screen.getByRole('button', { name: 'Use where I am now' })).toBeTruthy()
  })

  it('has no controls for a role without the right', () => {
    renderWithIntl(<OrderingPanel view={view({}, { canChange: false })} />)
    expect(screen.getByTestId('settings-readonly')).toBeTruthy()
    expect(screen.queryByRole('switch')).toBeNull()
    expect(screen.queryByRole('button', { name: /use this spot/ })).toBeNull()
  })
})
