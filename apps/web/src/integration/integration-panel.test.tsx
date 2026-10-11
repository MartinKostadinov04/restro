// @vitest-environment jsdom
import { screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { renderWithIntl } from '@/test-utils'

import { IntegrationPanel } from './integration-panel'
import { emptyView, integrationView, run } from './test-view'

vi.mock('@/server/integration/actions', () => ({
  saveConnectionAction: vi.fn(),
  checkConnectionAction: vi.fn(),
  addTillVenueAsVenueAction: vi.fn(),
  linkTillVenueAction: vi.fn(),
  markTillVenueAction: vi.fn(),
  saveMappingSettingsAction: vi.fn(),
  saveSyncSettingsAction: vi.fn(),
  syncAllAction: vi.fn(),
}))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}))

const sectionTitles = () =>
  screen.getAllByRole('heading', { level: 3 }).map((heading) => heading.textContent)

describe('Settings -> Integrations', () => {
  it('draws the cards in the order a manager works through them', () => {
    renderWithIntl(<IntegrationPanel view={integrationView({ runs: [run()] })} />)
    expect(sectionTitles()).toEqual([
      'Connection',
      'Status',
      'Venues in barsy',
      'How barsy data is read',
      'Automatic sync',
      'Sync history',
    ])
    expect(screen.queryByTestId('read-only')).toBeNull()
  })

  it('tells someone who cannot manage that they only see the status, the venues and the history', () => {
    renderWithIntl(
      <IntegrationPanel
        view={integrationView({
          canManage: false,
          gate: { enabled: false, reason: 'not_manager' },
        })}
      />,
    )
    expect(screen.getByTestId('read-only').textContent).toContain('Only owners and admins')
    expect(screen.queryByRole('button', { name: 'Change credentials' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Check again' })).toBeNull()
    expect(
      (screen.getByRole('button', { name: 'Sync everything now' }) as HTMLButtonElement).disabled,
    ).toBe(true)
    // The list is there to read, with nothing to press.
    expect(screen.getAllByTestId('till-venue')).toHaveLength(4)
    expect(screen.queryByRole('button', { name: 'Add as venue' })).toBeNull()
  })

  it('an organisation nobody connected yet starts with the connection form and an empty history', () => {
    renderWithIntl(<IntegrationPanel view={emptyView()} />)
    expect(screen.getByLabelText('Password')).toBeTruthy()
    expect(screen.getByText('No sync yet')).toBeTruthy()
    expect(screen.getByTestId('till-venues-empty')).toBeTruthy()
    expect(
      (screen.getByRole('button', { name: 'Sync everything now' }) as HTMLButtonElement).disabled,
    ).toBe(true)
  })

  it('draws everything in Bulgarian', () => {
    renderWithIntl(<IntegrationPanel view={integrationView()} />, { locale: 'bg' })
    expect(sectionTitles()).toEqual([
      'Връзка',
      'Състояние',
      'Заведения в barsy',
      'Как се четат данните от barsy',
      'Автоматична синхронизация',
      'История на синхронизациите',
    ])
  })
})
