// A tiny HTML reader for the contract tests: enough to find elements by attribute, read their text
// and walk up to a parent. It is written here because the shell takes no DOM library; it reads the
// output of a face's `renderToStaticMarkup`, which is well-formed, so it does not try to repair
// broken markup.

/** An element of the parsed output. */
export interface HtmlElement {
  readonly tag: string
  readonly attrs: Readonly<Record<string, string>>
  readonly children: (HtmlElement | string)[]
  readonly parent: HtmlElement | null
}

const VOID_TAGS = new Set([
  'area',
  'base',
  'br',
  'col',
  'embed',
  'hr',
  'img',
  'input',
  'link',
  'meta',
  'source',
  'track',
  'wbr',
])

const RAW_TEXT_TAGS = new Set(['script', 'style'])

const NAMED_ENTITIES: Readonly<Record<string, string>> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
}

/** Decodes the entities `renderToStaticMarkup` and common templates produce. */
export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-fA-F]+|#\d+|[a-zA-Z]+);/g, (whole, body: string) => {
    if (body.startsWith('#x')) return String.fromCodePoint(Number.parseInt(body.slice(2), 16))
    if (body.startsWith('#')) return String.fromCodePoint(Number.parseInt(body.slice(1), 10))
    return NAMED_ENTITIES[body] ?? whole
  })
}

const ATTRIBUTE = /([^\s"'<>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g

function parseAttributes(source: string): Record<string, string> {
  const attrs: Record<string, string> = {}
  for (const match of source.matchAll(ATTRIBUTE)) {
    const name = (match[1] ?? '').toLowerCase()
    attrs[name] = decodeEntities(match[2] ?? match[3] ?? match[4] ?? '')
  }
  return attrs
}

/** Parses markup into a root element holding the top-level nodes. */
export function parseHtml(html: string): HtmlElement {
  const root: HtmlElement = { tag: '#root', attrs: {}, children: [], parent: null }
  let current = root
  let position = 0
  while (position < html.length) {
    const open = html.indexOf('<', position)
    if (open === -1) {
      current.children.push(decodeEntities(html.slice(position)))
      break
    }
    if (open > position) current.children.push(decodeEntities(html.slice(position, open)))

    if (html.startsWith('<!--', open)) {
      const end = html.indexOf('-->', open + 4)
      position = end === -1 ? html.length : end + 3
      continue
    }
    const close = html.indexOf('>', open)
    if (close === -1) {
      current.children.push(decodeEntities(html.slice(open)))
      break
    }
    const inside = html.slice(open + 1, close)
    position = close + 1
    if (inside.startsWith('!') || inside.startsWith('?')) continue

    if (inside.startsWith('/')) {
      const name = inside.slice(1).trim().toLowerCase()
      // Close the nearest open element of that name; stray end tags are ignored.
      for (let node: HtmlElement | null = current; node !== null; node = node.parent) {
        if (node.tag === name) {
          current = node.parent ?? root
          break
        }
      }
      continue
    }

    const selfClosing = inside.endsWith('/')
    const body = selfClosing ? inside.slice(0, -1) : inside
    const split = body.search(/[\s]/)
    const tag = (split === -1 ? body : body.slice(0, split)).toLowerCase()
    const attrs = parseAttributes(split === -1 ? '' : body.slice(split))
    const element: HtmlElement = { tag, attrs, children: [], parent: current }
    current.children.push(element)

    if (RAW_TEXT_TAGS.has(tag)) {
      const end = html.toLowerCase().indexOf(`</${tag}`, position)
      const stop = end === -1 ? html.length : end
      element.children.push(html.slice(position, stop))
      const after = html.indexOf('>', stop)
      position = after === -1 ? html.length : after + 1
    } else if (!selfClosing && !VOID_TAGS.has(tag)) {
      current = element
    }
  }
  return root
}

/** Every element under (and including) `root`, in document order. */
export function allElements(root: HtmlElement): HtmlElement[] {
  const out: HtmlElement[] = []
  const visit = (element: HtmlElement) => {
    if (element.tag !== '#root') out.push(element)
    for (const child of element.children) if (typeof child !== 'string') visit(child)
  }
  visit(root)
  return out
}

/** The text of an element and everything inside it, script and style left out. */
export function textOf(element: HtmlElement): string {
  let text = ''
  for (const child of element.children) {
    if (typeof child === 'string') text += child
    else if (!RAW_TEXT_TAGS.has(child.tag)) text += textOf(child)
  }
  return text
}

/** The elements at or under `root` that carry the attribute (with the value, when given). */
export function withAttribute(root: HtmlElement, name: string, value?: string): HtmlElement[] {
  return allElements(root).filter(
    (element) => name in element.attrs && (value === undefined || element.attrs[name] === value),
  )
}

/** Every attribute value at or under `element`, for icons that carry their name in an attribute. */
export function attributeValues(element: HtmlElement, names: readonly string[]): string[] {
  const out: string[] = []
  const visit = (node: HtmlElement) => {
    for (const name of names) {
      const value = node.attrs[name]
      if (value !== undefined) out.push(value)
    }
    for (const child of node.children) if (typeof child !== 'string') visit(child)
  }
  visit(element)
  return out
}

/** The `lang` values that apply to an element's text: its own and its descendants', and the nearest ancestor's. */
export function langsAround(element: HtmlElement): string[] {
  const langs = attributeValues(element, ['lang'])
  for (let node: HtmlElement | null = element.parent; node !== null; node = node.parent) {
    const lang = node.attrs.lang
    if (lang !== undefined) {
      langs.push(lang)
      break
    }
  }
  return langs
}
