// @vitest-environment jsdom
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { toast } from 'sonner'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { setMenuRouteAction } from '@/server/tables/actions'
import type { MenuShown } from '@/server/tables/view'
import { renderWithIntl } from '@/test-utils'

import { RoutePicker } from './route-picker'
import { COCKTAILS, MAIN_MENU, MENUS, VENUE_ID } from './test-view'

vi.mock('@/server/tables/actions', () => ({ setMenuRouteAction: vi.fn() }))
vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), message: vi.fn() },
}))

const AREA = 'ar_0000000000000000000002'
const TABLE = 'tb_0000000000000000000002'
const FROM_VENUE: MenuShown = { id: MAIN_MENU, name: 'Main menu', level: 'venue' }
const FROM_AREA: MenuShown = { id: COCKTAILS, name: 'Cocktails', level: 'area' }
const OWN: MenuShown = { id: COCKTAILS, name: 'Cocktails', level: 'table' }

beforeEach(() => {
  vi.mocked(setMenuRouteAction).mockReset()
  vi.mocked(setMenuRouteAction).mockResolvedValue({ ok: true, queued: true })
  vi.mocked(toast.success).mockReset()
  vi.mocked(toast.error).mockReset()
  vi.mocked(toast.warning).mockReset()
})

function picker(
  overrides: Partial<Parameters<typeof RoutePicker>[0]> & { effective: MenuShown | null },
) {
  return (
    <RoutePicker
      venueId={VENUE_ID}
      target={{ areaId: AREA }}
      targetName="the area Terrace"
      menus={MENUS}
      value={null}
      canManage
      {...overrides}
    />
  )
}

