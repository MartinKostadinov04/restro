// @vitest-environment jsdom
// The admin sidebar. Off a venue's page (D74): the organisation's venues as items of their own,
// "All venues", "New venue" for owners and admins only. On a venue's page (D154): the venue
// switcher and the venue's menu grouped by module, each module with its own Settings (D156).
// Always: the organisation's Settings, and in the footer the organisation (a switcher only for a
// person who belongs to several).
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { SidebarProvider } from '@/components/ui/sidebar'
import { switchOrganization } from '@/server/actions'
import { createVenueAction, loadNewVenueSourcesAction } from '@/server/venues-actions'
import { renderWithIntl } from '@/test-utils'

import { AppSidebar } from './app-sidebar'
import { sortVenuesByName } from './venue-nav'

// The sidebar reads the URL through next/navigation: replace it with a small fake.
const navigation = vi.hoisted(() => ({
  pathname: '/venues',
  search: '',
  push: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: navigation.push }),
  usePathname: () => navigation.pathname,
  useSearchParams: () => new URLSearchParams(navigation.search),
}))
// Server actions and the sign-in client are not what these tests are about.
vi.mock('@/server/actions', () => ({ switchOrganization: vi.fn() }))
vi.mock('@/server/venues-actions', () => ({
  createVenueAction: vi.fn(),
  loadNewVenueSourcesAction: vi.fn(),
}))
vi.mock('@/i18n/actions', () => ({ setAdminLocale: vi.fn() }))
vi.mock('@/lib/auth-client', () => ({ authClient: { signOut: vi.fn() } }))

const VENUES = [
  { id: 'vn_zebra', name: 'zebra Lounge' },
  { id: 'vn_beta', name: 'Beta Bar', reservations: true },
  { id: 'vn_alpha', name: 'Alpha Club' },
]
const ONE_ORGANIZATION = [{ id: 'tn_one', name: 'Night Group' }]
const TWO_ORGANIZATIONS = [...ONE_ORGANIZATION, { id: 'tn_two', name: 'Other Group' }]

interface Options {
  pathname?: string
  search?: string
  /** Start with the sidebar collapsed to icons. */
  collapsed?: boolean
  canCreateVenue?: boolean
  staffOnly?: boolean
  organizations?: typeof ONE_ORGANIZATION
}

function renderSidebar({
  pathname = '/venues',
  search = '',
  collapsed = false,
  canCreateVenue = true,
  staffOnly = false,
  organizations = ONE_ORGANIZATION,
}: Options = {}) {
  navigation.pathname = pathname
  navigation.search = search
  return renderWithIntl(
    <SidebarProvider defaultOpen={!collapsed}>
      <AppSidebar
        venues={VENUES}
        organizations={organizations}
        activeOrganizationId="tn_one"
        canCreateVenue={canCreateVenue}
        staffOnly={staffOnly}
        user={{ name: 'Maria Petrova', email: 'maria@example.com' }}
      />
    </SidebarProvider>,
  )
}

const venueItems = () => screen.getAllByTestId('venue-nav-item')
/** What a venue item reads: the initial in its mark, then the name. */
const readsAs = (name: string) => `${[...name][0]?.toUpperCase()}${name}`
const venueNamed = (name: string) => {
  const item = venueItems().find((link) => link.textContent === readsAs(name))
  if (!item) throw new Error(`no venue item named ${name}`)
  return item
}

beforeEach(() => {
  navigation.push.mockReset()
  vi.mocked(switchOrganization).mockReset()
  // The New venue dialog asks for its sources when it opens: none connected, so By hand.
  vi.mocked(loadNewVenueSourcesAction).mockReset()
  vi.mocked(loadNewVenueSourcesAction).mockResolvedValue({
    ok: true,
    sources: { organizationSlug: 'night-group', instances: [] },
  })
})

