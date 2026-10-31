// @vitest-environment jsdom

import type { Locale, ViewModel } from '@restro/shell'
import { fixture } from '@restro/shell/testing'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { EditorialMarketFace, type EditorialMarketFaceProps } from './face'
import { photoSizes } from './model'
import { firstImage, itemsOf, richView, viewOf } from './test-views'

// Rendering a whole menu in jsdom is slow when the whole suite runs in parallel on this PC: allow
// 15 s per test (a real hang still fails, only later).
vi.setConfig({ testTimeout: 15_000 })

const view = richView()
const hummus = itemsOf(view)[0]
if (hummus === undefined) throw new Error('the test menu is empty')

/** jsdom has no `matchMedia`; `reduceMotion` is what the guest's device says. */
function stubMatchMedia(reduceMotion: boolean) {
  window.matchMedia = ((query: string) => ({
    matches: reduceMotion && query.includes('prefers-reduced-motion: reduce'),
    media: query,
    onchange: null,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    addListener: () => undefined,
    removeListener: () => undefined,
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia
}

beforeEach(() => {
  stubMatchMedia(true)
  window.sessionStorage.clear()
  window.history.replaceState(null, '', '/')
})

afterEach(() => {
  // Testing Library only cleans up by itself when test globals are on; they are off here.
  cleanup()
  vi.restoreAllMocks()
  document.body.style.overflow = ''
})

const draw = (props: Partial<EditorialMarketFaceProps> = {}) =>
  render(<EditorialMarketFace view={view} {...props} />)

/** The names of the items that are not hidden by a filter. */
function visibleNames(container: HTMLElement): string[] {
  return [...container.querySelectorAll<HTMLElement>('[data-item]')]
    .filter((card) => !card.hidden)
    .map((card) => card.querySelector('[data-slot="item.name"]')?.textContent ?? '')
}

/** The test menu with other section layouts (D92) and, if given, another menu layout. */
function withLayouts(
  sections: readonly ('vertical' | 'horizontal')[],
  layout: ViewModel['layout'] = view.layout,
): ViewModel {
  return {
    ...view,
    layout,
    sections: view.sections.map((section, index) => ({
      ...section,
      hints: { ...section.hints, layout: sections[index] ?? 'vertical' },
    })),
  }
}

/** The top-level sections, in order, and whether each is hidden. */
const sectionsOf = (container: HTMLElement) => [
  ...container.querySelectorAll<HTMLElement>('section.rm-section'),
]

const openFilterSheet = () => {
  fireEvent.click(screen.getByRole('button', { name: 'Filter the menu' }))
  return screen.getByRole('dialog', { name: 'Filter the menu' })
}

describe('the layout', () => {
  it('starts in two columns and the switch changes it', () => {
    const { container } = draw()
    const root = container.querySelector('.rm')
    expect(root?.getAttribute('data-layout')).toBe('two')
    expect(screen.getByRole('radiogroup', { name: 'Menu layout' })).toBeTruthy()
    expect(screen.getByRole('radio', { name: '2 columns' }).getAttribute('aria-checked')).toBe(
      'true',
    )

    fireEvent.click(screen.getByRole('radio', { name: 'List' }))
    expect(root?.getAttribute('data-layout')).toBe('list')
    expect(screen.getByRole('radio', { name: 'List' }).getAttribute('aria-checked')).toBe('true')
    fireEvent.click(screen.getByRole('radio', { name: '1 column' }))
    expect(root?.getAttribute('data-layout')).toBe('one')
    expect(window.sessionStorage.getItem('rm-layout')).toBe('one')
  })

  it('moves the choice with the arrow keys, and only the chosen button is in the tab order', () => {
    const { container } = draw()
    const two = screen.getByRole('radio', { name: '2 columns' })
    expect(two.getAttribute('tabindex')).toBe('0')
    expect(screen.getByRole('radio', { name: 'List' }).getAttribute('tabindex')).toBe('-1')
    fireEvent.keyDown(two, { key: 'ArrowRight' })
    expect(container.querySelector('.rm')?.getAttribute('data-layout')).toBe('list')
    expect(document.activeElement).toBe(screen.getByRole('radio', { name: 'List' }))
    fireEvent.keyDown(document.activeElement as Element, { key: 'ArrowLeft' })
    expect(container.querySelector('.rm')?.getAttribute('data-layout')).toBe('two')
  })

  it('starts in the layout of the menu (view.layout, from the design)', () => {
    for (const layout of ['list', 'one', 'two'] as const) {
      const { container, unmount } = draw({
        view: { ...view, layout: { default: layout, guestSwitch: true } },
      })
      expect(container.querySelector('.rm')?.getAttribute('data-layout')).toBe(layout)
      unmount()
    }
  })

  it('reads none of the retired template options (layout, layoutSwitch, featureFirstSection)', () => {
    const { container } = draw({
      options: { layout: 'list', layoutSwitch: false, featureFirstSection: false },
    })
    expect(container.querySelector('.rm')?.getAttribute('data-layout')).toBe('two')
    expect(screen.getByRole('radiogroup', { name: 'Menu layout' })).toBeTruthy()
    expect(sectionsOf(container)[0]?.classList.contains('is-feature')).toBe(true)
  })

  it("lets the guest's remembered choice win while the switch is shown", () => {
    window.sessionStorage.setItem('rm-layout', 'one')
    const { container } = draw({
      view: { ...view, layout: { default: 'list', guestSwitch: true } },
    })
    expect(container.querySelector('.rm')?.getAttribute('data-layout')).toBe('one')
  })

  it('ignores a remembered value that is not a layout', () => {
    window.sessionStorage.setItem('rm-layout', 'banana')
    const { container } = draw()
    expect(container.querySelector('.rm')?.getAttribute('data-layout')).toBe('two')
  })

  it('works when the storage is not available (a private window)', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied')
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('denied')
    })
    const { container } = draw()
    fireEvent.click(screen.getByRole('radio', { name: 'List' }))
    expect(container.querySelector('.rm')?.getAttribute('data-layout')).toBe('list')
  })

  it('draws no switch when the menu does not let guests switch, and then the remembered choice does not apply', () => {
    window.sessionStorage.setItem('rm-layout', 'one')
    const { container } = draw({
      view: { ...view, layout: { default: 'list', guestSwitch: false } },
    })
    expect(screen.queryByRole('radiogroup')).toBeNull()
    expect(screen.queryByRole('radio')).toBeNull()
    expect(container.querySelector('.rm')?.getAttribute('data-layout')).toBe('list')
  })

  it('shows the switch under the title of the section after the photo-led strip', () => {
    const { container } = draw()
    const [first, second, third] = sectionsOf(container)
    expect(first?.classList.contains('is-feature')).toBe(true)
    expect(first?.querySelector('.rm-layout')).toBeNull()
    expect(second?.querySelector('.rm-layout')).not.toBeNull()
    expect(third?.querySelector('.rm-layout')).toBeNull()
    expect(container.querySelectorAll('.rm-layout')).toHaveLength(1)
  })

  it('draws the first section like the others when it is not marked horizontal', () => {
    const { container } = draw({ view: withLayouts(['vertical', 'vertical', 'vertical']) })
    expect(container.querySelector('.is-feature')).toBeNull()
    const [first, second] = sectionsOf(container)
    expect(first?.getAttribute('data-section-layout')).toBe('vertical')
    expect(first?.querySelector('.rm-layout')).not.toBeNull()
    expect(second?.querySelector('.rm-layout')).toBeNull()
  })

  it('draws any section marked horizontal as the strip, not only the first (D92)', () => {
    const { container } = draw({ view: withLayouts(['vertical', 'horizontal', 'vertical']) })
    const [first, second, third] = sectionsOf(container)
    expect(first?.classList.contains('is-feature')).toBe(false)
    expect(second?.classList.contains('is-feature')).toBe(true)
    expect(second?.getAttribute('data-section-layout')).toBe('horizontal')
    expect(third?.classList.contains('is-feature')).toBe(false)
    // The switch sits under the first section that is not a strip.
    expect(first?.querySelector('.rm-layout')).not.toBeNull()
    expect(container.querySelectorAll('.rm-layout')).toHaveLength(1)
    // A strip that is not at the top of the page loads its photos lazily, like the rest.
    for (const image of second?.querySelectorAll('img') ?? []) {
      expect(image.getAttribute('loading')).toBe('lazy')
    }
  })

  it('draws two strips when two sections are marked horizontal', () => {
    const { container } = draw({ view: withLayouts(['horizontal', 'vertical', 'horizontal']) })
    expect(
      sectionsOf(container).map((section) => section.classList.contains('is-feature')),
    ).toEqual([true, false, true])
    expect(sectionsOf(container)[1]?.querySelector('.rm-layout')).not.toBeNull()
  })

  it('carries the switch as the menu.layout_switch slot (the contract checks it, D92)', () => {
    const { container } = draw()
    expect(container.querySelectorAll('[data-slot="menu.layout_switch"]')).toHaveLength(1)
    cleanup()
    const off = draw({ view: { ...view, layout: { default: 'two', guestSwitch: false } } })
    expect(off.container.querySelector('[data-slot="menu.layout_switch"]')).toBeNull()
  })

  it('keeps the switch reachable when a filter hides the section it sat in', () => {
    const { container } = draw()
    const sheet = openFilterSheet()
    fireEvent.click(within(sheet).getByRole('button', { name: 'Vegetarian' }))
    // Only Halloumi (starters) and Cheesecake (desserts) are vegetarian: the mains are gone.
    const [, mains, desserts] = sectionsOf(container)
    expect(mains?.hidden).toBe(true)
    expect(container.querySelectorAll('.rm-layout')).toHaveLength(1)
    expect(desserts?.querySelector('.rm-layout')).not.toBeNull()
  })
})

