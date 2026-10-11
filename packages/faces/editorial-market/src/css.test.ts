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
