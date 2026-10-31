// @vitest-environment jsdom
// The Design page's Advanced panel (D129, D130, #176): General and the thirteen pages built from the
// contract file, a row of tiles for every option, a tap on a marked part of the preview opening the
// page that owns it, the switch between Simple and Advanced keeping the draft, rows that do not
// apply, and a role that may not edit. The server actions and the toast are the only fakes; what a
// frame draws is the Playwright spec's (design.spec.ts).
import {
  DEFAULT_DESIGN,
  DESIGN_PAGES,
  type DesignPage,
  designThemeOf,
  THEME_FONTS,
} from '@restro/core'
import { fixture } from '@restro/shell/testing'
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { NextIntlClientProvider } from 'next-intl'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { DesignView } from '@/server/design/service'
import { MESSAGES, renderWithIntl } from '@/test-utils'

import { AdvancedPanel } from './advanced-panel'
import { DesignPage as Page } from './design-page'

const actions = vi.hoisted(() => ({ saveDesignAction: vi.fn(), previewDraftAction: vi.fn() }))
vi.mock('@/server/design/actions', () => ({ saveDesignAction: actions.saveDesignAction }))
vi.mock('@/server/publish/actions', () => ({ previewDraftAction: actions.previewDraftAction }))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }))

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
  actions.saveDesignAction.mockReset().mockResolvedValue({ ok: true, revision: 4 })
  actions.previewDraftAction.mockReset().mockResolvedValue({
    ok: true,
    snapshot: fixture('with-images').snapshot,
    overlay: { version: 1, items: {} },
  })
})

function setup(initial: Partial<DesignView> = {}, locale: 'en' | 'bg' = 'en') {
  return renderWithIntl(
    <Page venueId={VENUE} venueName="Demo Club" initial={{ ...SAVED, ...initial }} menuId={MENU} />,
    { locale },
  )
}

