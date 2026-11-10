// @vitest-environment jsdom
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { renderWithIntl } from '@/test-utils'

import {
  settingsSectionOf,
  sharedDeviceTabOf,
  WORKSPACE_TAB_DEFS,
  type WorkspaceTabValue,
  workspaceTabOf,
  workspaceTabsOf,
} from './workspace-tab-defs'
import { SettingsSections, WorkspaceTabs } from './workspace-tabs'

// The tabs read and write the URL through next/navigation: replace it with a small fake.
const navigation = vi.hoisted(() => ({
  replace: vi.fn(),
  pathname: '/venues/vn_demo',
  search: '',
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: navigation.replace }),
  usePathname: () => navigation.pathname,
  useSearchParams: () => new URLSearchParams(navigation.search),
}))

const contents = Object.fromEntries(
  WORKSPACE_TAB_DEFS.map(({ value }) => [value, <p key={value}>content of {value}</p>]),
) as Record<WorkspaceTabValue, React.ReactNode>

function renderTabs() {
  return renderWithIntl(<WorkspaceTabs contents={contents} />)
}

beforeEach(() => {
  navigation.replace.mockReset()
  navigation.search = ''
})

describe('WorkspaceTabs: tabs and the URL', () => {
  it('draws the tab bar and the small-screen select from the one declared list', () => {
    renderTabs()
    const tabs = screen.getAllByRole('tab')
    // D97: no Publishing tab (the Publish button is in the header on every tab). D129: Design is
    // the Studio's subtab, not a tab of its own. #85: Tonight sits after Tables & QR.
    expect(tabs.map((tab) => tab.textContent)).toEqual([
      'Studio',
      'Tables & QR',
      'Tonight',
      'Settings',
    ])
    // The select has one entry per tab offered, labelled from the same keys. Reservations is
    // declared beside them but needs its own key (#326), so it is not one of them here.
    expect(screen.getByRole('combobox', { name: 'Switch tab' })).toBeTruthy()
    expect(tabs).toHaveLength(workspaceTabsOf().length)
    expect(WORKSPACE_TAB_DEFS.length).toBe(tabs.length + 1)
  })

  it('lists Reservations after Tonight, only for a role that may work them (#326)', () => {
    renderWithIntl(<WorkspaceTabs contents={contents} rights={{ reservations: true }} />)
    expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual([
      'Studio',
      'Tables & QR',
      'Tonight',
      'Reservations',
      'Settings',
    ])
    expect(workspaceTabOf('reservations', { reservations: true })).toBe('reservations')
  })

  it('opens the Studio on a link to Reservations without the key, rather than an empty tab', () => {
    navigation.search = 'tab=reservations'
    renderTabs()
    expect(screen.queryByRole('tab', { name: 'Reservations' })).toBeNull()
    expect(screen.getByRole('tab', { name: 'Studio' }).getAttribute('aria-selected')).toBe('true')
    expect(workspaceTabOf('reservations')).toBe('studio')
  })

  it('gives a shared device that works reservations Tonight and Reservations, nothing else', () => {
    navigation.search = 'tab=settings'
    renderWithIntl(
      <WorkspaceTabs contents={contents} sharedDevice rights={{ reservations: true }} />,
    )
    expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual([
      'Tonight',
      'Reservations',
    ])
    expect(screen.getByText('content of tonight')).toBeTruthy()
    // Two tabs fit the narrowest phone, so a device shows the row at every width and no chooser
    // at all: at the door the tab a hostess needs is one tap (RR-85, #326).
    expect(screen.queryByRole('combobox', { name: 'Switch tab' })).toBeNull()
    expect(sharedDeviceTabOf('settings', { reservations: true })).toBe('tonight')
    expect(sharedDeviceTabOf('reservations', { reservations: true })).toBe('reservations')
    expect(sharedDeviceTabOf('reservations')).toBe('tonight')
  })

  it('opens the first tab when the URL has no ?tab=', () => {
    renderTabs()
    expect(screen.getByRole('tab', { name: 'Studio' }).getAttribute('aria-selected')).toBe('true')
    expect(screen.getByText('content of studio')).toBeTruthy()
    expect(screen.queryByText('content of settings')).toBeNull()
  })

  it('opens the tab named in ?tab= (a reload keeps the tab)', () => {
    navigation.search = 'tab=tables'
    renderTabs()
    expect(screen.getByRole('tab', { name: 'Tables & QR' }).getAttribute('aria-selected')).toBe(
      'true',
    )
    expect(screen.getByText('content of tables')).toBeTruthy()
  })

  it('opens Settings for an old ?tab=publishing link: the Publishing tab is gone (D97)', () => {
    navigation.search = 'tab=publishing'
    renderTabs()
    expect(screen.getByRole('tab', { name: 'Settings' }).getAttribute('aria-selected')).toBe('true')
    expect(screen.queryByRole('tab', { name: 'Publishing' })).toBeNull()
    expect(workspaceTabOf('publishing')).toBe('settings')
  })

  it('opens the Studio for an old ?tab=composer or ?tab=design link (D129)', () => {
    expect(workspaceTabOf('composer')).toBe('studio')
    expect(workspaceTabOf('design')).toBe('studio')
    navigation.search = 'tab=design'
    renderTabs()
    expect(screen.getByRole('tab', { name: 'Studio' }).getAttribute('aria-selected')).toBe('true')
    expect(screen.queryByRole('tab', { name: 'Design' })).toBeNull()
  })

  it('opens Settings for an old ?tab=integration link: the Integration tab is gone (CF-09b)', () => {
    navigation.search = 'tab=integration'
    renderTabs()
    expect(screen.getByRole('tab', { name: 'Settings' }).getAttribute('aria-selected')).toBe('true')
    expect(screen.getByText('content of settings')).toBeTruthy()
    expect(screen.queryByRole('tab', { name: 'Integration' })).toBeNull()
  })

  it('falls back to the first tab for an unknown ?tab=', () => {
    navigation.search = 'tab=nonsense'
    renderTabs()
    expect(screen.getByRole('tab', { name: 'Studio' }).getAttribute('aria-selected')).toBe('true')
  })

  it('writes the chosen tab to the URL with router.replace, keeping the other parameters', async () => {
    navigation.search = 'tab=studio&foo=bar'
    renderTabs()
    await userEvent.click(screen.getByRole('tab', { name: 'Settings' }))
    await waitFor(() => expect(navigation.replace).toHaveBeenCalledTimes(1))
    expect(navigation.replace).toHaveBeenCalledWith('/venues/vn_demo?tab=settings&foo=bar', {
      scroll: false,
    })
  })

  it.each([
    ['studio', 'RR-83'],
    ['composer', 'RR-83'],
    ['tables', 'RR-84'],
    ['settings', 'RR-85'],
  ])('a shared device opens Tonight on an old link to %s, with no tabs to choose (%s)', (tab) => {
    navigation.search = `tab=${tab}`
    renderWithIntl(<WorkspaceTabs contents={contents} sharedDevice />)
    expect(screen.queryByRole('tab')).toBeNull()
    expect(screen.queryByRole('combobox')).toBeNull()
    expect(screen.getByText('content of tonight')).toBeTruthy()
    expect(screen.queryByText(`content of ${tab}`)).toBeNull()
  })

  it('does not touch the URL when the current tab is clicked again', async () => {
    navigation.search = 'tab=settings'
    renderTabs()
    await userEvent.click(screen.getByRole('tab', { name: 'Settings' }))
    expect(navigation.replace).not.toHaveBeenCalled()
  })
})