describe('the dish page', () => {
  const opener = () => screen.getByRole('button', { name: /^Hummus/ })

  it('opens as #item-<id> in a dialog named after the dish; Back closes it and returns the focus', async () => {
    draw()
    const card = opener()
    fireEvent.click(card)

    const dialog = screen.getByRole('dialog', { name: 'Hummus' })
    expect(window.location.hash).toBe(`#item-${hummus.id}`)
    expect(within(dialog).getByRole('heading', { name: 'Hummus' })).toBeTruthy()
    expect(within(dialog).getByText('Chickpeas, tahini and lemon.')).toBeTruthy()
    expect(document.body.style.overflow).toBe('hidden')
    // The close control is focused, and is the way back.
    expect(document.activeElement).toBe(
      within(dialog).getByRole('button', { name: 'Back to menu' }),
    )

    fireEvent.click(within(dialog).getByRole('button', { name: 'Back to menu' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(document.activeElement).toBe(card)
    expect(window.location.hash).toBe('')
    // The page scrolls again (the sheet's clean-up runs just after it leaves the DOM).
    await waitFor(() => expect(document.body.style.overflow).toBe(''))
  })

  it('closes on Escape and returns the focus', async () => {
    draw()
    const card = opener()
    fireEvent.click(card)
    expect(screen.getByRole('dialog', { name: 'Hummus' })).toBeTruthy()
    fireEvent.keyDown(window, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(document.activeElement).toBe(card)
  })

  it("closes with the phone's back button", async () => {
    draw()
    fireEvent.click(opener())
    expect(screen.getByRole('dialog', { name: 'Hummus' })).toBeTruthy()
    await act(async () => {
      window.history.back()
    })
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it('opens from a shared link and cleans the address when it closes', async () => {
    window.history.replaceState(null, '', `/#item-${hummus.id}`)
    draw()
    expect(await screen.findByRole('dialog', { name: 'Hummus' })).toBeTruthy()
    fireEvent.keyDown(window, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(window.location.hash).toBe('')
  })

  it('draws no dialog for a link that names no dish or is malformed', () => {
    for (const hash of ['#item-nd_does_not_exist', '#item-%E0%A4%A', '#rm-nd_whatever', '#item-']) {
      window.history.replaceState(null, '', `/${hash}`)
      const { unmount } = draw()
      expect(screen.queryByRole('dialog')).toBeNull()
      unmount()
    }
  })

  it('slides out before it goes when motion is allowed', async () => {
    stubMatchMedia(false)
    draw()
    fireEvent.click(opener())
    fireEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Back to menu' }),
    )
    await waitFor(() => expect(document.querySelector('.rm-overlay.is-leaving')).not.toBeNull())
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull(), { timeout: 2000 })
  })

  it('shows the dish whole: the full description, dietary labels, allergens and price', () => {
    draw()
    fireEvent.click(screen.getByRole('button', { name: /^Burger/ }))
    const dialog = screen.getByRole('dialog', { name: 'Burger' })
    expect(
      within(dialog).getByText(
        'A beef patty, cheddar, pickles and house sauce in a toasted brioche bun.',
      ),
    ).toBeTruthy()
    expect(dialog.querySelector('.rm-detail-allergens')?.textContent).toBe(
      'Allergens: Gluten · Milk · Eggs',
    )
    const burger = itemsOf(view).find((item) => item.name.text === 'Burger')
    expect(burger?.price?.text).toBeTruthy()
    expect(dialog.querySelector('.rm-detail-bar strong')?.textContent).toBe(burger?.price?.text)
    expect(dialog.querySelector('.rm-detail-title strong')?.textContent).toBe(burger?.price?.text)
  })

  it('names the dish in its own language when the text is a fallback', () => {
    const french = richView('fr_FR')
    render(<EditorialMarketFace view={french} />)
    fireEvent.click(screen.getByRole('button', { name: /^Hummus/ }))
    const dialog = screen.getByRole('dialog', { name: 'Hummus' })
    expect(dialog.querySelector('.rm-overlay-head > span')?.getAttribute('lang')).toBe('en-US')
  })
})

describe('the filters', () => {
  it('is reached by a button in the header and not drawn when the menu has nothing to filter by', () => {
    const { unmount } = draw()
    expect(screen.getByRole('button', { name: 'Filter the menu' })).toBeTruthy()
    unmount()
    draw({ view: { ...view, filters: { dietary: [], tags: [] } } })
    expect(screen.queryByRole('button', { name: 'Filter the menu' })).toBeNull()
  })

  it('marks the filter button as the menu.filters slot', () => {
    const { container } = draw()
    const slots = container.querySelectorAll('[data-slot="menu.filters"]')
    expect(slots).toHaveLength(1)
    expect(slots[0]).toBe(screen.getByRole('button', { name: 'Filter the menu' }))
  })

  it('is not drawn when the venue switched filters off, though the menu has chips (R15)', () => {
    const off = viewOf(fixture('features-off'))
    expect(off.filters.tags.length + off.filters.dietary.length).toBeGreaterThan(0)
    expect(off.features.filters).toBe(false)
    const { container } = draw({ view: off })
    expect(screen.queryByRole('button', { name: 'Filter the menu' })).toBeNull()
    expect(container.querySelector('[data-slot="menu.filters"]')).toBeNull()
    // The menu itself is all there.
    expect(visibleNames(container)).toHaveLength(itemsOf(off).length)
  })

  it('is drawn when the venue left filters on and the menu has chips (R15)', () => {
    const on = viewOf(fixture('features-on'))
    expect(on.features.filters).toBe(true)
    const { container } = draw({ view: on })
    expect(container.querySelectorAll('[data-slot="menu.filters"]')).toHaveLength(1)
  })

  it('shows the whole menu again, and no stale sheet, when filters are switched off under a guest', () => {
    const on = viewOf(fixture('features-on'))
    const off: ViewModel = { ...on, features: { ...on.features, filters: false } }
    const { container, rerender } = draw({ view: on })
    const sheet = openFilterSheet()
    fireEvent.click(within(sheet).getByRole('button', { name: 'Vegan' }))
    expect(visibleNames(container).length).toBeLessThan(itemsOf(on).length)

    // The venue changes the setting; the page redraws with the new view model.
    rerender(<EditorialMarketFace view={off} />)
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Filter the menu' })).toBeNull()
    expect(visibleNames(container)).toHaveLength(itemsOf(off).length)
    expect(screen.queryByRole('status')).toBeNull()

    // When the control comes back, the sheet does not open by itself and the filters start clean.
    rerender(<EditorialMarketFace view={on} />)
    expect(screen.getByRole('button', { name: 'Filter the menu' })).toBeTruthy()
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(visibleNames(container)).toHaveLength(itemsOf(on).length)
  })

  it('combines dietary labels with AND and hides a section it has emptied', () => {
    const { container } = draw()
    const sheet = openFilterSheet()
    expect(within(sheet).getByText('Choose one or more labels.')).toBeTruthy()

    fireEvent.click(within(sheet).getByRole('button', { name: 'Vegan' }))
    expect(visibleNames(container)).toEqual(['Hummus', 'Olives', 'Tofu bowl'])
    const [starters, mains, desserts] = sectionsOf(container)
    expect([starters?.hidden, mains?.hidden, desserts?.hidden]).toEqual([false, false, true])

    fireEvent.click(within(sheet).getByRole('button', { name: 'Gluten-free' }))
    expect(visibleNames(container)).toEqual(['Hummus', 'Olives'])
    expect([starters?.hidden, mains?.hidden, desserts?.hidden]).toEqual([false, true, true])
    expect(within(sheet).getByRole('button', { name: 'Vegan' }).getAttribute('aria-pressed')).toBe(
      'true',
    )
  })

  it('counts two taps that land before the page has redrawn', () => {
    const { container } = draw()
    const sheet = openFilterSheet()
    act(() => {
      within(sheet).getByRole('button', { name: 'Vegan' }).click()
      within(sheet).getByRole('button', { name: 'Gluten-free' }).click()
    })
    expect(visibleNames(container)).toEqual(['Hummus', 'Olives'])
  })

  it('combines tags with OR', () => {
    const { container } = draw()
    const sheet = openFilterSheet()
    fireEvent.click(within(sheet).getByRole('button', { name: 'Spicy' }))
    expect(visibleNames(container)).toEqual(['Olives'])
    fireEvent.click(within(sheet).getByRole('button', { name: 'Signature' }))
    expect(visibleNames(container)).toEqual(['Hummus', 'Olives', 'Halloumi', 'Burger'])
    // Dietary labels and tags together: tags are alternatives within, labels are required.
    fireEvent.click(within(sheet).getByRole('button', { name: 'Vegan' }))
    expect(visibleNames(container)).toEqual(['Hummus', 'Olives'])
  })

  it('keeps every item in the markup, in order, whatever is hidden', () => {
    const { container } = draw()
    const before = [...container.querySelectorAll('[data-item]')].map((card) =>
      card.getAttribute('data-item'),
    )
    fireEvent.click(within(openFilterSheet()).getByRole('button', { name: 'Vegan' }))
    const after = [...container.querySelectorAll('[data-item]')].map((card) =>
      card.getAttribute('data-item'),
    )
    expect(after).toEqual(before)
    expect(after).toHaveLength(itemsOf(view).length)
  })

  it('takes the link of a hidden section out of the rail', () => {
    const { container } = draw()
    fireEvent.click(within(openFilterSheet()).getByRole('button', { name: 'Vegan' }))
    const links = [...container.querySelectorAll<HTMLElement>('.rm-sections a')]
    expect(links.map((link) => link.hidden)).toEqual([false, false, true])
  })

  it('says so when nothing matches, and clears from the page and from the sheet', () => {
    const { container } = draw()
    const sheet = openFilterSheet()
    fireEvent.click(within(sheet).getByRole('button', { name: 'Vegan' }))
    fireEvent.click(within(sheet).getByRole('button', { name: 'Vegetarian' }))
    expect(visibleNames(container)).toEqual([])
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()

    const notice = screen.getByRole('status')
    expect(within(notice).getByText('Nothing on the menu matches these filters.')).toBeTruthy()
    fireEvent.click(within(notice).getByRole('button', { name: 'Clear filters' }))
    expect(screen.queryByRole('status')).toBeNull()
    expect(visibleNames(container)).toHaveLength(itemsOf(view).length)
    expect(sectionsOf(container).every((section) => !section.hidden)).toBe(true)

    // And the sheet's own "Clear filters".
    const again = openFilterSheet()
    fireEvent.click(within(again).getByRole('button', { name: 'Spicy' }))
    expect(visibleNames(container)).toEqual(['Olives'])
    fireEvent.click(within(again).getByRole('button', { name: 'Clear filters' }))
    expect(visibleNames(container)).toHaveLength(itemsOf(view).length)
    expect(within(again).getByRole('button', { name: 'Spicy' }).getAttribute('aria-pressed')).toBe(
      'false',
    )
  })

  it('does not say "nothing matches" for a menu that is simply empty', () => {
    draw({ view: { ...view, sections: [] } })
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('closes the sheet with its button and returns the focus to the filter button', () => {
    draw()
    const button = screen.getByRole('button', { name: 'Filter the menu' })
    fireEvent.click(button)
    const sheet = screen.getByRole('dialog', { name: 'Filter the menu' })
    fireEvent.click(within(sheet).getByRole('button', { name: 'Close' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(document.activeElement).toBe(button)
  })

  it('does not take the focus when the page is first drawn', () => {
    draw()
    expect(document.activeElement).toBe(document.body)
  })
})

describe('allergens', () => {
  it('names the allergens on the button and opens the sheet with the whole legend', () => {
    draw()
    const button = screen.getByRole('button', { name: 'Allergens: Sesame' })
    // The code, as the number of the allergen.
    expect(button.querySelector('b')?.textContent).toBe(
      String(view.allergenLegend.find((a) => a.code === 'sesame')?.number),
    )
    fireEvent.click(button)

    const sheet = screen.getByRole('dialog', { name: 'Allergens' })
    const present = [...sheet.querySelectorAll('.is-present')].map((entry) => entry.textContent)
    expect(present).toHaveLength(1)
    expect(present[0]).toContain('Sesame')
    // The legend names every allergen of the menu, the ones this dish lacks included.
    for (const allergen of view.allergenLegend) {
      expect(within(sheet).getByText(allergen.label.text, { exact: false })).toBeTruthy()
    }

    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(document.activeElement).toBe(button)
  })

  it('names a dish with several allergens', () => {
    draw()
    expect(screen.getByRole('button', { name: 'Allergens: Gluten, Milk, Eggs' })).toBeTruthy()
  })

  it('opens from the dish page, on top of it; Escape closes the sheet first, then the page', async () => {
    draw()
    fireEvent.click(screen.getByRole('button', { name: /^Hummus/ }))
    const page = screen.getByRole('dialog', { name: 'Hummus' })
    const info = within(page).getByRole('button', { name: 'Allergens' })
    fireEvent.click(info)
    expect(screen.getAllByRole('dialog')).toHaveLength(2)
    expect(screen.getByRole('dialog', { name: 'Allergens' })).toBeTruthy()

    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.getAllByRole('dialog')).toHaveLength(1)
    expect(screen.getByRole('dialog', { name: 'Hummus' })).toBeTruthy()
    expect(document.activeElement).toBe(info)

    fireEvent.keyDown(window, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it("closes the sheet of a dish page together with the page (the phone's back button)", async () => {
    draw()
    fireEvent.click(screen.getByRole('button', { name: /^Hummus/ }))
    fireEvent.click(
      within(screen.getByRole('dialog', { name: 'Hummus' })).getByRole('button', {
        name: 'Allergens',
      }),
    )
    expect(screen.getAllByRole('dialog')).toHaveLength(2)
    await act(async () => {
      window.history.back()
    })
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it('is not offered on a dish that lists none', () => {
    draw()
    fireEvent.click(screen.getByRole('button', { name: /^Olives/ }))
    expect(
      within(screen.getByRole('dialog', { name: 'Olives' })).queryByRole('button', {
        name: 'Allergens',
      }),
    ).toBeNull()
  })
})

describe('the header', () => {
  it('has no wordmark and no brand text of its own', () => {
    const { container } = draw({ tableLabel: '12', languages: ['en_US', 'bg_BG'] })
    expect(container.textContent).not.toMatch(/restro/i)
    expect(container.innerHTML).not.toMatch(/restro/i)
    expect(container.textContent).not.toMatch(/face\s*01/i)
  })

  it('without a logo shows nothing on the left, and the menu title carries the identity', () => {
    const { container } = draw()
    const bar = container.querySelector('.rm-brandline')
    expect(bar?.querySelector('img')).toBeNull()
    expect([...(bar?.children ?? [])].map((child) => child.className)).toEqual(['rm-headtools'])
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Late Menu')
  })

  it('with a logo draws it, with its files as a srcset', () => {
    const { container } = draw({
      view: { ...view, theme: { ...view.theme, logo: firstImage(view) } },
    })
    const logo = container.querySelector('img.rm-logo')
    expect(logo).not.toBeNull()
    expect(logo?.getAttribute('srcset')).toMatch(/\/cdn\/a\/as_[0-9A-Za-z]+\/w\d+\.webp \d+w/)
    expect(container.textContent).not.toMatch(/restro/i)
  })

  it('calls a menu without a title "Menu"', () => {
    draw({ view: { ...view, menu: { ...view.menu, title: null } } })
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Menu')
  })

  it('shows the table, in the words of the language', () => {
    const { unmount } = draw({ tableLabel: '12' })
    expect(screen.getByText('Table 12')).toBeTruthy()
    unmount()
    draw({ tableLabel: 'VIP 3' })
    expect(screen.getByText('VIP 3')).toBeTruthy()
    cleanup()
    render(<EditorialMarketFace view={richView('bg_BG')} tableLabel="12" />)
    expect(screen.getByText('Маса 12')).toBeTruthy()
  })

  it('shows no table banner without a table', () => {
    const { container } = draw()
    expect(container.querySelector('.rm-table')).toBeNull()
    cleanup()
    const blank = draw({ tableLabel: '  ' })
    expect(blank.container.querySelector('.rm-table')).toBeNull()
  })

  it('shows the language switch with two languages, the current one pressed', () => {
    const changed = vi.fn<(locale: Locale) => void>()
    const { container } = draw({ languages: ['bg_BG', 'en_US'], onLanguageChange: changed })
    const group = screen.getByRole('group', { name: 'Language' })
    const buttons = within(group).getAllByRole('button')
    expect(buttons.map((button) => button.textContent)).toEqual(['BG', 'EN'])
    expect(buttons.map((button) => button.getAttribute('aria-pressed'))).toEqual(['false', 'true'])
    expect(buttons.map((button) => button.getAttribute('lang'))).toEqual(['bg-BG', 'en-US'])
    fireEvent.click(buttons[0] as HTMLElement)
    expect(changed).toHaveBeenCalledWith('bg_BG')
    expect(container.querySelector('.rm-language')).not.toBeNull()
  })

  it('hides the language switch with fewer than two languages', () => {
    const { unmount } = draw()
    expect(screen.queryByRole('group', { name: 'Language' })).toBeNull()
    unmount()
    draw({ languages: ['en_US'] })
    expect(screen.queryByRole('group', { name: 'Language' })).toBeNull()
  })

  it('shows when the menu opens while it is outside its schedule', () => {
    const closed: ViewModel = {
      ...view,
      menu: {
        ...view.menu,
        schedule: {
          opensAt: '2026-10-08T18:00:00+03:00',
          weekday: null,
          text: { text: 'tomorrow from 18:00', lang: 'en_US' },
        },
      },
    }
    draw({ view: closed })
    expect(screen.getByText('Menu tomorrow from 18:00')).toBeTruthy()
  })
})

describe('the sections and items', () => {
  it('has a rail with one link per section, the first one current', () => {
    const { container } = draw()
    const rail = screen.getByRole('navigation', { name: 'Menu sections' })
    const links = within(rail).getAllByRole('link')
    expect(links.map((link) => link.textContent)).toEqual(['Starters', 'Mains', 'Desserts'])
    expect(links.map((link) => link.getAttribute('aria-current'))).toEqual(['true', null, null])
    expect(links.map((link) => link.getAttribute('href'))).toEqual(
      view.sections.map((section) => `#rm-${section.id}`),
    )
    for (const section of view.sections)
      expect(container.querySelector(`#rm-${section.id}`)).not.toBeNull()
  })

  it('makes the tapped link current', () => {
    draw()
    const rail = screen.getByRole('navigation', { name: 'Menu sections' })
    fireEvent.click(within(rail).getByRole('link', { name: 'Desserts' }))
    expect(within(rail).getByRole('link', { name: 'Desserts' }).getAttribute('aria-current')).toBe(
      'true',
    )
    expect(
      within(rail).getByRole('link', { name: 'Starters' }).getAttribute('aria-current'),
    ).toBeNull()
  })

  it('has no rail for a menu with one section', () => {
    const [only] = view.sections
    if (only === undefined) throw new Error('no section')
    draw({ view: { ...view, sections: [only] } })
    expect(screen.queryByRole('navigation')).toBeNull()
  })

  it('puts the badges of a text row in an item.badges slot, as it does for a photo card', () => {
    const { container } = draw()
    const row = container.querySelector(
      '[data-item]:not(.has-photo).is-text [data-slot="item.badges"]',
    )
    expect(row?.textContent).toBe('New')
    const photoCard = container.querySelector('.has-photo .rm-photo [data-slot="item.badges"]')
    expect(photoCard?.textContent).toBe('New')
    const slots = [...container.querySelectorAll('[data-slot="item.badges"]')]
    expect(slots).toHaveLength(2)
    for (const slot of slots) expect(slot.closest('[data-item]')).not.toBeNull()
  })

  it('opens the dish page from the whole card and not from the allergen codes', () => {
    draw()
    fireEvent.click(screen.getByRole('button', { name: 'Allergens: Sesame' }))
    expect(screen.getAllByRole('dialog')).toHaveLength(1)
    expect(window.location.hash).toBe('')
  })

  it('leaves a sold-out dish off the menu (D131)', () => {
    const { container } = draw()
    expect(container.querySelector('[data-item][data-state="sold_out"]')).toBeNull()
    expect(container.textContent).not.toContain('Steak')
  })

  it('draws the footer with the legend, and not without allergens', () => {
    const { container, unmount } = draw()
    expect(container.querySelector('footer.rm-footer')).not.toBeNull()
    expect(container.querySelector('footer h2')?.textContent).toBe('Allergen information')
    unmount()
    const none = draw({ view: { ...view, allergenLegend: [] } })
    expect(none.container.querySelector('footer')).toBeNull()
  })
})

describe('Bulgarian', () => {
  it('speaks Bulgarian: the switch, the filter sheet, the dish page', () => {
    render(<EditorialMarketFace view={richView('bg_BG')} />)
    expect(screen.getByRole('radiogroup', { name: 'Изглед на менюто' })).toBeTruthy()
    expect(screen.getByRole('radio', { name: 'Списък' })).toBeTruthy()
    expect(screen.getByRole('radio', { name: '1 колона' })).toBeTruthy()
    expect(screen.getByRole('radio', { name: '2 колони' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Филтриране на менюто' }))
    const sheet = screen.getByRole('dialog', { name: 'Филтриране на менюто' })
    expect(within(sheet).getByText('Изберете един или повече етикети.')).toBeTruthy()
    fireEvent.keyDown(window, { key: 'Escape' })
    fireEvent.click(screen.getByRole('button', { name: /^Хумус/ }))
    expect(
      within(screen.getByRole('dialog', { name: 'Хумус' })).getByRole('button', {
        name: 'Обратно към менюто',
      }),
    ).toBeTruthy()
  })
})

describe('the audit of the markup (SH-07)', () => {
  it('sets the name of an item as its heading, with the button that opens the dish inside', () => {
    const { container } = draw()
    const card = container.querySelector('[data-item]')
    const heading = card?.querySelector('[data-slot="item.name"] > h3')
    expect(heading?.textContent).toBe('Hummus')
    const open = heading?.querySelector('button.rm-item-open')
    expect(open?.textContent).toBe('Hummus')
    expect(open?.getAttribute('aria-haspopup')).toBe('dialog')
    // A button holds text only: no heading, no block, no arrow element inside it.
    expect(container.querySelectorAll('button :is(div, p, h1, h2, h3, h4, h5, h6)')).toHaveLength(0)
    expect(container.querySelector('.rm-chevron')).toBeNull()
    expect(screen.getByRole('heading', { name: 'Hummus' })).toBe(heading)
  })

  it('names the items of a sub-section with an h4, and those of a section with an h3', () => {
    const [first, second, ...rest] = view.sections
    if (first === undefined || second === undefined) throw new Error('the test menu is too small')
    const nested = {
      ...view,
      sections: [{ ...first, sections: [{ ...second, sections: [] }] }, ...rest],
    }
    const { container } = draw({ view: nested })
    expect(container.querySelectorAll('section.rm-section > .rm-items h3').length).toBeGreaterThan(
      0,
    )
    const inSub = 'section.rm-section section.rm-section'
    expect(container.querySelectorAll(`${inSub} .rm-items h4`)).toHaveLength(second.items.length)
    // The sub-section's own title is an h3, and no item of it is an h3.
    expect(container.querySelector(`${inSub} > .rm-section-head h3`)).not.toBeNull()
    expect(container.querySelectorAll(`${inSub} .rm-items h3`)).toHaveLength(0)
  })

  it('marks the dish’s own allergens in the sheet with aria-current, and no other', () => {
    draw()
    fireEvent.click(screen.getByRole('button', { name: 'Allergens: Sesame' }))
    const sheet = screen.getByRole('dialog', { name: 'Allergens' })
    const marked = [...sheet.querySelectorAll('[aria-current="true"]')]
    expect(marked.map((entry) => entry.textContent)).toEqual([expect.stringContaining('Sesame')])
    expect(marked.every((entry) => entry.classList.contains('is-present'))).toBe(true)
    // A list, with an entry for every allergen of the menu.
    expect(sheet.querySelectorAll('ul.rm-allergen-sheet > li')).toHaveLength(
      view.allergenLegend.length,
    )
  })

  it('sizes the photos by the layout, so a phone takes the smaller file', () => {
    const { container } = draw()
    const sizesOf = () =>
      [
        ...container.querySelectorAll<HTMLImageElement>(
          '.rm-section:not(.is-feature) .rm-photo img',
        ),
      ].map((image) => image.getAttribute('sizes'))
    const strip = container.querySelector('.rm-section.is-feature .rm-photo img')
    // Basic's photos fill their box (the Photos page's bleed).
    expect(strip?.getAttribute('sizes')).toBe(photoSizes('two', true, true))
    const names = { two: '2 columns', one: '1 column', list: 'List' } as const
    for (const layout of ['two', 'one', 'list'] as const) {
      fireEvent.click(screen.getByRole('radio', { name: names[layout] }))
      for (const sizes of sizesOf()) expect(sizes).toBe(photoSizes(layout, false, true))
    }
  })
})
