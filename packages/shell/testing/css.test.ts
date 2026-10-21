import { describe, expect, it } from 'vitest'

import { assertFaceScopedCss, assertThemeOnlyCss, NAMED_COLOURS } from './css'

describe('assertThemeOnlyCss: what it lets through', () => {
  it('accepts a stylesheet that takes every colour from variables', () => {
    const css = `
      .rm { color: var(--rm-text); background: var(--rm-bg, Canvas); border: 1px solid var(--rm-border); }
      .rm a:hover { color: var(--rm-accent-text, LinkText); }
      .rm :focus-visible { outline: 2px solid var(--rm-accent-text); outline-offset: 2px; }
    `
    expect(assertThemeOnlyCss(css)).toEqual([])
  })

  it('accepts the keywords: transparent, currentColor, inherit, initial, unset', () => {
    const css = `
      .a { background: transparent; border-color: currentColor; color: inherit; }
      .b { fill: currentcolor; stroke: initial; background-color: unset; }
    `
    expect(assertThemeOnlyCss(css)).toEqual([])
  })

  it('accepts the CSS system colours, which follow the guest’s own screen', () => {
    const css = `
      .a { color: CanvasText; background: Canvas; border-color: GrayText; }
      .b { color: Highlight; background-color: HighlightText; outline-color: LinkText; }
      .c { color: ButtonText; background: ButtonFace; border-color: ButtonBorder; accent-color: AccentColor; }
    `
    expect(assertThemeOnlyCss(css)).toEqual([])
  })

  it('accepts color-mix() of variables and allowed keywords', () => {
    const css = `
      .a { background: color-mix(in srgb, var(--rm-accent) 20%, transparent); }
      .b { border-color: color-mix(in oklch, var(--rm-text) 15%, var(--rm-bg)); }
      .c { color: color-mix(in srgb, currentColor 60%, Canvas); }
      .d { background: color-mix(in srgb, color-mix(in srgb, var(--a), var(--b)) 50%, transparent); }
    `
    expect(assertThemeOnlyCss(css)).toEqual([])
  })

  it('accepts a colour function that only recombines variables', () => {
    const css = `
      .a { color: rgb(var(--r) var(--g) var(--b)); }
      .b { color: hsl(var(--h), var(--s), var(--l)); }
      .c { background: oklch(from var(--rm-accent) l c h / 50%); }
    `
    expect(assertThemeOnlyCss(css)).toEqual([])
  })

  it('does not mistake words that merely contain a colour name or a hex-like text', () => {
    const css = `
      .rm-red, .rm-gold, .tan-bg, .white { content: ""; }
      .a { white-space: nowrap; grid-template-columns: 1fr; --rm-gold: 1; margin: calc(tan(45deg) * 1px); }
      .b { content: "red #fff white rgb(0 0 0)"; font-family: 'Playfair Display', Georgia, serif; }
      /* white, #fff and rgb(1 2 3) in a comment */
      .c { transition: color 0.2s ease, background-color 0.2s ease; accent-color: auto; }
      .d::after { content: '#abc'; }
    `
    expect(assertThemeOnlyCss(css)).toEqual([])
  })

  it('does not read a url fragment or a longer word as a hex colour', () => {
    expect(assertThemeOnlyCss('.a { width: 1px; height: 12#; } .b { margin: 0 #abcde; }')).toEqual(
      [],
    )
  })
})

