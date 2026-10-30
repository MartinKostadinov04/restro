import { describe, expect, it } from 'vitest'

import { EDITORIAL_CSS } from './css'

/** The CSS colour names (CSS Color Module Level 4), apart from `transparent` and `currentColor`. */
const NAMED_COLOURS = `
aliceblue antiquewhite aqua aquamarine azure beige bisque black blanchedalmond blue blueviolet
brown burlywood cadetblue chartreuse chocolate coral cornflowerblue cornsilk crimson cyan darkblue
darkcyan darkgoldenrod darkgray darkgreen darkgrey darkkhaki darkmagenta darkolivegreen darkorange
darkorchid darkred darksalmon darkseagreen darkslateblue darkslategray darkslategrey darkturquoise
darkviolet deeppink deepskyblue dimgray dimgrey dodgerblue firebrick floralwhite forestgreen
fuchsia gainsboro ghostwhite gold goldenrod gray green greenyellow grey honeydew hotpink indianred
indigo ivory khaki lavender lavenderblush lawngreen lemonchiffon lightblue lightcoral lightcyan
lightgoldenrodyellow lightgray lightgreen lightgrey lightpink lightsalmon lightseagreen
lightskyblue lightslategray lightslategrey lightsteelblue lightyellow lime limegreen linen magenta
maroon mediumaquamarine mediumblue mediumorchid mediumpurple mediumseagreen mediumslateblue
mediumspringgreen mediumturquoise mediumvioletred midnightblue mintcream mistyrose moccasin
navajowhite navy oldlace olive olivedrab orange orangered orchid palegoldenrod palegreen
paleturquoise palevioletred papayawhip peachpuff peru pink plum powderblue purple rebeccapurple red
rosybrown royalblue saddlebrown salmon sandybrown seagreen seashell sienna silver skyblue
slateblue slategray slategrey snow springgreen steelblue tan teal thistle tomato turquoise violet
wheat white whitesmoke yellow yellowgreen
`
  .trim()
  .split(/\s+/)

/** The CSS system colour keywords (CSS Color Module Level 4). */
const SYSTEM_COLOURS = `
AccentColor AccentColorText ActiveText ButtonBorder ButtonFace ButtonText Canvas CanvasText Field
FieldText GrayText Highlight HighlightText LinkText Mark MarkText SelectedItem SelectedItemText
VisitedText
`
  .trim()
  .split(/\s+/)

/** A colour name as a word of its own: not part of `white-space`, `.rm-red`, `--rm-gold` or `grid`. */
function namedColour(names: readonly string[]): RegExp {
  return new RegExp(`(?<![-\\w])(?:${names.join('|')})(?![-\\w])`, 'i')
}

const COLOUR_FUNCTION = /\b(?:rgb|rgba|hsl|hsla|hwb|lab|lch|oklab|oklch|color)\(/
const HEX_COLOUR = /#[0-9a-fA-F]{3,8}\b/

describe('the stylesheet (R13: the venue chooses the colours)', () => {
  it('has no hex colour, no colour function, no named colour and no system colour', () => {
    expect(EDITORIAL_CSS).not.toMatch(HEX_COLOUR)
    expect(EDITORIAL_CSS).not.toMatch(COLOUR_FUNCTION)
    expect(EDITORIAL_CSS).not.toMatch(namedColour(NAMED_COLOURS))
    expect(EDITORIAL_CSS).not.toMatch(namedColour(SYSTEM_COLOURS))
  })

  it('catches what it is meant to catch (the check itself)', () => {
    const named = namedColour(NAMED_COLOURS)
    expect('color: white;').toMatch(named)
    expect('background:Black').toMatch(named)
    expect('border: 1px solid red').toMatch(named)
    expect('color: CanvasText').toMatch(namedColour(SYSTEM_COLOURS))
    expect('color: #fff').toMatch(HEX_COLOUR)
    expect('color: rgb(0 0 0)').toMatch(COLOUR_FUNCTION)
    expect('color: hsl(0 0% 0%)').toMatch(COLOUR_FUNCTION)
    // What is fine: words that merely contain a colour name, and the three keywords that are not colours of their own.
    expect('white-space: nowrap').not.toMatch(named)
    expect('.rm-red { }').not.toMatch(named)
    expect('--rm-gold: 1').not.toMatch(named)
    expect('grid-template-columns: 1fr').not.toMatch(named)
    expect('color: transparent; stroke: currentColor; color: inherit').not.toMatch(named)
    expect('background: color-mix(in srgb, var(--rm-bg) 20%, transparent)').not.toMatch(
      COLOUR_FUNCTION,
    )
  })

  it('takes every colour from the variables the root carries', () => {
    // The eight roles come in as `--rm-l-*` (a light screen) and `--rm-d-*` (a dark one); the
    // font, the radius and the shadow come in as well.
    for (const role of [
      'background',
      'surface',
      'accent',
      'onAccent',
      'text',
      'muted',
      'accentText',
      'border',
    ]) {
      expect(EDITORIAL_CSS, role).toContain(`var(--rm-l-${role})`)
      expect(EDITORIAL_CSS, role).toContain(`var(--rm-d-${role})`)
    }
    expect(EDITORIAL_CSS).toContain('var(--rm-font)')
    expect(EDITORIAL_CSS).toContain('var(--rm-radius)')
    expect(EDITORIAL_CSS).toContain('var(--rm-shadow)')
  })
})

describe('the stylesheet (motion, schemes and the rules of the contract)', () => {
  it("follows the guest's screen and honours reduced motion", () => {
    expect(EDITORIAL_CSS).toContain('prefers-color-scheme: dark')
    expect(EDITORIAL_CSS).toContain('prefers-reduced-motion: reduce')
    expect(EDITORIAL_CSS).toContain('prefers-reduced-motion: no-preference')
  })

  it('cuts only a description, and only one marked clamped (R9)', () => {
    const clamping = EDITORIAL_CSS.match(/[^{}]*\{[^}]*-webkit-line-clamp[^}]*\}/g) ?? []
    expect(clamping.length).toBeGreaterThan(0)
    for (const rule of clamping) expect(rule).toContain('.rm-description p')
    expect(EDITORIAL_CSS).toMatch(
      /\.rm-description p\[data-clamped="true"\]\s*\{[^}]*-webkit-line-clamp:\s*3/,
    )
    // A line clamp only cuts inside a `-webkit-box`, and only a clamped description is one.
    const boxes = EDITORIAL_CSS.match(/[^{}]*\{[^}]*display:\s*-webkit-box[^}]*\}/g) ?? []
    expect(boxes).toHaveLength(1)
    expect(boxes[0]).toContain('.rm-description p[data-clamped="true"]')
  })

  it('never cuts a name with an ellipsis (R9)', () => {
    // Names wrap; the only ellipsis is on the title line of a sheet and on a badge of the list layout.
    const ellipsised = EDITORIAL_CSS.match(/[^{}]*\{[^}]*text-overflow:\s*ellipsis[^}]*\}/g) ?? []
    for (const rule of ellipsised) expect(rule).toMatch(/\.rm-overlay-head > span|\.rm-badge/)
  })

  it('has no rule for what the port left out', () => {
    expect(EDITORIAL_CSS).not.toContain('.ro-')
    expect(EDITORIAL_CSS).not.toMatch(/\.rm-wordmark|\.rm-kicker/)
  })
})

