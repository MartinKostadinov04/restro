import { describe, expect, it } from 'vitest'

import { type FaceManifest, validateManifest } from '../src/manifest'
import type { ViewItem, ViewModel, ViewSection } from '../src/view-model'
import type { RenderFn } from './contract'
import { cssRules, fontSizePx, resolvedCss, rulesFor, valuesOf, withCalc } from './css-rules'
import {
  assertTextFloors,
  type DesignFailure,
  designCases,
  firstDesignAttributes,
  firstRootAttributes,
  neverListFixtures,
  runDesignContract,
  storedRendering,
  styleCases,
} from './design-contract'
import { fixture } from './fixtures'
import { parseHtml, withAttribute } from './html'

const manifest: FaceManifest = (() => {
  const result = validateManifest({
    face: 'planted',
    version: '1.0.0',
    channels: ['qr'],
    slots: {
      'item.name': 'required',
      'item.price': 'required',
      'item.allergens': 'required',
      'item.state': 'required',
      'item.description': { optional: true, lines: 3, overflow: 'expand' },
    },
    allergen_mode: 'inline_codes',
    no_image_layout: 'text_only',
    ordering: false,
    paging: null,
    tokens: ['palette.50', 'font'],
  })
  if (!result.ok) throw new Error(JSON.stringify(result.issues))
  return result.manifest
})()

const lang = (locale: string) => locale.replace('_', '-')
const esc = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** A small face that keeps the never-list. `tweak` plants a breach in the markup. */
function face(tweak: (html: string, item: ViewItem) => string = (html) => html): RenderFn {
  return (view: ViewModel) => {
    const item = (entry: ViewItem) =>
      tweak(
        `<article data-item="${entry.id}" data-design-part="item">
          <h3 class="n" data-slot="item.name" data-design-part="item.name" lang="${lang(entry.name.lang)}">${esc(entry.name.text)}</h3>
          ${entry.price === null ? '' : `<span class="p" data-slot="item.price" data-design-part="item.price">${esc(entry.price.text)}</span>`}
          <span data-slot="item.state" data-state="${entry.state.code}">${esc(entry.state.label?.text ?? '')}</span>
          ${entry.description === null ? '' : `<p class="d" data-slot="item.description" data-design-part="item.description" lang="${lang(entry.description.lang)}">${esc(entry.description.text)}</p>`}
          ${entry.image === null ? '' : `<img data-design-part="item.photo" alt="" src="${entry.image.src}">`}
          ${entry.badges.length === 0 ? '' : `<i data-design-part="item.marks">x</i>`}
          ${entry.dietary.length + entry.tags.length === 0 ? '' : `<i data-design-part="item.labels">x</i>`}
          ${entry.allergens.length === 0 ? '' : `<ul class="a" data-slot="item.allergens" data-design-part="item.allergens">${entry.allergens.map((a) => `<li data-allergen="${a.code}">${a.code}</li>`).join('')}</ul>`}
          ${entry.modifierGroups.length === 0 ? '' : `<div data-design-part="item.choices">${entry.modifierGroups.map((g) => `${esc(g.name.text)} ${g.options.map((o) => esc(o.name.text)).join(' ')}`).join(' ')}</div>`}
          ${entry.order.askWaiter === null ? '' : esc(entry.order.askWaiter.text)}
        </article>`,
        entry,
      )
    const section = (entry: ViewSection): string =>
      `<section data-design-part="section" ${entry.hints.layout === 'horizontal' ? '' : ''}><h2 data-design-part="section.title">${esc(entry.title.text)}</h2><div ${entry.hints.layout === 'horizontal' ? 'data-design-part="strip"' : ''}>${entry.items.map(item).join('')}</div>${entry.sections.map(section).join('')}</section>`
    return `<div class="root" data-face="planted" lang="${lang(view.locale)}"><header data-design-part="header"><div data-design-part="header.title"></div>${view.theme.logo === null ? '' : '<img data-design-part="header.logo" alt="">'}</header>${view.sections.length > 1 ? '<nav data-design-part="nav"></nav>' : ''}${view.layout.guestSwitch ? '<div data-design-part="layout.switch"></div>' : ''}${view.sections.map(section).join('')}${view.allergenLegend.length > 0 ? '<footer data-design-part="footer"></footer>' : ''}</div>`
  }
}

const CSS = `
.root { --x-type: 1; color: var(--x-ink); font-size: calc(16px * var(--x-type)); }
.root[data-text="large"] { --x-type: 1.125; }
.d { font-size: calc(14px * var(--x-type)); }
.p { font-size: calc(14px * var(--x-type)); }
`

