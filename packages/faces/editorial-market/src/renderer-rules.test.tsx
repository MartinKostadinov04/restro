// @vitest-environment jsdom
// The renderer's rules (D130): what it draws on its own, whatever the design says. Each rule reads
// the stylesheet the way a design draws it (`resolvedCss`: another value's rules gone, the root's
// tokens worked out) against the markup that design renders. The sizes here are those of a phone;
// `faces-design.spec.ts` measures the real page at the four widths.

import type { DesignValues, ViewItem, ViewModel } from '@restro/shell'
import {
  BASIC_DESIGN_VALUES,
  cssRules,
  designView,
  fontSizePx,
  type HtmlElement,
  parseHtml,
  resolvedCss,
  runDesignContract,
  valuesOf,
  withAttribute,
  withDesign,
} from '@restro/shell/testing'
import { cleanup, fireEvent, render as renderToDom, screen } from '@testing-library/react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it } from 'vitest'

import { EDITORIAL_CSS } from './css'
import { EditorialMarketFace } from './face'
import { EDITORIAL_MARKET_MANIFEST } from './manifest'
import { designVariables, photoSizes } from './model'
import { SERVICES_CSS } from './services/services-css'
import { richFixture } from './test-views'

afterEach(cleanup)

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

function viewOf(change: Change): ViewModel {
  return designView(withDesign(richFixture(), design(change)), EDITORIAL_MARKET_MANIFEST)
}

/** A design as drawn: the markup, and the stylesheet's rules for it without the at-rules. */
function drawn(change: Change, edit: (view: ViewModel) => ViewModel = (view) => view) {
  const view = edit(viewOf(change))
  const html = renderToStaticMarkup(<EditorialMarketFace view={view} />)
  const dom = parseHtml(html)
  const root = withAttribute(dom, 'data-face')[0] as HtmlElement
  const css = resolvedCss(CSS, ROOT, root.attrs, TOKENS)
  const flat = css
    .split('\n')
    .filter((line) => !line.startsWith('@'))
    .join('\n')
  const rules = cssRules(flat)
  const sections = withAttribute(dom, 'data-design-part', 'section')
  const vertical = sections.find((one) => one.attrs['data-section-layout'] === 'vertical')
  const strip = sections.find((one) => one.attrs['data-section-layout'] === 'horizontal')
  const value = (element: HtmlElement, property: string, inherits = false) =>
    valuesOf(element, property, rules, inherits)[0]
  return {
    css,
    dom,
    root,
    rules,
    value,
    vertical: vertical as HtmlElement,
    strip: strip as HtmlElement,
    px: (element: HtmlElement) => fontSizePx(value(element, 'font-size', true) ?? '', {}),
  }
}

const part = (scope: HtmlElement, name: string) =>
  withAttribute(scope, 'data-design-part', name)[0] as HtmlElement

/** The first item with a photo in a scope. */
const photoCard = (scope: HtmlElement) =>
  withAttribute(scope, 'data-item').find((item) =>
    (item.attrs.class ?? '').includes('has-photo'),
  ) as HtmlElement

/** The heading inside a name's slot. */
const headingOf = (name: HtmlElement) =>
  name.children.find((child) => typeof child !== 'string') as HtmlElement

const OTHER_PHOTO_VALUES: Change[] = [
  { photos: { shape: 'square' } },
  { photos: { shape: 'wide' } },
  { photos: { shape: 'portrait' } },
  { photos: { fit: 'contain' } },
  { photos: { backdrop: 'tint' } },
  { photos: { backdrop: 'white' } },
  { photos: { backdrop: 'none' } },
  { photos: { frame: 'inset' } },
  { photos: { corners: 'square' } },
  { photos: { corners: 'round' } },
]