/** The declarations of every rule whose selector list holds exactly `selector`, outside any media query or inside. */
function declarationsFor(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const rule = new RegExp(
    `(?:^|[}\\n])\\s*(?:[^{}]*,\\s*)?${escaped}\\s*(?:,[^{}]*)?\\{([^}]*)\\}`,
    'g',
  )
  return [...EDITORIAL_CSS.matchAll(rule)].map((match) => match[1] ?? '').join('\n')
}

describe('the audit of the stylesheet (SH-07)', () => {
  it('makes every control a 44 x 44 px target in its own box, not by an area beside it', () => {
    // The switches keep their look: a negative margin keeps the room, the chosen fill is the ::before.
    for (const selector of ['.rm .rm-layout button', '.rm .rm-language button']) {
      const rule = declarationsFor(selector)
      expect(rule, selector).toMatch(/(?:min-)?height:\s*44px/)
      expect(rule, selector).toMatch(/(?:min-)?width:\s*44px/)
      expect(rule, selector).toMatch(/margin:\s*-\d+px 0/)
    }
    for (const selector of [
      '.rm-sections a',
      '.rm-allergens button',
      '.rm-filter-group button',
      '.rm-clear',
    ]) {
      expect(declarationsFor(selector), selector).toMatch(/min-width:\s*44px/)
    }
    expect(declarationsFor('.rm-icon')).toMatch(/width:\s*44px/)
  })

  it('keeps the table label on every width (it was hidden at 350 px and under)', () => {
    expect(EDITORIAL_CSS).not.toMatch(/\.rm-table\s*\{[^}]*display:\s*none/)
    expect(declarationsFor('.rm-headtools')).toContain('flex-wrap: wrap')
  })

  it('gives the arrow after a name no meaning of its own (a picture with an empty alternative text)', () => {
    expect(EDITORIAL_CSS).toContain('content: "→" / ""')
    expect(EDITORIAL_CSS).not.toContain('.rm-chevron')
  })

  it('has no look for a sold-out or unavailable item, which is not on the menu (D131)', () => {
    expect(EDITORIAL_CSS).not.toMatch(/data-state="(sold_out|unavailable)"/)
  })

  it('keeps the section titles and the items apart, the items being h3 or h4', () => {
    expect(EDITORIAL_CSS).toContain('.rm-item :is(h3, h4)')
    expect(EDITORIAL_CSS).not.toMatch(/\.rm-item h3|\.rm-item\.has-photo h3/)
  })

  it('switches the motion of the pseudo-elements off as well', () => {
    expect(EDITORIAL_CSS).toMatch(/\.rm \*::before,\s*\.rm \*::after/)
  })

  it('shows the edge of a choice on the sheet at 3:1 (a stronger mix than 30 %)', () => {
    const chip = declarationsFor('.rm-filter-group button')
    const share = Number(/color-mix\(in srgb, var\(--rm-bg\) (\d+)%/.exec(chip)?.[1])
    expect(share).toBeGreaterThanOrEqual(50)
  })
})
