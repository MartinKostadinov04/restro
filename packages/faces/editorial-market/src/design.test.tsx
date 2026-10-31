// The renderer against the design contract (D128, D130):
//   - the never-list on every fixture at every value of every option it draws and at every Style;
//   - every Style on every fixture against its stored rendering (`__renderings__/<style>/`), so a
//     new option can never change an existing look;
//   - Editorial against today's look (`__renderings__/today/`, written from the face as it stood
//     before it became the renderer): the only differences are the Style file's departures.
//
// A stored rendering is written once and read from then on. When a change means to move a look,
// `vitest -u` rewrites the files and the diff shows what moved; a new option at its first value
// moves nothing.

import { join } from 'node:path'
import type { ViewModel } from '@restro/shell'
import {
  BASIC_DESIGN_VALUES,
  type ContractHost,
  designCases,
  designView,
  type Fixture,
  fingerprint,
  firstDesignAttributes,
  neverListFixtures,
  resolvedCss,
  runDesignContract,
  storedRendering,
  stubServices,
  styleCases,
  withDesign,
} from '@restro/shell/testing'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { EDITORIAL_CSS } from './css'
import { EditorialMarketFace } from './face'
import { EDITORIAL_MARKET_MANIFEST } from './manifest'
import { SERVICES_CSS } from './services/services-css'
import { richFixture } from './test-views'

/** What the renderer draws (tickets 3 to 5): General, the browsing pages and the five screens. */
const DRAWN = {
  general: [
    'screen',
    'body_font',
    'heading_font',
    'heading_weight',
    'corners',
    'depth',
    'density',
    'text_size',
    'buttons',
  ],
  header: ['band', 'arrangement', 'title_size', 'logo_size'],
  navigation: ['marker', 'band'],
  sections: ['header', 'title_size', 'title_case', 'strip_card_size'],
  items: [
    'frame',
    'name_size',
    'name_weight',
    'name_case',
    'price_place',
    'portion_place',
    'description_lines',
    'layout',
    'guest_switch',
  ],
  photos: ['shape', 'fit', 'backdrop', 'frame', 'corners'],
  labels: ['labels'],
  dish: ['photo'],
  sheets: ['sheets'],
  call: ['kinds'],
  bill: ['rows', 'lines'],
  order: ['add_control', 'order_bar', 'line_photos'],
  pay: ['tip'],
  receipt: ['venue_block'],
} as const

/** The tokens the options' values set on the root. */
const TOKENS = [
  '--rm-font-heading',
  '--rm-heading-weight',
  '--rm-subheading-weight',
  '--rm-full',
  '--rm-depth',
  '--rm-depth-up',
  '--rm-space',
  '--rm-type',
  '--rm-button',
  '--rm-on-button',
  '--rm-button-mark',
  '--rm-on-button-mark',
  '--rm-ink',
  '--rm-page',
  '--rm-panel',
  '--rm-title-size',
  '--rm-title-narrow',
  '--rm-title-leading',
  '--rm-logo-width',
  '--rm-logo-height',
  '--rm-nav-weight',
  '--rm-section-title',
  '--rm-section-title-narrow',
  '--rm-strip-card',
  '--rm-strip-card-max',
  '--rm-strip-card-wide',
  '--rm-strip-card-narrow',
  '--rm-item-rule',
  '--rm-name-text',
  '--rm-name-list',
  '--rm-name-one',
  '--rm-name-two',
  '--rm-name-two-narrow',
  '--rm-name-strip',
  '--rm-name-weight',
  '--rm-name-case',
  '--rm-name-tracking',
  '--rm-price-photo',
  '--rm-price-strip',
  '--rm-photo-shape',
  '--rm-photo-fit',
  '--rm-photo-backdrop',
  '--rm-photo-pad',
  '--rm-photo-pad-two',
  '--rm-photo-pad-two-narrow',
  '--rm-dish-photo-pad',
  '--rm-photo-box-corners',
  '--rm-photo-corners',
  '--rm-mark-offset',
  '--rm-mark-room',
]

const CSS = `${EDITORIAL_CSS}\n${SERVICES_CSS}`
const ROOT = '.rm'
const here = join(__dirname, '__renderings__')