describe('the price follows the name (D130)', () => {
  const NAMES = ['s', 'm', 'l'] as const

  it('is one step under the name and never under the description, in a list and one column', () => {
    for (const layout of ['list', 'one'] as const) {
      for (const name_size of NAMES) {
        const page = drawn({ items: { layout, name_size } })
        const card = photoCard(page.vertical)
        const name = page.px(headingOf(part(card, 'item.name'))) as number
        const price = page.px(part(card, 'item.price')) as number
        const description = page.px(part(card, 'item.description')) as number
        expect(price, `${layout} ${name_size}`).toBeLessThan(name)
        expect(price, `${layout} ${name_size}`).toBeGreaterThanOrEqual(description)
      }
    }
  })

  it('in two columns, too, down from the second size; the largest is Editorial’s own', () => {
    for (const name_size of ['s', 'm'] as const) {
      const page = drawn({ items: { layout: 'two', name_size } })
      const card = photoCard(page.vertical)
      const name = page.px(headingOf(part(card, 'item.name'))) as number
      const price = page.px(part(card, 'item.price')) as number
      const description = page.px(part(card, 'item.description')) as number
      expect(price, name_size).toBeLessThan(name)
      expect(price, name_size).toBeGreaterThanOrEqual(description)
    }
    const page = drawn({ items: { layout: 'two', name_size: 'l' } })
    const card = photoCard(page.vertical)
    // 14 px name over a 16 px price is today's look, which Editorial must keep: reported on #172.
    expect(page.px(headingOf(part(card, 'item.name')))).toBe(14)
    expect(page.px(part(card, 'item.price'))).toBe(16)
  })

  it('on the strip as well, at every card size', () => {
    for (const name_size of NAMES) {
      for (const strip_card_size of ['s', 'm', 'l'] as const) {
        const page = drawn({ items: { name_size }, sections: { strip_card_size } })
        const card = photoCard(page.strip)
        const name = page.px(headingOf(part(card, 'item.name'))) as number
        const price = page.px(part(card, 'item.price')) as number
        const where = `${name_size} on a ${strip_card_size} card`
        expect(price, where).toBeLessThanOrEqual(name)
        expect(price, where).toBeGreaterThanOrEqual(
          page.px(part(card, 'item.description')) as number,
        )
      }
    }
  })
})

describe('a band keeps its pair (D130)', () => {
  it('draws the rail on the header’s band, with the current pill in the band’s pair', () => {
    for (const band of ['ink', 'panel'] as const) {
      const page = drawn({
        header: { band },
        navigation: { band: 'header', marker: 'pills' },
      })
      const rail = part(page.dom, 'nav')
      const current = withAttribute(rail, 'aria-current', 'true')[0] as HtmlElement
      const fill = band === 'ink' ? 'var(--rm-text)' : 'var(--rm-surface)'
      expect(page.value(rail, '--rm-bg')).toBe(fill)
      // The pill inverts the band: its writing is the band's fill, whatever the accent is.
      expect(page.value(current, 'background')).toBe('var(--rm-text)')
      expect(page.value(current, 'color')).toBe('var(--rm-bg)')
      // Never muted on a band: the other names read in the pair's own writing.
      expect(page.value(rail, '--rm-muted')).toBe(page.value(rail, '--rm-text'))
    }
  })

  it('uses the accent pair for a pill off a band, and a page header gives the rail no band', () => {
    const off = drawn({ navigation: { marker: 'pills' } })
    const current = withAttribute(part(off.dom, 'nav'), 'aria-current', 'true')[0] as HtmlElement
    expect(off.value(current, 'background')).toBe('var(--rm-accent)')
    expect(off.value(current, 'color')).toBe('var(--rm-on-accent)')
    const plain = drawn({ header: { band: 'page' }, navigation: { band: 'header' } })
    expect(plain.value(part(plain.dom, 'nav'), '--rm-text')).toBeUndefined()
  })

  it('writes the header in its band’s pair, and the sheets and the footer in theirs', () => {
    const header = (band: string) =>
      cssLine({ header: { band } }, '.rm[data-header-band=', '--rm-text')
    expect(header('ink')).toBeUndefined()
    expect(header('panel')).toBe('var(--rm-surface)')
    expect(header('page')).toBe('var(--rm-bg)')
    expect(cssLine({ sheets: { sheets: 'panel' } }, '.rm[data-sheets-sheets=', '--rm-text')).toBe(
      'var(--rm-surface)',
    )
    expect(cssLine({ sheets: { sheets: 'page' } }, '.rm[data-sheets-sheets=', '--rm-text')).toBe(
      'var(--rm-bg)',
    )
    expect(
      cssLine({ sheets: { sheets: 'ink' } }, '.rm[data-sheets-sheets=', '--rm-text'),
    ).toBeUndefined()
  })
})

