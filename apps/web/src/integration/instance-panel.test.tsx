// @vitest-environment jsdom
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { INSTANCE_ID, instanceView, newInstanceView, run } from '@/connectors/test-view'
import type { InstanceView } from '@/server/integration/view'
import { renderWithIntl } from '@/test-utils'
import { InstancePanel } from './instance-panel'

const actions = vi.hoisted(() => ({
  removeInstanceAction: vi.fn(),
  saveConnectionAction: vi.fn(),
  renameInstanceAction: vi.fn(),
  checkConnectionAction: vi.fn(),
  saveInstanceSettingsAction: vi.fn(),
  syncAllAction: vi.fn(),
}))
vi.mock('@/server/integration/actions', () => actions)

beforeEach(() => {
  for (const action of Object.values(actions)) action.mockReset()
})

const panel = (change: Partial<InstanceView> = {}, canManage = true, locale: 'en' | 'bg' = 'en') =>
  renderWithIntl(
    <InstancePanel instance={instanceView(change)} canManage={canManage} sealReady />,
    { locale },
  )

describe('an instance panel', () => {
  it('has the cards of an instance, in the order a manager works through them', () => {
    panel({ runs: [run()] })
    const root = screen.getByTestId('instance')
    expect(root.getAttribute('data-instance-id')).toBe(INSTANCE_ID)
    expect(within(root).getByRole('heading', { level: 3, name: 'barsy – Sofia' })).toBeTruthy()
    const headings = within(root)
      .getAllByRole('heading', { level: 3 })
      .map((heading) => heading.textContent)
    // The instance, then connection, status, the system's settings card (supplied by the
    // connector), sync everything and the history.
    expect(headings).toEqual([
      'barsy – Sofia',
      'Connection',
      'Status',
      'How barsy data is read',
      'Sync everything',
      'Sync history',
    ])
  })

  it('shows the status and which venues use the connection', () => {
    panel()
    expect(screen.getByTestId('instance-status').getAttribute('data-status')).toBe('connected')
    expect(screen.getByTestId('instance-venues').textContent).toBe(
      'Used by 1 venue: Demo Club Sofia.',
    )
    expect(screen.getByTestId('credentials-saved')).toBeTruthy()
  })

  it('says when no venue uses it yet', () => {
    panel({ venues: [] })
    expect(screen.getByTestId('instance-venues').textContent).toBe(
      'No venue uses this connection yet.',
    )
  })

  it('draws the connector’s system settings card and nothing else of its own (barsy: allergens and language)', () => {
    panel()
    expect(screen.getByRole('combobox', { name: 'Allergen characteristic' })).toBeTruthy()
    expect(screen.getByRole('combobox', { name: 'Language of untagged text' })).toBeTruthy()
    // Not the schedule, the rollback pause or the price: those are each venue’s (D82).
    expect(screen.queryByRole('switch')).toBeNull()
    expect(screen.queryByText(/Check for changes automatically/)).toBeNull()
    expect(screen.queryByRole('radio')).toBeNull()
  })

  it('draws no settings card for a kind that supplies none', () => {
    panel({ kind: 'unknown', source: 'Unknown POS' })
    expect(screen.queryByRole('combobox', { name: 'Allergen characteristic' })).toBeNull()
    expect(screen.getByText('Sync everything')).toBeTruthy()
  })

  it('keeps the run history collapsed: one line with the last run', () => {
    panel({ runs: [run(), run({ id: 'jb_b' })] })
    expect(screen.getByTestId('history-last').textContent).toMatch(/^Last run: Full sync/)
    expect(screen.queryAllByTestId('run-row')).toHaveLength(0)
  })

  it('names a new instance that has no credentials yet and shows its form', () => {
    renderWithIntl(<InstancePanel instance={newInstanceView()} canManage sealReady />)
    expect(screen.getByTestId('connect-form')).toBeTruthy()
    expect(screen.getByTestId('instance-status').getAttribute('data-status')).toBe('new')
  })

  describe('"Remove"', () => {
    it('asks first, then removes the instance by its id', async () => {
      const user = userEvent.setup()
      actions.removeInstanceAction.mockResolvedValue({ ok: true })
      panel()
      await user.click(screen.getByRole('button', { name: 'Remove' }))
      const dialog = await screen.findByTestId('remove-dialog')
      expect(within(dialog).getByRole('heading', { name: 'Remove “barsy – Sofia”?' })).toBeTruthy()
      expect(dialog.textContent).toContain('Its credentials and history are kept.')
      expect(actions.removeInstanceAction).not.toHaveBeenCalled()

      await user.click(within(dialog).getByRole('button', { name: 'Remove connection' }))
      expect(actions.removeInstanceAction).toHaveBeenCalledWith({ integrationId: INSTANCE_ID })
      await waitFor(() => expect(screen.queryByTestId('remove-dialog')).toBeNull())
    })

    it('is refused with a sentence while venues use the instance, and the dialog stays open', async () => {
      const user = userEvent.setup()
      actions.removeInstanceAction.mockResolvedValue({ ok: false, error: 'has_venues' })
      panel()
      await user.click(screen.getByRole('button', { name: 'Remove' }))
      const dialog = await screen.findByTestId('remove-dialog')
      await user.click(within(dialog).getByRole('button', { name: 'Remove connection' }))
      expect((await within(dialog).findByRole('alert')).textContent).toBe(
        'Venues still use this connection. Delete those venues first, then remove the connection.',
      )
      expect(screen.getByTestId('remove-dialog')).toBeTruthy()
    })

    it('cancel closes it and removes nothing', async () => {
      const user = userEvent.setup()
      panel()
      await user.click(screen.getByRole('button', { name: 'Remove' }))
      const dialog = await screen.findByTestId('remove-dialog')
      await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))
      await waitFor(() => expect(screen.queryByTestId('remove-dialog')).toBeNull())
      expect(actions.removeInstanceAction).not.toHaveBeenCalled()
    })

    it('is for managers only', () => {
      panel({}, false)
      expect(screen.queryByRole('button', { name: 'Remove' })).toBeNull()
    })
  })

  it('speaks Bulgarian', () => {
    panel({}, true, 'bg')
    expect(screen.getByRole('button', { name: 'Премахни' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Как се четат данните от barsy' })).toBeTruthy()
    expect(screen.getByTestId('instance-venues').textContent).toBe(
      'Ползва се от 1 заведение: Demo Club Sofia.',
    )
  })
})
