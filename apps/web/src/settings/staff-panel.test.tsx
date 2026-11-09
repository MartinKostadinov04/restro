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
  resetRoleAction,
  revealPinAction,
  setPinFallAction,
  updateRoleAction,
} from '@/server/settings/staff-actions'
import type { StaffView } from '@/server/settings/staff-view'
import { renderWithIntl } from '@/test-utils'
import { PIN_FALL_ROWS } from './pin-fall'
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
  resetRoleAction: vi.fn(),
  archiveRoleAction: vi.fn(),
  revokeSharedDeviceAction: vi.fn(),
  setPinFallAction: vi.fn(),
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
  'settings.connect_payments',
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
        readOnly: false,
        permissions: STAFF_PERMISSIONS,
        edited: false,
        newPermissions: [],
        shipped: STAFF_PERMISSIONS,
        people: 1,
      },
      {
        ref: 'manager',
        name: 'Manager',
        defaultKind: 'manager',
        readOnly: false,
        permissions: [...STAFF_PERMISSIONS, 'ordering.lift', 'log.view'],
        edited: false,
        newPermissions: [],
        shipped: [...STAFF_PERMISSIONS, 'ordering.lift', 'log.view'],
        people: 0,
      },
      {
        ref: 'owner',
        name: 'Owner',
        defaultKind: 'owner',
        readOnly: true,
        permissions: ALL_PERMISSIONS,
        edited: false,
        newPermissions: [],
        shipped: ALL_PERMISSIONS,
        people: 1,
      },
      {
        ref: 'rl_0000000000000000000009',
        name: 'Bar lead',
        defaultKind: null,
        readOnly: false,
        permissions: ['tables.open_close'],
        edited: false,
        newPermissions: [],
        shipped: [],
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
    held: ['tables.open_close', 'settings.roles', 'settings.reservations'],
    operator: false,
    pinFall: { falls: DEFAULT_FALLS, settingsExist: true },
    email: 'owner@example.com',
    ...overrides,
  }
}

/** D141's default, as the screen's own list states it (the venue has moved nothing). */
const DEFAULT_FALLS = Object.fromEntries(
  PIN_FALL_ROWS.map((row) => [row.action, row.fall]),
) as StaffView['pinFall']['falls']

const OK = { ok: true, details: {} } as const

beforeEach(() => {
  for (const action of [
    addPersonAction,
    assignRoleAction,
    newPinAction,
    removeFromVenueAction,
    revealPinAction,
    setPinFallAction,
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
          closeButton: true,
        },
      ),
    )
  })

  it('lists roles with their people, and the Owner role alone is fixed (#366)', async () => {
    const user = userEvent.setup()
    renderWithIntl(<StaffPanel view={view()} />)
    const roles = screen.getByTestId('staff-roles')
    expect(within(roles).getAllByRole('listitem')).toHaveLength(4)
    expect(within(roles).getAllByText(/Default/)).toHaveLength(3)
    await user.click(within(roles).getByText('Owner'))
    const sheet = await screen.findByRole('dialog')
    expect(within(sheet).getByTestId('role-owner-fixed').textContent).toContain('every ability')
    for (const box of within(sheet).getAllByRole('checkbox')) {
      expect((box as HTMLInputElement).disabled || box.getAttribute('data-disabled') !== null).toBe(
        true,
      )
    }
  })

  it('unticks an ability on the Staff role in place, named by its kind (#366)', async () => {
    vi.mocked(updateRoleAction).mockResolvedValue(OK)
    const user = userEvent.setup()
    renderWithIntl(<StaffPanel view={view({ held: ALL_PERMISSIONS })} />)
    await user.click(within(screen.getByTestId('staff-roles')).getByText('Staff'))
    const sheet = await screen.findByRole('dialog')
    // No copy, no new screen: the tick on the role itself, saved at once.
    await user.click(within(sheet).getByRole('checkbox', { name: /Resume a paused table/ }))
    await waitFor(() =>
      expect(updateRoleAction).toHaveBeenCalledWith({
        venueId: VENUE,
        roleId: 'staff',
        permissions: ['tables.open_close', 'ordering.pause', 'alerts.answer', 'night.view'],
      }),
    )
  })

  it('offers one Reset on an edited default role, with the confirm naming what it will hold', async () => {
    vi.mocked(resetRoleAction).mockResolvedValue(OK)
    const user = userEvent.setup()
    const edited = view()
    const roles = edited.roles.map((role) =>
      role.ref === 'staff'
        ? { ...role, edited: true, permissions: ['tables.open_close'] as const }
        : role,
    )
    renderWithIntl(<StaffPanel view={{ ...edited, roles, held: ALL_PERMISSIONS }} />)
    await user.click(within(screen.getByTestId('staff-roles')).getByText('Staff'))
    const sheet = await screen.findByRole('dialog')
    await user.click(within(sheet).getByRole('button', { name: /Reset to what Restro ships/ }))
    const confirm = await screen.findByTestId('role-reset-body')
    expect(confirm.textContent).toContain('Open and close tables for phones')
    expect(confirm.textContent).toContain('Resume a paused table')
    await user.click(screen.getByRole('button', { name: 'Reset role' }))
    await waitFor(() =>
      expect(resetRoleAction).toHaveBeenCalledWith({ venueId: VENUE, roleId: 'staff' }),
    )
  })

  it('shows a role the venue has never edited with no Reset and nothing marked new', async () => {
    const user = userEvent.setup()
    renderWithIntl(<StaffPanel view={view()} />)
    await user.click(within(screen.getByTestId('staff-roles')).getByText('Staff'))
    const sheet = await screen.findByRole('dialog')
    expect(within(sheet).queryByRole('button', { name: /Reset/ })).toBeNull()
    expect(within(sheet).queryByText(/Restro added a new ability/)).toBeNull()
  })

  it('marks an ability Restro added after the venue’s edit, unticked in its own group (#366)', async () => {
    const user = userEvent.setup()
    const base = view()
    const roles = base.roles.map((role) =>
      role.ref === 'staff'
        ? { ...role, edited: true, newPermissions: ['sold_out'] as const }
        : role,
    )
    renderWithIntl(<StaffPanel view={{ ...base, roles, held: ALL_PERMISSIONS }} />)
    await user.click(within(screen.getByTestId('staff-roles')).getByText('Staff'))
    const sheet = await screen.findByRole('dialog')
    expect(within(sheet).getByTestId('perm-new-sold_out').textContent).toContain(
      'Restro added a new ability',
    )
    expect(
      (within(sheet).getByRole('checkbox', { name: /Mark items sold out/ }) as HTMLInputElement)
        .checked,
    ).toBe(false)
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

  it('makes no shared device here: it says the bar tablet signs in with a staff account (RR-O35)', () => {
    renderWithIntl(<StaffPanel view={view()} />)
    expect(screen.queryByRole('button', { name: /shared device|bar tablet/i })).toBeNull()
    expect(screen.getByTestId('staff-devices-how').textContent).toContain('staff account')
  })

  it('says it in Bulgarian', () => {
    renderWithIntl(<StaffPanel view={view()} />, { locale: 'bg' })
    expect(screen.getByTestId('staff-devices-how').textContent).toContain('служебен акаунт')
  })
})

