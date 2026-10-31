// @vitest-environment jsdom
// The Publish bar (brief S4, D96): when it is off and why, the change count, the confirmation that
// lists the changes, the dropdown of a venue with several menus, and "Open the guest page".
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { BusyView, PublishBarView } from '@/server/publish/view'
import { renderWithIntl } from '@/test-utils'
import { PublishBar } from './publish-bar'
import { PublisherProvider } from './publisher-context'
import { barMenu, barView, NO_CHANGES, VENUE_ID } from './test-view'

const actions = vi.hoisted(() => ({
  publishNowAction: vi.fn(),
  approveHeldAction: vi.fn(),
  rejectHeldAction: vi.fn(),
  previewDraftAction: vi.fn(),
}))
vi.mock('@/server/publish/actions', () => actions)
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }))

beforeEach(() => {
  for (const action of Object.values(actions)) action.mockReset()
  actions.publishNowAction.mockResolvedValue({ ok: true, queued: true })
})

function render(
  view: PublishBarView,
  options: { busy?: BusyView; locale?: 'bg'; onlyWhatWorks?: boolean } = {},
) {
  renderWithIntl(
    <PublisherProvider venueId={VENUE_ID} state={{ lastRun: null, busy: options.busy ?? null }}>
      <PublishBar view={view} onlyWhatWorks={options.onlyWhatWorks ?? false} />
    </PublisherProvider>,
    options.locale === undefined ? {} : { locale: options.locale },
  )
}

const button = () => screen.getByTestId('publish-button') as HTMLButtonElement
const reason = () => screen.getByTestId('publish-block-reason').textContent

const TWO_ADDED = {
  ...NO_CHANGES,
  total: 2,
  identical: false,
  added: [
    { id: 'nd_a', name: { en_US: 'Mojito' } },
    { id: 'nd_b', name: { en_US: 'Spritz' } },
  ],
}

describe('the Publish bar with one menu', () => {
  it('shows the number of changes, and the confirmation lists them before anything is published', async () => {
    const user = userEvent.setup()
    render(barView())
    expect(button().disabled).toBe(false)
    expect(screen.getByTestId('publish-count').textContent).toBe('1')
    expect(reason()).toBe('1 change waiting')

    await user.click(button())
    const dialog = screen.getByTestId('publish-confirm-dialog')
    expect(within(dialog).getByText('Publish the menu?')).toBeTruthy()
    expect(within(dialog).getByTestId('changes-count').textContent).toBe('1 change waiting')
    expect(within(dialog).getByTestId('change-summary').textContent).toBe('1 with a new price')
    expect(within(dialog).getByTestId('change-list-prices').textContent).toContain(
      'Negroni: €12.50 → €14.00',
    )
    expect(actions.publishNowAction).not.toHaveBeenCalled()

    await user.click(within(dialog).getByTestId('publish-confirm'))
    // The live menu: the action's default.
    expect(actions.publishNowAction).toHaveBeenCalledWith(VENUE_ID)
    expect(screen.queryByTestId('publish-confirm-dialog')).toBeNull()
  })

  it('Cancel publishes nothing', async () => {
    const user = userEvent.setup()
    render(barView())
    await user.click(button())
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(actions.publishNowAction).not.toHaveBeenCalled()
  })

  it('is greyed when the menu is the same as the live one, and says so', () => {
    render(barView({ menus: [barMenu({ changes: 0, identical: true, list: NO_CHANGES })] }))
    expect(button().disabled).toBe(true)
    expect(reason()).toBe('Up to date: guests see the latest version.')
    expect(screen.queryByTestId('publish-count')).toBeNull()
  })

  it('stays on with nothing new when a publish would switch the address back on', async () => {
    const user = userEvent.setup()
    render(
      barView({
        addressServed: false,
        menus: [barMenu({ changes: 0, identical: true, list: NO_CHANGES })],
      }),
    )
    expect(button().disabled).toBe(false)
    expect(reason()).toBe('Nothing new; publishing switches the menu address back on.')
    await user.click(button())
    expect(screen.getByTestId('changes-same').textContent).toBe(
      'Nothing in the menu changed. Publishing switches the menu address back on.',
    )
  })

  it('stays on with nothing new while automatic publishing is paused', () => {
    render(
      barView({
        paused: true,
        menus: [barMenu({ changes: 0, identical: true, list: NO_CHANGES })],
      }),
    )
    expect(button().disabled).toBe(false)
    expect(reason()).toBe('Nothing new; publishing resumes automatic publishing.')
  })

  it('says why a draft cannot be published', () => {
    render(
      barView({ menus: [barMenu({ changes: null, list: null, blocked: 'no_visible_items' })] }),
    )
    expect(button().disabled).toBe(true)
    expect(reason()).toBe('Nothing visible to publish: show at least one item in Structure.')
  })

  it('says who may publish', () => {
    render(barView({ canPublish: false }))
    expect(button().disabled).toBe(true)
    expect(reason()).toBe('Only an owner or admin can publish.')
  })

  it('before the first publish: everything is new', async () => {
    const user = userEvent.setup()
    render(barView({ menus: [barMenu({ published: false, changes: 2, list: TWO_ADDED })] }))
    expect(reason()).toBe('Not published yet: guests see nothing until you publish.')
    expect(screen.getByTestId('publish-count').textContent).toBe('2')
    await user.click(button())
    expect(screen.getByTestId('changes-all-new').textContent).toBe(
      'Everything is new: 2 items will go live with the first publish.',
    )
  })

  it('says "Publishing…" and stays off while a publish is waiting for the worker', () => {
    render(barView(), { busy: 'publish' })
    expect(button().disabled).toBe(true)
    expect(button().textContent).toContain('Publishing…')
  })

  it('a venue without a menu has nothing to publish', () => {
    render(barView({ menus: [] }))
    expect(button().disabled).toBe(true)
    expect(reason()).toBe('This venue has no menu yet.')
  })
})

