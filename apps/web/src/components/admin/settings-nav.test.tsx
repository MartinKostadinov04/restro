// @vitest-environment jsdom
// The sub-navigation and the breadcrumb of the organisation's Settings area: both are drawn from
// the one list of sections, and the open section comes from the URL.
import { screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { SidebarProvider } from '@/components/ui/sidebar'
import { renderWithIntl } from '@/test-utils'

import { SettingsHeader } from './settings-header'
import { SettingsNav } from './settings-nav'
import {
  SETTINGS_SECTIONS,
  settingsSectionOf,
  settingsSectionPath,
  visibleSettingsSections,
} from './settings-sections'

const navigation = vi.hoisted(() => ({ pathname: '/settings/integrations' }))

vi.mock('next/navigation', () => ({ usePathname: () => navigation.pathname }))

describe('the Settings sections', () => {
  it('start with General, at /settings/general, then Integrations and Deleted venues (D91, D76)', () => {
    expect(SETTINGS_SECTIONS.map(settingsSectionPath)).toEqual([
      '/settings/general',
      '/settings/integrations',
      '/settings/deleted-venues',
    ])
  })

  it('keep Deleted venues for owners: everyone else is not offered it', () => {
    expect(visibleSettingsSections(true).map((section) => section.value)).toEqual([
      'general',
      'integrations',
      'deleted-venues',
    ])
    expect(visibleSettingsSections(false).map((section) => section.value)).toEqual([
      'general',
      'integrations',
    ])
  })

  it('own their path and anything below it, and nothing else', () => {
    expect(settingsSectionOf('/settings/general')?.value).toBe('general')
    expect(settingsSectionOf('/settings/integrations')?.value).toBe('integrations')
    expect(settingsSectionOf('/settings/integrations/barsy')?.value).toBe('integrations')
    expect(settingsSectionOf('/settings')).toBeUndefined()
    expect(settingsSectionOf('/settings/integrationsx')).toBeUndefined()
  })
})

describe('SettingsNav', () => {
  it('draws one link per section, the open one marked as the current page', () => {
    navigation.pathname = '/settings/integrations'
    renderWithIntl(<SettingsNav />)
    const nav = screen.getByRole('navigation', { name: 'Settings sections' })
    const links = within(nav).getAllByRole('link')
    expect(links.map((link) => link.textContent)).toEqual(['General', 'Integrations'])
    expect(links[0]?.getAttribute('href')).toBe('/settings/general')
    expect(links[0]?.getAttribute('aria-current')).toBeNull()
    expect(links[1]?.getAttribute('href')).toBe('/settings/integrations')
    expect(links[1]?.getAttribute('aria-current')).toBe('page')
  })

  it('draws Deleted venues for an owner only', () => {
    navigation.pathname = '/settings/deleted-venues'
    const { unmount } = renderWithIntl(<SettingsNav isOwner />)
    const nav = screen.getByRole('navigation', { name: 'Settings sections' })
    const links = within(nav).getAllByRole('link')
    expect(links.map((link) => link.textContent)).toEqual([
      'General',
      'Integrations',
      'Deleted venues',
    ])
    expect(links[2]?.getAttribute('href')).toBe('/settings/deleted-venues')
    expect(links[2]?.getAttribute('aria-current')).toBe('page')
    unmount()

    renderWithIntl(<SettingsNav />)
    expect(screen.queryByRole('link', { name: 'Deleted venues' })).toBeNull()
  })

  it('is in Bulgarian for the owner too', () => {
    navigation.pathname = '/settings/integrations'
    renderWithIntl(<SettingsNav isOwner />, { locale: 'bg' })
    expect(screen.getByRole('link', { name: 'Изтрити заведения' })).toBeTruthy()
  })

  it('marks no section as open on a path that belongs to none', () => {
    navigation.pathname = '/settings'
    renderWithIntl(<SettingsNav />)
    expect(
      screen.getByRole('link', { name: 'Integrations' }).getAttribute('aria-current'),
    ).toBeNull()
  })

  it('is in Bulgarian when the interface is', () => {
    navigation.pathname = '/settings/integrations'
    renderWithIntl(<SettingsNav />, { locale: 'bg' })
    expect(screen.getByRole('navigation', { name: 'Раздели на настройките' })).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Интеграции' })).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Общи' })).toBeTruthy()
  })
})

describe('SettingsHeader', () => {
  function header() {
    return renderWithIntl(
      <SidebarProvider>
        <SettingsHeader />
      </SidebarProvider>,
    )
  }

  it('shows "Settings › Integrations" on the Integrations page, Settings linking to /settings', () => {
    navigation.pathname = '/settings/integrations'
    header()
    const trail = screen.getByRole('navigation', { name: 'Breadcrumb' })
    expect(within(trail).getByRole('link', { name: 'Settings' }).getAttribute('href')).toBe(
      '/settings',
    )
    expect(within(trail).getByText('Integrations').getAttribute('aria-current')).toBe('page')
  })

  it('shows "Settings › General" on the General page', () => {
    navigation.pathname = '/settings/general'
    header()
    const trail = screen.getByRole('navigation', { name: 'Breadcrumb' })
    expect(within(trail).getByRole('link', { name: 'Settings' }).getAttribute('href')).toBe(
      '/settings',
    )
    expect(within(trail).getByText('General').getAttribute('aria-current')).toBe('page')
  })

  it('shows "Settings › Deleted venues" on that page', () => {
    navigation.pathname = '/settings/deleted-venues'
    header()
    const trail = screen.getByRole('navigation', { name: 'Breadcrumb' })
    expect(within(trail).getByText('Deleted venues').getAttribute('aria-current')).toBe('page')
  })

  it('shows just "Settings" where no section is open', () => {
    navigation.pathname = '/settings'
    header()
    const trail = screen.getByRole('navigation', { name: 'Breadcrumb' })
    expect(within(trail).queryByRole('link')).toBeNull()
    expect(within(trail).getByText('Settings').getAttribute('aria-current')).toBe('page')
  })
})