describe('the Venues group', () => {
  it('lists every venue of the organisation by name, ignoring case and alphabet', () => {
    renderSidebar()
    expect(screen.getByText('Venues')).toBeTruthy()
    // "zebra Lounge" is written in lower case and still comes after "Beta Bar".
    expect(venueItems().map((link) => link.textContent)).toEqual(
      ['Alpha Club', 'Beta Bar', 'zebra Lounge'].map(readsAs),
    )
  })

  it('sorts Bulgarian names in alphabet order, and a tie by id', () => {
    const names = (list: { id: string; name: string }[]) => sortVenuesByName(list).map((v) => v.id)
    expect(
      names([
        { id: 'vn_3', name: 'Ъгъл' },
        { id: 'vn_2', name: 'Бар' },
        { id: 'vn_1', name: 'Аква' },
      ]),
    ).toEqual(['vn_1', 'vn_2', 'vn_3'])
    expect(
      names([
        { id: 'vn_b', name: 'Same' },
        { id: 'vn_a', name: 'same' },
      ]),
    ).toEqual(['vn_a', 'vn_b'])
  })

  it('has an "All venues" item for the overview, lit on the overview', () => {
    renderSidebar({ pathname: '/venues' })
    const all = screen.getByRole('link', { name: 'All venues' })
    expect(all.getAttribute('href')).toBe('/venues')
    expect(all.getAttribute('aria-current')).toBe('page')
  })

  it('shows "New venue" to owners and admins, who open the dialog from it', async () => {
    renderSidebar({ canCreateVenue: true })
    await userEvent.click(screen.getByRole('button', { name: 'New venue' }))
    expect(await screen.findByTestId('new-venue-dialog')).toBeTruthy()
  })

  it('opens the new venue once the dialog has made it', async () => {
    vi.mocked(createVenueAction).mockResolvedValue({ ok: true, venueId: 'vn_new' })
    renderSidebar({ canCreateVenue: true })
    await userEvent.click(screen.getByRole('button', { name: 'New venue' }))
    // Step 1: no POS is connected, so By hand is chosen already; step 2 asks for the name.
    await screen.findByTestId('new-venue-sources')
    await userEvent.click(screen.getByTestId('new-venue-next'))
    await userEvent.type(await screen.findByTestId('new-venue-name'), 'Sea Bar')
    await userEvent.click(screen.getByTestId('new-venue-submit'))
    await waitFor(() => expect(navigation.push).toHaveBeenCalledWith('/venues/vn_new'))
  })

  it('does not show "New venue" to members', () => {
    renderSidebar({ canCreateVenue: false })
    expect(screen.queryByRole('button', { name: 'New venue' })).toBeNull()
    expect(screen.queryByTestId('venue-nav-new')).toBeNull()
    // The rest of the group is there.
    expect(screen.getByRole('link', { name: 'All venues' })).toBeTruthy()
    expect(venueItems()).toHaveLength(VENUES.length)
  })

  it('shows every venue however many there are', () => {
    navigation.pathname = '/venues'
    const many = Array.from({ length: 60 }, (_, index) => ({
      id: `vn_${index}`,
      name: `Venue ${index + 1}`,
    }))
    renderWithIntl(
      <SidebarProvider>
        <AppSidebar
          venues={many}
          organizations={ONE_ORGANIZATION}
          activeOrganizationId="tn_one"
          canCreateVenue={false}
          staffOnly={false}
          user={{ name: 'Maria Petrova', email: 'maria@example.com' }}
        />
      </SidebarProvider>,
    )
    expect(venueItems()).toHaveLength(60)
    // "Venue 2" before "Venue 10": numbers count as numbers.
    const names = venueItems().map((link) => link.textContent ?? '')
    expect(names.indexOf(readsAs('Venue 2'))).toBeLessThan(names.indexOf(readsAs('Venue 10')))
  })
})

