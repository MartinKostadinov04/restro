// @vitest-environment jsdom

// The five guest-feature screens' options (D130, #173): Call a waiter's kinds, the Bill's rows and
// lines, the Order's add control, order bar and line photos, the Pay page's tip, the Receipt's venue
// block. For every Style and every value, each screen is opened with the services on and drawn from
// the host's state, and these hold:
//   - the option is on the root and its value draws something (the stylesheet as that design draws it);
//   - what D72 and D122 fix is untouched: every text a screen draws at Basic's values is drawn at this
//     design's (the words, the states, the amounts, the lines, the consent text, the "Preview"
//     marker), and the rules of the waiter reference and the status panel are Basic's own lines;
//   - what an option adds is there (the seven kinds, the tip rows' amounts, a line's photo, the
//     logo with the name under it), and nothing an option takes off the screen.
// The sizes, targets and contrast of the real page are measured by faces-design-screens.spec.ts.

import { type DesignValues, SERVICE_KINDS, stringsFor, type ViewModel } from '@restro/shell'
import {
  cssRules,
  designCases,
  designView,
  fixtureId,
  type HtmlElement,
  PAYING_LEGAL,
  parseHtml,
  resolvedCss,
  snapshotFromSpec,
  valuesOf,
  withAttribute,
  withDesign,
} from '@restro/shell/testing'
import { cleanup, fireEvent, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { EDITORIAL_CSS } from '../css'
import { EDITORIAL_MARKET_MANIFEST } from '../manifest'
import { firstImage } from '../test-views'
import { SERVICES_CSS } from './services-css'
import {
  billLine,
  billOf,
  billRound,
  drawFace,
  type FakeHost,
  fakeHost,
  itemNamed,
  orderHost,
  orderLine,
  orderOf,
  payingOf,
  paymentOf,
  resetPage,
  tableBillOf,
} from './test-kit'

vi.setConfig({ testTimeout: 60_000 })

beforeEach(resetPage)
afterEach(() => {
  cleanup()
  document.body.style.overflow = ''
})

const OPTIONS = {
  call: ['kinds'],
  bill: ['rows', 'lines'],
  order: ['add_control', 'order_bar', 'line_photos'],
  pay: ['tip'],
  receipt: ['venue_block'],
}
const CASES = designCases(OPTIONS)
const BASIC = CASES.find((one) => one.id === 'style:basic')?.values as DesignValues
const WORDS = stringsFor('en_US').services
const CSS = `${EDITORIAL_CSS}\n${SERVICES_CSS}`

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

/** The ordering menu with a photo on its first dish and the venue's logo, in a design. */
function menu(values: DesignValues): ViewModel {
  const photo = fixtureId('as', 1)
  const both = (en: string, bg: string) => ({ en_US: en, bg_BG: bg })
  const fixture = {
    name: 'screens',
    note: 'Every service on; a dish with a photo, a dish with choices, a plain dish.',
    snapshot: snapshotFromSpec({
      locales: { default: 'en_US', available: ['en_US', 'bg_BG'] },
      menuTitle: both('Late Menu', 'Късно меню'),
      assets: { [photo]: { w: 1600, h: 1200, alt: { en_US: 'A plate of food' } } },
      features: {
        filters: false,
        call_waiter: { enabled: true, kinds: [...SERVICE_KINDS] },
        bill: true,
        ordering: true,
        pay: true,
      },
      sections: [
        {
          title: both('Food', 'Храна'),
          items: [
            { name: both('Hummus', 'Хумус'), image: photo, price: 700 },
            {
              name: both('Bowl', 'Боул'),
              price: 1000,
              groups: [
                {
                  name: both('Size', 'Размер'),
                  min: 1,
                  max: 1,
                  options: [
                    { name: both('Regular', 'Стандартна'), delta: null },
                    { name: both('Large', 'Голяма'), delta: 250 },
                  ],
                },
              ],
            },
            { name: both('Mojito', 'Мохито'), price: 1000 },
          ],
        },
      ],
    }),
    overlay: null,
    context: {
      locale: 'en_US' as const,
      now: '2026-10-07T20:30:00+03:00',
      orderingEnabled: true,
      tableToken: 'test-table-token',
      capabilities: { callWaiter: true, bill: true, ordering: true, pay: true },
    },
  }
  const view = designView(withDesign(fixture, values), EDITORIAL_MARKET_MANIFEST)
  return { ...view, theme: { ...view.theme, logo: firstImage(view) } }
}

const text = (value: string) => ({ text: value, lang: 'en_US' as const })

/** The screens, each with the host state that fills it and the way a guest opens it. */
const SCREENS: Record<string, { host: (view: ViewModel) => FakeHost; open: () => void }> = {
  call: { host: () => fakeHost(), open: () => click('Call a server') },
  bag: {
    host: (view) => {
      const bowl = itemNamed(view, 'Bowl')
      const size = bowl.modifierGroups[0]?.options.map((option) => option.id) ?? []
      return orderHost({
        order: orderOf([
          orderLine(itemNamed(view, 'Hummus'), 2),
          orderLine(bowl, 1, { optionIds: size.slice(1), note: 'no onions' }),
        ]),
      })
    },
    open: () => click(/View bag/),
  },
  bill: {
    host: () =>
      fakeHost({
        tableBill: tableBillOf(),
        paying: payingOf({ legal: PAYING_LEGAL }),
        ordering: { state: 'on', tips: true },
        bill: billOf(
          [
            billRound(
              'g1',
              'guest',
              [
                { ...billLine('g1-1', 'Hummus', 2, 1400), options: [text('Large'), text('Egg')] },
                billLine('g1-2', 'Mojito', 1, 1000, 'preparing'),
              ],
              'a1',
            ),
            billRound('w1', 'staff', [billLine('w1-1', 'House wine', 1, 1250, 'served')]),
          ],
          3650,
        ),
      }),
    open: () => click('Table order'),
  },
  pay: {
    host: () =>
      fakeHost({
        tableBill: tableBillOf(),
        paying: payingOf({ legal: PAYING_LEGAL }),
        ordering: { state: 'on', tips: true },
      }),
    open: () => {
      click('Pay')
      click('The whole bill')
    },
  },
  confirmation: {
    host: () =>
      fakeHost({
        tableBill: tableBillOf(),
        paying: payingOf({ legal: PAYING_LEGAL }),
        ordering: { state: 'on', tips: true },
        payment: paymentOf({ state: 'captured', form: null, tipMinor: 250, amountMinor: 2500 }),
      }),
    open: () => {
      click('Pay')
      click('Payment confirmation')
    },
  },
}

function click(name: string | RegExp) {
  fireEvent.click(screen.getByRole('button', { name }))
}

/** A screen drawn in a design: the markup, the root's attributes and the stylesheet that design draws. */
function drawn(id: keyof typeof SCREENS, values: DesignValues) {
  // Each drawing starts on a clean page: the last one's sheet is in the address and its face on the page.
  cleanup()
  window.history.replaceState(null, '', '/')
  const view = menu(values)
  const entry = SCREENS[id]
  if (entry === undefined) throw new Error(`no screen ${id}`)
  const { container, unmount } = drawFace(entry.host(view), view)
  entry.open()
  const dom = parseHtml(container.innerHTML)
  const root = withAttribute(dom, 'data-face')[0]
  const attrs = root?.attrs ?? {}
  const css = resolvedCss(CSS, '.rm', attrs, TOKENS)
  const sheet = container.querySelector('.rm-overlay') as HTMLElement
  // The bar at the bottom while this sheet is open (it is hidden, not removed: the focus comes back to it).
  const bar = container.querySelector('.ro-bagbar')
  // The rules with their variables left as they are written: a sheet that sets `--rm-button` itself
  // (an ink button on an ink sheet) is only seen when the root's value is not worked in first.
  const rules = cssRules(
    resolvedCss(CSS, '.rm', attrs, [])
      .split('\n')
      .filter((line) => !line.startsWith('@'))
      .join('\n'),
  )
  const result = { container, sheet, attrs, css, texts: textsOf(sheet), bar, dom, rules, unmount }
  return result
}

/** Every text a screen draws, one by one. */
function textsOf(element: Element): string[] {
  const found: string[] = []
  const walk = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      const value = (node.textContent ?? '').replace(/\s+/g, ' ').trim()
      if (value !== '') found.push(value)
    }
    for (const child of node.childNodes) walk(child)
  }
  walk(element)
  return found
}

