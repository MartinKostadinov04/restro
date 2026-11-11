// @vitest-environment jsdom
// The three staged options (D130, #174): allergens by name, the dish page's kind and the heading
// font, with the renderer rules each brings (the weight fallback among them), and the two things
// Editorial drew wrong on a narrow phone (a dish with no photo; a label with no spaces).

import type { DesignValues, ViewModel } from '@restro/shell'
import {
  BASIC_DESIGN_VALUES,
  cssRules,
  designView,
  type HtmlElement,
  parseHtml,
  resolvedCss,
  runDesignContract,
  stubServices,
  valuesOf,
  withAttribute,
  withDesign,
} from '@restro/shell/testing'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { EDITORIAL_CSS, HEAVY_FALLBACKS } from './css'
import { EditorialMarketFace } from './face'
import { EDITORIAL_MARKET_MANIFEST } from './manifest'
import { designVariables } from './model'
import { SERVICES_CSS } from './services/services-css'
import { itemsOf, richFixture } from './test-views'

const CSS = `${EDITORIAL_CSS}\n${SERVICES_CSS}`
const ROOT = '.rm'

/** Every custom property the stylesheet sets on the root but the palette's: what a design works out. */
const TOKENS = [
  ...new Set(
    cssRules(CSS)
      .filter((rule) => rule.media === null && /^\.rm(\[[^\]]+\])*$/.test(rule.selector))
      .flatMap((rule) => rule.declarations.map(([name]) => name))
      .filter((name) => name.startsWith('--'))
      .filter(
        (name) => !/^--rm-(bg|surface|accent|on-accent|text|muted|accent-text|border)$/.test(name),
      ),
  ),
]

type Change = Readonly<Record<string, Readonly<Record<string, string>>>>

/** Basic with a few values changed. */
function design(change: Change): DesignValues {
  const values = structuredClone(BASIC_DESIGN_VALUES) as unknown as Record<
    string,
    Record<string, string>
  >
  for (const [page, options] of Object.entries(change)) {
    values[page] = { ...values[page], ...options }
  }
  return values as unknown as DesignValues
}

const viewOf = (change: Change): ViewModel =>
  designView(withDesign(richFixture(), design(change)), EDITORIAL_MARKET_MANIFEST)

