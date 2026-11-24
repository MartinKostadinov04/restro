// @vitest-environment jsdom
// The Design page's Advanced panel (D129, D130, D159, #176): the list of parts with General and the
// thirteen pages built from the contract file, a row of tiles for every option, a tap on a marked
// part of the preview opening the page that owns it, the switch between Simple and Advanced keeping
// the draft, rows that do not apply, and a role that may not edit. The server actions and the toast
// are the only fakes; what a frame draws is the Playwright spec's (design.spec.ts).
import {
  DEFAULT_DESIGN,
  DESIGN_PAGES,
  type DesignPage,
  designThemeOf,
  THEME_FONTS,
} from '@restro/core'
import { fixture } from '@restro/shell/testing'
import { act, cleanup, render, renderHook, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { NextIntlClientProvider } from 'next-intl'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { DesignView } from '@/server/design/service'
import { MESSAGES, renderWithIntl } from '@/test-utils'

import { pageOfTap, shownValues, tilePlanOf } from './advanced-model'
import { AdvancedPanel } from './advanced-panel'
import { draftOf } from './design-draft'
import { DesignPage as Page } from './design-page'
import { useTileContent } from './option-tiles'
import { optionsOfPage, partListOf } from './part-list'
import { PartList } from './part-rows'
import { specimenOf } from './specimen'

const actions = vi.hoisted(() => ({
  saveDesignAction: vi.fn(),
  previewDraftAction: vi.fn(),
  saveStyleAction: vi.fn(),
  setStyleStatusAction: vi.fn(),
}))
vi.mock('@/server/design/actions', () => ({
  saveDesignAction: actions.saveDesignAction,
  saveStyleAction: actions.saveStyleAction,
  setStyleStatusAction: actions.setStyleStatusAction,
}))
vi.mock('@/server/publish/actions', () => ({ previewDraftAction: actions.previewDraftAction }))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}))

const VENUE = 'vn_0123456789ABCDEFGHIJKL'
const MENU = 'nd_0123456789ABCDEFGHIJKL'
const SAVED: DesignView = {
  revision: 3,
  design: DEFAULT_DESIGN,
  theme: designThemeOf(DEFAULT_DESIGN),
  logo: null,
  canEdit: true,
}

beforeEach(() => {
  // The address of the page: jsdom keeps one for the whole file.
  window.history.replaceState(null, '', '/')
  actions.saveDesignAction.mockReset().mockResolvedValue({ ok: true, revision: 4 })
  actions.previewDraftAction.mockReset().mockResolvedValue({
    ok: true,
    snapshot: fixture('with-images').snapshot,
    overlay: { version: 1, items: {} },
  })
})

function setup(initial: Partial<DesignView> = {}, locale: 'en' | 'bg' = 'en') {
  return renderWithIntl(
    <Page
      venueId={VENUE}
      venueName="Demo Club"
      initial={{ ...SAVED, ...initial }}
      myStyles={{ saved: [], venues: [] }}
      menuId={MENU}
    />,
    { locale },
  )
}

const level = () => screen.getByRole('group', { name: 'Level of detail' })
const advanced = async () => {
  await userEvent.click(within(level()).getByRole('button', { name: 'Advanced' }))
}
/** Opens a part from the list of parts (D159), back to the list first when another is open. */
async function openPart(id: string) {
  const back = screen.queryByTestId('design-part-back')
  if (back !== null) await userEvent.click(back)
  await userEvent.click(screen.getByTestId(`design-part-${id}`))
}
/** The part open in the panel, or null for the list. */
const opened = () => screen.queryByTestId('design-part-page')?.dataset.part ?? null
const title = () => screen.getByTestId('design-part-title')
const rows = () => screen.getAllByTestId('design-option')
const row = (page: string, option: string) =>
  rows().find((r) => r.dataset.page === page && r.dataset.option === option) as HTMLElement
const tile = (page: string, option: string, value: string) =>
  within(row(page, option))
    .getAllByTestId('design-tile')
    .find((t) => t.dataset.value === value) as HTMLElement
const radioOf = (element: HTMLElement) => within(element).getByRole('radio') as HTMLInputElement
const done = () => screen.getByTestId('design-done') as HTMLButtonElement
const undo = () => screen.getByTestId('design-undo') as HTMLButtonElement

