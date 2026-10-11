// @vitest-environment jsdom
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { SyncBlock } from '@/server/integration/view'
import { renderWithIntl } from '@/test-utils'
import { SyncCard } from './sync-card'
import { integrationView } from './test-view'

const actions = vi.hoisted(() => ({ syncAllAction: vi.fn(), saveSyncSettingsAction: vi.fn() }))
vi.mock('@/server/integration/actions', () => actions)

beforeEach(() => {
  actions.syncAllAction.mockReset()
  actions.saveSyncSettingsAction.mockReset()
})

describe('the Automatic sync card: "Sync everything now"', () => {
  it('presses it when the gate is open, and says how many syncs are queued', async () => {
    const user = userEvent.setup()
    actions.syncAllAction.mockResolvedValue({ ok: true, pulls: 2 })
    renderWithIntl(<SyncCard view={integrationView()} />)
    const button = screen.getByRole('button', { name: 'Sync everything now' }) as HTMLButtonElement
    expect(button.disabled).toBe(false)
    expect(screen.queryByTestId('sync-blocked')).toBeNull()
    await user.click(button)
    expect(actions.syncAllAction).toHaveBeenCalledWith()
    expect(await screen.findByText('2 syncs are queued.')).toBeTruthy()
  })

  it('says "1 sync" for one linked venue', async () => {
    const user = userEvent.setup()
    actions.syncAllAction.mockResolvedValue({ ok: true, pulls: 1 })
    renderWithIntl(<SyncCard view={integrationView()} />)
    await user.click(screen.getByRole('button', { name: 'Sync everything now' }))
    expect(await screen.findByText('1 sync is queued.')).toBeTruthy()
  })

  it.each([
    ['not_manager', 'Only owners and admins can start a sync.'],
    ['no_credentials', 'Save the barsy credentials first.'],
    ['checking', 'The connection is being checked. Wait until it finishes.'],
    ['not_connected', 'The connection to barsy has to work first. See the status above.'],
    ['no_till_venue', 'Link a venue in barsy to a venue first.'],
    ['no_root', 'Choose a menu category in a linked venue first.'],
    ['busy', 'A sync is already queued or running.'],
  ] as [SyncBlock, string][])('is off for "%s" and says why', async (reason, text) => {
    const user = userEvent.setup()
    renderWithIntl(<SyncCard view={integrationView({ gate: { enabled: false, reason } })} />)
    const button = screen.getByRole('button', { name: 'Sync everything now' }) as HTMLButtonElement
    expect(button.disabled).toBe(true)
    expect(screen.getByTestId('sync-blocked').textContent).toBe(text)
    await user.click(button)
    expect(actions.syncAllAction).not.toHaveBeenCalled()
  })

  it('drops the "queued" notice once the pulls it was about have finished', async () => {
    const user = userEvent.setup()
    actions.syncAllAction.mockResolvedValue({ ok: true, pulls: 2 })
    const { rerender } = renderWithIntl(<SyncCard view={integrationView()} />)
    await user.click(screen.getByRole('button', { name: 'Sync everything now' }))
    expect(await screen.findByText('2 syncs are queued.')).toBeTruthy()
    // The page catches up: a pull is waiting, then it is done.
    rerender(
      <SyncCard
        view={integrationView({ activeJob: 'pull', gate: { enabled: false, reason: 'busy' } })}
      />,
    )
    expect(screen.getByText('2 syncs are queued.')).toBeTruthy()
    rerender(<SyncCard view={integrationView()} />)
    expect(screen.queryByText('2 syncs are queued.')).toBeNull()
  })

  it('shows why the press was refused', async () => {
    const user = userEvent.setup()
    actions.syncAllAction.mockResolvedValue({ ok: false, error: 'already_running' })
    renderWithIntl(<SyncCard view={integrationView()} />)
    await user.click(screen.getByRole('button', { name: 'Sync everything now' }))
    expect((await screen.findByRole('alert')).textContent).toBe(
      'A sync is already queued or running.',
    )
  })

  it('names the schedule’s clock, and has no publishing rules (they are each venue’s)', () => {
    renderWithIntl(<SyncCard view={integrationView()} />)
    expect(screen.getByText('Counted in Sofia time.')).toBeTruthy()
    expect(screen.queryByText('After a sync')).toBeNull()
    expect(screen.queryByRole('radio')).toBeNull()
  })

  it('speaks Bulgarian', () => {
    renderWithIntl(<SyncCard view={integrationView()} />, { locale: 'bg' })
    expect(screen.getByRole('button', { name: 'Синхронизирай всичко сега' })).toBeTruthy()
    expect(screen.getByText('Брои се по софийско време.')).toBeTruthy()
  })
})