/** The lines of a stylesheet about the pieces whose looks the decisions fix. */
const fixedLines = (css: string) =>
  css
    .split('\n')
    .filter((line) =>
      /\.ro-waiter-(card|ref)|\.ro-state\b|\.ro-confirm-note|\.ro-preview/.test(line),
    )

describe('every design draws every screen whole (D72, D122, D130)', () => {
  /** Basic's drawing of a screen, made once (the page is reset before each test, so not at load). */
  const basics = new Map<string, { texts: string[]; css: string }>()
  const basicOf = (id: string) => {
    let found = basics.get(id)
    if (found === undefined) {
      const page = drawn(id, BASIC)
      found = { texts: page.texts, css: page.css }
      basics.set(id, found)
      page.unmount()
      cleanup()
      window.history.replaceState(null, '', '/')
    }
    return found
  }

  for (const one of CASES) {
    it(`${one.id}: every text of every screen is drawn, and the fixed looks are Basic's`, () => {
      for (const id of Object.keys(SCREENS)) {
        window.history.replaceState(null, '', '/')
        const page = drawn(id, one.values)
        const reference = basicOf(id)
        for (const word of reference.texts) {
          expect(page.texts, `${id}: "${word}"`).toContain(word)
        }
        // The panels and the reference (40 px at 7:1: their rules are untouched) are Basic's lines.
        expect(fixedLines(page.css), id).toEqual(fixedLines(reference.css))
        page.unmount()
        cleanup()
      }
    })
  }
})