describe('the menu picker', () => {
  it('says whose menu an area takes when it chose none: the venue’s live menu', () => {
    renderWithIntl(picker({ effective: FROM_VENUE }))
    expect(screen.getByTestId('route-select').textContent).toBe("Menu: Venue's (Main menu)")
    expect(screen.queryByTestId('menu-overrides')).toBeNull()
    expect(screen.getByRole('combobox', { name: 'Menu for the area Terrace' })).toBeTruthy()
  })

  it('says it is the area’s menu on a table that chose none, and the table’s own when it did, marked', () => {
    const table = { target: { tableId: TABLE }, targetName: 'table 2' }
    const { unmount } = renderWithIntl(picker({ ...table, effective: FROM_AREA }))
    expect(screen.getByTestId('route-select').textContent).toBe("Menu: Area's (Cocktails)")
    expect(screen.queryByTestId('menu-overrides')).toBeNull()
    unmount()
    renderWithIntl(picker({ ...table, value: COCKTAILS, effective: OWN }))
    expect(screen.getByTestId('route-select').textContent).toBe('Menu: Cocktails')
    expect(screen.getByTestId('menu-overrides').textContent).toBe('Overrides')
  })

  it('marks an area’s own choice as overriding the venue’s', () => {
    renderWithIntl(picker({ value: COCKTAILS, effective: FROM_AREA }))
    expect(screen.getByTestId('route-select').textContent).toBe('Menu: Cocktails')
    expect(screen.getByTestId('menu-overrides')).toBeTruthy()
  })

  it('offers the venue’s menus with the live one marked, and “Same as the venue” first on an area', async () => {
    const user = userEvent.setup({ delay: null })
    renderWithIntl(picker({ effective: FROM_VENUE }))
    await user.click(screen.getByTestId('route-select'))
    const options = await screen.findAllByRole('option')
    expect(options.map((option) => option.textContent)).toEqual([
      'Same as the venue',
      'Main menu (live)',
      'Cocktails',
    ])
  })

  it('says “Same as the area” on a table', async () => {
    const user = userEvent.setup({ delay: null })
    renderWithIntl(
      picker({ target: { tableId: TABLE }, targetName: 'table 2', effective: FROM_VENUE }),
    )
    await user.click(screen.getByTestId('route-select'))
    expect((await screen.findAllByRole('option'))[0]?.textContent).toBe('Same as the area')
  })

  it('saves the menu chosen for the area, or takes the choice away with the first item', async () => {
    const user = userEvent.setup({ delay: null })
    renderWithIntl(picker({ effective: FROM_VENUE }))
    await user.click(screen.getByTestId('route-select'))
    await user.click(await screen.findByRole('option', { name: 'Cocktails' }))
    await waitFor(() =>
      expect(setMenuRouteAction).toHaveBeenCalledWith({
        venueId: VENUE_ID,
        target: { areaId: AREA },
        menuId: COCKTAILS,
      }),
    )
    expect(toast.success).toHaveBeenCalledWith('Menu saved.')
  })

  it('takes the choice away: the menu id goes out as null', async () => {
    const user = userEvent.setup({ delay: null })
    renderWithIntl(
      picker({
        target: { tableId: TABLE },
        targetName: 'table 2',
        value: COCKTAILS,
        effective: OWN,
      }),
    )
    await user.click(screen.getByTestId('route-select'))
    await user.click(await screen.findByRole('option', { name: 'Same as the area' }))
    await waitFor(() =>
      expect(setMenuRouteAction).toHaveBeenCalledWith({
        venueId: VENUE_ID,
        target: { tableId: TABLE },
        menuId: null,
      }),
    )
    expect(toast.success).toHaveBeenCalledWith('Menu choice removed.')
  })

  it('does not call the action again for the choice it already has', async () => {
    const user = userEvent.setup({ delay: null })
    renderWithIntl(picker({ value: COCKTAILS, effective: FROM_AREA }))
    await user.click(screen.getByTestId('route-select'))
    await user.click(await screen.findByRole('option', { name: 'Cocktails' }))
    expect(setMenuRouteAction).not.toHaveBeenCalled()
  })

  it('shows the refusal in words and the late-files warning', async () => {
    const user = userEvent.setup({ delay: null })
    vi.mocked(setMenuRouteAction).mockResolvedValueOnce({ ok: false, error: 'unknown_menu' })
    renderWithIntl(picker({ effective: FROM_VENUE }))
    await user.click(screen.getByTestId('route-select'))
    await user.click(await screen.findByRole('option', { name: 'Cocktails' }))
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        'This menu is not available any more. Choose another one.',
      ),
    )
    vi.mocked(setMenuRouteAction).mockResolvedValueOnce({ ok: true, queued: false })
    await user.click(screen.getByTestId('route-select'))
    await user.click(await screen.findByRole('option', { name: 'Cocktails' }))
    await waitFor(() =>
      expect(toast.warning).toHaveBeenCalledWith(
        expect.stringContaining('could not be refreshed yet'),
      ),
    )
  })

  it('says when the chosen menu is not published and what guests see meanwhile', () => {
    const { unmount } = renderWithIntl(picker({ value: COCKTAILS, effective: FROM_VENUE }))
    expect(screen.getByTestId('route-select').textContent).toBe('Menu: Cocktails')
    expect(screen.getByTestId('route-fallback').textContent).toBe(
      'Not published yet: guests see Main menu for now.',
    )
    expect(screen.queryByTestId('menu-overrides')).toBeNull()
    unmount()
    renderWithIntl(picker({ value: COCKTAILS, effective: null }))
    expect(screen.getByTestId('route-fallback').textContent).toBe(
      'Not published yet: guests see no menu from this code.',
    )
  })

  it('says nothing is published when the venue has no menu to show', () => {
    renderWithIntl(picker({ effective: null }))
    expect(screen.getByTestId('route-select').textContent).toBe('Menu: none published yet')
  })

  it('is plain text for a member who may not choose', () => {
    renderWithIntl(picker({ canManage: false, effective: FROM_VENUE }))
    expect(screen.queryByTestId('route-select')).toBeNull()
    expect(within(screen.getByTestId('route-picker')).getByTestId('route-text').textContent).toBe(
      "Menu: Venue's (Main menu)",
    )
  })

  it('reads in Bulgarian', () => {
    renderWithIntl(picker({ value: COCKTAILS, effective: FROM_AREA }), { locale: 'bg' })
    expect(screen.getByTestId('route-select').textContent).toBe('Меню: Cocktails')
    expect(screen.getByTestId('menu-overrides').textContent).toBe('Заменя')
  })
})