describe('on a venue’s page (D154)', () => {
  const groupLabels = () =>
    [...document.querySelectorAll('[data-sidebar="group-label"]')].map((label) => label.textContent)
  const entry = (key: string) => {
    const found = document.querySelector(`[data-nav="${key}"]`)
    if (!found) throw new Error(`no entry ${key}`)
    return found
  }

  it('draws the venue’s menu by module instead of the venues list', () => {
    renderSidebar({ pathname: '/venues/vn_beta', search: 'tab=tonight' })
    expect(groupLabels()).toEqual(['Menu', 'Ordering', 'Reservations', 'Venue', 'Organisation'])
    expect(screen.queryAllByTestId('venue-nav-item')).toHaveLength(0)
    expect(entry('studio').getAttribute('href')).toBe('/venues/vn_beta?tab=studio')
    expect(entry('tables').getAttribute('href')).toBe('/venues/vn_beta?tab=tables')
    expect(entry('tonight').getAttribute('href')).toBe('/venues/vn_beta?tab=tonight')
    expect(entry('reservations').getAttribute('href')).toBe('/venues/vn_beta?tab=reservations')
    expect(entry('settings-ordering').getAttribute('href')).toBe(
      '/venues/vn_beta?tab=settings&section=hours',
    )
    expect(entry('settings-reservations').getAttribute('href')).toBe(
      '/venues/vn_beta?tab=settings&section=reservations',
    )
    expect(entry('settings-venue').getAttribute('href')).toBe(
      '/venues/vn_beta?tab=settings&section=general',
    )
  })

  it('marks the open screen, and only it', () => {
    for (const [search, open] of [
      ['', 'studio'],
      ['tab=tonight&view=log', 'tonight'],
      ['tab=settings&section=alerts', 'settings-ordering'],
      ['tab=settings&section=reservations', 'settings-reservations'],
      ['tab=settings&section=staff', 'settings-venue'],
      ['tab=settings', 'settings-venue'],
    ] as const) {
      const { unmount } = renderSidebar({ pathname: '/venues/vn_beta', search })
      const current = [...document.querySelectorAll('[data-nav][aria-current="page"]')].map(
        (link) => link.getAttribute('data-nav'),
      )
      expect(current, search).toEqual([open])
      unmount()
    }
  })

  it('marks a tapped entry at once, before the page has answered', async () => {
    renderSidebar({ pathname: '/venues/vn_beta', search: 'tab=studio' })
    await userEvent.click(entry('settings-ordering'))
    expect(entry('settings-ordering').getAttribute('aria-current')).toBe('page')
    expect(entry('studio').getAttribute('aria-current')).toBeNull()
  })

  it('names each Settings by its module to a screen reader and in its tooltip', async () => {
    renderSidebar({ pathname: '/venues/vn_beta', collapsed: true })
    expect(screen.getByRole('link', { name: 'Ordering settings' })).toBe(entry('settings-ordering'))
    expect(screen.getByRole('link', { name: 'Reservation settings' })).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Venue settings' })).toBeTruthy()
    await userEvent.hover(entry('settings-ordering'))
    expect((await screen.findByRole('tooltip')).textContent).toBe('Ordering settings')
  })

  it('lists the night’s reservations only where the person works them (#326)', () => {
    renderSidebar({ pathname: '/venues/vn_alpha' })
    expect(document.querySelector('[data-nav="reservations"]')).toBeNull()
    // The module keeps its Settings, read-only where the role lacks the right.
    expect(entry('settings-reservations')).toBeTruthy()
  })

  it('switches venue from the venue’s name, on the same screen and nothing else of it (C1)', async () => {
    renderSidebar({ pathname: '/venues/vn_alpha', search: 'tab=settings&section=hours&view=log' })
    const switcher = screen.getByTestId('venue-switcher')
    expect(screen.getByRole('button', { name: 'Alpha Club, Switch venue' })).toBe(switcher)
    await userEvent.click(switcher)
    const items = await screen.findAllByTestId('venue-nav-item')
    expect(items.map((item) => item.getAttribute('data-venue-id'))).toEqual([
      'vn_alpha',
      'vn_beta',
      'vn_zebra',
    ])
    expect(items[1]?.getAttribute('href')).toBe('/venues/vn_beta?tab=settings&section=hours')
    expect(items[0]?.getAttribute('aria-current')).toBe('page')
    expect(screen.getByTestId('venue-nav-all').getAttribute('href')).toBe('/venues')
    expect(screen.getByTestId('venue-nav-new')).toBeTruthy()
  })

  it('carries only the screen to another venue', async () => {
    for (const [search, href] of [
      ['tab=tonight&view=log&day=2026-11-18', '/venues/vn_beta?tab=tonight'],
      ['tab=studio&menu=mn_1&item=nd_2', '/venues/vn_beta?tab=studio'],
      ['tab=nonsense', '/venues/vn_beta'],
      ['', '/venues/vn_beta'],
    ] as const) {
      const { unmount } = renderSidebar({ pathname: '/venues/vn_alpha', search })
      await userEvent.click(screen.getByTestId('venue-switcher'))
      const beta = (await screen.findAllByTestId('venue-nav-item')).find(
        (item) => item.getAttribute('data-venue-id') === 'vn_beta',
      )
      expect(beta?.getAttribute('href'), search).toBe(href)
      unmount()
    }
  })

  it('offers members no new venue in the switcher', async () => {
    renderSidebar({ pathname: '/venues/vn_alpha', canCreateVenue: false })
    await userEvent.click(screen.getByTestId('venue-switcher'))
    await screen.findAllByTestId('venue-nav-item')
    expect(screen.queryByTestId('venue-nav-new')).toBeNull()
  })

  it('gives a staff-only sign-in the venue’s name alone: nothing to switch to, no Restro link (C4)', () => {
    renderSidebar({ pathname: '/venues/vn_alpha', staffOnly: true })
    const name = screen.getByTestId('venue-switcher')
    expect(name.tagName).toBe('DIV')
    expect(name.textContent).toContain('Alpha Club')
    expect(screen.queryByRole('button', { name: /Switch venue/ })).toBeNull()
    expect(screen.queryByRole('link', { name: /Restro/ })).toBeNull()
  })

  it('shows Restro’s mark without a link to the venues for a staff-only sign-in elsewhere', () => {
    renderSidebar({ pathname: '/settings', staffOnly: true })
    expect(screen.getByText('Restro')).toBeTruthy()
    expect(screen.queryByRole('link', { name: /Restro/ })).toBeNull()
  })
})

