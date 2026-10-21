// @vitest-environment jsdom
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { INSTANCE_ID, instanceView } from '@/connectors/test-view'
import type { InstanceView, SyncBlock } from '@/server/integration/view'
import { renderWithIntl } from '@/test-utils'
import { SyncCard } from './sync-card'

const actions = vi.hoisted(() => ({ syncAllAction: vi.fn() }))
vi.mock('@/server/integration/actions', () => actions)

beforeEach(() => {
  actions.syncAllAction.mockReset()
})

const card = (change: Partial<InstanceView> = {}) =>
  renderWithIntl(<SyncCard instance={instanceView(change)} />)

describe('the "Sync everything" card of an instance', () => {
  it('presses it when the gate is open, and says how many syncs are queued', async () => {
    const user = userEvent.setup()
    actions.syncAllAction.mockResolvedValue({ ok: true, pulls: 2 })
    card()
    const button = screen.getByRole('button', { name: 'Sync everything now' }) as HTMLButtonElement
    expect(button.disabled).toBe(false)
    expect(screen.queryByTestId('sync-blocked')).toBeNull()
    await user.click(button)
    expect(actions.syncAllAction).toHaveBeenCalledWith({ integrationId: INSTANCE_ID })
    expect(await screen.findByText('2 syncs are queued.')).toBeTruthy()
  })

  it('says "1 sync" for one linked venue', async () => {
    const user = userEvent.setup()
    actions.syncAllAction.mockResolvedValue({ ok: true, pulls: 1 })
    card()
    await user.click(screen.getByRole('button', { name: 'Sync everything now' }))
    expect(await screen.findByText('1 sync is queued.')).toBeTruthy()
  })

  it.each([
    ['not_manager', 'Only owners and admins can start a sync.'],
    ['no_credentials', 'Save the barsy credentials first.'],
    ['checking', 'The connection is being checked. Wait until it finishes.'],
    ['not_connected', 'The connection to barsy has to work first. See the status above.'],
    ['no_till_venue', 'No venue uses this connection yet.'],
    ['no_menu', 'barsy has not reported the menus of its venues yet. Check the connection again.'],
    ['busy', 'A sync is already queued or running.'],
  ] as [SyncBlock, string][])('is off for "%s" and says why', async (reason, text) => {
    const user = userEvent.setup()
    card({ gate: { enabled: false, reason } })
    const button = screen.getByRole('button', { name: 'Sync everything now' }) as HTMLButtonElement
    expect(button.disabled).toBe(true)
    expect(screen.getByTestId('sync-blocked').textContent).toBe(text)
    await user.click(button)
    expect(actions.syncAllAction).not.toHaveBeenCalled()
  })

  it('drops the "queued" notice once the pulls it was about have finished', async () => {
    const user = userEvent.setup()
    actions.syncAllAction.mockResolvedValue({ ok: true, pulls: 2 })
    const { rerender } = card()
    await user.click(screen.getByRole('button', { name: 'Sync everything now' }))
    expect(await screen.findByText('2 syncs are queued.')).toBeTruthy()
    // The page catches up: a pull is waiting, then it is done.
    rerender(
      <SyncCard
        instance={instanceView({ activeJob: 'pull', gate: { enabled: false, reason: 'busy' } })}
      />,
    )
    expect(screen.getByText('2 syncs are queued.')).toBeTruthy()
    rerender(<SyncCard instance={instanceView()} />)
    expect(screen.queryByText('2 syncs are queued.')).toBeNull()
  })

  it('shows why the press was refused', async () => {
    const user = userEvent.setup()
    actions.syncAllAction.mockResolvedValue({ ok: false, error: 'already_running' })
    card()
    await user.click(screen.getByRole('button', { name: 'Sync everything now' }))
    expect((await screen.findByRole('alert')).textContent).toBe(
      'A sync is already queued or running.',
    )
  })

  it('is an action only: no schedule here (each venue has its own, D82)', () => {
    card()
    expect(screen.queryByText(/Counted in/)).toBeNull()
    expect(screen.queryByRole('switch')).toBeNull()
    expect(screen.queryByRole('radio')).toBeNull()
    expect(screen.getByText(/Each venue sets its own automatic syncing/)).toBeTruthy()
  })

  it('speaks Bulgarian', () => {
    renderWithIntl(<SyncCard instance={instanceView()} />, { locale: 'bg' })
    expect(screen.getByRole('button', { name: 'Синхронизирай всичко сега' })).toBeTruthy()
  })
})
