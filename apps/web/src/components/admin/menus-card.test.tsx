// @vitest-environment jsdom
// The Menus card of Settings › General (D88, D90, D91): rows in order with the Live badge and ">"
// into the composer, rename, move, "Set live" that publishes after a confirmation, and for a
// hand-made venue add, delete (never the live one), import and the bin; a POS venue has none of
// the three.
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { renderWithIntl } from '@/test-utils'
import { composerMenuHref, type MenuRow, MenusCard } from './menus-card'

const actions = vi.hoisted(() => ({
  createMenuAction: vi.fn(),
  renameMenuAction: vi.fn(),
  moveMenuAction: vi.fn(),
  deleteMenuAction: vi.fn(),
  restoreMenuAction: vi.fn(),
  setLiveMenuAction: vi.fn(),
  importMenuAction: vi.fn(),
  listImportSourcesAction: vi.fn(),
}))
vi.mock('@/server/menus-actions', () => actions)

const VENUE = 'vn_demoVenueForMenusTests'
const MAIN: MenuRow = { id: 'nd_main', name: null, live: true, deletedAt: null }
const BRUNCH: MenuRow = { id: 'nd_brunch', name: 'Brunch', live: false, deletedAt: null }
const LATE: MenuRow = { id: 'nd_late', name: 'Late night', live: false, deletedAt: null }
const OLD: MenuRow = {
  id: 'nd_old',
  name: 'Winter',
  live: false,
  deletedAt: '2026-10-10T10:00:00.000Z',
}

beforeEach(() => {
  for (const action of Object.values(actions)) {
    action.mockReset()
    action.mockResolvedValue({ ok: true, menu: { id: 'nd_x' } })
  }
  actions.setLiveMenuAction.mockResolvedValue({ ok: true, menu: { id: 'nd_brunch' }, queued: true })
})

function render(
  options: {
    hasTill?: boolean
    canManage?: boolean
    menus?: readonly MenuRow[]
    deleted?: readonly MenuRow[]
    locale?: 'bg'
  } = {},
) {
  renderWithIntl(
    <MenusCard
      venueId={VENUE}
      venueName="Demo Club"
      hasTill={options.hasTill ?? false}
      canManage={options.canManage ?? true}
      menus={options.menus ?? [MAIN, BRUNCH, LATE]}
      deleted={options.deleted ?? [OLD]}
      binDays={30}
      timeZone="Europe/Sofia"
    />,
    options.locale === undefined ? {} : { locale: options.locale },
  )
}

const rows = () => screen.getAllByTestId('menu-row')
const row = (index: number) => rows()[index] as HTMLElement