describe('SettingsSections: the sections of the Settings tab in the URL (D97)', () => {
  const sections = {
    general: <p>general section</p>,
    publish: <p>publish section</p>,
    versioning: <p>versioning section</p>,
  }

  it('has General, Hours, Ordering, Reservations, Publish and Versioning for a venue with a till; General by default', () => {
    navigation.search = 'tab=settings'
    renderWithIntl(<SettingsSections hasTill contents={sections} />)
    expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual([
      'General',
      'Hours',
      'Ordering',
      'Reservations',
      'Publish',
      'Versioning',
    ])
    expect(screen.getByRole('tab', { name: 'General' }).getAttribute('aria-selected')).toBe('true')
    expect(screen.getByText('general section')).toBeTruthy()
  })

  it('has no Publish section without a till, and ?section=publish opens General there', () => {
    navigation.search = 'tab=settings&section=publish'
    renderWithIntl(<SettingsSections hasTill={false} contents={sections} />)
    expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual([
      'General',
      'Hours',
      'Ordering',
      'Reservations',
      'Versioning',
    ])
    expect(screen.getByRole('tab', { name: 'General' }).getAttribute('aria-selected')).toBe('true')
    expect(settingsSectionOf('publish', false)).toBe('general')
    expect(settingsSectionOf('publish', true)).toBe('publish')
    expect(settingsSectionOf('nonsense', true)).toBe('general')
    // Reservations are Restro's own: every venue has the section, with or without a till or a right.
    expect(settingsSectionOf('reservations', false)).toBe('reservations')
  })

  it('lists Staff and roles and Alerts only for a role holding their right, in the grouping’s order', () => {
    navigation.search = 'tab=settings'
    renderWithIntl(
      <SettingsSections hasTill rights={{ roles: true, alerts: true }} contents={sections} />,
    )
    expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual([
      'General',
      'Hours',
      'Ordering',
      'Reservations',
      'Staff and roles',
      'Alerts',
      'Publish',
      'Versioning',
    ])
    expect(settingsSectionOf('staff', true)).toBe('general')
    expect(settingsSectionOf('alerts', true, { roles: false, alerts: true })).toBe('alerts')
    expect(settingsSectionOf('staff', true, { roles: false, alerts: true })).toBe('general')
  })

  it('lists Paying between Reservations and Staff and roles, only where the POS can take card payments', () => {
    navigation.search = 'tab=settings'
    renderWithIntl(
      <SettingsSections
        hasTill
        rights={{ roles: true, alerts: false, paying: true }}
        contents={sections}
      />,
    )
    expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual([
      'General',
      'Hours',
      'Ordering',
      'Reservations',
      'Paying',
      'Staff and roles',
      'Publish',
      'Versioning',
    ])
    expect(settingsSectionOf('paying', true, { roles: false, alerts: false, paying: true })).toBe(
      'paying',
    )
    // A hand-made venue (nothing offered): the link opens General.
    expect(settingsSectionOf('paying', false, { roles: true, alerts: true })).toBe('general')
  })

  it('opens the section in ?section= and writes a choice to the URL, keeping ?tab=', async () => {
    navigation.search = 'tab=settings&section=versioning'
    renderWithIntl(<SettingsSections hasTill contents={sections} />)
    expect(screen.getByRole('tab', { name: 'Versioning' }).getAttribute('aria-selected')).toBe(
      'true',
    )
    await userEvent.click(screen.getByRole('tab', { name: 'Publish' }))
    await waitFor(() => expect(navigation.replace).toHaveBeenCalledTimes(1))
    expect(navigation.replace).toHaveBeenCalledWith(
      '/venues/vn_demo?tab=settings&section=publish',
      { scroll: false },
    )
  })
})