/** One run of the never-list on a small sweep; the rules it broke, each once. */
async function broken(render: RenderFn = face(), css = CSS): Promise<readonly DesignFailure[]> {
  const report = await runDesignContract({
    manifest,
    render,
    css,
    drawn: {},
    rootSelector: '.root',
    tokens: ['--x-type'],
    inkValues: ['var(--x-ink)', 'inherit'],
    fixtures: ['long-names', 'tags-dietary', 'deep-modifiers', 'features-off'].map(fixture),
    cases: styleCases().slice(0, 1),
  })
  return report.failures
}

const hasFailure = (failures: readonly DesignFailure[], rule: string, text: string) =>
  failures.some((failure) => failure.rule === rule && failure.message.includes(text))

describe('the never-list (D130)', () => {
  it('passes a face that keeps it', async () => {
    expect(await broken()).toEqual([])
  })

  it('catches a name cut by the stylesheet', async () => {
    const failures = await broken(face(), `${CSS}.n { text-overflow: ellipsis; }`)
    expect(hasFailure(failures, 'name', 'cuts the name')).toBe(true)
  })

  it('catches a name cut by a line clamp, on a nested selector too', async () => {
    const failures = await broken(face(), `${CSS}article .n { -webkit-line-clamp: 2; }`)
    expect(hasFailure(failures, 'name', 'cuts the name')).toBe(true)
  })

  it('catches a name that is not whole', async () => {
    const failures = await broken(face((html) => html.replace(/(<h3[^>]*>)[^<]{3}/, '$1')))
    expect(failures.some((failure) => failure.rule === 'name' || failure.rule === 'R9')).toBe(true)
  })

  it('catches a price struck through, in the markup and in the stylesheet', async () => {
    const markup = await broken(
      face((html) =>
        html.replace(/(<span class="p"[^>]*>)(.*?)<\/span>/, '$1<del>$2</del></span>'),
      ),
    )
    expect(hasFailure(markup, 'price', 'struck through')).toBe(true)
    const css = await broken(face(), `${CSS}.p { text-decoration: line-through; }`)
    expect(hasFailure(css, 'price', 'strikes the price through')).toBe(true)
  })

  it('catches a price out of the ink', async () => {
    const failures = await broken(face(), `${CSS}.p { color: var(--x-muted); }`)
    expect(hasFailure(failures, 'price', 'not in the ink')).toBe(true)
  })

  it('catches a price under the description', async () => {
    const failures = await broken(face(), `${CSS}.d { font-size: calc(18px * var(--x-type)); }`)
    expect(hasFailure(failures, 'price', 'under the description')).toBe(true)
  })

  it('catches allergens taken off the row, or their meaning out of reach', async () => {
    const hidden = await broken(face(), `${CSS}.a { display: none; }`)
    expect(hasFailure(hidden, 'allergens', 'hides the allergens')).toBe(true)
    const unread = await broken(
      face((html) =>
        html.replace(
          /<ul class="a"[\s\S]*?<\/ul>/,
          '<ul class="a" data-slot="item.allergens" data-design-part="item.allergens"></ul>',
        ),
      ),
    )
    expect(unread.some((failure) => failure.rule === 'R6')).toBe(true)
  })

  it('catches a part that is not drawn, and a marker the contract does not have', async () => {
    const gone = await broken(face((html) => html.replace(/ data-design-part="item.price"/, '')))
    expect(hasFailure(gone, 'parts', 'item.price')).toBe(true)
    const unknown = await broken(
      face((html) => html.replace('data-design-part="item.price"', 'data-design-part="item.cost"')),
    )
    expect(hasFailure(unknown, 'parts', 'item.cost')).toBe(true)
  })

  it('catches a placement drawn twice or out of its order', async () => {
    const failures = await broken(face((html) => html + html))
    expect(failures.some((failure) => failure.rule === 'R2' || failure.rule === 'R7')).toBe(true)
  })

  it('catches choices taken off the row, and their order changed', async () => {
    const hidden = await broken(
      face((html) =>
        html.replace(
          'data-design-part="item.choices"',
          'class="c" data-design-part="item.choices"',
        ),
      ),
      `${CSS}.c { display: none; }`,
    )
    expect(hasFailure(hidden, 'parts', 'takes the choices off the row')).toBe(true)
  })

  it('catches a text under the 12 px floor and an input under 16 px, at the design’s own size', () => {
    expect(assertTextFloors('.a { font-size: 11px; }', {})).toEqual(['.a: 11px is under 12px'])
    expect(assertTextFloors('.a input { font-size: 15px; }', {})).toEqual([
      '.a input: 15px is under 16px',
    ])
    expect(
      assertTextFloors('.a { font-size: calc(13px * var(--t)); }', { '--t': '0.9' }),
    ).toHaveLength(1)
    expect(assertTextFloors('.a { font-size: calc(13px * var(--t)); }', { '--t': '1' })).toEqual([])
    // What it cannot read is a failure, never a pass.
    expect(assertTextFloors('.a { font-size: 0.5em; }', {})).toHaveLength(1)
  })

  it('catches a breach of the floors through the sweep, and a colour of the face’s own', async () => {
    const failures = await broken(face(), `${CSS}.n { font-size: 11px; color: #ff0000; }`)
    expect(hasFailure(failures, '§7.5', '11px is under 12px')).toBe(true)
    expect(hasFailure(failures, '§7.5', '#ff0000')).toBe(true)
  })

  it('does not run on the scheduled fixture (D131)', () => {
    expect(neverListFixtures().map((entry) => entry.name)).not.toContain('scheduled')
  })
})