describe('Call a waiter, Kinds (D130)', () => {
  it('draws every kind the code has, as tiles or as a list', () => {
    for (const kinds of ['tiles', 'list']) {
      const page = drawn('call', { ...BASIC, call: { kinds } } as DesignValues)
      expect(page.attrs['data-call-kinds']).toBe(kinds)
      const radios = [...page.sheet.querySelectorAll('[role="radiogroup"] [role="radio"]')]
      expect(radios.map((radio) => radio.textContent)).toEqual(
        SERVICE_KINDS.map((kind) => WORDS.kinds[kind]),
      )
      expect(radios.every((radio) => radio.querySelector('svg') !== null)).toBe(true)
      page.unmount()
      cleanup()
      window.history.replaceState(null, '', '/')
    }
  })

  it('stacks the icon over the word for tiles, and leaves the list as it was', () => {
    const tiles = drawn('call', { ...BASIC, call: { kinds: 'tiles' } } as DesignValues)
    const list = drawn('call', { ...BASIC, call: { kinds: 'list' } } as DesignValues)
    expect(tiles.css).toContain(
      '.rm[data-call-kinds="tiles"] .ro-choicegrid button { flex-direction: column }',
    )
    expect(list.css).not.toContain('data-call-kinds')
  })
})

describe('Bill, Rows and Lines (D130)', () => {
  it('banding is zebra’s alone, ruled keeps its rules, and the Order’s lines follow', () => {
    const zebra = drawn('bill', {
      ...BASIC,
      bill: { rows: 'zebra', lines: 'detailed' },
    } as DesignValues)
    const ruled = drawn('bill', {
      ...BASIC,
      bill: { rows: 'ruled', lines: 'detailed' },
    } as DesignValues)
    expect(zebra.css).toContain('.ro-lines li:nth-child(odd)')
    expect(zebra.css).toContain('.ro-round li:nth-child(even)')
    expect(ruled.css).not.toContain('.ro-lines li:nth-child(odd)')
    expect(ruled.css).toContain('.ro-lines li { border-bottom: 1px solid')
    // The lines and the amounts are the same texts in both.
    expect(zebra.texts).toEqual(ruled.texts)
  })

  it('runs a line’s options on after its name in compact, never under 12 px, and keeps every one', () => {
    const compact = drawn('bill', {
      ...BASIC,
      bill: { rows: 'ruled', lines: 'compact' },
    } as DesignValues)
    const detailed = drawn('bill', {
      ...BASIC,
      bill: { rows: 'ruled', lines: 'detailed' },
    } as DesignValues)
    expect(compact.css).toContain('.ro-tabname small { display: inline }')
    expect(compact.css).toContain('.ro-tabname small { font-size: 12px }')
    expect(detailed.css).not.toContain('.ro-tabname small { display: inline }')
    // Every option the guest chose is still drawn, in both.
    for (const option of ['Large', 'Egg']) {
      expect(
        compact.texts.some((one) => one.includes(option)),
        option,
      ).toBe(true)
      expect(
        detailed.texts.some((one) => one.includes(option)),
        option,
      ).toBe(true)
    }
    // The options of a round's line sit at the 12 px floor in the detailed look too.
    expect(detailed.css).toContain('.rm .ro-tabname small { font-size: 12px }')
  })

  it('has the Order’s lines, the pay summary and the confirmation follow the rows', () => {
    for (const id of ['bag', 'pay', 'confirmation']) {
      const zebra = drawn(id, {
        ...BASIC,
        bill: { rows: 'zebra', lines: 'compact' },
      } as DesignValues)
      expect(zebra.sheet.querySelector('.ro-lines'), id).not.toBeNull()
      expect(zebra.css, id).toContain('.ro-lines li:nth-child(odd)')
      zebra.unmount()
      cleanup()
      window.history.replaceState(null, '', '/')
    }
  })
})