describe('the Organisation group', () => {
  it('has one item, Settings, that opens /settings', () => {
    renderSidebar()
    expect(
      screen.getByText('Organisation', { selector: '[data-sidebar="group-label"]' }),
    ).toBeTruthy()
    // Its accessible name and tooltip say whose Settings; the visible word is still in it.
    const settings = screen.getByRole('link', { name: 'Organisation settings' })
    expect(settings.textContent).toBe('Settings')
    expect(settings.getAttribute('href')).toBe('/settings')
    expect(settings.getAttribute('aria-current')).toBeNull()
  })

  it('lights Settings on every settings page', () => {
    renderSidebar({ pathname: '/settings/integrations' })
    expect(screen.getByTestId('nav-settings').getAttribute('aria-current')).toBe('page')
    expect(venueItems().every((link) => link.getAttribute('aria-current') === null)).toBe(true)
  })

  it('speaks Bulgarian first-class', () => {
    renderWithIntl(
      <SidebarProvider>
        <AppSidebar
          venues={VENUES}
          organizations={ONE_ORGANIZATION}
          activeOrganizationId="tn_one"
          canCreateVenue
          staffOnly={false}
          user={{ name: 'Maria Petrova', email: 'maria@example.com' }}
        />
      </SidebarProvider>,
      { locale: 'bg' },
    )
    expect(screen.getByText('Заведения', { selector: '[data-sidebar="group-label"]' })).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Всички заведения' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Ново заведение' })).toBeTruthy()
    expect(
      screen.getByText('Организация', { selector: '[data-sidebar="group-label"]' }),
    ).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Настройки на организацията' })).toBeTruthy()
  })
})

describe('the footer', () => {
  it('shows the organisation’s name only, for a person who belongs to one', () => {
    renderSidebar({ organizations: ONE_ORGANIZATION })
    expect(within(screen.getByTestId('organization-name')).getByText('Night Group')).toBeTruthy()
    expect(screen.queryByTestId('organization-switcher')).toBeNull()
    // Off a venue's page there is no venue switcher: the venues are in the list above.
    expect(screen.queryByTestId('venue-switcher')).toBeNull()
  })

  it('has an organisation switcher for a person who belongs to several', async () => {
    renderSidebar({ organizations: TWO_ORGANIZATIONS })
    expect(screen.queryByTestId('organization-name')).toBeNull()
    await userEvent.click(screen.getByTestId('organization-switcher'))
    await userEvent.click(await screen.findByRole('menuitem', { name: /Other Group/ }))
    expect(switchOrganization).toHaveBeenCalledWith('tn_two')
  })

  it('keeps the user menu', () => {
    renderSidebar()
    expect(within(screen.getByTestId('user-menu')).getByText('Maria Petrova')).toBeTruthy()
  })
})

describe('the sidebar collapsed to icons', () => {
  it('shows the initial of each venue, and the name as a tooltip', async () => {
    renderSidebar({ collapsed: true })
    const beta = venueNamed('Beta Bar')
    // The initial is drawn beside the name (the name is clipped away by the narrow button).
    expect(beta.textContent).toBe(readsAs('Beta Bar'))
    await userEvent.hover(beta)
    expect((await screen.findByRole('tooltip')).textContent).toBe('Beta Bar')
  })

  it('names the other items too', async () => {
    renderSidebar({ collapsed: true })
    await userEvent.hover(screen.getByTestId('nav-settings'))
    expect((await screen.findByRole('tooltip')).textContent).toBe('Organisation settings')
  })

  it('shows no tooltip while the sidebar is open: the names are in view', async () => {
    renderSidebar({ collapsed: false })
    await userEvent.hover(venueNamed('Beta Bar'))
    expect(screen.queryByRole('tooltip')).toBeNull()
  })
})
