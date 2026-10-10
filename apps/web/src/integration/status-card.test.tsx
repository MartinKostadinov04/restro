// @vitest-environment jsdom
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { IntegrationInfo } from '@/server/integration/view'
import { renderWithIntl } from '@/test-utils'
import { StatusCard } from './status-card'
import { emptyView, integrationView, VENUE_ID } from './test-view'

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
    renderWithIntl(<StatusCard venueId={VENUE_ID} view={withIntegration({ status })} />)
    const badge = screen.getByTestId('status-badge')
    expect(badge.textContent).toBe(text)
    expect(badge.getAttribute('data-status')).toBe(status)
  })

  it('shows the address and the last check in the venue’s time zone', () => {
    renderWithIntl(<StatusCard venueId={VENUE_ID} view={integrationView()} />)
    expect(screen.getByText('demo.barsyonline.com')).toBeTruthy()
    // 10:00 UTC on 9 October is 13:00 in Sofia (UTC+3).
    expect(screen.getByTestId('status-details').textContent).toMatch(/13:00/)
  })

  it('uses the venue’s clock whatever the browser’s', () => {
    renderWithIntl(
      <StatusCard venueId={VENUE_ID} view={integrationView({ timeZone: 'America/New_York' })} />,
    )
    // 10:00 UTC is 06:00 in New York (UTC-4 in October).
    expect(screen.getByTestId('status-details').textContent).toMatch(/06:00/)
  })

  it('says "Never" when it has not been checked', () => {
    renderWithIntl(
      <StatusCard
        venueId={VENUE_ID}
        view={withIntegration({ status: 'new', lastCheckedAt: null })}
      />,
    )
    expect(screen.getByText('Never')).toBeTruthy()
  })

  it('shows the detail, translating the worker’s status code for rejected credentials', () => {
    const { unmount } = renderWithIntl(
      <StatusCard
        venueId={VENUE_ID}
        view={withIntegration({ status: 'error', statusDetail: 'wrong_credentials' })}
      />,
      { locale: 'bg' },
    )
    expect(screen.getByTestId('status-detail').textContent).toBe('Грешен потребител или парола.')
    unmount()
    renderWithIntl(
      <StatusCard
        venueId={VENUE_ID}
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
    renderWithIntl(
      <StatusCard
        venueId={VENUE_ID}
        view={withIntegration({ status: 'error', statusDetail: code })}
      />,
    )
    expect(screen.getByTestId('status-detail').textContent).toBe(text)
  })

  it('says when there is nothing to connect yet', () => {
    renderWithIntl(<StatusCard venueId={VENUE_ID} view={emptyView()} />)
    expect(screen.getByTestId('status-none').textContent).toBe('Not connected to barsy yet.')
    expect(screen.queryByRole('button', { name: 'Check again' })).toBeNull()
  })

  it('shows what is queued or running, and offers no new check meanwhile', () => {
    const { unmount } = renderWithIntl(
      <StatusCard venueId={VENUE_ID} view={integrationView({ activeJob: 'connect' })} />,
    )
    expect(screen.getByTestId('status-active').textContent).toBe('Checking the connection…')
    expect(screen.queryByRole('button', { name: 'Check again' })).toBeNull()
    unmount()
    renderWithIntl(<StatusCard venueId={VENUE_ID} view={integrationView({ activeJob: 'pull' })} />)
    expect(screen.getByTestId('status-active').textContent).toBe('A sync is queued or running…')
  })

  it('"Check again" queues the check for managers only', async () => {
    const user = userEvent.setup()
    actions.checkConnectionAction.mockResolvedValue({ ok: true, queued: true })
    const { unmount } = renderWithIntl(<StatusCard venueId={VENUE_ID} view={integrationView()} />)
    await user.click(screen.getByRole('button', { name: 'Check again' }))
    expect(actions.checkConnectionAction).toHaveBeenCalledWith({ venueId: VENUE_ID })
    await waitFor(() => expect(screen.getByText('The connection check is queued.')).toBeTruthy())
    unmount()

    renderWithIntl(<StatusCard venueId={VENUE_ID} view={integrationView({ canManage: false })} />)
    expect(screen.queryByRole('button', { name: 'Check again' })).toBeNull()
  })

  it('shows why a check could not be queued', async () => {
    const user = userEvent.setup()
    actions.checkConnectionAction.mockResolvedValue({ ok: false, error: 'queue_unavailable' })
    renderWithIntl(<StatusCard venueId={VENUE_ID} view={integrationView()} />)
    await user.click(screen.getByRole('button', { name: 'Check again' }))
    expect((await screen.findByRole('alert')).textContent).toContain('could not be reached')
  })
})
