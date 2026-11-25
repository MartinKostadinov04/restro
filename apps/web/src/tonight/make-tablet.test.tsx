// @vitest-environment jsdom
// "Make this the bar tablet" on Tonight (RR-O35): it names the device, makes this browser the
// venue's shared device and reloads as one; an account that is not a staff-only one is told which
// account to use.
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { toast } from 'sonner'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { markSharedDeviceAction } from '@/server/settings/staff-actions'
import { renderWithIntl } from '@/test-utils'

import { MakeTablet } from './make-tablet'

const refresh = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh, replace: vi.fn(), push: vi.fn() }),
  unstable_rethrow: () => {},
}))
vi.mock('@/server/settings/staff-actions', () => ({ markSharedDeviceAction: vi.fn() }))
vi.mock('@/lib/auth-client', () => ({ authClient: { signIn: { email: vi.fn() } } }))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

const VENUE = 'vn_0000000000000000000001'

beforeEach(() => {
  refresh.mockReset()
  vi.mocked(markSharedDeviceAction).mockReset()
  vi.mocked(toast.success).mockReset()
  vi.mocked(toast.error).mockReset()
})

async function make(name: string) {
  await userEvent.click(screen.getByRole('button', { name: 'Make this the bar tablet' }))
  await userEvent.type(screen.getByLabelText('Device name'), name)
  await userEvent.click(screen.getByRole('button', { name: 'Make shared' }))
}

describe('Make this the bar tablet', () => {
  it('names the device, makes this browser the bar tablet and reloads as it', async () => {
    vi.mocked(markSharedDeviceAction).mockResolvedValue({ ok: true, details: {} })
    renderWithIntl(<MakeTablet venueId={VENUE} email="waiter@example.test" />)
    await make('Bar 1')
    await waitFor(() =>
      expect(markSharedDeviceAction).toHaveBeenCalledWith({ venueId: VENUE, name: 'Bar 1' }),
    )
    await waitFor(() => expect(refresh).toHaveBeenCalled())
    expect(toast.success).toHaveBeenCalledWith('Saved', {})
  })

  it('tells any other account which account to use', async () => {
    vi.mocked(markSharedDeviceAction).mockResolvedValue({
      ok: false,
      error: 'staff_account_required',
    })
    renderWithIntl(<MakeTablet venueId={VENUE} email="owner@example.test" />)
    await make('Bar 1')
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        'Only a staff account can make this the bar tablet: sign in here with an account whose role is Staff.',
        expect.anything(),
      ),
    )
    expect(refresh).not.toHaveBeenCalled()
  })

  it('says it in Bulgarian', () => {
    renderWithIntl(<MakeTablet venueId={VENUE} email="waiter@example.test" />, { locale: 'bg' })
    expect(screen.getByRole('button', { name: 'Направи това бар таблета' })).toBeTruthy()
  })
})
