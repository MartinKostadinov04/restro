// @vitest-environment jsdom
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { SyncBlock } from '@/server/integration/view'
import { renderWithIntl } from '@/test-utils'
import { SyncCard } from './sync-card'
import { integrationView, VENUE_ID } from './test-view'

const actions = vi.hoisted(() => ({ syncNowAction: vi.fn() }))
vi.mock('@/server/integration/actions', () => actions)

beforeEach(() => {
  actions.syncNowAction.mockReset()
})

describe('the Sync card', () => {
  it('presses "Sync now" when the gate is open, and says it is queued', async () => {
    const user = userEvent.setup()
    actions.syncNowAction.mockResolvedValue({ ok: true })
    renderWithIntl(<SyncCard venueId={VENUE_ID} view={integrationView()} />)
    const button = screen.getByRole('button', { name: 'Sync now' }) as HTMLButtonElement
    expect(button.disabled).toBe(false)
    expect(screen.queryByTestId('sync-blocked')).toBeNull()
    await user.click(button)
    expect(actions.syncNowAction).toHaveBeenCalledWith({ venueId: VENUE_ID })
    expect(await screen.findByText('The sync is queued.')).toBeTruthy()
  })

  it.each([
    ['not_manager', 'Only owners and admins can start a sync.'],
    ['no_credentials', 'Save the barsy credentials first.'],
    ['checking', 'The connection is being checked. Wait until it finishes.'],
    ['not_connected', 'The connection to barsy has to work first. See the status above.'],
    ['no_barsy_venue', 'Choose the barsy venue first.'],
    ['no_root', 'Choose the menu catalogue first.'],
    ['busy', 'A sync is already queued or running.'],
  ] as [SyncBlock, string][])('is off for "%s" and says why', async (reason, text) => {
    const user = userEvent.setup()
    renderWithIntl(
      <SyncCard venueId={VENUE_ID} view={integrationView({ gate: { enabled: false, reason } })} />,
    )
    const button = screen.getByRole('button', { name: 'Sync now' }) as HTMLButtonElement
    expect(button.disabled).toBe(true)
    expect(screen.getByTestId('sync-blocked').textContent).toBe(text)
    await user.click(button)
    expect(actions.syncNowAction).not.toHaveBeenCalled()
  })

  it('shows when it last synced, in the venue’s time zone, or that it has not', () => {
    const { unmount } = renderWithIntl(<SyncCard venueId={VENUE_ID} view={integrationView()} />)
    // 09:30 UTC is 12:30 in Sofia.
    expect(screen.getByTestId('sync-last').textContent).toMatch(/Last synced .*12:30/)
    unmount()
    renderWithIntl(<SyncCard venueId={VENUE_ID} view={integrationView({ lastSyncedAt: null })} />)
    expect(screen.getByTestId('sync-last').textContent).toBe('Not synced yet.')
  })

  it('shows why the press was refused', async () => {
    const user = userEvent.setup()
    actions.syncNowAction.mockResolvedValue({ ok: false, error: 'already_running' })
    renderWithIntl(<SyncCard venueId={VENUE_ID} view={integrationView()} />)
    await user.click(screen.getByRole('button', { name: 'Sync now' }))
    expect((await screen.findByRole('alert')).textContent).toBe(
      'A sync is already queued or running.',
    )
  })

  it('speaks Bulgarian', () => {
    renderWithIntl(<SyncCard venueId={VENUE_ID} view={integrationView()} />, { locale: 'bg' })
    expect(screen.getByRole('button', { name: 'Синхронизирай сега' })).toBeTruthy()
  })
})