/** The value of a property in the rule of a design whose selector starts so. */
function cssLine(change: Change, start: string, property: string): string | undefined {
  const line = drawn(change)
    .css.split('\n')
    .find((one) => one.startsWith(start) && one.includes(`{ ${property}:`))
  return line?.slice(line.indexOf(':', line.indexOf('{')) + 2, line.lastIndexOf(' }'))
}

describe('a two-column card draws all its parts (D130)', () => {
  /** The first photo card of a vertical section with a choice and an extra field. */
  const withParts = (view: ViewModel): ViewModel => {
    const add = (item: ViewItem): ViewItem => ({
      ...item,
      extraFields: [
        {
          key: 'abv',
          type: 'number',
          label: item.name,
          text: '40',
          lang: null,
        } as ViewItem['extraFields'][number],
      ],
      modifierGroups: [
        {
          id: 'mg_1',
          name: item.name,
          options: [{ id: 'mo_1', name: item.name, delta: null }],
        } as unknown as ViewItem['modifierGroups'][number],
      ],
    })
    return {
      ...view,
      sections: view.sections.map((section) => ({
        ...section,
        items: section.items.map((item) => (item.image !== null ? add(item) : item)),
      })),
    } as ViewModel
  }

  it('shows the choices summary and the extra fields, at 12 px', () => {
    const page = drawn({ items: { layout: 'two' } }, withParts)
    const card = photoCard(page.vertical)
    const choices = part(card, 'item.choices')
    const extra = withAttribute(card, 'data-slot', 'item.extra_fields')[0] as HtmlElement
    for (const element of [choices, extra]) {
      expect(element).toBeDefined()
      expect(page.px(element)).toBe(12)
      expect(page.value(element, 'display')).not.toBe('none')
    }
  })
})

describe('a section image (D130)', () => {
  it('keeps 16:7 and General’s corners, whatever the Photos page says', () => {
    const sectionImage = (rules: ReturnType<typeof drawn>['rules']) =>
      rules.filter((rule) => rule.selector === '.rm-section-head > img')
    for (const change of OTHER_PHOTO_VALUES) {
      const { rules } = drawn(change)
      const declarations = Object.fromEntries(
        sectionImage(rules).flatMap((rule) => rule.declarations),
      )
      expect(declarations['aspect-ratio']).toBe('16 / 7')
      expect(declarations['border-radius']).toBe('var(--rm-radius)')
    }
    // Nothing else reaches it: no other rule names the section head's image.
    expect(EDITORIAL_CSS.match(/rm-section-head > img/g)).toHaveLength(1)
  })
})

describe('quiet text on the page’s and the panel’s colour (D130)', () => {
  const declarations = (values: readonly string[], attribute: string, selector: string) =>
    values.map((value) =>
      cssRules(CSS)
        .filter((rule) => rule.media === null)
        .filter((rule) => rule.selector.includes(`[${attribute}="${value}"]`))
        .filter((rule) => rule.selector.includes(selector))
        .flatMap((rule) => rule.declarations),
    )

  it('is the venue’s own muted colour, the pair the theme promises, never a mix of the ink', () => {
    for (const found of [
      ...declarations(['page', 'panel'], 'data-header-band', '.rm-titleblock > p'),
      ...declarations(['page', 'panel'], 'data-header-band', '.rm-language button'),
      ...declarations(['page', 'panel'], 'data-sheets-sheets', '.rm-footer > p'),
      ...declarations(['page', 'panel'], 'data-sheets-sheets', '.rm-overlay-intro'),
      ...declarations(['page', 'panel'], 'data-sheets-sheets', '.rm-allergen-sheet li'),
    ]) {
      expect(found).toContainEqual(['color', 'var(--rm-muted)'])
    }
    for (const found of declarations(['page', 'panel'], 'data-sheets-sheets', '.rm-filter-group')) {
      expect(found).toContainEqual(['border-color', 'var(--rm-muted)'])
    }
  })

  it('leaves the pressed language and the pressed filter in their own colours', () => {
    const selectors = cssRules(CSS)
      .flatMap((rule) => rule.selector.split(','))
      .filter((selector) => /\.rm-language button|\.rm-filter-group/.test(selector))
      .filter((selector) => /data-(header-band|sheets-sheets)="(page|panel)"/.test(selector))
    expect(selectors.length).toBeGreaterThan(0)
    for (const selector of selectors) {
      expect(selector).toContain(':not([aria-pressed="true"])')
    }
  })
})