/** A tap on a marked part of the preview, as the frame's page reports it. */
async function tapPart(marker: string) {
  await waitFor(() => expect(screen.getByTestId('design-preview-frame')).toBeTruthy())
  const stores = (
    window as unknown as { __restroDesignFrames: Map<string, { tap(m: string): void }> }
  ).__restroDesignFrames
  act(() => stores.get('main')?.tap(marker))
}

describe('Advanced on the Design page', () => {
  it('lists the Style, colours and fonts, then General and the thirteen pages from the contract', async () => {
    setup()
    expect(screen.queryByTestId('design-advanced-panel')).toBeNull()
    await advanced()
    const list = screen.getByTestId('design-part-list')
    expect(
      within(list)
        .getAllByRole('button')
        .map((entry) => entry.dataset.part),
    ).toEqual(['style', 'colours', 'fonts', ...DESIGN_PAGES.map((page) => page.id)])
    // The pages sit under "Parts of the menu", General first, each with its summary.
    const parts = screen.getByRole('region', { name: 'Parts of the menu' })
    const rows = within(parts).getAllByRole('button')
    expect(rows).toHaveLength(DESIGN_PAGES.length)
    expect(DESIGN_PAGES).toHaveLength(14)
    expect(rows.map((entry) => entry.getAttribute('aria-label')?.split(':')[0])).toEqual(
      DESIGN_PAGES.map((page) => page.en),
    )
    expect(rows[0]?.dataset.part).toBe('general')
    expect(screen.getByTestId('design-part-items').getAttribute('aria-label')).toBe(
      'Items: Rows · Medium',
    )
    // Layout is the Items page's in Advanced, not a row of its own.
    expect(screen.queryByTestId('design-part-layout')).toBeNull()
  })

  it('draws every option of every page as a row of tiles, one tile for each value', async () => {
    setup()
    await advanced()
    for (const page of DESIGN_PAGES) {
      await openPart(page.id)
      expect(title().textContent).toBe(page.en)
      for (const option of optionsOfPage(page)) {
        if (option.kind !== 'choice') continue
        const tiles = within(row(page.id, option.id)).getAllByTestId('design-tile')
        expect(tiles.map((entry) => entry.dataset.value)).toEqual(
          shownValues<{ readonly id: string }>(option.values).map((v) => v.id),
        )
      }
    }
  })

  it('picking a tile changes the draft at once and is one Undo step; Done saves it', async () => {
    setup()
    await advanced()
    await openPart('items')
    expect(radioOf(tile('items', 'frame', 'rows')).checked).toBe(true)
    await userEvent.click(radioOf(tile('items', 'frame', 'cards')))
    expect(radioOf(tile('items', 'frame', 'cards')).checked).toBe(true)
    expect(undo().disabled).toBe(false)
    await userEvent.click(undo())
    expect(radioOf(tile('items', 'frame', 'rows')).checked).toBe(true)
    expect(undo().disabled).toBe(true)

    await userEvent.click(radioOf(tile('items', 'frame', 'cards')))
    // The row's summary says it.
    await userEvent.click(screen.getByTestId('design-part-back'))
    expect(screen.getByTestId('design-part-items').getAttribute('aria-label')).toBe(
      'Items: Cards · Medium',
    )
    await userEvent.click(done())
    await waitFor(() => expect(actions.saveDesignAction).toHaveBeenCalledTimes(1))
    expect(actions.saveDesignAction.mock.lastCall?.[0]).toMatchObject({
      expectedRevision: 3,
      design: { values: { items: { frame: 'cards' } } },
    })
  })

  it('switching between Simple and Advanced keeps the draft', async () => {
    setup()
    await advanced()
    await openPart('header')
    await userEvent.click(radioOf(tile('header', 'band', 'ink')))
    // Simple has no Header page: the list.
    await userEvent.click(within(level()).getByRole('button', { name: 'Simple' }))
    expect(screen.getByTestId('design-part-list')).toBeTruthy()
    expect(screen.getByTestId('design-unsaved')).toBeTruthy()
    await advanced()
    await openPart('header')
    expect(radioOf(tile('header', 'band', 'ink')).checked).toBe(true)
  })

  it('General holds only its page-wide options: the Style, colours and fonts are rows above it', async () => {
    setup()
    await advanced()
    await openPart('general')
    expect(screen.queryByTestId('design-style-tiles')).toBeNull()
    expect(screen.queryByLabelText('Your brand colour')).toBeNull()
    expect(screen.queryByTestId('design-body-font')).toBeNull()
    expect(screen.queryByTestId('design-heading-font')).toBeNull()
    expect(rows().map((entry) => entry.dataset.option)).toEqual([
      'screen',
      'heading_weight',
      'corners',
      'depth',
      'density',
      'text_size',
      'buttons',
    ])
    expect(within(row('general', 'text_size')).getAllByTestId('design-tile')).toHaveLength(2)
  })

  it('a tap on a marked part opens the page that owns it, for every page', async () => {
    setup()
    await advanced()
    for (const page of DESIGN_PAGES) {
      // The first marker of each page; General is opened by a tap on a button, the others by theirs.
      const marker = page.markers[0]
      if (marker === undefined) continue
      await tapPart(marker)
      await waitFor(() => expect(opened()).toBe(page.id))
      expect(title().textContent).toBe(page.en)
    }
  })

  it('a tap on a part inside a page (a dotted marker) opens the page too', async () => {
    setup()
    await advanced()
    await tapPart('item.name')
    await waitFor(() => expect(opened()).toBe('items'))
    await tapPart('item.photo')
    await waitFor(() => expect(opened()).toBe('photos'))
    await tapPart('bill.lines')
    await waitFor(() => expect(opened()).toBe('bill'))
    // A part of the panel's own (the fonts) is no page: a tap opens the part's page.
    await openPart('fonts')
    await tapPart('header.title')
    await waitFor(() => expect(opened()).toBe('header'))
  })

  it('shows sizes small to large, whatever the contract lists first (R5)', async () => {
    const sizes = [{ id: 'm' }, { id: 's' }, { id: 'l' }, { id: 'xl' }]
    expect(shownValues(sizes).map((v) => v.id)).toEqual(['s', 'm', 'l', 'xl'])
    const words = [{ id: 'rows' }, { id: 'cards' }]
    expect(shownValues(words)).toBe(words)
    // Counts read upwards, "all" last.
    const lines = [{ id: '2' }, { id: '1' }, { id: '3' }, { id: 'all' }]
    expect(shownValues(lines).map((v) => v.id)).toEqual(['1', '2', '3', 'all'])
    setup()
    await advanced()
    await openPart('items')
    const tiles = within(row('items', 'name_size')).getAllByTestId('design-tile')
    expect(tiles.map((entry) => entry.dataset.value)).toEqual(['s', 'm', 'l'])
  })

  it('a tap on a dish while the Dish page is open stays there, and the preview opens a dish (S6, S10)', async () => {
    // The tap that opens the dish lands on its name: the open page is about what it opens.
    expect(pageOfTap('item.name', 'dish', 'dish')).toBeNull()
    expect(pageOfTap('item.name', null, 'dish')).toBe('items')
    expect(pageOfTap('item.name', 'dish', 'header')).toBe('items')
    // The section a dish sits in is not the tap's: with Sections open, a dish's parts open theirs.
    expect(pageOfTap('item.name', 'dish', 'sections')).toBe('items')
    expect(pageOfTap('item.photo', 'dish', 'items')).toBe('photos')
    expect(pageOfTap('item.labels', null, 'items')).toBe('labels')
    expect(pageOfTap('section.title', null, 'sections')).toBeNull()
    setup()
    await advanced()
    await openPart('dish')
    await waitFor(() => expect(screen.getByTestId('design-preview-frame')).toBeTruthy())
    const stores = (
      window as unknown as {
        __restroDesignFrames: Map<string, { tap(m: string, opens?: string | null): void }>
      }
    ).__restroDesignFrames
    act(() => stores.get('main')?.tap('item.name', 'dish'))
    expect(opened()).toBe('dish')
    // On Sections, a tap on a dish's photo opens Photos, though the dish sits in a section.
    await openPart('sections')
    act(() => stores.get('main')?.tap('item.photo', 'dish'))
    await waitFor(() => expect(opened()).toBe('photos'))
  })

  it('in Simple a tap on an Advanced part says so, and Show Advanced opens its page', async () => {
    setup()
    expect(screen.queryByTestId('design-styled-in-advanced')).toBeNull()
    await tapPart('item.name')
    const banner = await screen.findByTestId('design-styled-in-advanced')
    expect(banner.textContent).toContain('Styled in Advanced')
    // Simple stays as it was.
    expect(screen.getByTestId('design-part-list')).toBeTruthy()
    await userEvent.click(within(banner).getByRole('button', { name: 'Show Advanced' }))
    expect(screen.queryByTestId('design-styled-in-advanced')).toBeNull()
    expect(opened()).toBe('items')
    expect(document.activeElement).toBe(title())
  })

  it('the note can be closed, and goes when the level changes', async () => {
    setup()
    await tapPart('header')
    const banner = await screen.findByTestId('design-styled-in-advanced')
    await userEvent.click(within(banner).getByRole('button', { name: 'Close this note' }))
    expect(screen.queryByTestId('design-styled-in-advanced')).toBeNull()
  })

  it('Photo corners are off while the Frame is edge to edge, with the hint', async () => {
    setup()
    await advanced()
    await openPart('photos')
    // Basic draws the photos edge to edge or inset; make it edge to edge, then look.
    await userEvent.click(radioOf(tile('photos', 'frame', 'bleed')))
    const corners = row('photos', 'corners')
    expect((corners as HTMLFieldSetElement).disabled).toBe(true)
    expect(within(corners).getByTestId('design-option-note').textContent).toBe(
      'Edge-to-edge photos have no corners of their own',
    )
    // The disabled state is exposed and described.
    expect(corners.getAttribute('aria-describedby')).toBe(
      within(corners).getByTestId('design-option-note').id,
    )
    for (const entry of within(corners).getAllByRole('radio')) {
      expect((entry as HTMLInputElement).disabled).toBe(true)
    }
    // A row that does not apply draws no pictures (C8).
    expect(within(corners).queryAllByTestId('design-tile-picture')).toHaveLength(0)
    await userEvent.click(radioOf(tile('photos', 'frame', 'inset')))
    expect((row('photos', 'corners') as HTMLFieldSetElement).disabled).toBe(false)
    expect(within(row('photos', 'corners')).queryByTestId('design-option-note')).toBeNull()
  })

  it('the heading weight row notes a font that has no Heavy', async () => {
    const lora = THEME_FONTS.find((font) => font.id === 'lora')
    expect(lora?.heaviest).toBeLessThan(850)
    const inLora = {
      ...DEFAULT_DESIGN,
      values: {
        ...DEFAULT_DESIGN.values,
        general: { ...DEFAULT_DESIGN.values.general, body_font: 'lora', heading_font: 'same' },
      },
    } as DesignView['design']
    setup()
    await advanced()
    await openPart('general')
    expect(within(row('general', 'heading_weight')).queryByTestId('design-option-note')).toBeNull()
    cleanup()
    setup({ design: inLora, theme: designThemeOf(inLora) })
    await advanced()
    await openPart('general')
    expect(
      within(row('general', 'heading_weight')).getByTestId('design-option-note').textContent,
    ).toContain('Lora has no weight heavier than 700')
  })

  it('a role that may not edit sees the list, opens a page and finds every tile off', async () => {
    setup({ canEdit: false })
    expect(screen.getByTestId('design-read-only')).toBeTruthy()
    await advanced()
    expect(screen.getByRole('region', { name: 'Parts of the menu' })).toBeTruthy()
    await openPart('items')
    for (const entry of within(row('items', 'frame')).getAllByRole('radio')) {
      expect((entry as HTMLInputElement).disabled).toBe(true)
    }
    // The pictures still draw for a member who may only look (C8).
    for (const entry of within(row('items', 'frame')).getAllByTestId('design-tile')) {
      expect(within(entry).getByTestId('design-tile-picture')).toBeTruthy()
    }
    expect(screen.queryByTestId('design-done')).toBeNull()
  })

  it('shows the Bulgarian pages and the long labels in Bulgarian', async () => {
    setup({}, 'bg')
    await userEvent.click(
      within(screen.getByRole('group', { name: 'Ниво на детайлност' })).getByRole('button', {
        name: 'Разширено',
      }),
    )
    const parts = screen.getByRole('region', { name: 'Части на менюто' })
    expect(
      within(parts)
        .getAllByRole('button')
        .map((entry) => entry.getAttribute('aria-label')?.split(':')[0]),
    ).toEqual(DESIGN_PAGES.map((page) => page.bg))
    expect(screen.getByTestId('design-part-items').getAttribute('aria-label')).toBe(
      'Артикули: Редове · Среден',
    )
    expect(screen.getByTestId('design-part-style').getAttribute('aria-label')).toMatch(/^Стил: /)
    await openPart('items')
    expect(screen.getByRole('button', { name: 'Назад към всички части' }).textContent).toBe('Назад')
    expect(within(row('items', 'portion_place')).getByText('Място на порцията')).toBeTruthy()
    expect(within(row('items', 'portion_place')).getByText('На отделен ред')).toBeTruthy()
  })
})