describe('Order, Add control, Order bar and Line photos (D130)', () => {
  it('draws the add control as a "+" or as the shell’s word, with the same name and the same button', () => {
    for (const add_control of ['plus', 'add']) {
      const view = menu({ ...BASIC, order: { ...BASIC.order, add_control } } as DesignValues)
      const host = orderHost()
      const { container } = drawFace(host, view)
      const buttons = [...container.querySelectorAll<HTMLElement>('[data-slot="item.add"]')]
      expect(buttons.length).toBeGreaterThan(0)
      for (const button of buttons) {
        expect(button.getAttribute('aria-label')).toMatch(/^Add /)
        expect(button.textContent?.includes(WORDS.add)).toBe(add_control === 'add')
        expect(button.querySelector('svg') !== null).toBe(add_control === 'plus')
        expect(button.classList.contains('is-word')).toBe(add_control === 'add')
      }
      cleanup()
      window.history.replaceState(null, '', '/')
    }
    expect(WORDS.add).toBe('Add')
    expect(stringsFor('bg_BG').services.add).not.toBe('')
  })

  it('docks the bar to the screen’s edge for docked, floating as it was', () => {
    const docked = drawn('bag', {
      ...BASIC,
      order: { ...BASIC.order, order_bar: 'docked' },
    } as DesignValues)
    const floating = drawn('bag', {
      ...BASIC,
      order: { ...BASIC.order, order_bar: 'floating' },
    } as DesignValues)
    expect(docked.css).toContain('.rm[data-order-order-bar="docked"] .ro-bagbar { padding: 0 }')
    expect(docked.css).toContain('.ro-bagbar button { border-radius: 0 }')
    expect(floating.css).not.toContain('data-order-order-bar')
    // The bar keeps its two buttons, hidden while a sheet is open as before.
    expect(docked.bar?.hasAttribute('hidden')).toBe(true)
  })

  it('shows a small photo ahead of a line only where the line’s dish has one, and only for shown', () => {
    const shown = drawn('bag', {
      ...BASIC,
      order: { ...BASIC.order, line_photos: 'shown' },
    } as DesignValues)
    const hidden = drawn('bag', {
      ...BASIC,
      order: { ...BASIC.order, line_photos: 'hidden' },
    } as DesignValues)
    const photos = shown.sheet.querySelectorAll('li img.ro-line-photo')
    expect(photos).toHaveLength(1)
    expect(photos[0]?.closest('li')?.getAttribute('data-order-line')).not.toBeNull()
    expect(photos[0]?.closest('li')?.textContent).toContain('Hummus')
    expect(hidden.sheet.querySelectorAll('img')).toHaveLength(0)
    // The photo is a picture with its own proportions and takes nothing off the line.
    expect(shown.texts).toEqual(hidden.texts)
    expect(shown.css).toContain('.ro-lines li.has-line-photo')
  })
})

