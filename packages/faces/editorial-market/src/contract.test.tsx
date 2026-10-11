import type { ViewModel, ViewText } from '@restro/shell'
import {
  fixture,
  fixtures,
  type HtmlElement,
  parseHtml,
  runFaceContract,
  textOf,
  withAttribute,
} from '@restro/shell/testing'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { EditorialMarketFace } from './face'
import { EDITORIAL_MARKET_MANIFEST } from './manifest'
import { bcp47 } from './model'
import { itemsOf, richFixture, richView, viewOf } from './test-views'

const render = (view: ViewModel) => renderToStaticMarkup(<EditorialMarketFace view={view} />)

/** Every host prop and option at once: the contract must hold however the host dresses the face. */
const renderDressed = (view: ViewModel) =>
  renderToStaticMarkup(
    <EditorialMarketFace
      view={view}
      assetBase="https://cdn.example.test/"
      languages={['bg_BG', 'en_US']}
      onLanguageChange={() => {}}
      tableLabel="12"
      scheme="dark"
      options={{ layout: 'list', layoutSwitch: true, featureFirstSection: false }}
    />,
  )

/** The markup without the stylesheet (whose text mentions every class). */
const withoutStyle = (html: string) => html.replace(/<style>[\s\S]*?<\/style>/, '')

describe('the face contract (brief S3-02 harness, every fixture)', () => {
  it('runs in Node, so a render that reads the window would throw', () => {
    expect(typeof window).toBe('undefined')
    expect(typeof document).toBe('undefined')
  })

  it('renders every fixture with every required slot, in order, with no failure', async () => {
    const report = await runFaceContract(render, EDITORIAL_MARKET_MANIFEST)
    expect(report.failures).toEqual([])
    expect(report.renders).toBeGreaterThanOrEqual(10)
    expect(report.items).toBeGreaterThan(300)
  })

  it('also passes on a dense screen (the shell picks the larger photo variant)', async () => {
    const report = await runFaceContract(render, EDITORIAL_MARKET_MANIFEST, { density: 3 })
    expect(report.failures).toEqual([])
  })

  it('also passes with a table, two languages, a forced scheme and every option changed', async () => {
    const report = await runFaceContract(renderDressed, EDITORIAL_MARKET_MANIFEST)
    expect(report.failures).toEqual([])
  })

  it('also passes on a menu with a badge on a photo card and one on a text row', async () => {
    const report = await runFaceContract(render, EDITORIAL_MARKET_MANIFEST, {
      fixtures: [richFixture('en_US'), richFixture('bg_BG')],
    })
    expect(report.failures).toEqual([])
    expect(report.items).toBe(14)
  })
})

describe('badges (R8)', () => {
  it('draws one item.badges slot for every item that has badges, on photo cards and text rows', () => {
    const view = richView()
    const root = parseHtml(render(view))
    const cards = withAttribute(root, 'data-item')
    const withBadges = itemsOf(view).filter((item) => item.badges.length > 0)
    expect(withBadges.map((item) => item.name.text)).toEqual(['Hummus', 'Tofu bowl'])
    expect(withBadges.some((item) => item.image !== null)).toBe(true)
    expect(withBadges.some((item) => item.image === null)).toBe(true)
    for (const card of cards) {
      const item = itemsOf(view).find((candidate) => candidate.id === card.attrs['data-item'])
      const slots = withAttribute(card, 'data-slot', 'item.badges')
      expect(slots, item?.name.text).toHaveLength(
        item !== undefined && item.badges.length > 0 ? 1 : 0,
      )
      if (item !== undefined && slots[0] !== undefined) {
        for (const badge of item.badges) expect(textOf(slots[0])).toContain(badge.label.text)
      }
    }
  })
})