describe('"Open the guest page"', () => {
  it('opens the venue’s address in a new tab', () => {
    render(barView())
    const link = screen.getByTestId('guest-link')
    expect(link.getAttribute('href')).toBe('/m/demo-org/demo-club')
    expect(link.getAttribute('target')).toBe('_blank')
  })

  it('is off with a hint while the address is switched off', () => {
    render(barView({ addressServed: false }))
    expect((screen.getByTestId('guest-link') as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByTestId('guest-link-hint').textContent).toBe(
      'The menu address is switched off. Publish to put it back.',
    )
  })

  it('is off before anything is published', () => {
    render(barView({ menus: [barMenu({ published: false })] }))
    expect((screen.getByTestId('guest-link') as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByTestId('guest-link-hint').textContent).toBe('Nothing is published yet.')
  })
})

describe('the Publish bar with several menus', () => {
  const several = barView({
    menus: [
      barMenu({ name: 'Main', areas: ['Terrace'] }),
      barMenu({
        menuId: 'nd_brunchMenuForTests',
        name: 'Brunch',
        live: false,
        areas: ['Garden', 'Bar'],
        changes: 2,
        published: false,
        list: TWO_ADDED,
      }),
      barMenu({
        menuId: 'nd_lateMenuForTests',
        name: 'Late night',
        live: false,
        changes: null,
        list: null,
        blocked: 'menu_blocked',
      }),
    ],
  })

  it('opens one row per menu: its name, its areas in brackets, its changes; a blocked one is greyed with the reason', async () => {
    const user = userEvent.setup()
    render(several)
    // The button counts what can be published.
    expect(screen.getByTestId('publish-count').textContent).toBe('3')
    await user.click(button())
    const rows = await screen.findAllByTestId('publish-menu-row')
    expect(rows.map((row) => row.textContent)).toEqual([
      'Main (venue address, Terrace)1 change',
      'Brunch (Garden, Bar)Not published yet: guests see nothing until you publish.2 changes',
      'Late nightThe menu cannot be published yet. Check Structure in the Studio.',
    ])
    expect(rows[2]?.getAttribute('data-disabled')).not.toBeNull()
    expect(rows[0]?.getAttribute('data-disabled')).toBeNull()
  })

  it('publishing a menu that is not live publishes that menu, after a confirmation that names it', async () => {
    const user = userEvent.setup()
    render(several)
    await user.click(button())
    const [, brunch] = await screen.findAllByTestId('publish-menu-row')
    if (brunch === undefined) throw new Error('the Brunch row is missing')
    await user.click(brunch)
    const dialog = await screen.findByTestId('publish-confirm-dialog')
    expect(within(dialog).getByText('Publish Brunch?')).toBeTruthy()
    expect(
      within(dialog).getByText('Brunch is not the live menu. Guests see it in: Garden, Bar.'),
    ).toBeTruthy()
    await user.click(within(dialog).getByTestId('publish-confirm'))
    expect(actions.publishNowAction).toHaveBeenCalledWith(VENUE_ID, 'nd_brunchMenuForTests')
  })

  it('is greyed when no menu has anything to publish', () => {
    render(
      barView({
        menus: [
          barMenu({ changes: 0, identical: true, list: NO_CHANGES }),
          barMenu({
            menuId: 'nd_other',
            live: false,
            changes: 0,
            identical: true,
            list: NO_CHANGES,
          }),
        ],
      }),
    )
    expect(button().disabled).toBe(true)
    expect(reason()).toBe('Up to date: every menu is published as it is.')
  })
})

describe('on Tonight, only what works (RR-80)', () => {
  const tonight = (view: PublishBarView, busy?: BusyView) =>
    render(view, { onlyWhatWorks: true, ...(busy === undefined ? {} : { busy }) })

  it('draws the working link and button, and the words on what waits', () => {
    tonight(barView())
    expect(screen.getByTestId('guest-link').getAttribute('href')).toBe('/m/demo-org/demo-club')
    expect(button().disabled).toBe(false)
    expect(reason()).toBe('1 change waiting')
  })

  it('has no Publish when nothing waits, and still the guest page', () => {
    tonight(barView({ menus: [barMenu({ changes: 0, identical: true, published: true })] }))
    expect(screen.getByTestId('guest-link')).toBeTruthy()
    expect(screen.queryByTestId('publish-button')).toBeNull()
    expect(screen.queryByTestId('publish-block-reason')).toBeNull()
  })

  it('draws nothing at all when nothing can be pressed', () => {
    tonight(barView({ menus: [] }))
    expect(screen.queryByTestId('publish-bar')).toBeNull()
    expect(document.querySelector(':disabled')).toBeNull()
  })

  it('says it is publishing, with no greyed button', () => {
    tonight(barView(), 'publish')
    expect(screen.queryByTestId('publish-button')).toBeNull()
    expect(screen.getByTestId('publish-block-reason').getAttribute('data-block')).toBe('busy')
    expect(document.querySelector(':disabled')).toBeNull()
  })

  it('lists only the menus that can be published in the dropdown', async () => {
    const user = userEvent.setup()
    tonight(
      barView({
        menus: [
          barMenu({ menuId: 'nd_a', name: 'Drinks' }),
          barMenu({ menuId: 'nd_b', name: 'Food', changes: 0, identical: true, published: true }),
        ],
      }),
    )
    await user.click(button())
    const rows = await screen.findAllByTestId('publish-menu-row')
    expect(rows.map((row) => row.getAttribute('data-menu'))).toEqual(['nd_a'])
  })
})

describe('in Bulgarian', () => {
  it('words the button and the count', () => {
    render(barView(), { locale: 'bg' })
    expect(button().textContent).toContain('Публикувай')
    expect(reason()).toBe('1 промяна чака')
    expect(screen.getByTestId('guest-link').textContent).toBe('Отвори страницата за гости')
  })
})