describe('designCases', () => {
  it('holds every Style with a file, then every value but Basic’s of each drawn option', () => {
    const ids = designCases({ general: ['corners', 'text_size'], items: ['layout'] }).map(
      (entry) => entry.id,
    )
    expect(ids).toEqual([
      'style:basic',
      'style:editorial',
      'style:soft',
      'style:classic',
      'style:club',
      'general.corners=square',
      'general.corners=round',
      'general.corners=extra',
      'general.text_size=large',
      'items.layout=one',
      'items.layout=two',
    ])
  })

  it('refuses an option the contract does not have', () => {
    expect(() => designCases({ general: ['nope'] })).toThrow()
  })
})

describe('storedRendering', () => {
  it('leaves out the stylesheet and any root attribute at its first value', () => {
    const html =
      '<div class="rm" data-face="x" data-corners="soft" data-depth="none"><style>.a{}</style><p>x</p></div>'
    expect(storedRendering(html, firstRootAttributes())).toBe(
      '<div class="rm" data-face="x" data-depth="none">\n<p>x</p>\n</div>\n',
    )
  })

  it('names one attribute per General option, and none for the Style or the colours', () => {
    const first = firstRootAttributes({ style: 'basic', colours: 'x', heading_font: 'same' })
    expect(first).toEqual({ 'data-heading-font': 'same' })
  })

  it('names the other pages with the page in front, at Basic’s values', () => {
    const first = firstDesignAttributes()
    expect(first['data-corners']).toBe('soft')
    expect(first['data-items-name-size']).toBe('m')
    expect(first['data-header-band']).toBe('page')
    expect(first['data-sheets-sheets']).toBe('panel')
    expect(first['data-style']).toBeUndefined()
    expect(first['data-general-corners']).toBeUndefined()
  })
})

describe('the stylesheet reader', () => {
  const root = parseHtml(
    '<div class="r" data-x="y"><section class="s is-f"><p class="d"><b>t</b></p></section></div>',
  )
  const d = withAttribute(root, 'class', 'd')[0]
  if (d === undefined) throw new Error('no element')

  it('finds the rules that reach an element, through classes, attributes and combinators', () => {
    const rules = cssRules(`
      .d { color: red; }
      .s > .d { color: blue; }
      .r[data-x="y"] .d { top: 0; }
      .r[data-x="z"] .d { top: 1px; }
      .s:not(.is-f) .d { top: 2px; }
      .s:is(.is-f, .other) p { top: 3px; }
      .d::before { top: 4px; }
      .other .d { top: 5px; }
      @media (min-width: 1px) { p { left: 0; } }
      @keyframes k { from { top: 6px; } }
    `)
    expect(rulesFor(d, rules).map((rule) => rule.selector)).toEqual([
      '.d',
      '.s > .d',
      '.r[data-x="y"] .d',
      '.s:is(.is-f, .other) p',
      'p',
    ])
  })

  it('takes the cascade’s winner, and inherits where asked', () => {
    const rules = cssRules('.r { font-size: 16px; } p { color: red; } .s .d { color: blue; }')
    expect(valuesOf(d, 'color', rules, true)).toEqual(['blue'])
    expect(valuesOf(d, 'font-size', rules, false)).toEqual([])
    expect(valuesOf(d, 'font-size', rules, true)).toEqual(['16px'])
  })

  it('works out calc and clamp', () => {
    expect(withCalc('calc(14px * 1.125) 2px calc(0.5 * 8px)')).toBe('15.75px 2px 4px')
    expect(fontSizePx('clamp(calc(38px * var(--t)), 11vw, 60px)', { '--t': '1' })).toBe(38)
    expect(fontSizePx('var(--nope)', {})).toBeNull()
  })

  it('draws a stylesheet as a design: a rule of another value gone, tokens worked out', () => {
    const css = `
      .r { --t: 1; --keep: 2; top: calc(10px * var(--t)); }
      .r[data-a="b"] { --t: 2; }
      .r[data-a="b"] .d { left: 0; }
      .r[data-a="c"] .d { left: 1px; }
    `
    expect(resolvedCss(css, '.r', {}, ['--t'])).toBe('.r { --keep: 2 }\n.r { top: 10px }\n')
    expect(resolvedCss(css, '.r', { 'data-a': 'b' }, ['--t'])).toBe(
      '.r { --keep: 2 }\n.r { top: 20px }\n.r[data-a="b"] .d { left: 0 }\n',
    )
  })
})