describe('the Menus card', () => {
  it('lists the menus in order: the venue’s name for a menu without one, the Live badge, ">" into the composer', () => {
    render()
    expect(rows().map((one) => one.getAttribute('data-menu'))).toEqual([
      'nd_main',
      'nd_brunch',
      'nd_late',
    ])
    expect(row(0).textContent).toContain('Demo Club')
    expect(row(0).textContent).toContain('(the venue’s name)')
    expect(within(row(0)).getByTestId('menu-live-badge').textContent).toBe('Live')
    expect(within(row(1)).queryByTestId('menu-live-badge')).toBeNull()
    expect(within(row(1)).getByTestId('menu-open').getAttribute('href')).toBe(
      composerMenuHref(VENUE, 'nd_brunch'),
    )
    expect(composerMenuHref(VENUE, 'nd_brunch')).toBe(
      `/venues/${VENUE}?tab=composer&menu=nd_brunch`,
    )
  })

  it('renames a menu in place', async () => {
    const user = userEvent.setup()
    render()
    await user.click(within(row(1)).getByTestId('menu-rename'))
    const input = screen.getByTestId('menu-rename-input')
    await user.clear(input)
    await user.type(input, 'Sunday brunch')
    await user.click(screen.getByTestId('menu-rename-save'))
    expect(actions.renameMenuAction).toHaveBeenCalledWith({
      venueId: VENUE,
      menuId: 'nd_brunch',
      name: 'Sunday brunch',
    })
  })

  it('moves a menu up before the one above, and down before the one after the next (or to the end)', async () => {
    const user = userEvent.setup()
    render()
    expect((within(row(0)).getByTestId('menu-up') as HTMLButtonElement).disabled).toBe(true)
    expect((within(row(2)).getByTestId('menu-down') as HTMLButtonElement).disabled).toBe(true)
    await user.click(within(row(2)).getByTestId('menu-up'))
    expect(actions.moveMenuAction).toHaveBeenLastCalledWith({
      venueId: VENUE,
      menuId: 'nd_late',
      position: { before: 'nd_brunch' },
    })
    await user.click(within(row(0)).getByTestId('menu-down'))
    expect(actions.moveMenuAction).toHaveBeenLastCalledWith({
      venueId: VENUE,
      menuId: 'nd_main',
      position: { before: 'nd_late' },
    })
    await user.click(within(row(1)).getByTestId('menu-down'))
    expect(actions.moveMenuAction).toHaveBeenLastCalledWith({
      venueId: VENUE,
      menuId: 'nd_brunch',
      position: 'end',
    })
  })

  it('"Set live" says it publishes, and only then makes the menu live', async () => {
    const user = userEvent.setup()
    render()
    expect(within(row(0)).queryByTestId('menu-set-live')).toBeNull()
    await user.click(within(row(1)).getByTestId('menu-set-live'))
    const dialog = screen.getByTestId('menu-set-live-dialog')
    expect(within(dialog).getByText('Make Brunch the live menu?')).toBeTruthy()
    expect(within(dialog).getByText(/It is published now/)).toBeTruthy()
    expect(actions.setLiveMenuAction).not.toHaveBeenCalled()
    await user.click(within(dialog).getByTestId('menu-set-live-confirm'))
    expect(actions.setLiveMenuAction).toHaveBeenCalledWith({ venueId: VENUE, menuId: 'nd_brunch' })
    expect((await screen.findByTestId('menus-note')).textContent).toBe(
      'It is the live menu now. Publishing it…',
    )
  })

  it('says when the new live menu could not be published', async () => {
    const user = userEvent.setup()
    actions.setLiveMenuAction.mockResolvedValue({ ok: true, menu: {}, queued: false })
    render()
    await user.click(within(row(1)).getByTestId('menu-set-live'))
    await user.click(screen.getByTestId('menu-set-live-confirm'))
    expect((await screen.findByTestId('menus-note')).textContent).toContain(
      'could not be published just now',
    )
  })

  it('a hand-made venue deletes a menu to the bin, but never the live one', async () => {
    const user = userEvent.setup()
    render()
    expect((within(row(0)).getByTestId('menu-delete') as HTMLButtonElement).disabled).toBe(true)
    await user.click(within(row(2)).getByTestId('menu-delete'))
    expect(actions.deleteMenuAction).toHaveBeenCalledWith({ venueId: VENUE, menuId: 'nd_late' })
    expect((await screen.findByTestId('menus-note')).textContent).toBe('Moved to Deleted menus.')
  })

  it('words a refusal', async () => {
    const user = userEvent.setup()
    actions.deleteMenuAction.mockResolvedValue({ ok: false, error: 'menu_live' })
    render()
    await user.click(within(row(2)).getByTestId('menu-delete'))
    expect((await screen.findByTestId('menus-error')).textContent).toBe(
      'The live menu cannot be deleted: make another menu live first.',
    )
  })

  it('adds a menu; an empty name is the venue’s', async () => {
    const user = userEvent.setup()
    render()
    await user.click(screen.getByTestId('menu-add'))
    expect(screen.getByTestId('menu-add-name').getAttribute('placeholder')).toBe(
      'Name (empty = Demo Club)',
    )
    await user.type(screen.getByTestId('menu-add-name'), 'Drinks')
    await user.click(screen.getByTestId('menu-add-submit'))
    expect(actions.createMenuAction).toHaveBeenCalledWith({ venueId: VENUE, name: 'Drinks' })
  })

  it('keeps deleted menus in a collapsed list with the day and Restore', async () => {
    const user = userEvent.setup()
    render()
    expect(screen.queryByTestId('menus-bin')).toBeNull()
    await user.click(screen.getByTestId('menus-bin-toggle'))
    const bin = screen.getByTestId('menus-bin')
    expect(bin.textContent).toContain('Winter')
    expect(bin.textContent).toContain('Deleted Oct 10, 2026 · erased on Nov 9, 2026')
    await user.click(within(bin).getByTestId('menu-restore'))
    expect(actions.restoreMenuAction).toHaveBeenCalledWith({ venueId: VENUE, menuId: 'nd_old' })
  })

  it('imports a menu of another hand-made venue', async () => {
    const user = userEvent.setup()
    actions.listImportSourcesAction.mockResolvedValue({
      ok: true,
      venues: [
        { venueId: 'vn_other', name: 'Other Bar', menus: [{ id: 'nd_theirs', name: 'Cocktails' }] },
      ],
    })
    render()
    await user.click(screen.getByTestId('menu-import'))
    const dialog = await screen.findByTestId('menu-import-dialog')
    expect(actions.listImportSourcesAction).toHaveBeenCalledWith(VENUE)
    await user.click(await within(dialog).findByTestId('menu-import-venue'))
    await user.click(await screen.findByRole('option', { name: 'Other Bar' }))
    await user.click(within(dialog).getByTestId('menu-import-menu'))
    await user.click(await screen.findByRole('option', { name: 'Cocktails' }))
    await user.click(within(dialog).getByTestId('menu-import-submit'))
    expect(actions.importMenuAction).toHaveBeenCalledWith({
      fromVenueId: 'vn_other',
      fromMenuId: 'nd_theirs',
      toVenueId: VENUE,
    })
  })

  it('a POS venue’s menus are the till’s: no add, delete, import or bin; rename, order and set live stay', () => {
    render({ hasTill: true })
    expect(screen.queryByTestId('menu-add')).toBeNull()
    expect(screen.queryByTestId('menu-import')).toBeNull()
    expect(screen.queryByTestId('menu-delete')).toBeNull()
    expect(screen.queryByTestId('menus-bin-toggle')).toBeNull()
    expect(within(row(1)).getByTestId('menu-rename')).toBeTruthy()
    expect(within(row(1)).getByTestId('menu-up')).toBeTruthy()
    expect(within(row(1)).getByTestId('menu-set-live')).toBeTruthy()
  })

  it('shows the list but no buttons to anyone who may not manage menus', () => {
    render({ canManage: false })
    expect(rows()).toHaveLength(3)
    expect(screen.queryByTestId('menu-rename')).toBeNull()
    expect(screen.queryByTestId('menu-set-live')).toBeNull()
    expect(screen.queryByTestId('menu-add')).toBeNull()
    // The composer stays one click away.
    expect(within(row(0)).getByTestId('menu-open')).toBeTruthy()
  })

  it('speaks Bulgarian', () => {
    render({ locale: 'bg' })
    expect(screen.getByText('Менюта')).toBeTruthy()
    expect(within(row(0)).getByTestId('menu-live-badge').textContent).toBe('На живо')
  })
})
