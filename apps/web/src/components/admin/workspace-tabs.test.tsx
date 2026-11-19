// @vitest-environment jsdom
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { renderWithIntl } from '@/test-utils'

import {
  FIRST_SECTION_OF,
  NO_SETTINGS_RIGHTS,
  SETTINGS_MODULE_OF,
  type SettingsModule,
  settingsSectionOf,
  settingsSectionsOf,
  sharedDeviceTabOf,
  venueQueryRedirect,
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

describe('SettingsSections: one module’s sections in the URL (D97, D156)', () => {
  const sections = {
    general: <p>general section</p>,
    hours: <p>hours section</p>,
    paying: <p>paying section</p>,
    publish: <p>publish section</p>,
    versioning: <p>versioning section</p>,
  }

  it('the venue’s own: General, Publish and Versioning with a till; General by default', () => {
    navigation.search = 'tab=settings'
    renderWithIntl(<SettingsSections hasTill module="venue" contents={sections} />)
    expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual([
      'General',
      'Publish',
      'Versioning',
    ])
    expect(screen.getByRole('tab', { name: 'General' }).getAttribute('aria-selected')).toBe('true')
    expect(screen.getByText('general section')).toBeTruthy()
  })

  it('has no Publish section without a till, and ?section=publish opens General there', () => {
    navigation.search = 'tab=settings&section=publish'
    renderWithIntl(<SettingsSections hasTill={false} module="venue" contents={sections} />)
    expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual([
      'General',
      'Versioning',
    ])
    expect(screen.getByRole('tab', { name: 'General' }).getAttribute('aria-selected')).toBe('true')
    expect(settingsSectionOf('publish', false)).toBe('general')
    expect(settingsSectionOf('publish', true)).toBe('publish')
    expect(settingsSectionOf('nonsense', true)).toBe('general')
    // Reservations are Restro's own: every venue has the section, with or without a till or a right.
    expect(settingsSectionOf('reservations', false)).toBe('reservations')
  })

  it('Ordering’s: Hours, Ordering, Paying where the POS takes cards, Alerts with its right', () => {
    navigation.search = 'tab=settings&section=hours'
    renderWithIntl(
      <SettingsSections
        hasTill
        module="ordering"
        rights={{ roles: true, alerts: true, paying: true }}
        contents={sections}
      />,
    )
    expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual([
      'Hours',
      'Ordering',
      'Paying',
      'Alerts',
    ])
    expect(screen.getByText('hours section')).toBeTruthy()
  })

  it('Reservations’ one section needs no row', () => {
    navigation.search = 'tab=settings&section=reservations'
    renderWithIntl(<SettingsSections hasTill module="reservations" contents={sections} />)
    expect(screen.queryByRole('tab')).toBeNull()
    expect(screen.queryByRole('combobox')).toBeNull()
  })

  it('lists every section in module order, Staff, Alerts and Paying only with their right', () => {
    expect(settingsSectionsOf(true, { roles: true, alerts: true, paying: true })).toEqual([
      'general',
      'staff',
      'publish',
      'versioning',
      'hours',
      'ordering',
      'paying',
      'alerts',
      'reservations',
    ])
    expect(settingsSectionsOf(false)).toEqual([
      'general',
      'versioning',
      'hours',
      'ordering',
      'reservations',
    ])
    expect(settingsSectionsOf(true, { roles: true, alerts: false }, 'venue')).toEqual([
      'general',
      'staff',
      'publish',
      'versioning',
    ])
    expect(settingsSectionOf('staff', true)).toBe('general')
    expect(settingsSectionOf('alerts', true, { roles: false, alerts: true })).toBe('alerts')
    expect(settingsSectionOf('paying', false, { roles: true, alerts: true })).toBe('hours')
    // An unoffered section stays in its own module's Settings (critique L1).
    expect(settingsSectionOf('alerts', true)).toBe('hours')
    expect(settingsSectionOf('staff', true)).toBe('general')
    // Every section has a module, and each module's first section is offered to every role.
    for (const [module, first] of Object.entries(FIRST_SECTION_OF)) {
      expect(SETTINGS_MODULE_OF[first]).toBe(module)
      expect(settingsSectionsOf(false, undefined, module as SettingsModule)).toContain(first)
    }
  })

  it('writes a choice to the URL, keeping ?tab= and leaving Paying’s provider return behind', async () => {
    navigation.search = 'tab=settings&section=paying&connection=return'
    renderWithIntl(
      <SettingsSections
        hasTill
        module="ordering"
        rights={{ roles: false, alerts: false, paying: true }}
        contents={sections}
      />,
    )
    expect(screen.getByRole('tab', { name: 'Paying' }).getAttribute('aria-selected')).toBe('true')
    await userEvent.click(screen.getByRole('tab', { name: 'Hours' }))
    await waitFor(() => expect(navigation.replace).toHaveBeenCalledTimes(1))
    expect(navigation.replace).toHaveBeenCalledWith('/venues/vn_demo?tab=settings&section=hours', {
      scroll: false,
    })
  })
})

describe('venueQueryRedirect: one address per screen (C1, C9)', () => {
  const everything = { hasTill: true, rights: { roles: true, alerts: true, paying: true } }
  const nothing = { hasTill: false, rights: NO_SETTINGS_RIGHTS }
  const owner = { reservations: true }
  const parse = (search: string) => Object.fromEntries(new URLSearchParams(search))

  it.each([
    // [link, rights, settings, where it is sent (null: left as it is)]
    ['', owner, everything, null],
    ['menu=mn_1', owner, everything, null],
    ['tab=studio', owner, everything, null],
    // The Studio's own `section` is a menu section's id: a reload or a shared item link keeps it.
    ['tab=studio&menu=mn_1&section=nd_9&item=nd_4', owner, everything, null],
    ['tab=composer&menu=mn_1&section=nd_9', owner, everything, 'tab=studio&menu=mn_1&section=nd_9'],
    ['tab=composer&sub=structure', owner, everything, 'tab=studio&sub=structure'],
    ['tab=tables', owner, everything, null],
    ['tab=tables&view=log', owner, everything, 'tab=tables'],
    ['tab=tonight&view=log', owner, everything, null],
    ['tab=tonight&view=log&day=2026-11-18', owner, everything, null],
    ['tab=tonight&section=hours', owner, everything, 'tab=tonight'],
    ['tab=reservations&view=plan&guest=gs_1', owner, everything, null],
    ['tab=reservations', { reservations: false }, everything, 'tab=studio'],
    ['tab=settings', owner, everything, 'tab=settings&section=general'],
    ['tab=settings&section=hours', owner, everything, null],
    ['tab=settings&section=hours&view=log', owner, everything, 'tab=settings&section=hours'],
    ['tab=settings&section=staff', owner, nothing, 'tab=settings&section=general'],
    ['tab=settings&section=nonsense', owner, everything, 'tab=settings&section=general'],
    // Paying carried to a venue no POS serves stays in Ordering settings (critique L1).
    ['tab=settings&section=paying', owner, nothing, 'tab=settings&section=hours'],
    // The payment provider's return (#116) and refresh keep their marker on Paying alone.
    ['tab=settings&section=paying&connection=return', owner, everything, null],
    [
      'tab=settings&section=hours&connection=return',
      owner,
      everything,
      'tab=settings&section=hours',
    ],
    ['tab=integration', owner, everything, 'tab=settings&section=general'],
    ['tab=publishing', owner, everything, 'tab=settings&section=publish'],
    ['tab=publishing', owner, nothing, 'tab=settings&section=general'],
    ['tab=nonsense', owner, everything, 'tab=studio'],
  ])('%s → %s', (search, rights, settings, expected) => {
    expect(venueQueryRedirect(parse(search), rights, settings)).toBe(expected)
  })

  it('treats a repeated parameter as not the one address', () => {
    expect(venueQueryRedirect({ tab: 'tonight', view: ['log', 'orders'] }, owner, everything)).toBe(
      'tab=tonight',
    )
  })
})
