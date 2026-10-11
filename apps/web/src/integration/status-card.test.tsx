// @vitest-environment jsdom
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { IntegrationInfo } from '@/server/integration/view'
import { renderWithIntl } from '@/test-utils'
import { StatusCard } from './status-card'
import { emptyView, integrationView } from './test-view'

const actions = vi.hoisted(() => ({ checkConnectionAction: vi.fn() }))
vi.mock('@/server/integration/actions', () => actions)

beforeEach(() => {
  actions.checkConnectionAction.mockReset()
})

const withIntegration = (change: Partial<IntegrationInfo>) =>
  integrationView({
    integration: {
      host: 'demo.barsyonline.com',
      hasCredentials: true,
      status: 'connected',
      statusDetail: null,
      lastCheckedAt: '2026-10-09T10:00:00.000Z',
      ...change,
    },
  })

describe('the Status card', () => {
  it.each([
    ['new', 'Not checked yet'],
    ['connected', 'Connected'],
    ['error', 'Connection problem'],
  ] as const)('shows status %s as "%s"', (status, text) => {
    renderWithIntl(<StatusCard view={withIntegration({ status })} />)
    const badge = screen.getByTestId('status-badge')
    expect(badge.textContent).toBe(text)
    expect(badge.getAttribute('data-status')).toBe(status)
  })

  it('shows the address and the last check in the integration’s time zone', () => {
    renderWithIntl(<StatusCard view={integrationView()} />)
    expect(screen.getByText('demo.barsyonline.com')).toBeTruthy()
    // 10:00 UTC on 9 October is 13:00 in Sofia (UTC+3).
    expect(screen.getByTestId('status-details').textContent).toMatch(/13:00/)
  })

  it('uses the integration’s clock whatever the browser’s', () => {
    renderWithIntl(<StatusCard view={integrationView({ timeZone: 'America/New_York' })} />)
    // 10:00 UTC is 06:00 in New York (UTC-4 in October).
    expect(screen.getByTestId('status-details').textContent).toMatch(/06:00/)
  })

  it('says "Never" when it has not been checked', () => {
    renderWithIntl(<StatusCard view={withIntegration({ status: 'new', lastCheckedAt: null })} />)
    expect(screen.getByText('Never')).toBeTruthy()
  })

  it('shows the detail, translating the worker’s status code for rejected credentials', () => {
    const { unmount } = renderWithIntl(
      <StatusCard view={withIntegration({ status: 'error', statusDetail: 'wrong_credentials' })} />,
      { locale: 'bg' },
    )
    expect(screen.getByTestId('status-detail').textContent).toBe('Грешен потребител или парола.')
    unmount()
    renderWithIntl(
      <StatusCard
        view={withIntegration({ status: 'error', statusDetail: 'This barsy host is not allowed.' })}
      />,
    )
    expect(screen.getByTestId('status-detail').textContent).toBe('This barsy host is not allowed.')
  })

  it.each([
    ['wrong_credentials', 'Wrong user or password.'],
    ['host_refused', 'This barsy address is not allowed.'],
    ['credentials_unreadable', 'The saved credentials cannot be read. Enter them again.'],
  ])('translates the status code %s', (code, text) => {
    renderWithIntl(<StatusCard view={withIntegration({ status: 'error', statusDetail: code })} />)
    expect(screen.getByTestId('status-detail').textContent).toBe(text)
  })

  it('says when there is nothing to connect yet', () => {
    renderWithIntl(<StatusCard view={emptyView()} />)
    expect(screen.getByTestId('status-none').textContent).toBe('Not connected to barsy yet.')
    expect(screen.queryByRole('button', { name: 'Check again' })).toBeNull()
  })

  it('shows what is queued or running, and offers no new check meanwhile', () => {
    const { unmount } = renderWithIntl(
      <StatusCard view={integrationView({ activeJob: 'connect' })} />,
    )
    expect(screen.getByTestId('status-active').textContent).toBe('Checking the connection…')
    expect(screen.queryByRole('button', { name: 'Check again' })).toBeNull()
    unmount()
    renderWithIntl(<StatusCard view={integrationView({ activeJob: 'pull' })} />)
    expect(screen.getByTestId('status-active').textContent).toBe('A sync is queued or running…')
  })

  it('"Check again" queues the check for managers only', async () => {
    const user = userEvent.setup()
    actions.checkConnectionAction.mockResolvedValue({ ok: true, queued: true })
    const { unmount } = renderWithIntl(<StatusCard view={integrationView()} />)
    await user.click(screen.getByRole('button', { name: 'Check again' }))
    expect(actions.checkConnectionAction).toHaveBeenCalledWith()
    await waitFor(() => expect(screen.getByText('The connection check is queued.')).toBeTruthy())
    unmount()

    renderWithIntl(<StatusCard view={integrationView({ canManage: false })} />)
    expect(screen.queryByRole('button', { name: 'Check again' })).toBeNull()
  })

  it('shows why a check could not be queued', async () => {
    const user = userEvent.setup()
    actions.checkConnectionAction.mockResolvedValue({ ok: false, error: 'queue_unavailable' })
    renderWithIntl(<StatusCard view={integrationView()} />)
    await user.click(screen.getByRole('button', { name: 'Check again' }))
    expect((await screen.findByRole('alert')).textContent).toContain('could not be reached')
  })

  it('shows the currency warning on a connection that works, in both languages', () => {
    const { unmount } = renderWithIntl(
      <StatusCard
        view={withIntegration({ status: 'connected', statusDetail: 'currency_not_eur' })}
      />,
    )
    expect(screen.getByTestId('status-badge').getAttribute('data-status')).toBe('connected')
    const detail = screen.getByTestId('status-detail')
    expect(detail.textContent).toBe(
      "The till's main currency is not EUR; Restro shows prices in EUR only.",
    )
    expect(detail.getAttribute('data-level')).toBe('warning')
    unmount()
    renderWithIntl(
      <StatusCard
        view={withIntegration({ status: 'connected', statusDetail: 'currency_not_eur' })}
      />,
      { locale: 'bg' },
    )
    expect(screen.getByTestId('status-detail').textContent).toBe(
      'Основната валута на касата не е EUR; Restro показва цените само в EUR.',
    )
  })

  it('marks a connection problem as a problem, not a warning', () => {
    renderWithIntl(
      <StatusCard view={withIntegration({ status: 'error', statusDetail: 'wrong_credentials' })} />,
    )
    expect(screen.getByTestId('status-detail').getAttribute('data-level')).toBe('problem')
  })

  describe('the warnings: a held full sync names the venue it concerns', () => {
    const held = (
      venue: { id: string; name: string } | null,
      reason: 'too_many_missing' | 'empty_read' = 'too_many_missing',
    ) => ({
      reason,
      wouldHide: 61,
      active: 65,
      finishedAt: '2026-10-09T10:00:00.000Z',
      venue,
    })

    it('shows one warning per venue, with the numbers', () => {
      renderWithIntl(
        <StatusCard
          view={integrationView({
            heldSyncs: [
              held({ id: 'vn_a', name: 'Main bar' }),
              held({ id: 'vn_b', name: 'Roof' }, 'empty_read'),
            ],
          })}
        />,
      )
      const warnings = screen.getAllByTestId('sync-held')
      expect(warnings).toHaveLength(2)
      expect(warnings[0]?.textContent).toContain('The last full sync of Main bar was held back')
      expect(warnings[0]?.textContent).toContain('it would have hidden 61 of 65 items')
      expect(warnings[0]?.getAttribute('data-reason')).toBe('too_many_missing')
      expect(warnings[1]?.textContent).toContain('The last full sync of Roof was held back')
      expect(warnings[1]?.getAttribute('data-reason')).toBe('empty_read')
    })

    it('says so without a venue for an older run that names none, and shows nothing when none was held', () => {
      const { unmount } = renderWithIntl(
        <StatusCard view={integrationView({ heldSyncs: [held(null)] })} />,
      )
      expect(screen.getByTestId('sync-held').textContent).toContain(
        'The last full sync was held back',
      )
      unmount()
      renderWithIntl(<StatusCard view={integrationView()} />)
      expect(screen.queryByTestId('sync-held')).toBeNull()
    })

    it('speaks Bulgarian', () => {
      renderWithIntl(
        <StatusCard
          view={integrationView({ heldSyncs: [held({ id: 'vn_a', name: 'Main bar' })] })}
        />,
        { locale: 'bg' },
      )
      expect(screen.getByTestId('sync-held').textContent).toContain(
        'Последната пълна синхронизация на Main bar е задържана',
      )
    })
  })
})