describe('Settings › Staff and roles › Where the PIN falls (D141, #324)', () => {
  /** One of an action's two radios. */
  const radio = (action: string, fall: 'tap' | 'pin') =>
    screen.getByTestId(`pin-fall-${action}-${fall}`) as HTMLInputElement
  /** Where the screen shows an action falling now. */
  const chosen = (action: string) => (radio(action, 'tap').checked ? 'tap' : 'pin')

  it('draws every action where D141 puts it, and says so where the venue moved one', () => {
    renderWithIntl(
      <StaffPanel
        view={view({
          pinFall: { falls: { ...DEFAULT_FALLS, cancel: 'tap' }, settingsExist: true },
        })}
      />,
    )
    const list = screen.getByTestId('pin-fall')
    expect(within(list).getAllByRole('radiogroup')).toHaveLength(PIN_FALL_ROWS.length)
    expect(chosen('status')).toBe('tap')
    expect(chosen('create')).toBe('pin')
    // The one line this venue moved says where the default had it.
    expect(chosen('cancel')).toBe('tap')
    expect(list.textContent).toContain('Default: a PIN')
    expect(list.textContent).not.toContain('Default: one tap')
  })

  it('moves one line at once, with Undo, and leaves the others alone', async () => {
    vi.mocked(setPinFallAction).mockResolvedValue(OK)
    const user = userEvent.setup()
    renderWithIntl(<StaffPanel view={view()} />)
    await user.click(screen.getByTestId('pin-fall-walk_in-pin'))
    await waitFor(() =>
      expect(setPinFallAction).toHaveBeenCalledWith({
        venueId: VENUE,
        action: 'walk_in',
        fall: 'pin',
      }),
    )
    expect(setPinFallAction).toHaveBeenCalledTimes(1)
    const toasted = vi.mocked(toast.success).mock.calls[0]
    expect(toasted?.[0]).toBe('Saved')
    expect(toasted?.[1]).toMatchObject({ action: { label: 'Undo' } })
  })

  it('says what is missing when the venue has no reservation settings yet, and changes nothing', () => {
    renderWithIntl(
      <StaffPanel view={view({ pinFall: { falls: DEFAULT_FALLS, settingsExist: false } })} />,
    )
    expect(screen.getByTestId('staff-panel').textContent).toContain(
      "Set this venue's reservation settings first.",
    )
    expect(radio('status', 'pin').disabled).toBe(true)
    expect(setPinFallAction).not.toHaveBeenCalled()
  })

  it('shows the list read-only to someone who may not change the reservation settings', () => {
    renderWithIntl(<StaffPanel view={view({ held: ['settings.roles'] })} />)
    expect(screen.getByTestId('staff-panel').textContent).toContain(
      'Only someone who may change the reservation settings can move these.',
    )
    expect(radio('create', 'tap').disabled).toBe(true)
  })

  it('gives the roles sheet a Reservations group whose settings two need an own sign-in', async () => {
    const user = userEvent.setup()
    renderWithIntl(<StaffPanel view={view()} />)
    await user.click(screen.getByRole('button', { name: /^Owner/ }))
    const sheet = await screen.findByRole('dialog')
    expect(within(sheet).getByRole('group', { name: 'Reservations' })).toBeTruthy()
    expect(sheet.textContent).toContain(
      "Work tonight's reservations: arrivals, walk-ins, the waiting list",
    )
    expect(sheet.textContent).toContain('Change the reservation settings')
    expect(sheet.textContent).toContain(
      "The reservation settings and the guest records need the person's own sign-in",
    )
  })
})
