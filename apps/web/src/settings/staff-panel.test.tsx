// @vitest-environment jsdom
import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { toast } from 'sonner'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { authClient } from '@/lib/auth-client'
import {
  addPersonAction,
  assignRoleAction,
  newPinAction,
  removeFromVenueAction,
  revealPinAction,
  updateRoleAction,
} from '@/server/settings/staff-actions'
import type { StaffView } from '@/server/settings/staff-view'
import { renderWithIntl } from '@/test-utils'
import { StaffPanel } from './staff-panel'
import { PIN_SHOWN_MS } from './staff-people'

vi.mock('@/server/settings/staff-actions', () => ({
  addPersonAction: vi.fn(),
  assignRoleAction: vi.fn(),
  linkAccountAction: vi.fn(),
  newPinAction: vi.fn(),
  removeForGoodAction: vi.fn(),
  removeFromVenueAction: vi.fn(),
  renamePersonAction: vi.fn(),
  revealPinAction: vi.fn(),
  copyRoleAction: vi.fn(),
  updateRoleAction: vi.fn(),
  archiveRoleAction: vi.fn(),
  markSharedDeviceAction: vi.fn(),
  revokeSharedDeviceAction: vi.fn(),
}))
vi.mock('@/lib/auth-client', () => ({ authClient: { signIn: { email: vi.fn() } } }))
vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), message: vi.fn() },
}))

const VENUE = 'vn_0000000000000000000001'
const ANA = 'sm_0000000000000000000001'
const OWNER_ISH = 'sm_0000000000000000000002'

const STAFF_PERMISSIONS = [
  'tables.open_close',
  'tables.resume',
  'ordering.pause',
  'alerts.answer',
  'night.view',
] as const
const ALL_PERMISSIONS = [
  ...STAFF_PERMISSIONS,
  'ordering.lift',
  'sold_out',
  'log.view',
  'night.view_full',
  'money.follow_up',
  'settings.guards',
  'settings.codes',
  'settings.payment_tables',
  'settings.alerts',
  'settings.roles',
] as const

function view(overrides: Partial<StaffView> = {}): StaffView {
  return {
    venueId: VENUE,
    venueName: 'Club Nova',
    roles: [
      {
        ref: 'staff',
        name: 'Staff',
        defaultKind: 'staff',
        readOnly: true,
        permissions: STAFF_PERMISSIONS,
        people: 1,
      },
      {
        ref: 'manager',
        name: 'Manager',
        defaultKind: 'manager',
        readOnly: true,
        permissions: [...STAFF_PERMISSIONS, 'ordering.lift', 'log.view'],
        people: 0,
      },
      {
        ref: 'owner',
        name: 'Owner',
        defaultKind: 'owner',
        readOnly: true,
        permissions: ALL_PERMISSIONS,
        people: 1,
      },
      {
        ref: 'rl_0000000000000000000009',
        name: 'Bar lead',
        defaultKind: null,
        readOnly: false,
        permissions: ['tables.open_close'],
        people: 0,
      },
    ],
    people: [
      {
        id: ANA,
        name: 'Ana',
        roleRef: 'staff',
        hasPin: true,
        accountId: null,
        manageable: true,
        neededRole: null,
      },
      {
        id: OWNER_ISH,
        name: 'Boris',
        roleRef: 'owner',
        hasPin: true,
        accountId: 'u1',
        manageable: false,
        neededRole: 'Owner',
      },
    ],
    accounts: [],
    devices: [],
    held: ['tables.open_close', 'settings.roles'],
    operator: false,
    thisBrowserShared: false,
    email: 'owner@example.com',
    ...overrides,
  }
}

const OK = { ok: true, details: {} } as const