describe('Pay, Tip (D130)', () => {
  const tips = (page: ReturnType<typeof drawn>) => [
    ...page.sheet.querySelectorAll('[data-slot="pay.tip.preset"]'),
  ]

  it('shows what each percent comes to on its row, and the chips only the percent', () => {
    const rows = drawn('pay', { ...BASIC, pay: { tip: 'rows' } } as DesignValues)
    expect(rows.attrs['data-pay-tip']).toBe('rows')
    expect(tips(rows).map((tip) => tip.textContent)).toEqual([
      // €22.50 of lines: 5, 10 and 15 %, rounded half-up.
      '5 %€1.13',
      '10 %€2.25',
      '15 %€3.38',
    ])
    expect(rows.css).toContain('.rm[data-pay-tip="rows"] .ro-tips { grid-template-columns: 1fr }')
    const chips = drawn('pay', { ...BASIC, pay: { tip: 'chips' } } as DesignValues)
    expect(tips(chips).map((tip) => tip.textContent)).toEqual(['5 %', '10 %', '15 %'])
    expect(chips.css).not.toContain('data-pay-tip')
  })

  it('keeps none first: nothing is picked, a tap picks and a second tap clears', () => {
    const rows = drawn('pay', { ...BASIC, pay: { tip: 'rows' } } as DesignValues)
    const [first] = tips(rows)
    expect(first?.getAttribute('aria-pressed')).toBe('false')
    fireEvent.click(first as Element)
    expect(first?.getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(first as Element)
    expect(first?.getAttribute('aria-pressed')).toBe('false')
  })

  it('shows no amount before a line is ticked', () => {
    const view = menu({ ...BASIC, pay: { tip: 'rows' } } as DesignValues)
    drawFace(
      fakeHost({
        tableBill: tableBillOf(),
        paying: payingOf({ legal: PAYING_LEGAL }),
        ordering: { state: 'on', tips: true },
      }),
      view,
    )
    click('Pay')
    const presets = [...document.querySelectorAll('[data-slot="pay.tip.preset"]')]
    expect(presets.map((tip) => tip.textContent)).toEqual(['5 %', '10 %', '15 %'])
  })
})

describe('Receipt, Venue block (D130)', () => {
  it('draws the logo with the name small under it for logo, the name alone for name', () => {
    const logo = drawn('confirmation', {
      ...BASIC,
      receipt: { venue_block: 'logo' },
    } as DesignValues)
    const name = drawn('confirmation', {
      ...BASIC,
      receipt: { venue_block: 'name' },
    } as DesignValues)
    const venue = logo.sheet.querySelector('[data-slot="pay.confirmation.venue"]')
    expect(venue?.textContent).toBe('Club X')
    expect(venue?.classList.contains('is-under-logo')).toBe(true)
    expect(logo.sheet.querySelector('img.ro-confirm-logo')).not.toBeNull()
    expect(name.sheet.querySelector('[data-slot="pay.confirmation.venue"]')?.textContent).toBe(
      'Club X',
    )
    expect(name.sheet.querySelector('img')).toBeNull()
    // The name is never lost to the logo, and the logo's rules are the logo value's alone.
    expect(logo.css).toContain('.ro-confirm p.is-under-logo')
    expect(name.css).not.toContain('is-under-logo')
  })

  it('keeps the name when the venue has no logo', () => {
    const view = { ...menu({ ...BASIC, receipt: { venue_block: 'logo' } } as DesignValues) }
    const bare = { ...view, theme: { ...view.theme, logo: null } }
    const host = fakeHost({
      tableBill: tableBillOf(),
      paying: payingOf({ legal: PAYING_LEGAL }),
      ordering: { state: 'on', tips: true },
      payment: paymentOf({ state: 'captured', form: null }),
    })
    drawFace(host, bare)
    click('Pay')
    click('Payment confirmation')
    const venue = document.querySelector('[data-slot="pay.confirmation.venue"]')
    expect(venue?.textContent).toBe('Club X')
    expect(document.querySelector('img.ro-confirm-logo')).toBeNull()
  })
})

describe('the chips and the inputs follow the labels look (D130)', () => {
  it('fills them for soft and underlines them for text; outline is the boxed look, untouched', () => {
    const line = (labels: string) =>
      drawn('pay', { ...BASIC, labels: { ...BASIC.labels, labels } } as DesignValues).css
    expect(line('soft')).toContain(
      '.ro-promo input { background: color-mix(in srgb, currentColor 8%, transparent) }',
    )
    expect(line('text')).toContain('.ro-promo input { border-width: 0 0 2px }')
    expect(line('outline')).not.toContain('data-labels-labels')
  })
})

describe('an ink button on an ink sheet inverts (D130)', () => {
  /** What a property comes to on an element, followed down its `var()`s to the root's token it ends in. */
  function computed(
    element: HtmlElement,
    name: string,
    rules: ReturnType<typeof cssRules>,
  ): string {
    for (let node: HtmlElement | null = element; node !== null; node = node.parent) {
      const [value] = valuesOf(node, name, rules, false)
      if (value === undefined) continue
      const next = /^var\((--[\w-]+)\)$/.exec(value)
      // A custom property is worked out where it is declared, not where it is read.
      return next === null ? value : computed(node, next[1] as string, rules)
    }
    return `unset(${name})`
  }
  const panelOf = (element: HtmlElement) => {
    for (let node = element.parent; node !== null; node = node.parent) {
      if ((node.attrs.class ?? '').includes('rm-overlay-panel')) return node
    }
    throw new Error('the button is not on a sheet')
  }
  /** Send on the Order's sheet, Pay on the Pay sheet. */
  const BUTTONS = [
    ['bag', 'data-send'],
    ['pay', 'data-slot'],
  ] as const

  it('draws Send and Pay in the page fill with ink writing on an ink sheet', () => {
    for (const [id, attribute] of BUTTONS) {
      const page = drawn(id, {
        ...BASIC,
        general: { ...BASIC.general, buttons: 'ink' },
        sheets: { sheets: 'ink' },
      } as DesignValues)
      const buttons = withAttribute(page.dom, attribute).filter((element) =>
        (element.attrs.class ?? '').includes('ro-primary'),
      )
      const button =
        id === 'pay' ? buttons.find((one) => one.attrs['data-slot'] === 'pay.start') : buttons[0]
      expect(button, id).toBeDefined()
      const sheet = panelOf(button as HtmlElement)
      expect(computed(sheet, 'background', page.rules), `${id} sheet`).toBe('unset(--rm-l-text)')
      expect(computed(button as HtmlElement, 'background', page.rules), `${id} fill`).toBe(
        'unset(--rm-l-background)',
      )
      expect(computed(button as HtmlElement, 'color', page.rules), `${id} writing`).toBe(
        'unset(--rm-l-text)',
      )
    }
  })

  it('never draws a button in its sheet’s own fill, or its writing in its own fill, at any Sheets value', () => {
    for (const buttons of ['accent', 'ink']) {
      for (const sheets of ['panel', 'page', 'ink']) {
        for (const [id, attribute] of BUTTONS) {
          const page = drawn(id, {
            ...BASIC,
            general: { ...BASIC.general, buttons },
            sheets: { sheets },
          } as DesignValues)
          const button = withAttribute(page.dom, attribute).find(
            (element) =>
              (element.attrs.class ?? '').includes('ro-primary') &&
              (id === 'bag' || element.attrs['data-slot'] === 'pay.start'),
          ) as HtmlElement
          const sheet = panelOf(button)
          const where = `${id}, buttons ${buttons}, sheets ${sheets}`
          const fill = computed(button, 'background', page.rules)
          expect(fill, where).not.toBe(computed(sheet, 'background', page.rules))
          expect(computed(button, 'color', page.rules), where).not.toBe(fill)
        }
      }
    }
  })
})