describe('language (R3)', () => {
  /** Every menu text of a view model that the face draws as text. */
  function menuTexts(view: ViewModel): ViewText[] {
    const texts: ViewText[] = []
    const add = (text: ViewText | null | undefined) => {
      if (text) texts.push(text)
    }
    add(view.menu.title)
    add(view.menu.intro)
    for (const allergen of view.allergenLegend) add(allergen.label)
    for (const label of view.filters.dietary) add(label.label)
    for (const tag of view.filters.tags) add(tag.label)
    const walk = (sections: ViewModel['sections']) => {
      for (const section of sections) {
        add(section.title)
        add(section.description)
        walk(section.sections)
      }
    }
    walk(view.sections)
    for (const item of itemsOf(view)) {
      add(item.name)
      add(item.description)
      add(item.state.label)
      add(item.order.askWaiter)
      for (const badge of item.badges) add(badge.label)
      for (const label of item.dietary) add(label.label)
      for (const tag of item.tags) add(tag.label)
      for (const field of item.extraFields) add(field.label)
      for (const group of item.modifierGroups) {
        add(group.name)
        for (const option of group.options) add(option.name)
      }
    }
    return texts
  }

  /** The elements that hold exactly this text and nothing else. */
  function holders(root: HtmlElement, text: string): HtmlElement[] {
    const found: HtmlElement[] = []
    const visit = (element: HtmlElement) => {
      const inner = element.children.filter(
        (child): child is HtmlElement => typeof child !== 'string',
      )
      for (const child of inner) visit(child)
      if (element.tag !== '#root' && element.tag !== 'style' && textOf(element) === text) {
        if (!inner.some((child) => textOf(child) === text)) found.push(element)
      }
    }
    visit(root)
    return found
  }

  /** The `lang` that applies to an element: its own, else its nearest ancestor's. */
  function langAt(element: HtmlElement): string | undefined {
    for (let node: HtmlElement | null = element; node !== null; node = node.parent) {
      if (node.attrs.lang !== undefined) return node.attrs.lang
    }
    return undefined
  }

  for (const name of ['six-languages', 'tags-dietary', 'sold-out', 'ask-waiter']) {
    it(`gives every text that is not in the page language its own lang (${name})`, () => {
      const view = viewOf(fixture(name))
      const root = parseHtml(render(view))
      const foreign = menuTexts(view).filter((text) => text.lang !== view.locale)
      let checked = 0
      for (const text of foreign) {
        for (const holder of holders(root, text.text)) {
          expect(langAt(holder), `"${text.text}" (${text.lang})`).toBe(bcp47(text.lang))
          checked++
        }
      }
      // Not vacuous: these fixtures do hold texts in another language.
      if (name === 'six-languages' || name === 'tags-dietary') expect(checked).toBeGreaterThan(0)
    })
  }

  it('draws rail links, section titles, tags and dietary labels in their own language', () => {
    // The guest asks for French; the test menu has no French, so every text falls back.
    const view = viewOf(richFixture('fr_FR'))
    expect(view.locale).toBe('fr_FR')
    const html = render(view)
    const root = parseHtml(html)
    const lang = (text: ViewText) => holders(root, text.text).map(langAt)
    const section = view.sections[0]
    expect(section).toBeDefined()
    if (section === undefined) return
    // The link of the rail and the title of the section: two places, both tagged.
    expect(lang(section.title)).toEqual([bcp47(section.title.lang), bcp47(section.title.lang)])
    const tag = view.filters.tags[0]
    expect(tag).toBeDefined()
    if (tag !== undefined) {
      const langs = lang(tag.label)
      expect(langs.length).toBeGreaterThan(0)
      expect(new Set(langs)).toEqual(new Set([bcp47(tag.label.lang)]))
    }
    const dietary = view.filters.dietary[0]
    expect(dietary).toBeDefined()
    if (dietary !== undefined) {
      const langs = lang(dietary.label)
      expect(langs.length).toBeGreaterThan(0)
      expect(new Set(langs)).toEqual(new Set([bcp47(dietary.label.lang)]))
    }
  })
})

describe('the allergen information footer', () => {
  it('lists the allergens of the menu, numbered, when there are any', () => {
    const view = richView()
    expect(view.allergenLegend.length).toBeGreaterThan(0)
    const root = parseHtml(render(view))
    const footers = withAttribute(root, 'class', 'rm-footer')
    expect(footers).toHaveLength(1)
    const legend = withAttribute(root, 'data-slot', 'menu.allergen_legend')
    expect(legend).toHaveLength(1)
    for (const allergen of view.allergenLegend) {
      expect(textOf(legend[0] as HtmlElement)).toContain(`${allergen.number}${allergen.label.text}`)
    }
  })

  it('is not drawn at all when the menu lists no allergen', () => {
    const view = { ...richView(), allergenLegend: [] }
    const html = withoutStyle(render(view))
    expect(html).not.toContain('rm-footer')
    expect(html).not.toContain('menu.allergen_legend')
  })
})

describe('descriptions (R9)', () => {
  it('are cut only where the shell says they may be, the full text always in the markup', () => {
    const view = richView()
    const clamped = (v: ViewModel) =>
      withAttribute(parseHtml(render(v)), 'data-slot', 'item.description').map(
        (slot) =>
          slot.children.find((child): child is HtmlElement => typeof child !== 'string')?.attrs[
            'data-clamped'
          ],
      )
    expect(clamped(view)).toEqual(['true', 'true'])
    const whole = {
      ...view,
      sections: view.sections.map((section) => ({
        ...section,
        items: section.items.map((item) =>
          item.description === null
            ? item
            : { ...item, description: { ...item.description, truncatable: false } },
        ),
      })),
    }
    expect(clamped(whole)).toEqual(['false', 'false'])
    for (const item of itemsOf(view)) {
      if (item.description !== null) expect(render(view)).toContain(item.description.text)
    }
  })
})

describe('the first render is static', () => {
  it('holds every item, the rail, the footer and no dialog', () => {
    const view = richView()
    const html = render(view)
    const root = parseHtml(html)
    expect(withAttribute(root, 'data-item')).toHaveLength(itemsOf(view).length)
    expect(withAttribute(root, 'role', 'dialog')).toHaveLength(0)
    expect(withAttribute(root, 'class', 'rm-sections')).toHaveLength(1)
    // The layout switch is drawn, in the venue's layout, before any script runs.
    expect(withAttribute(root, 'data-layout', 'two')).toHaveLength(1)
    expect(withAttribute(root, 'role', 'radio')).toHaveLength(3)
  })

  it('draws every fixture of the harness without a window', () => {
    for (const f of fixtures()) expect(render(viewOf(f))).toContain('data-face="editorial-market"')
  })
})