/** jsdom has no `matchMedia`; the guest's device asks for less motion, so a dialog leaves at once. */
function stubMatchMedia() {
  window.matchMedia = ((query: string) => ({
    matches: query.includes('prefers-reduced-motion: reduce'),
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
  stubMatchMedia()
  window.history.replaceState(null, '', '/')
})
afterEach(() => {
  cleanup()
  document.body.style.overflow = ''
})

/** The attributes the design puts on the root. */
const rootOf = (view: ViewModel): Record<string, string> => {
  const html = renderToStaticMarkup(<EditorialMarketFace view={view} />)
  const root = withAttribute(parseHtml(html), 'data-face')[0] as HtmlElement
  return root.attrs as Record<string, string>
}

const burger = (view: ViewModel) => {
  const item = itemsOf(view).find((one) => one.name.text === 'Burger')
  if (item === undefined) throw new Error('the test menu has no Burger')
  return item
}

describe('allergens by name (D130)', () => {
  const card = (container: HTMLElement) =>
    [...container.querySelectorAll('[data-item]')].find((one) =>
      one.textContent?.includes('Burger'),
    ) as HTMLElement

  it('draws the names in words on the row, from the same data, and the numbers as they were', () => {
    const names = render(<EditorialMarketFace view={viewOf({ labels: { allergens: 'names' } })} />)
    const row = card(names.container).querySelector('[data-slot="item.allergens"] button')
    expect(row?.textContent).toBe('Gluten · Milk · Eggs')
    expect(row?.querySelectorAll('b')).toHaveLength(0)
    expect(row?.getAttribute('aria-label')).toBe('Allergens: Gluten, Milk, Eggs')
    cleanup()

    const numbers = render(<EditorialMarketFace view={viewOf({})} />)
    const codes = card(numbers.container).querySelector('[data-slot="item.allergens"] button')
    expect(codes?.textContent).toBe('173')
    expect(codes?.querySelectorAll('b')).toHaveLength(3)
  })

  it('opens the sheet behind the names, which lists names alone and marks the dish’s own', () => {
    const { container } = render(
      <EditorialMarketFace view={viewOf({ labels: { allergens: 'names' } })} />,
    )
    fireEvent.click(card(container).querySelector('[data-slot="item.allergens"] button') as Element)
    const sheet = screen.getByRole('dialog', { name: 'Allergens' })
    expect(sheet.querySelectorAll('li b')).toHaveLength(0)
    expect(sheet.querySelectorAll('li')).toHaveLength(4)
    const own = [...sheet.querySelectorAll('li.is-present')].map((li) => li.textContent)
    expect(own).toEqual(['Gluten', 'Eggs', 'Milk'])
    expect(sheet.querySelector('.rm-overlay-intro')?.textContent).toBe(
      'A filled dot marks what this item contains.',
    )
  })

  it('lists the names without numbers in the footer, and says so', () => {
    const names = render(<EditorialMarketFace view={viewOf({ labels: { allergens: 'names' } })} />)
    const legend = names.container.querySelector('.rm-legend') as HTMLElement
    expect(legend.querySelectorAll('span')).toHaveLength(4)
    expect(legend.querySelectorAll('b')).toHaveLength(0)
    expect(names.container.querySelector('.rm-footer > p')?.textContent).toMatch(/^The names on/)
    cleanup()
    const numbers = render(<EditorialMarketFace view={viewOf({})} />)
    expect(numbers.container.querySelectorAll('.rm-legend b')).toHaveLength(4)
    expect(numbers.container.querySelector('.rm-footer > p')?.textContent).toMatch(/^The codes on/)
  })

  it('keeps the manifest at inline_codes and passes the contract at both values', async () => {
    expect(EDITORIAL_MARKET_MANIFEST.allergen_mode).toBe('inline_codes')
    const report = await runDesignContract({
      manifest: EDITORIAL_MARKET_MANIFEST,
      render: (view, host) =>
        renderToStaticMarkup(
          <EditorialMarketFace view={view} languages={host?.languages} services={stubServices()} />,
        ),
      css: CSS,
      drawn: { labels: ['allergens'] },
      rootSelector: ROOT,
      tokens: TOKENS,
      inkValues: ['var(--rm-text)', 'inherit', 'currentColor'],
    })
    expect(report.failures).toEqual([])
    // Basic's numbers aside, the names are one more case on every fixture.
    expect(report.cases).toBeGreaterThanOrEqual(3)
  }, 300_000)

  it('draws the row’s words at 13 px, with a 44 px target and a wrap for a long name', () => {
    const lines = resolvedCss(CSS, ROOT, rootOf(viewOf({ labels: { allergens: 'names' } })), [])
    for (const line of [
      '.rm[data-labels-allergens="names"] .rm-allergens button { font-size: 13px }',
      '.rm[data-labels-allergens="names"] .rm-allergens button { overflow-wrap: anywhere }',
    ]) {
      expect(lines.replaceAll('calc(13px * var(--rm-type))', '13px')).toContain(line)
    }
    // The base's own 44 px minimum stays under the names.
    expect(lines).toContain('.rm-allergens button { min-height: 44px }')
    expect(resolvedCss(CSS, ROOT, rootOf(viewOf({})), [])).not.toContain(
      'data-labels-allergens="names"',
    )
  })
})

describe('the dish page’s kind (D130)', () => {
  for (const kind of ['sheet', 'page'] as const) {
    describe(`as a ${kind}`, () => {
      const open = () => {
        const view = viewOf({ dish: { kind } })
        const drawn = render(<EditorialMarketFace view={view} />)
        const opener = drawn.container.querySelector(
          `[data-item="${burger(view).id}"] .rm-item-open`,
        ) as HTMLElement
        fireEvent.click(opener)
        return { view, opener, dialog: screen.getByRole('dialog', { name: 'Burger' }) }
      }

      it('opens a dialog named after the dish, on #item-<id>, with the Back control focused', () => {
        const { view, dialog } = open()
        const panel = dialog.querySelector('.rm-overlay-panel') as HTMLElement
        expect(panel.classList.contains(kind === 'sheet' ? 'is-dish' : 'is-detail')).toBe(true)
        expect(panel.classList.contains(kind === 'sheet' ? 'is-detail' : 'is-dish')).toBe(false)
        expect(dialog.getAttribute('aria-modal')).toBe('true')
        expect(window.location.hash).toBe(`#item-${burger(view).id}`)
        const back = within(dialog).getByRole('button', { name: 'Back to menu' })
        expect(document.activeElement).toBe(back)
        expect(document.body.style.overflow).toBe('hidden')
      })

      it('holds the whole dish and the sticky name-and-price bar', () => {
        const { view, dialog } = open()
        expect(within(dialog).getByRole('heading', { name: 'Burger' })).toBeTruthy()
        expect(dialog.querySelector('.rm-detail-allergens')?.textContent).toBe(
          'Allergens: Gluten · Milk · Eggs',
        )
        const bar = dialog.querySelector('.rm-detail-bar') as HTMLElement
        expect(bar.textContent).toContain(burger(view).price?.text)
        const lines = resolvedCss(CSS, ROOT, rootOf(view), [])
        expect(lines).toContain('.rm-detail-bar { position: sticky }')
        expect(lines).toContain('.rm-detail-bar { bottom: 0 }')
      })

      it('closes with Back, with Escape and with the phone’s back button, the focus returning', async () => {
        const { opener, dialog } = open()
        fireEvent.click(within(dialog).getByRole('button', { name: 'Back to menu' }))
        await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
        expect(document.activeElement).toBe(opener)
        expect(window.location.hash).toBe('')

        fireEvent.click(opener)
        expect(screen.getByRole('dialog', { name: 'Burger' })).toBeTruthy()
        fireEvent.keyDown(window, { key: 'Escape' })
        await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())

        fireEvent.click(opener)
        expect(screen.getByRole('dialog', { name: 'Burger' })).toBeTruthy()
        await act(async () => {
          window.history.back()
        })
        await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
      })

      it('lets the allergen sheet open over it and close first', async () => {
        const { dialog } = open()
        fireEvent.click(within(dialog).getByRole('button', { name: 'Allergens' }))
        expect(screen.getAllByRole('dialog')).toHaveLength(2)
        fireEvent.keyDown(window, { key: 'Escape' })
        await waitFor(() => expect(screen.getAllByRole('dialog')).toHaveLength(1))
        expect(screen.getByRole('dialog', { name: 'Burger' })).toBeTruthy()
      })
    })
  }

  it('draws the sheet’s own rules for a sheet and the page’s for a page, never both', () => {
    const sheet = resolvedCss(CSS, ROOT, rootOf(viewOf({ dish: { kind: 'sheet' } })), [])
    const page = resolvedCss(CSS, ROOT, rootOf(viewOf({ dish: { kind: 'page' } })), [])
    expect(sheet).toContain('.is-dish')
    expect(page).not.toContain('.is-dish')
    // The page's rules are keyed on its own class and stay in the stylesheet at both values.
    expect(sheet).toContain('.rm-overlay-panel.is-detail')
    expect(page).toContain('.rm-overlay-panel.is-detail')
  })

  it('takes the sheets’ colour for its fill, at each value', () => {
    const fill = (sheets: string) => {
      const lines = resolvedCss(
        CSS,
        ROOT,
        rootOf(viewOf({ dish: { kind: 'sheet' }, sheets: { sheets } })),
        [],
      ).split('\n')
      // The last declaration wins: the stylesheet lists the panel's, then the page's, then the ink's.
      return lines
        .filter((line) => /\.is-dish \{ --rm-bg: /.test(line))
        .map((line) => /--rm-bg: (.+) \}/.exec(line)?.[1])
        .at(-1)
    }
    expect(fill('panel')).toBe('var(--rm-panel)')
    expect(fill('page')).toBe('var(--rm-page)')
    expect(fill('ink')).toBe('var(--rm-ink)')
  })
})

describe('the heading font (D130)', () => {
  const stacks = { Lora: 'var(--font-lora), "Lora", Georgia, serif' }

  it('loads nothing for `same`, and our own stack for any other font', () => {
    expect(designVariables(design({}), stacks)).toEqual({})
    expect(designVariables(design({ general: { heading_font: 'same' } }), stacks)).toEqual({})
    expect(designVariables(design({ general: { heading_font: 'lora' } }), stacks)).toEqual({
      '--rm-font-heading': stacks.Lora,
    })
    // A host with no stacks names the family and falls back to a system font.
    expect(
      designVariables(design({ general: { heading_font: 'playfair-display' } }))[
        '--rm-font-heading'
      ],
    ).toMatch(/^"Playfair Display", system-ui/)
    // On the root's own style (the stylesheet names the variable too).
    const styleOf = (view: ViewModel) =>
      (
        withAttribute(
          parseHtml(renderToStaticMarkup(<EditorialMarketFace view={view} fontStacks={stacks} />)),
          'data-face',
        )[0] as HtmlElement
      ).attrs.style ?? ''
    expect(styleOf(viewOf({}))).not.toContain('--rm-font-heading')
    expect(styleOf(viewOf({}))).not.toContain('Lora')
    expect(styleOf(viewOf({ general: { heading_font: 'lora' } }))).toContain(
      '--rm-font-heading:var(--font-lora)',
    )
  })

  it('applies to the menu title, section titles and item names, and to no other text', () => {
    const view = viewOf({ general: { heading_font: 'lora' } })
    const html = renderToStaticMarkup(<EditorialMarketFace view={view} />)
    const dom = parseHtml(html)
    // Every token but the heading font is worked out; that one stays a name, so it can be told from the body's.
    const names = [...CSS.matchAll(/(--rm-[\w-]+):/g)]
      .map((match) => match[1] as string)
      .filter((name) => name !== '--rm-font-heading')
    const rules = cssRules(resolvedCss(CSS, ROOT, rootOf(view), names))
    const font = (element: HtmlElement) => valuesOf(element, 'font-family', rules, true)[0]
    const heading = 'var(--rm-font-heading)'
    const [block] = withAttribute(dom, 'data-design-part', 'header.title')
    const title = (block as HtmlElement).children.find((child) => typeof child !== 'string')
    const [section] = withAttribute(dom, 'data-design-part', 'section.title')
    const [name] = withAttribute(dom, 'data-design-part', 'item.name')
    const [price] = withAttribute(dom, 'data-design-part', 'item.price')
    const [description] = withAttribute(dom, 'data-design-part', 'item.description')
    const [label] = withAttribute(dom, 'data-slot', 'item.dietary')
    for (const drawn of [title, section]) expect(font(drawn as HtmlElement)).toBe(heading)
    const h3 = (name as HtmlElement).children.find(
      (child) => typeof child !== 'string',
    ) as HtmlElement
    expect(font(h3)).toBe(heading)
    for (const other of [price, description, label]) {
      expect(font(other as HtmlElement)).not.toBe(heading)
    }
  })

  /** The weight a design's rules end on for a token: the last line that sets it. */
  const weight = (change: Change, token: string): number => {
    const lines = resolvedCss(CSS, ROOT, rootOf(viewOf(change)), []).split('\n')
    const last = lines
      .filter((line) => /^\.rm(\[[^\]]+\])* \{ /.test(line) && line.includes(`{ ${token}: `))
      .at(-1)
    return Number(/: (\d+) \}/.exec(last ?? '')?.[1])
  }

  it('lists the fonts that stop short of Heavy: Manrope at 800 and Lora at 700 (bold)', () => {
    expect(HEAVY_FALLBACKS).toEqual([
      { font: 'manrope', heaviest: 800 },
      { font: 'lora', heaviest: 700 },
    ])
  })

  it('falls back to the font’s heaviest weight where it lacks Heavy, for the heading and the name', () => {
    const heavy = { general: { heading_weight: 'heavy' }, items: { name_weight: 'heavy' } }
    const at = (font: Record<string, string>) => ({
      ...heavy,
      general: { ...heavy.general, ...font },
    })
    // Lora, chosen: bold, in all three.
    for (const token of ['--rm-heading-weight', '--rm-subheading-weight', '--rm-name-weight']) {
      expect(weight(at({ heading_font: 'lora' }), token), token).toBe(700)
    }
    // `same` follows the body font.
    expect(weight(at({ body_font: 'lora' }), '--rm-heading-weight')).toBe(700)
    expect(weight(at({ body_font: 'manrope' }), '--rm-heading-weight')).toBe(800)
    expect(weight(at({ body_font: 'manrope' }), '--rm-name-weight')).toBe(800)
    // A font that serves Heavy keeps it: Playfair Display reaches 900.
    expect(weight(at({ heading_font: 'playfair-display' }), '--rm-heading-weight')).toBe(880)
    expect(weight(at({ heading_font: 'playfair-display' }), '--rm-name-weight')).toBe(850)
    // The heading font is the one drawing: a Lora body under an Inter heading keeps Heavy.
    expect(weight(at({ body_font: 'lora', heading_font: 'inter' }), '--rm-heading-weight')).toBe(
      880,
    )
    // And bold or regular are not touched.
    expect(weight({ general: { heading_font: 'lora' } }, '--rm-heading-weight')).toBe(700)
    expect(
      weight(
        { general: { heading_font: 'lora', heading_weight: 'regular' } },
        '--rm-heading-weight',
      ),
    ).toBe(400)
  })
})

