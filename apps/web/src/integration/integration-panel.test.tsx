// @vitest-environment jsdom
import { screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { renderWithIntl } from '@/test-utils'

import { IntegrationPanel } from './integration-panel'
import { emptyView, integrationView, run, VENUE_ID } from './test-view'

vi.mock('@/server/integration/actions', () => ({
  saveConnectionAction: vi.fn(),
  checkConnectionAction: vi.fn(),
  chooseBarsyVenueAction: vi.fn(),
  chooseCatalogueRootAction: vi.fn(),
  saveMappingSettingsAction: vi.fn(),
  syncNowAction: vi.fn(),
}))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }))

const sectionTitles = () =>
  screen.getAllByRole('heading', { level: 3 }).map((heading) => heading.textContent)

describe('the Integration tab', () => {
  it('draws the cards in the order a manager works through them', () => {
    renderWithIntl(
      <IntegrationPanel venueId={VENUE_ID} view={integrationView({ runs: [run()] })} />,
    )
    expect(sectionTitles()).toEqual([
      'Connection',
      'Status',
      'barsy venue',
      'Menu catalogue',
      'Mapping settings',
      'Sync',
      'Sync history',
    ])
    expect(screen.queryByTestId('read-only')).toBeNull()
  })

  it('tells someone who cannot manage that they only see the status and the history', () => {
    renderWithIntl(
      <IntegrationPanel
        venueId={VENUE_ID}
        view={integrationView({
          canManage: false,
          gate: { enabled: false, reason: 'not_manager' },
        })}
      />,
    )
    expect(screen.getByTestId('read-only').textContent).toContain('Only owners and admins')
    expect(screen.queryByRole('button', { name: 'Change credentials' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Check again' })).toBeNull()
    expect((screen.getByRole('button', { name: 'Sync now' }) as HTMLButtonElement).disabled).toBe(
      true,
    )
  })

  it('a venue nobody connected yet starts with the connection form and an empty history', () => {
    renderWithIntl(<IntegrationPanel venueId={VENUE_ID} view={emptyView()} />)
    expect(screen.getByLabelText('Password')).toBeTruthy()
    expect(screen.getByText('No sync yet')).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Sync now' }) as HTMLButtonElement).disabled).toBe(
      true,
    )
  })

  it('draws everything in Bulgarian', () => {
    renderWithIntl(<IntegrationPanel venueId={VENUE_ID} view={integrationView()} />, {
      locale: 'bg',
    })
    expect(sectionTitles()).toEqual([
      'Връзка',
      'Състояние',
      'Заведение в barsy',
      'Каталог на менюто',
      'Настройки на съответствието',
      'Синхронизация',
      'История на синхронизациите',
    ])
  })
})