describe('assertThemeOnlyCss: what it flags', () => {
  it('flags hex colours of every length, in either case', () => {
    const css =
      '.a { color: #fff; } .b { color: #FFAA00; } .c { color: #1234; } .d { color: #12345678; }'
    expect(assertThemeOnlyCss(css)).toEqual(['#fff', '#FFAA00', '#1234', '#12345678'])
  })

  it('flags colour functions with literal numbers', () => {
    const css = `
      .a { color: rgb(0 0 0); }
      .b { color: rgba(0, 0, 0, .5); }
      .c { color: hsl(120 50% 50%); }
      .d { color: hsla(120, 50%, 50%, 0.5); }
      .e { color: hwb(120 0% 0%); }
      .f { color: lab(50% 40 59); }
      .g { color: lch(50% 40 59); }
      .h { color: oklab(0.5 0.1 0.1); }
      .i { color: oklch(0.5 0.1 120); }
      .j { color: color(srgb 1 0 0); }
    `
    expect(assertThemeOnlyCss(css)).toEqual([
      'rgb(0 0 0)',
      'rgba(0, 0, 0, .5)',
      'hsl(120 50% 50%)',
      'hsla(120, 50%, 50%, 0.5)',
      'hwb(120 0% 0%)',
      'lab(50% 40 59)',
      'lch(50% 40 59)',
      'oklab(0.5 0.1 0.1)',
      'oklch(0.5 0.1 120)',
      'color(srgb 1 0 0)',
    ])
  })

  it('flags a function that mixes variables with a literal number', () => {
    expect(assertThemeOnlyCss('.a { color: hsl(var(--h) 50% 50%); }')).toEqual([
      'hsl(var(--h) 50% 50%)',
    ])
    expect(assertThemeOnlyCss('.a { color: rgb(0 0 0 / var(--alpha)); }')).toEqual([
      'rgb(0 0 0 / var(--alpha))',
    ])
  })

  it('flags a literal in a var() fallback, and inside color-mix()', () => {
    expect(assertThemeOnlyCss('.a { color: var(--x, #fff); }')).toEqual(['#fff'])
    expect(assertThemeOnlyCss('.a { color: var(--x, red); }')).toEqual(['red'])
    expect(
      assertThemeOnlyCss('.a { background: color-mix(in srgb, #fff 20%, transparent); }'),
    ).toEqual(['#fff'])
    expect(assertThemeOnlyCss('.a { background: color-mix(in srgb, red 20%, var(--x)); }')).toEqual(
      ['red'],
    )
    expect(
      assertThemeOnlyCss('.a { background: color-mix(in srgb, rgb(0 0 0) 20%, var(--x)); }'),
    ).toEqual(['rgb(0 0 0)'])
  })

  it('flags a literal colour behind from, in the origin', () => {
    expect(assertThemeOnlyCss('.a { color: oklch(from #f00 l c h); }')).toEqual(['#f00'])
    expect(assertThemeOnlyCss('.a { color: rgb(from rgb(255 0 0) r g b); }')).toEqual([
      'rgb(255 0 0)',
    ])
  })

  it('flags the named colours, as words of their own, in any case', () => {
    const css = `
      .a { color: white; }
      .b { background: Black; }
      .c { border: 1px solid RED; }
      .d { box-shadow: 0 0 0 1px rebeccapurple, 0 1px 2px darkslategrey; }
      .e { background: linear-gradient(to right, gold, transparent); }
    `
    expect(assertThemeOnlyCss(css)).toEqual([
      'white',
      'Black',
      'RED',
      'rebeccapurple',
      'darkslategrey',
      'gold',
    ])
  })

  it('lists each offender once, in the order it appears', () => {
    const css = '.a { color: red; } .b { color: #fff; } .c { color: red; background: #fff; }'
    expect(assertThemeOnlyCss(css)).toEqual(['red', '#fff'])
  })

  it('flags even a colour inside a nested function', () => {
    expect(assertThemeOnlyCss('.a { filter: drop-shadow(0 1px 2px rgba(0, 0, 0, 0.2)); }')).toEqual(
      ['rgba(0, 0, 0, 0.2)'],
    )
  })
})

describe('the list of named colours', () => {
  it('is the whole of CSS Color Module Level 4 (148 names, each once)', () => {
    expect(NAMED_COLOURS).toHaveLength(148)
    expect(new Set(NAMED_COLOURS).size).toBe(148)
    for (const name of ['red', 'rebeccapurple', 'darkslategrey', 'yellowgreen', 'aliceblue']) {
      expect(NAMED_COLOURS).toContain(name)
    }
    // Not colours of their own: allowed keywords.
    expect(NAMED_COLOURS).not.toContain('transparent')
    expect(NAMED_COLOURS).not.toContain('currentcolor')
  })

  it('flags every one of them', () => {
    for (const name of NAMED_COLOURS) {
      expect(assertThemeOnlyCss(`.a { color: ${name}; }`), name).toEqual([name])
    }
  })
})

describe('assertFaceScopedCss: a face styles only inside its own root', () => {
  it('accepts rules on the face root and inside it, at-rules and keyframes', () => {
    const css = `
      .rm { overflow-x: clip; }
      .rm-body, .rm .body-copy, [data-slot="item.body"] { margin: 0; }
      @media (prefers-reduced-motion: no-preference) { .rm-sheet { animation: rm-up .2s; } }
      @keyframes rm-up { from { opacity: 0; } to { opacity: 1; } }
      /* html { overflow: hidden } is only a comment */
      .rm::after { content: "body"; }
    `
    expect(assertFaceScopedCss(css)).toEqual([])
  })

  it('flags html, body and :root rules, also inside @media and in a selector list', () => {
    const css = `
      html:has(.rm), body:has(.rm) { overflow-x: hidden; }
      html:has(.rm)::-webkit-scrollbar { display: none; }
      @media (prefers-reduced-motion: no-preference) { html:has(.rq-root) { scroll-behavior: smooth; } }
      :root { --x: 1px; }
      .rm, body > .rm { color: var(--rm-text); }
    `
    expect(assertFaceScopedCss(css)).toEqual([
      'html:has(.rm), body:has(.rm)',
      'html:has(.rm)::-webkit-scrollbar',
      'html:has(.rq-root)',
      ':root',
      '.rm, body > .rm',
    ])
  })
})