describe('a tile keeps its picture', () => {
  it('builds it again only when something it draws changes, not on every render of the page (C10)', () => {
    const look = { theme: designThemeOf(DEFAULT_DESIGN), values: DEFAULT_DESIGN.values }
    const props = {
      specimen: specimenOf(fixture('with-images').snapshot, { services: false, strip: false }),
      overlay: { version: 1, items: {} },
      look,
      pageId: 'items',
      optionId: 'frame',
      value: 'cards',
      scheme: 'light' as const,
      services: false,
      plan: tilePlanOf('items', 'frame'),
    }
    const { result, rerender } = renderHook((p: typeof props) => useTileContent(p), {
      initialProps: props,
    })
    const first = result.current
    expect(first).not.toBeNull()
    rerender({ ...props })
    expect(result.current).toBe(first)
    rerender({ ...props, value: 'rows' })
    expect(result.current).not.toBe(first)
  })
})

describe('the panel is driven by the contract file', () => {
  it('an option added to the contract is a row with tiles, with no page code changed', () => {
    const planted: DesignPage = {
      ...DESIGN_PAGES[3],
      options: [
        ...DESIGN_PAGES[3].options,
        {
          id: 'planted',
          kind: 'choice',
          en: 'Planted',
          bg: 'Засадено',
          values: [
            { id: 'one', en: 'One', bg: 'Едно' },
            { id: 'two', en: 'Two', bg: 'Две' },
          ],
        },
      ],
    }
    render(
      <NextIntlClientProvider locale="en" messages={MESSAGES.en}>
        <AdvancedPanel
          venueId={VENUE}
          locale="en"
          page={planted}
          values={DEFAULT_DESIGN.values}
          theme={designThemeOf(DEFAULT_DESIGN)}
          draft={{ state: 'loading' }}
          scheme="light"
          canEdit
          onPick={() => undefined}
        />
      </NextIntlClientProvider>,
    )
    const added = rows().find((r) => r.dataset.option === 'planted') as HTMLElement
    expect(within(added).getByText('Planted')).toBeTruthy()
    expect(
      within(added)
        .getAllByTestId('design-tile')
        .map((t) => t.dataset.value),
    ).toEqual(['one', 'two'])
  })

  it('a page added to the contract is a row of the list, with no page code changed', () => {
    const planted: DesignPage = {
      ...DESIGN_PAGES[3],
      id: 'planted' as DesignPage['id'],
      en: 'Planted',
      bg: 'Засадено',
    }
    render(
      <NextIntlClientProvider locale="en" messages={MESSAGES.en}>
        <PartList
          list={partListOf('advanced', [...DESIGN_PAGES, planted])}
          draft={draftOf(SAVED)}
          styles={{ saved: [], venues: [] }}
          locale="en"
          onOpen={() => undefined}
          rowRef={() => () => undefined}
        />
      </NextIntlClientProvider>,
    )
    const parts = within(screen.getByRole('region', { name: 'Parts of the menu' })).getAllByRole(
      'button',
    )
    expect(parts).toHaveLength(DESIGN_PAGES.length + 1)
    expect(parts.at(-1)?.dataset.part).toBe('planted')
    expect(parts.at(-1)?.textContent).toContain('Planted')
  })
})