describe('what Editorial drew wrong on a narrow phone (#174)', () => {
  it('starts a dish with no photo under the Back button, whatever the design says', () => {
    const lines = resolvedCss(CSS, ROOT, rootOf(viewOf({ dish: { kind: 'page' } })), [])
    expect(lines).toContain('.rm-detail-copy:first-child { padding-top: 72px }')
    // A dish with a photo has the photo first, so its copy is not the first child.
    const { container } = render(<EditorialMarketFace view={viewOf({ dish: { kind: 'page' } })} />)
    const tofu = itemsOf(viewOf({})).find((one) => one.name.text === 'Tofu bowl')
    fireEvent.click(
      container.querySelector(`[data-item="${tofu?.id}"] .rm-item-open`) as HTMLElement,
    )
    const detail = screen.getByRole('dialog').querySelector('.rm-detail') as HTMLElement
    expect(detail.firstElementChild?.classList.contains('rm-detail-copy')).toBe(true)
  })

  it('wraps a label, a badge and a filter chip with no spaces instead of clipping or widening it', () => {
    const lines = resolvedCss(CSS, ROOT, rootOf(viewOf({ items: { layout: 'list' } })), [])
    const group = '.rm-labels span, .rm-badge, .rm-filter-group button'
    expect(lines).toContain(`${group} { max-width: 100% }`)
    expect(lines).toContain(`${group} { overflow-wrap: anywhere }`)
    // A badge in a list thumbnail used to be cut with an ellipsis; nothing cuts a label now.
    expect(lines).not.toMatch(
      /\.rm-badge \{ (?:text-overflow|white-space: nowrap|overflow: hidden)/,
    )
  })
})