describe('the photos’ backdrop (D130)', () => {
  const box = (change: Change) => {
    const page = drawn(change)
    return page.value(part(photoCard(page.vertical), 'item.photo'), 'background')
  }

  it('sits on the photo’s box, in the venue’s colours and none', () => {
    expect(box({ photos: { backdrop: 'panel' } })).toBe('var(--rm-surface)')
    expect(box({ photos: { backdrop: 'tint' } })).toBe(
      'color-mix(in srgb, var(--rm-accent) 10%, var(--rm-bg))',
    )
    expect(box({ photos: { backdrop: 'none' } })).toBe('transparent')
  })

  it('is white on both screens: the face writes the colour, for that value alone', () => {
    for (const screen of ['light', 'dark'] as const) {
      const values = design({ general: { screen }, photos: { backdrop: 'white' } })
      expect(designVariables(values)).toEqual({ '--rm-photo-backdrop': '#ffffff' })
    }
    expect(designVariables(design({ photos: { backdrop: 'panel' } }))).toEqual({})
    const html = renderToStaticMarkup(
      <EditorialMarketFace view={viewOf({ photos: { backdrop: 'white' } })} />,
    )
    expect(html).toContain('--rm-photo-backdrop:#ffffff')
  })
})

describe('the photo’s frame (D130)', () => {
  it('draws a bleed photo with no corners of its own, whatever Corners says', () => {
    const lines = (corners: string) => drawn({ photos: { frame: 'bleed', corners } }).css
    expect(lines('round')).toBe(lines('general'))
    expect(lines('square')).toBe(lines('general'))
    const page = drawn({ items: { layout: 'one' }, photos: { frame: 'bleed', corners: 'round' } })
    const photo = part(photoCard(page.vertical), 'item.photo')
    expect(page.value(photo, 'border-radius')).toBe('0px')
    expect(page.value(photo, 'padding')).toBe('0px')
  })

  it('gives an inset photo its corners, by the Corners value', () => {
    const corners = (value: string) => {
      const page = drawn({ items: { layout: 'one' }, photos: { frame: 'inset', corners: value } })
      return page.value(part(photoCard(page.vertical), 'item.photo'), 'border-radius')
    }
    expect(corners('square')).toBe('0px')
    expect(corners('general')).not.toBe('0px')
    expect(corners('round')).not.toBe(corners('general'))
  })

  it('takes a bigger file for a photo that fills its card', () => {
    const widest = (sizes: string) => sizes.split(',').at(-1)?.trim()
    expect(widest(photoSizes('one', false, true))).toBe('calc(100vw - 40px)')
    expect(widest(photoSizes('one', false, false))).toBe('calc(100vw - 68px)')
    expect(photoSizes('list', false, true)).toBe('96px')
  })
})

describe('a list thumbnail (D130)', () => {
  it('stays a square at the end, whatever the Photos page says', () => {
    for (const change of OTHER_PHOTO_VALUES) {
      const page = drawn({ ...change, items: { layout: 'list' } })
      const photo = part(photoCard(page.vertical), 'item.photo')
      expect(page.value(photo, 'grid-column')).toBe('2')
      expect(page.value(photo, 'width')).toBe('96px')
      expect(page.value(photo, 'height')).toBe('96px')
    }
  })
})

