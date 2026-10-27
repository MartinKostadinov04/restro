// @vitest-environment jsdom
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import { renderWithIntl } from '@/test-utils'

import { LogExport } from './log-export'

const VENUE = 'vn_0000000000000000000001'

describe('Tonight › Log › Export (#87)', () => {
  it('opens with the last 7 nights and two downloads, one CSV each', async () => {
    const user = userEvent.setup()
    renderWithIntl(<LogExport venueId={VENUE} today="2026-10-27" />)
    await user.click(screen.getByTestId('log-export'))
    expect((screen.getByLabelText('From') as HTMLInputElement).value).toBe('2026-10-21')
    expect((screen.getByLabelText('To') as HTMLInputElement).value).toBe('2026-10-27')
    expect(screen.getByTestId('export-sent').getAttribute('href')).toBe(
      `/api/venues/${VENUE}/export?kind=sent&from=2026-10-21&to=2026-10-27`,
    )
    expect(screen.getByTestId('export-log').getAttribute('href')).toBe(
      `/api/venues/${VENUE}/export?kind=log&from=2026-10-21&to=2026-10-27`,
    )
    expect(screen.getByRole('link', { name: 'Download sent orders' })).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Download the Log' })).toBeTruthy()
    expect(
      screen.getByText(
        'Night details are kept 31 days; sent orders, settings and staff changes 18 months.',
      ),
    ).toBeTruthy()
  })

  it('follows the dates the owner picks', async () => {
    const user = userEvent.setup()
    renderWithIntl(<LogExport venueId={VENUE} today="2026-10-27" />)
    await user.click(screen.getByTestId('log-export'))
    const from = screen.getByLabelText('From')
    await user.clear(from)
    await user.type(from, '2026-09-01')
    expect(screen.getByTestId('export-log').getAttribute('href')).toContain(
      'from=2026-09-01&to=2026-10-27',
    )
  })

  it('offers no download for a range that is backwards', async () => {
    const user = userEvent.setup()
    renderWithIntl(<LogExport venueId={VENUE} today="2026-10-27" />)
    await user.click(screen.getByTestId('log-export'))
    const to = screen.getByLabelText('To')
    await user.clear(to)
    await user.type(to, '2026-10-01')
    expect(screen.getByRole('alert').textContent).toBe('From must not be after To.')
    expect(screen.queryByTestId('export-sent')).toBeNull()
    expect(
      (screen.getByRole('button', { name: 'Download sent orders' }) as HTMLButtonElement).disabled,
    ).toBe(true)
  })

  it('writes the same in Bulgarian', async () => {
    const user = userEvent.setup()
    renderWithIntl(<LogExport venueId={VENUE} today="2026-10-27" />, { locale: 'bg' })
    await user.click(screen.getByTestId('log-export'))
    expect(screen.getByRole('link', { name: 'Изтегли поръчките' })).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Изтегли дневника' })).toBeTruthy()
  })
})
