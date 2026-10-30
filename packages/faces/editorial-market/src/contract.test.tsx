import {
  EMPTY_SERVICE_STATE,
  type OrderLineView,
  type SentOrderView,
  type ServiceState,
  type ViewModel,
  type ViewText,
} from '@restro/shell'
import {
  type ContractHost,
  faceContractSuite,
  fixture,
  fixtures,
  type HtmlElement,
  parseHtml,
  runFaceContract,
  stubServices,
  textOf,
  withAttribute,
} from '@restro/shell/testing'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { EDITORIAL_CSS } from './css'
import { EditorialMarketFace } from './face'
import { EDITORIAL_MARKET_MANIFEST } from './manifest'
import { bcp47 } from './model'
import { SERVICES_CSS } from './services/services-css'
import { itemsOf, richFixture, richView, viewOf } from './test-views'

/** The browsing page: the host binds no services. */
const renderBrowsing = (view: ViewModel, host?: ContractHost) =>
  renderToStaticMarkup(<EditorialMarketFace view={view} languages={host?.languages} />)

/**
 * The face as the contract renders it (brief SH-06): with the empty services binding of the test
 * harness, so the controls of a service the view model has on are drawn and the rest are not.
 */
const render = (view: ViewModel, host?: ContractHost) =>
  renderToStaticMarkup(
    <EditorialMarketFace view={view} languages={host?.languages} services={stubServices()} />,
  )

/**
 * Every host prop at once, and options a venue stored before D92 (the face reads none now): the
 * contract must hold however the host dresses the face.
 */
