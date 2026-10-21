// `assertThemeOnlyCss(css)`: a face's stylesheet may not choose a colour (R13: the venue does).
// It returns the offending tokens, so a test can say `expect(assertThemeOnlyCss(css)).toEqual([])`
// and print what is wrong when it fails.
//
// Flagged:
//   - hex colours (`#fff`, `#ff00aa80`);
//   - colour functions whose arguments hold a literal number: `rgb(`, `rgba(`, `hsl(`, `hsla(`,
//     `hwb(`, `lab(`, `lch(`, `oklab(`, `oklch(` and `color(`. A function that only recombines
//     variables (`rgb(var(--r) var(--g) var(--b))`) and the relative form
//     (`oklch(from var(--accent) l c h / 50%)`) are fine, since the venue's colour is still the
//     source;
//   - the CSS named colours (all 148 of CSS Color Module Level 4), as words of their own.
//
// Allowed: `transparent`, `currentColor`, `inherit`, `initial`, `unset`, the CSS system colours
// (`Canvas`, `CanvasText`, `GrayText` …: they follow the guest's own screen), and `color-mix()`
// of variables and those keywords. `color-mix()` needs no rule of its own: a literal colour
// inside it is a hex colour, a named colour or a colour function, and is flagged as one.
//
// Comments and quoted strings are ignored. Limits: it reads text, not a parsed stylesheet, so an
// ID selector made only of hex digits (`#add`) reads as a hex colour, and a colour hidden in the
// body of a `data:` URL is not looked at; both are for the reviewer.

/** The CSS colour names (CSS Color Module Level 4), apart from `transparent` and `currentColor`. */
export const NAMED_COLOURS: readonly string[] = `
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

/** Colour functions that can carry a literal colour. */
const COLOUR_FUNCTIONS = [
  'rgb',
  'rgba',
  'hsl',
  'hsla',
  'hwb',
  'lab',
  'lch',
  'oklab',
  'oklch',
  'color',
]

/** `#rgb`, `#rgba`, `#rrggbb` or `#rrggbbaa`, not the start of a longer word. */
const HEX_COLOUR = /#(?:[0-9a-f]{8}|[0-9a-f]{6}|[0-9a-f]{3,4})(?![0-9a-z_-])/gi

/** A colour name as a word of its own: not `white-space`, `.red`, `#red`, `--gold` or `tan(`. */
const NAMED_COLOUR = new RegExp(`(?<![-\\w.#])(?:${NAMED_COLOURS.join('|')})(?![-\\w(])`, 'gi')

/** A colour function call, matched at its name; the arguments are read by `argumentsAt`. */
const COLOUR_FUNCTION = new RegExp(`(?<![-\\w])(?:${COLOUR_FUNCTIONS.join('|')})\\(`, 'gi')

/** Comments and quoted strings out, so a class named in a comment or a `content` text is not read. */
function stripped(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/g, '""')
}

/** The text between the parenthesis opened just before `start` and its match, or the rest of the text. */
function argumentsAt(css: string, start: number): { text: string; end: number } {
  let depth = 1
  for (let i = start; i < css.length; i++) {
    const char = css[i]
    if (char === '(') depth++
    else if (char === ')' && --depth === 0) return { text: css.slice(start, i), end: i + 1 }
  }
  return { text: css.slice(start), end: css.length }
}

/** The text with every `var(…)` call taken out (its fallback may hold anything; the fallback is read on its own). */
function withoutVariables(text: string): string {
  let out = ''
  let position = 0
  for (const match of text.matchAll(/(?<![-\w])var\(/gi)) {
    if (match.index < position) continue
    out += text.slice(position, match.index)
    position = argumentsAt(text, match.index + match[0].length).end
  }
  return out + text.slice(position)
}

/** A selector that reaches the page around the face: `html`, `body` or `:root` as a selector of its own. */
const PAGE_SELECTOR = /(?:^|[\s,>+~(])(?:html|body|:root)(?![-\w])/i

/**
 * The selectors of a stylesheet that style the page around the face (`html`, `body`, `:root`), each
 * once, in order. A face draws inside its own root element: how the page scrolls and looks is the
 * host's (the guest page's `html[data-guest-page]` rules in apps/web), so the same face can sit on
 * the guest page and inside the admin's preview without changing either (lead, after SH-04).
 * At-rule preludes (`@media …`) are not selectors and are skipped; `.rm-body` is not `body`.
 */
export function assertFaceScopedCss(css: string): string[] {
  const text = stripped(css)
  const found: string[] = []
  let start = 0
  for (let i = 0; i < text.length; i++) {
    const char = text[i]
    if (char === '{') {
      const prelude = text.slice(start, i).trim()
      if (prelude !== '' && !prelude.startsWith('@') && PAGE_SELECTOR.test(prelude)) {
        found.push(prelude)
      }
      start = i + 1
    } else if (char === '}' || char === ';') {
      start = i + 1
    }
  }
  return [...new Set(found)]
}

/**
 * The colours a stylesheet chooses for itself, in the order they appear (each once). An empty
 * list means every colour comes from the theme, a system colour or a keyword.
 */
export function assertThemeOnlyCss(css: string): string[] {
  const text = stripped(css)
  const found: { at: number; token: string }[] = []

  for (const match of text.matchAll(HEX_COLOUR)) found.push({ at: match.index, token: match[0] })
  for (const match of text.matchAll(NAMED_COLOUR)) found.push({ at: match.index, token: match[0] })

  for (const match of text.matchAll(COLOUR_FUNCTION)) {
    const open = match.index + match[0].length
    const { text: args, end } = argumentsAt(text, open)
    const own = withoutVariables(args).trim()
    // The relative form takes its colour from the origin after `from`, which is read on its own.
    if (/^from(?![-\w])/i.test(own)) continue
    if (/\d/.test(own)) found.push({ at: match.index, token: text.slice(match.index, end) })
  }

  const seen = new Set<string>()
  return found
    .sort((a, b) => a.at - b.at)
    .flatMap(({ token }) => {
      if (seen.has(token)) return []
      seen.add(token)
      return [token]
    })
}