const level = () => screen.getByRole('group', { name: 'Level of detail' })
const advanced = async () => {
  await userEvent.click(within(level()).getByRole('button', { name: 'Advanced' }))
}
const pageChip = (id: string) => screen.getByTestId(`design-page-${id}`)
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
  it('lists General and the thirteen pages, General first, built from the contract', async () => {
    setup()
    expect(screen.queryByTestId('design-advanced-panel')).toBeNull()
    await advanced()
    const chips = within(screen.getByTestId('design-pages')).getAllByRole('button')
    expect(chips).toHaveLength(DESIGN_PAGES.length)
    expect(chips.map((chip) => chip.textContent)).toEqual(DESIGN_PAGES.map((page) => page.en))
    expect(chips[0]?.getAttribute('aria-current')).toBe('page')
    expect(DESIGN_PAGES).toHaveLength(14)
  })

  it('draws every option of every page as a row of tiles, one tile for each value', async () => {
    setup()
    await advanced()
    for (const page of DESIGN_PAGES) {
      await userEvent.click(pageChip(page.id))
      for (const option of page.options) {
        if (option.kind !== 'choice') continue
        // The fonts are Simple's own selects; every other choice is a row of tiles.
        if (option.id === 'body_font' || option.id === 'heading_font') {
          expect(row(page.id, option.id)).toBeTruthy()
          continue
        }
        const tiles = within(row(page.id, option.id)).getAllByTestId('design-tile')
        expect(tiles.map((entry) => entry.dataset.value)).toEqual(option.values.map((v) => v.id))
      }
    }
  })

  it('picking a tile changes the draft at once and is one Undo step; Done saves it', async () => {
    setup()
    await advanced()
    await userEvent.click(pageChip('items'))
    expect(radioOf(tile('items', 'frame', 'rows')).checked).toBe(true)
    await userEvent.click(radioOf(tile('items', 'frame', 'cards')))
    expect(radioOf(tile('items', 'frame', 'cards')).checked).toBe(true)
    expect(undo().disabled).toBe(false)
    await userEvent.click(undo())
    expect(radioOf(tile('items', 'frame', 'rows')).checked).toBe(true)
    expect(undo().disabled).toBe(true)

    await userEvent.click(radioOf(tile('items', 'frame', 'cards')))
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
    await userEvent.click(pageChip('header'))
    await userEvent.click(radioOf(tile('header', 'band', 'ink')))
    await userEvent.click(within(level()).getByRole('button', { name: 'Simple' }))
    expect(screen.getByTestId('design-style-section')).toBeTruthy()
    expect(screen.getByTestId('design-unsaved')).toBeTruthy()
    await advanced()
    // The page that was open is still open, with the pick in it.
    expect(radioOf(tile('header', 'band', 'ink')).checked).toBe(true)
  })

  it("General holds Simple's own controls and the page-wide options", async () => {
    setup()
    await advanced()
    expect(screen.getByTestId('design-style-tiles')).toBeTruthy()
    expect(screen.getByLabelText('Your brand colour')).toBeTruthy()
    expect(screen.getByTestId('design-body-font')).toBeTruthy()
    expect(screen.getByTestId('design-heading-font')).toBeTruthy()
    expect(row('general', 'heading_weight')).toBeTruthy()
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
      await waitFor(() => expect(pageChip(page.id).getAttribute('aria-current')).toBe('page'))
      expect(screen.getByTestId('design-advanced-title').textContent).toBe(page.en)
    }
  })

  it('a tap on a part inside a page (a dotted marker) opens the page too', async () => {
    setup()
    await advanced()
    await tapPart('item.name')
    await waitFor(() => expect(pageChip('items').getAttribute('aria-current')).toBe('page'))
    await tapPart('item.photo')
    await waitFor(() => expect(pageChip('photos').getAttribute('aria-current')).toBe('page'))
    await tapPart('bill.lines')
    await waitFor(() => expect(pageChip('bill').getAttribute('aria-current')).toBe('page'))
  })

  it('in Simple a tap on an Advanced part says so, and Show Advanced opens its page', async () => {
    setup()
    expect(screen.queryByTestId('design-styled-in-advanced')).toBeNull()
    await tapPart('item.name')
    const banner = await screen.findByTestId('design-styled-in-advanced')
    expect(banner.textContent).toContain('Styled in Advanced')
    // Simple stays as it was.
    expect(screen.getByTestId('design-style-section')).toBeTruthy()
    await userEvent.click(within(banner).getByRole('button', { name: 'Show Advanced' }))
    expect(screen.queryByTestId('design-styled-in-advanced')).toBeNull()
    expect(pageChip('items').getAttribute('aria-current')).toBe('page')
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
    await userEvent.click(pageChip('photos'))
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
    expect(within(row('general', 'heading_weight')).queryByTestId('design-option-note')).toBeNull()
    cleanup()
    setup({ design: inLora, theme: designThemeOf(inLora) })
    await advanced()
    expect(
      within(row('general', 'heading_weight')).getByTestId('design-option-note').textContent,
    ).toContain('Lora has no weight heavier than 700')
  })

  it('a role that may not edit sees the pages and every tile off', async () => {
    setup({ canEdit: false })
    expect(screen.getByTestId('design-read-only')).toBeTruthy()
    await advanced()
    await userEvent.click(pageChip('items'))
    for (const entry of within(row('items', 'frame')).getAllByRole('radio')) {
      expect((entry as HTMLInputElement).disabled).toBe(true)
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
    const chips = within(screen.getByTestId('design-pages')).getAllByRole('button')
    expect(chips.map((chip) => chip.textContent)).toEqual(DESIGN_PAGES.map((page) => page.bg))
    await userEvent.click(pageChip('items'))
    expect(within(row('items', 'portion_place')).getByText('Място на порцията')).toBeTruthy()
    expect(within(row('items', 'portion_place')).getByText('На отделен ред')).toBeTruthy()
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
    const pages = [DESIGN_PAGES[0], DESIGN_PAGES[1], DESIGN_PAGES[2], planted]
    render(
      <NextIntlClientProvider locale="en" messages={MESSAGES.en}>
        <AdvancedPanel
          venueId={VENUE}
          locale="en"
          pages={pages}
          open="sections"
          onOpen={() => undefined}
          reveal={false}
          onRevealed={() => undefined}
          values={DEFAULT_DESIGN.values}
          theme={designThemeOf(DEFAULT_DESIGN)}
          draft={{ state: 'loading' }}
          scheme="light"
          canEdit
          custom={{}}
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
    // The page list has the four pages it was given, in their order.
    expect(
      within(screen.getByTestId('design-pages'))
        .getAllByRole('button')
        .map((chip) => chip.textContent),
    ).toEqual(['General', 'Header', 'Navigation', 'Sections'])
  })
})