// Vite's own file reader, as a face's package may not use `fs`: the rendering of today, as text.
declare global {
  interface ImportMeta {
    glob(
      pattern: string,
      options: { eager: true; query: '?raw'; import: 'default' },
    ): Record<string, string>
  }
}
const TODAY = import.meta.glob('./__renderings__/today/*.snap', {
  eager: true,
  query: '?raw',
  import: 'default',
})

const render = (view: ViewModel, host?: ContractHost) =>
  renderToStaticMarkup(
    <EditorialMarketFace view={view} languages={host?.languages} services={stubServices()} />,
  )

/** The browsing page as a Style draws it: the stored renderings hold no service control. */
const renderBrowsing = (view: ViewModel) =>
  renderToStaticMarkup(<EditorialMarketFace view={view} />)

/** The attributes on the root for a design. */
const rootOf = (html: string) => {
  const tag = /<div [^>]*data-face=[^>]*>/.exec(html)?.[0] ?? ''
  return Object.fromEntries(
    [...tag.matchAll(/ ([\w-]+)="([^"]*)"/g)].map((match) => [match[1], match[2]]),
  ) as Record<string, string>
}

const fixtures = [richFixture(), ...neverListFixtures()]
const editorial = styleCases().find((style) => style.id === 'style:editorial')

/** A fixture's rendering in the form it is stored. Only the 300-item menu is kept as a fingerprint. */
function stored(html: string, name: string, first = firstDesignAttributes()): string {
  const text = storedRendering(html, first)
  return name === 'big-menu' ? `${fingerprint(text)}\n` : text
}

