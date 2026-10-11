import { assertFaceScopedCss, assertThemeOnlyCss } from '@restro/shell/testing'
import { describe, expect, it } from 'vitest'

import { EDITORIAL_CSS } from '../css'
import { SERVICES_CSS } from './services-css'

/** One rule of a stylesheet: its selectors and declarations (property → value). */
interface Rule {
  readonly selectors: readonly string[]
  readonly declarations: ReadonlyMap<string, string>
  /** The condition of the `@media` it sits in, or null. */
  readonly media: string | null
}

/** A small reader for the stylesheets of this package: rules, nested `@media`, `@keyframes` skipped. */
function rulesOf(css: string): Rule[] {
  const text = css.replace(/\/\*[\s\S]*?\*\//g, ' ')
  const rules: Rule[] = []
  let position = 0
  const read = (media: string | null, until: number) => {
    while (position < until) {
      const open = text.indexOf('{', position)
      if (open < 0 || open >= until) return
      const prelude = text.slice(position, open).trim()
      // The matching close brace.
      let depth = 1
      let close = open + 1
      while (depth > 0 && close < text.length) {
        const char = text[close]
        if (char === '{') depth++
        else if (char === '}') depth--
        close++
      }
      const body = text.slice(open + 1, close - 1)
      if (prelude.startsWith('@media')) {
        const saved = position
        position = open + 1
        read(prelude.slice('@media'.length).trim(), close - 1)
        position = Math.max(close, saved)
      } else if (!prelude.startsWith('@')) {
        const declarations = new Map<string, string>()
        for (const declaration of body.split(';')) {
          const colon = declaration.indexOf(':')
          if (colon < 0) continue
          declarations.set(declaration.slice(0, colon).trim(), declaration.slice(colon + 1).trim())
        }
        rules.push({
          selectors: prelude.split(',').map((selector) => selector.trim().replace(/\s+/g, ' ')),
          declarations,
          media,
        })
        position = close
      } else {
        position = close // @keyframes and the like
      }
    }
  }
  read(null, text.length)
  return rules
}

/** The smallest size a value guarantees, in px: `44px`, `max(44px, var(--x))`; null when it cannot say. */
function guaranteed(value: string | undefined): number | null {
  if (value === undefined) return null
  const sizes = [...value.matchAll(/(\d+(?:\.\d+)?)px/g)].map((match) => Number(match[1]))
  if (value.startsWith('max(')) return sizes.length > 0 ? Math.max(...sizes) : null
  if (/^\d+(?:\.\d+)?px$/.test(value)) return sizes[0] ?? null
  return null
}

/** The size a selector guarantees for a property, outside any media query (the last rule wins). */
function sizeOf(rules: readonly Rule[], selector: string, property: string): number | null {
  let found: number | null = null
  for (const rule of rules) {
    if (rule.media === null && rule.selectors.includes(selector)) {
      const size = guaranteed(rule.declarations.get(property))
      if (size !== null) found = size
    }
  }
  return found
}

const services = rulesOf(SERVICES_CSS)

describe('the reader of stylesheets used below (the check itself)', () => {
  it('reads selector lists, nested media and skips keyframes', () => {
    const rules = rulesOf(`
      .a, .b c { min-height: 44px; width: max(44px, var(--x)) }
      @media (hover: hover) { .d:hover { color: red } }
      @keyframes k { from { opacity: 0 } to { opacity: 1 } }
      .e { height: calc(10px + 1px) }
    `)
    expect(rules.map((rule) => [rule.selectors, rule.media])).toEqual([
      [['.a', '.b c'], null],
      [['.d:hover'], '(hover: hover)'],
      [['.e'], null],
    ])
    expect(sizeOf(rules, '.a', 'min-height')).toBe(44)
    expect(sizeOf(rules, '.b c', 'width')).toBe(44)
    expect(sizeOf(rules, '.e', 'height')).toBeNull()
  })
})

describe('the stylesheet of the services (R13)', () => {
  it('chooses no colour of its own: no hex colour, colour function, named colour', () => {
    expect(assertThemeOnlyCss(SERVICES_CSS)).toEqual([])
    // And the check itself would catch one.
    expect(assertThemeOnlyCss(`${SERVICES_CSS}\n.x { color: #fff; background: red }`)).toEqual([
      '#fff',
      'red',
    ])
  })

  it('styles nothing outside its own root: no html, body or :root rule (the host owns the page)', () => {
    expect(assertFaceScopedCss(SERVICES_CSS)).toEqual([])
    expect(assertFaceScopedCss(`${EDITORIAL_CSS}\n${SERVICES_CSS}`)).toEqual([])
    // And the check would catch one.
    expect(assertFaceScopedCss(`${SERVICES_CSS}\nbody:has(.rm) { overflow-x: hidden }`)).toEqual([
      'body:has(.rm)',
    ])
  })

  it('takes its colours from the variables the page root carries', () => {
    for (const variable of [
      '--rm-bg',
      '--rm-text',
      '--rm-accent',
      '--rm-on-accent',
      '--rm-surface',
      '--rm-border',
      '--rm-muted',
      '--rm-accent-text',
    ]) {
      expect(SERVICES_CSS, variable).toContain(`var(${variable})`)
    }
    expect(SERVICES_CSS).toContain('var(--rm-radius)')
    expect(SERVICES_CSS).toContain('var(--rm-pill)')
  })

  it("has every rule under .rm, so it outranks the page's `.rm button` and `.rm svg`", () => {
    const outside = services
      .flatMap((rule) => rule.selectors)
      .filter((selector) => !selector.startsWith('.rm'))
    expect(outside).toEqual([])
  })

  it('never cuts a name or a label with an ellipsis or a line clamp (R9)', () => {
    expect(SERVICES_CSS).not.toMatch(/text-overflow\s*:\s*ellipsis/)
    expect(SERVICES_CSS).not.toMatch(/line-clamp/)
  })

  it('holds the rules of the services and none of the browsing page, and the other way round', () => {
    expect(EDITORIAL_CSS).not.toContain('.ro-')
    expect(
      services
        .flatMap((rule) => rule.selectors)
        .some(
          (selector) =>
            /\.rm-(item|photo|section|header)/.test(selector) &&
            !selector.startsWith('.rm[data-layout'),
        ),
    ).toBe(false)
  })

  it("keeps the room for the bottom bar out of the page and in the services' own sheet", () => {
    expect(EDITORIAL_CSS).not.toMatch(/\.rm main\s*\{[^}]*padding-bottom/)
    expect(EDITORIAL_CSS).not.toMatch(/calc\((110|120)px \+ env/)
    const room = services.find((rule) => rule.selectors.includes('.rm[data-services="bar"] main'))
    expect(room?.declarations.get('padding-bottom')).toContain('110px')
    const footer = services.find((rule) =>
      rule.selectors.includes('.rm[data-services="bar"] .rm-footer'),
    )
    expect(footer?.declarations.get('padding-bottom')).toContain('120px')
  })

  it('switches its animations off for a guest who asked for less motion', () => {
    expect(SERVICES_CSS).toContain('prefers-reduced-motion: reduce')
    const reduced = services.filter((rule) => rule.media === '(prefers-reduced-motion: reduce)')
    const stopped = reduced.flatMap((rule) =>
      rule.declarations.get('animation') === 'none !important' ? rule.selectors : [],
    )
    for (const selector of [
      '.rm .ro-spinner',
      '.rm .ro-pulse',
      '.rm .ro-check',
      '.rm .ro-bagbar',
    ]) {
      expect(stopped, selector).toContain(selector)
    }
  })

  it('keeps the bill to its icon and total up to 440 px when the pay entry sits beside it', () => {
    // Otherwise the pay entry drops to a row of its own at 390-439 px and pushes the title down.
    const compact = services.find(
      (rule) =>
        rule.media === '(max-width: 439px)' &&
        rule.selectors.includes('.rm .ro-pill:has(~ .ro-payentry) .ro-billword'),
    )
    expect(compact?.declarations.get('display')).toBe('none')
  })
})

describe('the edges of inputs and choices (brief SH-07): 3:1 against what is around them', () => {
  const borderOf = (selector: string, property: string) =>
    services
      .filter((rule) => rule.media === null && rule.selectors.includes(selector))
      .map((rule) => rule.declarations.get(property))
      .filter((value) => value !== undefined)
      .at(-1)

  it('draws the edge of a choice or an input on the page in the muted colour, not the border colour', () => {
    // The border role is for separators (about 1.3:1); muted reads at 4.5:1 on the page.
    for (const selector of ['.rm .ro-options button', '.rm .ro-note textarea']) {
      expect(borderOf(selector, 'border'), selector).toBe('1px solid var(--rm-muted)')
    }
  })

  it('draws the edge of a choice or an input on a sheet (inverse colours) at 54 % of its text', () => {
    for (const selector of [
      '.rm .ro-choicegrid button',
      '.rm .ro-tips button',
      '.rm .ro-scope button',
      '.rm .ro-sheet .ro-note textarea',
      '.rm .ro-sheet .ro-input input',
      '.rm .ro-sheet .ro-promo input',
    ]) {
      expect(borderOf(selector, 'border-color'), selector).toBe(
        'color-mix(in srgb, currentColor 54%, transparent)',
      )
    }
  })

  it('marks the chosen one by a ring in the sheet’s text colour as well as by the accent fill', () => {
    const chosen = '.rm .ro-choicegrid [aria-checked="true"]'
    expect(borderOf(chosen, 'border-color')).toBe('var(--rm-bg)')
    expect(borderOf(chosen, 'box-shadow')).toBe('inset 0 0 0 1px var(--rm-bg)')
  })

  it('does not fade the status of a bill line (a faded small text reads at about 3.5:1)', () => {
    const done = services.find((rule) =>
      rule.selectors.includes('.rm .ro-status[data-status="served"]'),
    )
    expect(done?.declarations.has('opacity')).toBe(false)
  })
})

describe('touch targets (brief SH-06 test 8): 44 px on every control of a sheet', () => {
  const tall = [
    '.rm .ro-stepper button',
    '.rm .ro-primary',
    '.rm .ro-ghost',
    '.rm .ro-pay',
    '.rm .ro-options button',
    '.rm .ro-choicegrid button',
    '.rm .ro-tips button',
    '.rm .ro-scope button',
    '.rm .ro-line-actions button',
    '.rm .ro-pill',
    '.rm .ro-bagbar button',
    '.rm .ro-acc summary',
    '.rm .ro-note textarea',
    '.rm .ro-input input',
    '.rm .ro-promo input',
  ]
  it.each(tall)('%s is at least 44 px high', (selector) => {
    const height = Math.max(
      sizeOf(services, selector, 'min-height') ?? 0,
      sizeOf(services, selector, 'height') ?? 0,
    )
    expect(height).toBeGreaterThanOrEqual(44)
  })

  const wide = [
    '.rm .ro-stepper button',
    '.rm .ro-line-actions button',
    '.rm .ro-pill',
    '.rm .ro-bagbar .ro-waiter',
  ]
  it.each(wide)('%s is at least 44 px wide', (selector) => {
    const width = Math.max(
      sizeOf(services, selector, 'min-width') ?? 0,
      sizeOf(services, selector, 'width') ?? 0,
    )
    expect(width).toBeGreaterThanOrEqual(44)
  })

  it("gives the close and back buttons of every sheet 44 px (the page's own rule)", () => {
    const base = rulesOf(EDITORIAL_CSS)
    expect(sizeOf(base, '.rm-overlay-head button', 'width')).toBe(44)
    expect(sizeOf(base, '.rm-overlay-head button', 'height')).toBe(44)
  })

  it('makes the compact "+" and counter on a dish card real 44 x 44 px buttons that look as drawn', () => {
    // They look 32 to 38 px (the designer's size: the round fill is their ::before); the button itself
    // is 44 x 44 px, and a negative margin keeps the room the smaller one took. (SH-07 replaced the
    // 6 px `::after` area around them, which no measure of the button itself could see.)
    expect(SERVICES_CSS).toMatch(/--ro-btn:\s*clamp\(32px,/)
    for (const selector of ['.rm .ro-plus', '.rm .ro-quick .ro-stepper button']) {
      expect(sizeOf(services, selector, 'width'), `${selector} width`).toBe(44)
      expect(sizeOf(services, selector, 'height'), `${selector} height`).toBe(44)
      const margin = services.find(
        (rule) =>
          rule.media === null &&
          rule.selectors.includes(selector) &&
          rule.declarations.has('margin'),
      )
      expect(margin?.declarations.get('margin'), `${selector} margin`).toMatch(
        /^calc\(\(var\(--ro-(circle|btn)\) - 44px\) \/ 2\)$/,
      )
      const fill = services.find(
        (rule) => rule.media === null && rule.selectors.includes(`${selector}::before`),
      )
      expect(fill?.declarations.get('position'), `${selector}::before`).toBe('absolute')
    }
    expect(SERVICES_CSS).not.toContain('.rm .ro-plus::after')
    expect(SERVICES_CSS).not.toContain('.rm .ro-quick .ro-stepper button::after')
  })
})
