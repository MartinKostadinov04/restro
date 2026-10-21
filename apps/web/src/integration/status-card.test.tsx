// @vitest-environment jsdom
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { INSTANCE_ID, instanceView } from '@/connectors/test-view'
import type { InstanceView } from '@/server/integration/view'
import { renderWithIntl } from '@/test-utils'
import { StatusCard } from './status-card'

const actions = vi.hoisted(() => ({ checkConnectionAction: vi.fn() }))
vi.mock('@/server/integration/actions', () => actions)

beforeEach(() => {
  actions.checkConnectionAction.mockReset()
})

const card = (change: Partial<InstanceView> = {}, canManage = true) =>
  renderWithIntl(<StatusCard instance={instanceView(change)} canManage={canManage} />)

describe('the Status card of an instance', () => {
  it.each([
    ['new', 'Not checked yet'],
    ['connected', 'Connected'],
    ['error', 'Connection problem'],
  ] as const)('shows status %s as "%s"', (status, text) => {
    card({ status })
    const badge = screen.getByTestId('status-badge')
    expect(badge.textContent).toBe(text)
    expect(badge.getAttribute('data-status')).toBe(status)
  })

  it('names the system in its description', () => {
    card()
    expect(
      screen.getByText('Whether Restro can reach barsy with the saved credentials.'),
    ).toBeTruthy()
  })

  it('shows the address and the last check in the instance’s time zone', () => {
    card()
    expect(screen.getByText('demo.barsyonline.com')).toBeTruthy()
    // 10:00 UTC on 9 October is 13:00 in Sofia (UTC+3).
    expect(screen.getByTestId('status-details').textContent).toMatch(/13:00/)
  })

  it('uses the instance’s clock whatever the browser’s', () => {
    card({ timeZone: 'America/New_York' })
    // 10:00 UTC is 06:00 in New York (UTC-4 in October).
    expect(screen.getByTestId('status-details').textContent).toMatch(/06:00/)
  })

  it('says "Never" when it has not been checked', () => {
    card({ status: 'new', lastCheckedAt: null })
    expect(screen.getByText('Never')).toBeTruthy()
  })

  it('shows the detail, translating the worker’s status code for rejected credentials', () => {
    const { unmount } = renderWithIntl(
      <StatusCard
        instance={instanceView({ status: 'error', statusDetail: 'wrong_credentials' })}
        canManage
      />,
      { locale: 'bg' },
    )
    expect(screen.getByTestId('status-detail').textContent).toBe('Грешен потребител или парола.')
    unmount()
    card({ status: 'error', statusDetail: 'This barsy host is not allowed.' })
    expect(screen.getByTestId('status-detail').textContent).toBe('This barsy host is not allowed.')
  })

  it.each([
    ['wrong_credentials', 'Wrong user or password.'],
    ['host_refused', 'This barsy address is not allowed.'],
    ['credentials_unreadable', 'The saved credentials cannot be read. Enter them again.'],
  ])('translates the status code %s', (code, text) => {
    card({ status: 'error', statusDetail: code })
    expect(screen.getByTestId('status-detail').textContent).toBe(text)
  })

  it('uses the instance’s own name for the system in a message that names it', () => {
    renderWithIntl(
      <StatusCard
        instance={instanceView({
          source: 'Another POS',
          status: 'error',
          statusDetail: 'host_refused',
        })}
        canManage
      />,
    )
    expect(screen.getByTestId('status-detail').textContent).toBe(
      'This Another POS address is not allowed.',
    )
  })

  it('shows what is queued or running, and offers no new check meanwhile', () => {
    const { unmount } = card({ activeJob: 'connect' })
    expect(screen.getByTestId('status-active').textContent).toBe('Checking the connection…')
    expect(screen.queryByRole('button', { name: 'Check again' })).toBeNull()
    unmount()
    card({ activeJob: 'pull' })
    expect(screen.getByTestId('status-active').textContent).toBe('A sync is queued or running…')
  })

  it('"Check again" queues the check of this instance, for managers only', async () => {
    const user = userEvent.setup()
    actions.checkConnectionAction.mockResolvedValue({ ok: true, queued: true })
    const { unmount } = card()
    await user.click(screen.getByRole('button', { name: 'Check again' }))
    expect(actions.checkConnectionAction).toHaveBeenCalledWith({ integrationId: INSTANCE_ID })
    await waitFor(() => expect(screen.getByText('The connection check is queued.')).toBeTruthy())
    unmount()

    card({}, false)
    expect(screen.queryByRole('button', { name: 'Check again' })).toBeNull()
  })

  it('offers no check for an instance without credentials', () => {
    card({ hasCredentials: false, status: 'new' })
    expect(screen.queryByRole('button', { name: 'Check again' })).toBeNull()
  })

  it('shows why a check could not be queued', async () => {
    const user = userEvent.setup()
    actions.checkConnectionAction.mockResolvedValue({ ok: false, error: 'queue_unavailable' })
    card()
    await user.click(screen.getByRole('button', { name: 'Check again' }))
    expect((await screen.findByRole('alert')).textContent).toContain('could not be reached')
  })

  it('shows the currency warning on a connection that works, in both languages', () => {
    const view = instanceView({ status: 'connected', statusDetail: 'currency_not_eur' })
    const { unmount } = renderWithIntl(<StatusCard instance={view} canManage />)
    expect(screen.getByTestId('status-badge').getAttribute('data-status')).toBe('connected')
    const detail = screen.getByTestId('status-detail')
    expect(detail.textContent).toBe(
      "The till's main currency is not EUR; Restro shows prices in EUR only.",
    )
    expect(detail.getAttribute('data-level')).toBe('warning')
    unmount()
    renderWithIntl(<StatusCard instance={view} canManage />, { locale: 'bg' })
    expect(screen.getByTestId('status-detail').textContent).toBe(
      'Основната валута на касата не е EUR; Restro показва цените само в EUR.',
    )
  })

  it('marks a connection problem as a problem, not a warning', () => {
    card({ status: 'error', statusDetail: 'wrong_credentials' })
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
      card({
        heldSyncs: [
          held({ id: 'vn_a', name: 'Main bar' }),
          held({ id: 'vn_b', name: 'Roof' }, 'empty_read'),
        ],
      })
      const warnings = screen.getAllByTestId('sync-held')
      expect(warnings).toHaveLength(2)
      expect(warnings[0]?.textContent).toContain('The last full sync of Main bar was held back')
      expect(warnings[0]?.textContent).toContain('it would have hidden 61 of 65 items')
      expect(warnings[0]?.textContent).toContain('Check the venue and its menus in barsy.')
      expect(warnings[0]?.getAttribute('data-reason')).toBe('too_many_missing')
      expect(warnings[1]?.textContent).toContain('The last full sync of Roof was held back')
      expect(warnings[1]?.getAttribute('data-reason')).toBe('empty_read')
    })

    it('says so without a venue for an older run that names none, and shows nothing when none was held', () => {
      const { unmount } = card({ heldSyncs: [held(null)] })
      expect(screen.getByTestId('sync-held').textContent).toContain(
        'The last full sync was held back',
      )
      unmount()
      card()
      expect(screen.queryByTestId('sync-held')).toBeNull()
    })

    it('speaks Bulgarian', () => {
      renderWithIntl(
        <StatusCard
          instance={instanceView({ heldSyncs: [held({ id: 'vn_a', name: 'Main bar' })] })}
          canManage
        />,
        { locale: 'bg' },
      )
      expect(screen.getByTestId('sync-held').textContent).toContain(
        'Последната пълна синхронизация на Main bar е задържана',
      )
    })
  })
})