describe('the never-list (D130)', () => {
  it('holds on every fixture, at every value of every option drawn and at every Style', async () => {
    const report = await runDesignContract({
      manifest: EDITORIAL_MARKET_MANIFEST,
      render,
      css: CSS,
      drawn: DRAWN,
      rootSelector: ROOT,
      tokens: TOKENS,
      inkValues: ['var(--rm-text)', 'inherit', 'currentColor'],
      fixtures,
    })
    expect(report.failures).toEqual([])
    // Guards against a sweep that checks nothing: two Styles and every value off Basic's.
    expect(report.cases).toBe(designCases(DRAWN).length)
    expect(report.cases).toBeGreaterThanOrEqual(68)
    expect(report.renders).toBe(report.cases * fixtures.length)
  }, 900_000)

  it('inverts an ink button on an ink sheet: page fill, ink writing (D130)', () => {
    expect(EDITORIAL_CSS).toMatch(
      /\.rm\[data-buttons="ink"\] \.rm-overlay-panel:not\(\.is-detail\) \{\s*--rm-button: var\(--rm-bg\);\s*--rm-on-button: var\(--rm-text\);/,
    )
  })
})

describe('the root carries the design (D130)', () => {
  it('has one data attribute per option, and the theme tokens follow the values', () => {
    const view = designView(
      withDesign(richFixture(), BASIC_DESIGN_VALUES),
      EDITORIAL_MARKET_MANIFEST,
    )
    const attrs = rootOf(render(view))
    for (const [attribute, value] of Object.entries(firstDesignAttributes())) {
      expect(attrs[attribute], attribute).toBe(value)
    }
    expect(attrs['data-style']).toBeUndefined()
    expect(attrs['data-colours']).toBeUndefined()
    expect(attrs.style).toContain('Inter')
  })
})

describe('a new option never changes an existing look (D130)', () => {
  for (const style of styleCases()) {
    const name = style.id.replace('style:', '')
    for (const fixture of fixtures) {
      it(`${name} on ${fixture.name} equals its stored rendering`, async () => {
        const view = designView(withDesign(fixture, style.values), EDITORIAL_MARKET_MANIFEST)
        await expect(stored(renderBrowsing(view), fixture.name)).toMatchFileSnapshot(
          join(here, name, `${fixture.name}.html.snap`),
        )
      })
    }
    it(`${name}'s stylesheet, as it draws it, equals its stored rendering`, async () => {
      const view = designView(withDesign(richFixture(), style.values), EDITORIAL_MARKET_MANIFEST)
      const css = resolvedCss(CSS, ROOT, rootOf(render(view)), TOKENS)
      await expect(css).toMatchFileSnapshot(join(here, `${name}.css.snap`))
    })
  }

  /** Basic and the throwaway option, as a test would add it to the contract. */
  const withThrowaway = (value: string) => ({
    ...BASIC_DESIGN_VALUES,
    general: { ...BASIC_DESIGN_VALUES.general, throwaway: value },
  })
  const THROWAWAY_CSS = `${CSS}\n.rm[data-throwaway="second"] { --rm-type: 2; }\n`
  const first = firstDesignAttributes({ ...BASIC_DESIGN_VALUES.general, throwaway: 'first' })
  const basic = designView(
    withDesign(richFixture(), BASIC_DESIGN_VALUES),
    EDITORIAL_MARKET_MANIFEST,
  )
  const added = (value: string) => ({
    ...basic,
    design: withThrowaway(value) as ViewModel['design'],
  })

  it('leaves the stored renderings equal when an option comes with its first value', () => {
    const html = renderBrowsing(added('first'))
    expect(rootOf(html)['data-throwaway']).toBe('first')
    expect(stored(html, 'x', first)).toBe(stored(renderBrowsing(basic), 'x'))
    expect(resolvedCss(THROWAWAY_CSS, ROOT, rootOf(html), TOKENS)).toBe(
      resolvedCss(CSS, ROOT, rootOf(renderBrowsing(basic)), TOKENS),
    )
  })

  it('does show when the option leaves its first value: the comparison can see', () => {
    const html = renderBrowsing(added('second'))
    expect(stored(html, 'x', first)).not.toBe(stored(renderBrowsing(basic), 'x'))
    expect(resolvedCss(THROWAWAY_CSS, ROOT, rootOf(html), TOKENS)).not.toBe(
      resolvedCss(CSS, ROOT, rootOf(renderBrowsing(basic)), TOKENS),
    )
  })
})

describe("Editorial against today's look (D128)", () => {
  const today = (name: string) => TODAY[`./__renderings__/today/${name}`] ?? ''

  /** Today's file of the test menu is with every dish on sale: today a sold-out one was drawn greyed. */
  const everyItemOnSale = (fixture: Fixture): Fixture =>
    fixture.name !== 'editorial-market-rich'
      ? fixture
      : {
          ...fixture,
          snapshot: {
            ...fixture.snapshot,
            items: Object.fromEntries(
              Object.entries(fixture.snapshot.items).map(([id, item]) => [
                id,
                { ...item, availability: { ...item.availability, state: 'available' as const } },
              ]),
            ),
          },
        }
  const values = editorial?.values ?? BASIC_DESIGN_VALUES

  /** Today had neither the design's attributes on its root nor the parts' markers. */
  const designAttributeNames = Object.keys(firstDesignAttributes())
  const asToday = (html: string) =>
    storedRendering(html, {})
      .replace(/ data-design-part="[^"]*"/g, '')
      .replace(/<div [^>]*data-face=[^>]*>/, (root) =>
        designAttributeNames.reduce(
          (text, attribute) => text.replace(new RegExp(` ${attribute}="[^"]*"`), ''),
          root,
        ),
      )

  for (const fixture of fixtures.filter((candidate) => candidate.name !== 'big-menu')) {
    it(`draws ${fixture.name} with today's markup`, () => {
      const view = designView(
        withDesign(everyItemOnSale(fixture), values),
        EDITORIAL_MARKET_MANIFEST,
      )
      expect(asToday(renderBrowsing(view))).toBe(today(`${fixture.name}.html.snap`))
    })
  }

  it('differs from today’s stylesheet only by the departures its Style file lists', () => {
    const view = designView(withDesign(richFixture(), values), EDITORIAL_MARKET_MANIFEST)
    const attrs = rootOf(render(view))
    const lines = (css: string) =>
      resolvedCss(css, ROOT, attrs, TOKENS, { '--rm-radius': '8px' }).trimEnd().split('\n')
    const now = lines(CSS)
    const then = lines(today('today.css.snap'))
    const added = now.filter((line) => !then.includes(line))
    const removed = then.filter((line) => !now.includes(line))
    expect({ added: unlisted(added, true), removed: unlisted(removed, false) }).toEqual({
      added: [],
      removed: [],
    })
  })
})

describe('every value of every option, as stored (D130)', () => {
  const rendering = designCases(DRAWN).map((one) => {
    const view = designView(withDesign(richFixture(), one.values), EDITORIAL_MARKET_MANIFEST)
    const html = render(view)
    const css = resolvedCss(CSS, ROOT, rootOf(html), TOKENS)
    return `${one.id} ${fingerprint(stored(renderBrowsing(view), 'x'))} ${fingerprint(css)}`
  })

  it('moves only with a change that means to move a look', async () => {
    await expect(`${rendering.join('\n')}\n`).toMatchFileSnapshot(join(here, 'options.snap'))
  })

  it('gives every value a look of its own: the markup or the stylesheet moves', () => {
    const basic = rendering.find((line) => line.startsWith('style:basic')) ?? ''
    const look = (line: string) => line.slice(line.indexOf(' '))
    const same = rendering.filter(
      (line) => !line.startsWith('style:') && look(line) === look(basic),
    )
    // Each value draws differently from Basic, in the markup or the stylesheet (`body_font` and
    // `screen` through the root's own attributes). A value left out of the stylesheet shows here.
    expect(same.map((line) => line.split(' ')[0])).toEqual([])
  })
})

/** The lines of a stylesheet diff that no departure of Editorial's Style file explains. */
function unlisted(lines: readonly string[], added: boolean): readonly string[] {
  return lines.filter((line) => !DEPARTURES.some((departure) => departure(line, added)))
}

const property = (line: string) => /\{ ([\w-]+):/.exec(line)?.[1] ?? ''

/** Each departure of `packages/shell/src/design/styles/editorial.ts`, as the lines it may touch. */
const DEPARTURES: readonly ((line: string, added: boolean) => boolean)[] = [
  // The confirmation's note states its size in pixels: 0.9 of the page's 16 px (no departure in look).
  (line) => /\.ro-confirm-note/.test(line) && property(line) === 'font-size',
  // The confirmation's note reads at 4.5:1 on any sheet: its own rule adds an opacity and a colour,
  // and nothing of the earlier rules goes (#173).
  (line, added) =>
    added &&
    line.startsWith('.rm .ro-confirm .ro-confirm-note {') &&
    /^(?:opacity|color)$/.test(property(line)),
  // The headings state the font they used to inherit: `same` draws the same (no departure in look).
  (line, added) => added && line.endsWith('{ font-family: var(--rm-font) }'),
  // The 9–11 px marks, chips, allergen numbers and table label rise to the 12 px floor.
  (line, added) =>
    added
      ? line.endsWith('{ font-size: 12px }')
      : /\{ font-size: (?:9|10|11|11\.5)px \}$/.test(line),
  // The note, email and promo inputs rise from 15 px to the 16 px floor.
  (line) => /\.ro-note textarea/.test(line) && property(line) === 'font-size',
  // Strip crops and the dish photo are 4:3.
  (line) => /\.rm-photo img|\.rm-detail-photo img/.test(line) && property(line) === 'aspect-ratio',
  // A card shows three description lines beside a photo too.
  (line, added) =>
    !added &&
    line.includes('.rm-item.has-photo .rm-description p') &&
    property(line) === '-webkit-line-clamp',
  // The fixed small shadows of sheets, strip cards and the "+" become the `low` depth step.
  (line) =>
    property(line) === 'box-shadow' &&
    /color-mix\(in srgb, var\(--rm-text\) \d+%, transparent\)/.test(line) &&
    !line.includes('inset'),
  // Buttons is `ink` and Send and Pay follow it; on an ink sheet they invert.
  (line) =>
    /\.ro-primary|\.ro-count|\.ro-plus-count/.test(line) &&
    /^(?:background|color)$/.test(property(line)),
  (line, added) =>
    added && line.includes('.rm[data-buttons="ink"] .rm-overlay-panel:not(.is-detail)'),
  // The receipt's dashed rules are ruled rows.
  (line) => line.includes('.ro-receipt') && property(line) === 'border-bottom',
  // Two-column cards draw the choices summary and the extra fields.
  (line, added) =>
    !added && /\.rm-modifiers|\.rm-extra/.test(line) && line.endsWith('{ display: none }'),
  // A sold-out item is not drawn (D131): the greyed card's rules are gone.
  (line, added) => !added && /data-state="(?:sold_out|unavailable)"/.test(line),
]
