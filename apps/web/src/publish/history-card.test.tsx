// @vitest-environment jsdom
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { renderWithIntl } from '@/test-utils'
import { HistoryCard } from './history-card'
import { entry, publishView } from './test-view'

const actions = vi.hoisted(() => ({ loadHistoryPageAction: vi.fn() }))
vi.mock('@/server/publish/actions', () => actions)

beforeEach(() => {
  actions.loadHistoryPageAction.mockReset()
})

const render = (
  view = publishView(),
  returnTo: (snapshotId: string, version: number) => Promise<boolean> = vi.fn(async () => true),
  busy = false,
) => {
  renderWithIntl(<HistoryCard view={view} busy={busy} returnTo={returnTo} />)
  return returnTo
}

const rows = () => screen.getAllByTestId('history-row')

describe('the History card', () => {
  it('lists the versions newest first, marks the live one, and says what each changed', () => {
    render()
    expect(rows().map((row) => row.getAttribute('data-version'))).toEqual(['2', '1'])
    const [second, first] = rows() as [HTMLElement, HTMLElement]
    expect(within(second).getByText('Live')).toBeTruthy()
    expect(within(second).getByTestId('history-what').textContent).toBe('1 with a new price')
    expect(second.textContent).toContain('Published by hand')
    expect(second.textContent).toContain('Maria Ivanova')
    expect(within(first).getByTestId('history-what').textContent).toBe('First version')
    // Dates are the venue's: 10:00 UTC on 2 Oct is 13:00 in Sofia.
    expect(first.textContent).toMatch(/13:00/)
  })

  it('offers "Return to this version" on every other published version, and not on the live one', () => {
    render()
    const [second, first] = rows() as [HTMLElement, HTMLElement]
    expect(within(second).queryByRole('button', { name: 'Return to this version' })).toBeNull()
    expect(within(first).getByRole('button', { name: 'Return to this version' })).toBeTruthy()
  })

  it('asks first, then returns to that version and closes', async () => {
    const user = userEvent.setup()
    const returnTo = render()
    await user.click(screen.getByRole('button', { name: 'Return to this version' }))
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByText('Return to version 1?')).toBeTruthy()
    expect(
      within(dialog).getByText(/Automatic publishing is paused until you publish/),
    ).toBeTruthy()
    expect(returnTo).not.toHaveBeenCalled()

    await user.click(within(dialog).getByRole('button', { name: 'Return to version 1' }))
    expect(returnTo).toHaveBeenCalledWith('sn_version1', 1)
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it('cancelling returns nothing', async () => {
    const user = userEvent.setup()
    const returnTo = render()
    await user.click(screen.getByRole('button', { name: 'Return to this version' }))
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel' }))
    expect(returnTo).not.toHaveBeenCalled()
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('shows a return as a row of its own, and a held or rejected publish as what it was', () => {
    render(
      publishView({
        live: {
          ...(publishView().live as NonNullable<ReturnType<typeof publishView>['live']>),
          version: 1,
        },
        history: {
          entries: [
            entry(5, { reason: 'rollback', restoresVersion: 1 }),
            entry(4, {
              status: 'rejected',
              reason: 'auto_sync',
              actor: { kind: 'sync' },
              held: { hidden: 3, previouslyVisible: 5 },
            }),
            entry(3, {
              status: 'rejected',
              reason: 'auto_sync',
              actor: { kind: 'sync' },
              decisionNote: 'superseded',
            }),
            entry(2, { reason: 'auto_sync', actor: { kind: 'sync' } }),
            entry(1, { first: true }),
          ],
          nextBeforeVersion: null,
        },
      }),
    )
    const byVersion = (version: number) =>
      rows().find((row) => row.getAttribute('data-version') === String(version)) as HTMLElement
    expect(within(byVersion(5)).getByTestId('history-what').textContent).toBe(
      'Returned to version 1',
    )
    expect(byVersion(5).textContent).not.toContain('Published by hand')
    expect(within(byVersion(4)).getByText('Rejected')).toBeTruthy()
    expect(within(byVersion(4)).getByTestId('history-what').textContent).toBe(
      'Would have hidden 3 of 5 items',
    )
    expect(within(byVersion(3)).getByText('Replaced by a later publish')).toBeTruthy()
    expect(byVersion(2).textContent).toContain('barsy sync')
    // Only the published versions with a body can be returned to; the live one (1) cannot.
    expect(screen.getAllByRole('button', { name: 'Return to this version' })).toHaveLength(1)
    expect(
      within(byVersion(2)).getByRole('button', { name: 'Return to this version' }),
    ).toBeTruthy()
    expect(within(byVersion(1)).getByText('Live')).toBeTruthy()
  })

  it('has no Return buttons for anyone who may not publish, or while something is happening', () => {
    const { unmount } = renderWithIntl(
      <HistoryCard view={publishView({ canPublish: false })} busy={false} returnTo={vi.fn()} />,
    )
    expect(screen.queryByRole('button', { name: 'Return to this version' })).toBeNull()
    unmount()
    render(publishView(), undefined, true)
    expect(
      (screen.getByRole('button', { name: 'Return to this version' }) as HTMLButtonElement)
        .disabled,
    ).toBe(true)
  })

  it('loads the next, older page on request and keeps going until there is none', async () => {
    const user = userEvent.setup()
    actions.loadHistoryPageAction.mockResolvedValue({
      ok: true,
      page: { entries: [entry(1, { first: true })], nextBeforeVersion: null },
    })
    render(
      publishView({
        history: { entries: [entry(3), entry(2)], nextBeforeVersion: 2 },
        live: {
          ...(publishView().live as NonNullable<ReturnType<typeof publishView>['live']>),
          version: 3,
        },
      }),
    )
    expect(rows()).toHaveLength(2)
    await user.click(screen.getByRole('button', { name: 'Show older versions' }))
    expect(actions.loadHistoryPageAction).toHaveBeenCalledWith('vn_demoVenueForPublishTests', 2)
    await waitFor(() => expect(rows()).toHaveLength(3))
    expect(rows().map((row) => row.getAttribute('data-version'))).toEqual(['3', '2', '1'])
    expect(screen.queryByRole('button', { name: 'Show older versions' })).toBeNull()
  })

  it('says so when older versions cannot be loaded, and lets the person try again', async () => {
    const user = userEvent.setup()
    actions.loadHistoryPageAction.mockResolvedValue({ ok: false })
    render(publishView({ history: { entries: [entry(2)], nextBeforeVersion: 2 } }))
    await user.click(screen.getByRole('button', { name: 'Show older versions' }))
    expect(await screen.findByText('Older versions could not be loaded. Try again.')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Show older versions' })).toBeTruthy()
  })

  it('says nothing has been published when there is no history', () => {
    render(publishView({ live: null, history: { entries: [], nextBeforeVersion: null } }))
    expect(screen.getByTestId('history-empty').textContent).toBe('Nothing has been published yet.')
  })
})