beforeEach(() => {
  for (const action of [
    addPersonAction,
    assignRoleAction,
    newPinAction,
    removeFromVenueAction,
    revealPinAction,
    updateRoleAction,
  ]) {
    vi.mocked(action).mockReset()
  }
  vi.mocked(toast.success).mockReset()
  vi.mocked(toast.error).mockReset()
  vi.mocked(authClient.signIn.email).mockReset()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('Settings › Staff and roles', () => {
  it('shows the empty state with a filled "Add person" while nobody works here', () => {
    renderWithIntl(<StaffPanel view={view({ people: [] })} />)
    expect(screen.getByTestId('staff-empty').textContent).toContain(
      'Add the people who work at Club Nova. Each gets a PIN for the bar tablet; no email needed.',
    )
    expect(screen.getAllByRole('button', { name: 'Add person' })).toHaveLength(1)
  })

  it('adds a person and shows the PIN once, in the result', async () => {
    vi.mocked(addPersonAction).mockResolvedValue({
      ok: true,
      details: {},
      staffMemberId: 'sm_0000000000000000000003',
      pin: '4821',
    })
    const user = userEvent.setup()
    renderWithIntl(<StaffPanel view={view()} />)
    await user.click(screen.getByRole('button', { name: 'Add person' }))
    await user.type(screen.getByLabelText('Name'), 'Mila')
    await user.click(screen.getByRole('button', { name: 'Add' }))
    await waitFor(() =>
      expect(addPersonAction).toHaveBeenCalledWith({
        venueId: VENUE,
        displayName: 'Mila',
        roleId: 'staff',
      }),
    )
    const result = await screen.findByTestId('pin-result')
    expect(result.textContent).toBe("Mila's PIN is 4821. They use it on the bar tablet.")
    await user.click(screen.getByRole('button', { name: 'Done' }))
    expect(screen.queryByTestId('pin-result')).toBeNull()
  })

  it('shows a PIN behind the eye for 30 seconds, then hides it again', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    vi.mocked(revealPinAction).mockResolvedValue({
      ok: true,
      details: {},
      staffMemberId: ANA,
      pin: '4821',
    })
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    renderWithIntl(<StaffPanel view={view()} />)
    expect(screen.getByTestId(`pin-${ANA}`).textContent).toBe('••••')
    await user.click(screen.getByRole('button', { name: 'Show PIN: Ana' }))
    await waitFor(() => expect(screen.getByTestId(`pin-${ANA}`).textContent).toBe('4821'))
    await act(async () => {
      vi.advanceTimersByTime(PIN_SHOWN_MS + 10)
    })
    expect(screen.getByTestId(`pin-${ANA}`).textContent).toBe('••••')
  })

  it('draws a person the actor may not manage with a name, a role and one line, no controls', () => {
    renderWithIntl(<StaffPanel view={view()} />)
    const row = screen.getByText('Boris').closest('li') as HTMLElement
    expect(within(row).getByText('Only Owner can change this person.')).toBeTruthy()
    expect(within(row).queryByRole('combobox')).toBeNull()
    expect(within(row).queryByRole('button')).toBeNull()
  })

  it('puts a removed person back on Undo', async () => {
    vi.mocked(removeFromVenueAction).mockResolvedValue(OK)
    vi.mocked(assignRoleAction).mockResolvedValue(OK)
    const user = userEvent.setup()
    renderWithIntl(<StaffPanel view={view()} />)
    await user.click(screen.getByRole('button', { name: 'Ana' }))
    await user.click(await screen.findByRole('menuitem', { name: 'Remove from Club Nova' }))
    await waitFor(() => expect(toast.success).toHaveBeenCalled())
    const options = vi.mocked(toast.success).mock.calls[0]?.[1] as unknown as {
      action: { onClick: () => void }
    }
    options.action.onClick()
    await waitFor(() =>
      expect(assignRoleAction).toHaveBeenCalledWith({
        venueId: VENUE,
        staffMemberId: ANA,
        roleId: 'staff',
      }),
    )
  })

  it('asks for the password again after 15 minutes, then does the change', async () => {
    vi.mocked(newPinAction)
      .mockResolvedValueOnce({ ok: false, error: 'sign_in_again' })
      .mockResolvedValueOnce({ ok: true, details: {}, staffMemberId: ANA, pin: '1234' })
    vi.mocked(authClient.signIn.email).mockResolvedValue({ data: {}, error: null } as never)
    const user = userEvent.setup()
    renderWithIntl(<StaffPanel view={view()} />)
    await user.click(screen.getByRole('button', { name: 'Ana' }))
    await user.click(await screen.findByRole('menuitem', { name: 'New PIN' }))
    expect(await screen.findByText('Enter your password to change settings')).toBeTruthy()
    await user.type(screen.getByLabelText('Password'), 'secret-pass')
    await user.click(screen.getByRole('button', { name: 'Confirm' }))
    await waitFor(() =>
      expect(authClient.signIn.email).toHaveBeenCalledWith({
        email: 'owner@example.com',
        password: 'secret-pass',
      }),
    )
    expect((await screen.findByTestId('pin-result')).textContent).toContain('1234')
    expect(newPinAction).toHaveBeenCalledTimes(2)
  })

  it('words a refusal and keeps the toast', async () => {
    vi.mocked(assignRoleAction).mockResolvedValue({ ok: false, error: 'permission_denied' })
    const user = userEvent.setup()
    renderWithIntl(<StaffPanel view={view()} />)
    await user.click(screen.getByRole('combobox', { name: 'Role: Ana' }))
    await user.click(await screen.findByRole('option', { name: 'Manager' }))
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        "You can't change Ana: they hold rights you don't.",
        {
          duration: Number.POSITIVE_INFINITY,
        },
      ),
    )
  })

  it('lists roles with their people and the three defaults read-only', async () => {
    const user = userEvent.setup()
    renderWithIntl(<StaffPanel view={view()} />)
    const roles = screen.getByTestId('staff-roles')
    expect(within(roles).getAllByRole('listitem')).toHaveLength(4)
    expect(within(roles).getAllByText(/Default/)).toHaveLength(3)
    await user.click(within(roles).getByText('Staff'))
    const sheet = await screen.findByRole('dialog')
    for (const box of within(sheet).getAllByRole('checkbox')) {
      expect((box as HTMLInputElement).disabled || box.getAttribute('data-disabled') !== null).toBe(
        true,
      )
    }
  })

  it('saves a tick on a venue’s own role at once and shows what the actor cannot give as read-only', async () => {
    vi.mocked(updateRoleAction).mockResolvedValue(OK)
    const user = userEvent.setup()
    renderWithIntl(<StaffPanel view={view()} />)
    await user.click(within(screen.getByTestId('staff-roles')).getByText('Bar lead'))
    const sheet = await screen.findByRole('dialog')
    expect(
      within(sheet).getAllByText("You can't give what you don't hold.").length,
    ).toBeGreaterThan(0)
    await user.click(
      within(sheet).getByRole('checkbox', { name: 'Open and close tables for phones' }),
    )
    await waitFor(() =>
      expect(updateRoleAction).toHaveBeenCalledWith({
        venueId: VENUE,
        roleId: 'rl_0000000000000000000009',
        permissions: [],
      }),
    )
  })

  it('offers "Make this browser a shared device" only to a person, never to Restro’s team', () => {
    const { unmount } = renderWithIntl(<StaffPanel view={view()} />)
    expect(screen.getByRole('button', { name: 'Make this browser a shared device' })).toBeTruthy()
    unmount()
    renderWithIntl(<StaffPanel view={view({ operator: true })} />)
    expect(screen.queryByRole('button', { name: 'Make this browser a shared device' })).toBeNull()
  })
})