const renderDressed = (view: ViewModel, host?: ContractHost) =>
  renderToStaticMarkup(
    <EditorialMarketFace
      view={view}
      assetBase="https://cdn.example.test/"
      languages={host?.languages ?? ['bg_BG', 'en_US']}
      onLanguageChange={() => {}}
      tableLabel="12"
      scheme="dark"
      options={{ layout: 'list', layoutSwitch: true, featureFirstSection: false }}
      services={stubServices()}
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

  it('also passes with a table, two languages, a forced scheme and stale options', async () => {
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

describe('layouts (D92)', () => {
  /** Each top-level section's class and layout attribute, in order. */
  const sectionsOf = (html: string) =>
    withAttribute(parseHtml(html), 'data-section-layout').map((section) => [
      section.attrs.class,
      section.attrs['data-section-layout'],
    ])

  it('draws a section marked horizontal as the strip, and not an unmarked first one', () => {
    // horizontal-sections: the second section is marked, the first is not.
    expect(sectionsOf(render(viewOf(fixture('horizontal-sections'))))).toEqual([
      ['rm-section', 'vertical'],
      ['rm-section is-feature', 'horizontal'],
      ['rm-section', 'vertical'],
    ])
    // A first section published without a layout (before D92) is no strip either.
    expect(sectionsOf(render(viewOf(fixture('long-names'))))).toEqual([['rm-section', 'vertical']])
  })

  it('starts in the menu’s layout, and draws the switch only where the menu lets guests switch', () => {
    const two = render(viewOf(fixture('horizontal-sections')))
    expect(two).toContain('data-layout="two"')
    expect(two).toContain('data-slot="menu.layout_switch"')
    const one = render(viewOf(fixture('one-column')))
    expect(one).toContain('data-layout="one"')
    expect(one).not.toContain('data-slot="menu.layout_switch"')
    expect(one).not.toContain('role="radiogroup"')
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

const SERVICE_SLOTS = ['menu.call_waiter', 'menu.bill', 'menu.bag', 'menu.pay']
const slotsOf = (html: string) =>
  new Set(withAttribute(parseHtml(html), 'data-slot').map((element) => element.attrs['data-slot']))

describe('the service controls (R15, D71, D72)', () => {
  it('are all drawn on the features-on fixture, each once, when the services are bound', () => {
    const view = viewOf(fixture('features-on'))
    const root = parseHtml(render(view))
    for (const slot of ['menu.filters', ...SERVICE_SLOTS]) {
      expect(withAttribute(root, 'data-slot', slot), slot).toHaveLength(1)
    }
  })

  it('are not drawn on any fixture when the venue switched them off', () => {
    const view = viewOf(fixture('features-off'))
    const slots = slotsOf(render(view))
    for (const slot of ['menu.filters', ...SERVICE_SLOTS]) expect(slots.has(slot), slot).toBe(false)
    const html = render(view)
    expect(html).not.toContain('class="ro-')
    expect(html).not.toContain('data-services')
  })

  it('are not drawn without bound services, though the venue switched them on (a browsing page)', () => {
    const view = viewOf(fixture('features-on'))
    expect(view.features.bill).toBe(true)
    const html = renderBrowsing(view)
    const slots = slotsOf(html)
    for (const slot of SERVICE_SLOTS) expect(slots.has(slot), slot).toBe(false)
    expect(slots.has('menu.filters')).toBe(true) // filters are not a service
    // No stylesheet, no marker and no room for the bar: an empty band under the menu would show.
    expect(html).not.toContain('.ro-')
    expect(html).not.toContain('class="ro-')
    expect(html).not.toContain('data-services')
  })

  it('leave the contract failing for a face that declares a service and draws none', async () => {
    // The harness catches a face whose render forgot to bind the services: only the four slots are missing.
    const report = await runFaceContract(renderBrowsing, EDITORIAL_MARKET_MANIFEST)
    expect(new Set(report.failures.map((failure) => failure.rule))).toEqual(new Set(['R15']))
    expect(report.failures.every((failure) => failure.fixture === 'features-on')).toBe(true)
    // The four slots, and the quick-add of each dish that can be ordered (T90).
    const orderable = itemsOf(viewOf(fixture('features-on'))).filter((item) => item.order.controls)
    expect(orderable.length).toBeGreaterThan(0)
    expect(report.failures).toHaveLength(SERVICE_SLOTS.length + orderable.length)
    expect(report.failures.filter((failure) => failure.message.includes('item.add'))).toHaveLength(
      orderable.length,
    )
  })

  it('draw the stylesheet of the services, and the room for the bar, only with the bar', () => {
    const on = viewOf(fixture('features-on'))
    expect(withAttribute(parseHtml(render(on)), 'data-services', 'bar')).toHaveLength(1)
    expect(render(on)).toContain('.ro-bagbar')
    // A service that is not the bar (the bill alone) has the stylesheet and no bar.
    const billOnly: ViewModel = {
      ...on,
      features: { ...on.features, callWaiter: null, ordering: false, pay: false },
    }
    const html = render(billOnly)
    expect(html).toContain('.ro-pill')
    expect(withAttribute(parseHtml(html), 'data-services')).toHaveLength(0)
    expect(slotsOf(html).has('menu.bill')).toBe(true)
    expect(slotsOf(html).has('menu.bag')).toBe(false)
  })

  it('draw no quick-add on an item without ordering controls, and one on each item with them', () => {
    const view = viewOf(fixture('features-on'))
    const html = render(view)
    const root = parseHtml(html)
    const cards = withAttribute(root, 'data-item')
    const withControls = itemsOf(view).filter((item) => item.order.controls)
    expect(withControls.length).toBeGreaterThan(0)
    const quick = cards.filter((card) => withAttribute(card, 'class', 'ro-quick').length > 0)
    expect(quick.map((card) => card.attrs['data-item'])).toEqual(
      withControls.map((item) => item.id),
    )
    // And none at all when the venue has ordering off, whatever else is on.
    const off: ViewModel = { ...view, features: { ...view.features, ordering: false } }
    expect(withAttribute(parseHtml(render(off)), 'class', 'ro-quick')).toHaveLength(0)
  })

  it('mark that quick-add item.add, one on each item with ordering controls (T90)', () => {
    const view = viewOf(fixture('features-on'))
    const root = parseHtml(render(view))
    const cards = withAttribute(root, 'data-item')
    const marked = cards.filter((card) => withAttribute(card, 'data-slot', 'item.add').length > 0)
    expect(marked.map((card) => card.attrs['data-item'])).toEqual(
      itemsOf(view)
        .filter((item) => item.order.controls)
        .map((item) => item.id),
    )
    expect(
      withAttribute(root, 'data-slot', 'item.add').every((control) => control.tag === 'button'),
    ).toBe(true)
  })
})

describe('the table’s order on the first render (D117, #239)', () => {
  const view = viewOf(fixture('features-on'))
  const orderable = itemsOf(view).filter((item) => item.order.controls)
  const bound = (state: Partial<ServiceState>) => ({
    ...stubServices(),
    state: { ...EMPTY_SERVICE_STATE, ...state },
  })
  const drawn = (state: Partial<ServiceState>) =>
    parseHtml(renderToStaticMarkup(<EditorialMarketFace view={view} services={bound(state)} />))
  const lineFor = (
    itemId: string,
    qty = 1,
    changes: Partial<OrderLineView> = {},
  ): OrderLineView => ({
    id: `ol_${itemId.slice(-8)}`,
    itemId: itemId as OrderLineView['itemId'],
    optionIds: [],
    qty,
    note: '',
    mode: 'on_bill',
    held: false,
    pending: false,
    ...changes,
  })

  it('draws the bag’s place in the bar empty while the table’s order has no line', () => {
    const root = drawn({ order: { lines: [], removed: [], earlier: null } })
    const slot = withAttribute(root, 'data-slot', 'menu.bag')
    expect(slot).toHaveLength(1)
    expect(withAttribute(slot[0] as HtmlElement, 'class', 'ro-bagbtn')).toHaveLength(0)
    expect(withAttribute(root, 'class', 'ro-bagbar')[0]?.attrs['data-bag']).toBe('false')
  })

  it('draws the host’s lines as the count and the estimate in the bar, and a counter on the dish', () => {
    const [first, second] = orderable
    expect(first && second).toBeTruthy()
    const lines = [lineFor(first?.id ?? '', 2), lineFor(second?.id ?? '')]
    const root = drawn({ order: { lines, removed: [], earlier: null } })
    const button = withAttribute(root, 'class', 'ro-bagbtn')
    expect(button).toHaveLength(1)
    expect(textOf(button[0] as HtmlElement)).toContain('3')
    expect(textOf(button[0] as HtmlElement)).toContain('approx.')
    // The two dishes in the order show their counters; the rest keep the "+".
    const counters = withAttribute(root, 'class', 'ro-stepper is-sm')
    expect(counters).toHaveLength(2)
    expect(withAttribute(root, 'data-slot', 'item.add')).toHaveLength(orderable.length - 2)
  })

  it('has the bag button for a sent order alone, and for the reason the order is hidden', () => {
    const [first] = orderable
    const sent: SentOrderView = {
      id: 'so_1',
      state: 'added',
      reason: null,
      ref: 'K7Q',
      lines: [{ itemId: (first?.id ?? '') as OrderLineView['itemId'], optionIds: [], qty: 1 }],
      sentAt: 0,
      mine: false,
    }
    expect(withAttribute(drawn({ sentOrders: [sent] }), 'class', 'ro-bagbtn')).toHaveLength(1)
    const needed = drawn({
      order: null,
      location: { state: 'needed', prompt: 'none', consent: 'declined', venueName: 'X' },
    })
    expect(withAttribute(needed, 'class', 'ro-bagbtn')).toHaveLength(1)
  })

  it('says "Order this from your waiter" in place of the "+" on a dish that needs a choice, where the POS takes none', () => {
    const choosy = orderable.filter((item) => item.modifierGroups.some((group) => group.required))
    const root = drawn({ ordering: { state: 'on' } })
    expect(withAttribute(root, 'data-slot', 'item.order_from_waiter')).toHaveLength(choosy.length)
    const withChoices = drawn({ ordering: { state: 'on', notesAndOptions: true } })
    expect(withAttribute(withChoices, 'data-slot', 'item.order_from_waiter')).toHaveLength(0)
  })
})

describe('the controls the audits drive (T90)', () => {
  it('marks the button that opens the dish page item.open, once in each item', () => {
    const view = richView()
    const root = parseHtml(render(view))
    const cards = withAttribute(root, 'data-item')
    expect(cards.length).toBeGreaterThan(0)
    for (const card of cards) {
      const opener = withAttribute(card, 'data-slot', 'item.open')
      expect(opener).toHaveLength(1)
      expect(opener[0]?.tag).toBe('button')
    }
  })

  it('marks the language switch menu.language when the host gives two languages, and not with one', () => {
    const view = richView()
    const languages = ['bg_BG', 'en_US'] as const
    const two = renderToStaticMarkup(
      <EditorialMarketFace view={view} languages={languages} onLanguageChange={() => {}} />,
    )
    const marked = withAttribute(parseHtml(two), 'data-slot', 'menu.language')
    expect(marked).toHaveLength(1)
    expect(withAttribute(marked[0] as HtmlElement, 'aria-pressed')).toHaveLength(2)
    const one = renderToStaticMarkup(<EditorialMarketFace view={view} languages={['en_US']} />)
    expect(withAttribute(parseHtml(one), 'data-slot', 'menu.language')).toHaveLength(0)
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

// The tests every face has to pass (brief SH-03): manifest, contract on every fixture, theme-only CSS
// (the face's whole stylesheet: the page's and the services').
faceContractSuite('editorial-market', {
  manifest: EDITORIAL_MARKET_MANIFEST,
  render,
  css: `${EDITORIAL_CSS}
${SERVICES_CSS}`,
})