describe('the dish page’s photo (D130)', () => {
  const lines = (change: Change) => drawn(change).css

  it('follows the Photos page: the shape on the box, the backdrop behind, no focus when contained', () => {
    expect(lines({ photos: { shape: 'square' } })).toContain(
      '.rm-detail-photo img { aspect-ratio: 1 / 1 }',
    )
    expect(lines({ photos: { fit: 'contain' } })).toContain(
      '.rm-detail-photo img { object-fit: contain }',
    )
    expect(lines({ photos: { fit: 'contain' } })).toMatch(/object-position: center !important/)
    expect(lines({ photos: { fit: 'cover' } })).not.toMatch(/object-position: center !important/)
    expect(lines({ photos: { backdrop: 'tint' } })).toContain(
      '.rm-detail-photo { background: color-mix(in srgb, var(--rm-accent) 10%, var(--rm-bg)) }',
    )
  })

  it('lets go of the image’s own height wherever the shape is the design’s to draw', () => {
    const height = /\.rm-detail-photo img[^{]*\{ height: auto \}/
    expect(lines({ photos: { frame: 'bleed' } })).toMatch(height)
    expect(lines({ photos: { frame: 'inset', shape: 'square' } })).toMatch(height)
    expect(lines({ photos: { frame: 'inset', shape: 'landscape' } })).not.toMatch(height)
  })

  it('shrinks to a 96 px square at the name’s end when the Dish page asks for small', () => {
    const small = lines({ dish: { photo: 'small' } })
    expect(small).toMatch(/\.is-detail \.rm-detail-photo \{ width: 96px \}/)
    expect(small).toMatch(/\.is-detail \.rm-detail-photo img \{ aspect-ratio: 1 \/ 1 \}/)
    expect(lines({ dish: { photo: 'hero' } })).not.toMatch(/\.rm-detail-photo \{ width: 96px \}/)
  })
})

describe('the layout comes from the design (D129, D130)', () => {
  it('draws the design’s layout and its guest switch', () => {
    for (const layout of ['list', 'one', 'two'] as const) {
      expect(drawn({ items: { layout } }).root.attrs['data-layout']).toBe(layout)
    }
    const on = drawn({ items: { guest_switch: 'on' } })
    const off = drawn({ items: { guest_switch: 'off' } })
    expect(withAttribute(on.dom, 'data-design-part', 'layout.switch').length).toBeGreaterThan(0)
    expect(withAttribute(off.dom, 'data-design-part', 'layout.switch')).toHaveLength(0)
  })

  it('applies the guest’s choice to every vertical section, and never to a strip', () => {
    const { container } = renderToDom(
      <EditorialMarketFace view={viewOf({ items: { layout: 'list' } })} />,
    )
    const root = container.querySelector('[data-face]') as HTMLElement
    const stripSize = () =>
      container.querySelector('.rm-section.is-feature .rm-photo img')?.getAttribute('sizes')
    const before = stripSize()
    expect(root.dataset.layout).toBe('list')
    fireEvent.click(screen.getAllByRole('radio', { name: '1 column' })[0] as HTMLElement)
    expect(root.dataset.layout).toBe('one')
    // Every rule the layouts draw with leaves the strip out, so the strip stays what it was.
    expect(stripSize()).toBe(before)
    for (const rule of cssRules(CSS)) {
      if (!/\.rm\[data-layout="(list|one|two)"\]/.test(rule.selector)) continue
      if (!/\.rm-(item|photo)/.test(rule.selector) && !/rm-items/.test(rule.selector)) continue
      // A comma inside `:is(h3, h4)` does not end a selector.
      for (const selector of rule.selector.split(/,(?![^(]*\))/)) {
        expect(selector, selector).toMatch(/:not\(\.is-feature\)|\.is-feature|\.ro-/)
      }
    }
  })

  it('lets a section’s own layout win: a horizontal section is a strip in any layout', () => {
    for (const layout of ['list', 'one', 'two'] as const) {
      const page = drawn({ items: { layout } })
      expect(page.strip.attrs.class).toContain('is-feature')
      expect(page.vertical.attrs.class).not.toContain('is-feature')
    }
  })
})

describe('the never-list on a value of this page (D67)', () => {
  const planted = async (css: string) => {
    const report = await runDesignContract({
      manifest: EDITORIAL_MARKET_MANIFEST,
      render: (view) => renderToStaticMarkup(<EditorialMarketFace view={view} />),
      css,
      drawn: { items: ['name_size'], labels: ['labels'] },
      rootSelector: ROOT,
      tokens: TOKENS,
      inkValues: ['var(--rm-text)', 'inherit', 'currentColor'],
      fixtures: [richFixture()],
    })
    return report.failures.map((failure) => `${failure.rule}: ${failure.message}`)
  }

  it('passes the stylesheet as it stands, on this small sweep', async () => {
    expect(await planted(CSS)).toEqual([])
  })

  it('fails on a breach planted behind one value: a floor, a price out of the ink', async () => {
    const floor = await planted(
      `${CSS}.rm[data-items-name-size="s"] .rm-item :is(h3, h4) { font-size: 11px; }`,
    )
    expect(floor.join('\n')).toContain('11px is under 12px')
    const faint = await planted(
      `${CSS}.rm[data-labels-labels="text"] .rm-price { color: var(--rm-muted); }`,
    )
    expect(faint.length).toBeGreaterThan(0)
  })
})
