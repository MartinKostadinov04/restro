// @vitest-environment jsdom
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { renderWithIntl } from '@/test-utils'

import {
  settingsSectionOf,
  WORKSPACE_TAB_DEFS,
  type WorkspaceTabValue,
  workspaceTabOf,
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
    // D97: no Publishing tab (the Publish button is in the header on every tab). D92: Design is
    // the composer's subtab, not a tab of its own. #85: Tonight sits after Tables & QR.
    expect(tabs.map((tab) => tab.textContent)).toEqual([
      'Composer',
      'Tables & QR',
      'Tonight',
      'Settings',
    ])
    // The select has one entry per declared tab, labelled from the same keys.
    expect(screen.getByRole('combobox', { name: 'Switch tab' })).toBeTruthy()
    expect(tabs).toHaveLength(WORKSPACE_TAB_DEFS.length)
  })

  it('opens the first tab when the URL has no ?tab=', () => {
    renderTabs()
    expect(screen.getByRole('tab', { name: 'Composer' }).getAttribute('aria-selected')).toBe('true')
    expect(screen.getByText('content of composer')).toBeTruthy()
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

  it('opens the composer for an old ?tab=design link: Design is its subtab now (D92)', () => {
    expect(workspaceTabOf('design')).toBe('composer')
    navigation.search = 'tab=design'
    renderTabs()
    expect(screen.getByRole('tab', { name: 'Composer' }).getAttribute('aria-selected')).toBe('true')
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
    expect(screen.getByRole('tab', { name: 'Composer' }).getAttribute('aria-selected')).toBe('true')
  })

  it('writes the chosen tab to the URL with router.replace, keeping the other parameters', async () => {
    navigation.search = 'tab=composer&foo=bar'
    renderTabs()
    await userEvent.click(screen.getByRole('tab', { name: 'Settings' }))
    await waitFor(() => expect(navigation.replace).toHaveBeenCalledTimes(1))
    expect(navigation.replace).toHaveBeenCalledWith('/venues/vn_demo?tab=settings&foo=bar', {
      scroll: false,
    })
  })

  it('a shared device has no composer tab, and an old link to it opens Tonight (RR-83)', () => {
    navigation.search = 'tab=composer'
    renderWithIntl(<WorkspaceTabs contents={contents} sharedDevice />)
    expect(screen.queryByRole('tab', { name: 'Composer' })).toBeNull()
    expect(screen.getByRole('tab', { name: 'Tonight' }).getAttribute('aria-selected')).toBe('true')
    expect(screen.queryByText('content of composer')).toBeNull()
  })

  it('a shared device has no Tables & QR tab, and an old link to it opens Tonight (RR-84)', () => {
    navigation.search = 'tab=tables'
    renderWithIntl(<WorkspaceTabs contents={contents} sharedDevice />)
    expect(screen.queryByRole('tab', { name: 'Tables & QR' })).toBeNull()
    expect(screen.getByRole('tab', { name: 'Tonight' }).getAttribute('aria-selected')).toBe('true')
    expect(screen.queryByText('content of tables')).toBeNull()
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

  it('has General, Hours, Ordering, Publish and Versioning for a venue with a till; General by default', () => {
    navigation.search = 'tab=settings'
    renderWithIntl(<SettingsSections hasTill contents={sections} />)
    expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual([
      'General',
      'Hours',
      'Ordering',
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
      'Versioning',
    ])
    expect(screen.getByRole('tab', { name: 'General' }).getAttribute('aria-selected')).toBe('true')
    expect(settingsSectionOf('publish', false)).toBe('general')
    expect(settingsSectionOf('publish', true)).toBe('publish')
    expect(settingsSectionOf('nonsense', true)).toBe('general')
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
      'Staff and roles',
      'Alerts',
      'Publish',
      'Versioning',
    ])
    expect(settingsSectionOf('staff', true)).toBe('general')
    expect(settingsSectionOf('alerts', true, { roles: false, alerts: true })).toBe('alerts')
    expect(settingsSectionOf('staff', true, { roles: false, alerts: true })).toBe('general')
  })

  it('lists Paying between Ordering and Staff and roles, only where the POS can take card payments', () => {
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
