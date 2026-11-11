// A small reader of a face's stylesheet, for the never-list and the stored renderings (D130): the
// rules with their at-rule, which rules reach an element of the parsed markup, the winner of a
// property on that element, and the values with the design's tokens worked out. It reads the CSS a
// face writes (classes, tags, attributes, `:is`, `:not`, descendant and child), not all of CSS: a
// pseudo-class it cannot judge counts as matching, so a rule that might apply is read as applying.

import type { HtmlElement } from './html'

/** One style rule of a stylesheet. */
export interface CssRule {
  readonly selector: string
  readonly declarations: readonly (readonly [string, string])[]
  /** The at-rule it sits in (`@media (min-width: 641px)`), or null. */
  readonly media: string | null
  /** Its place in the stylesheet. */
  readonly order: number
}

/** Splits `text` at `separator`, outside parentheses, brackets and quotes. */
function splitTop(text: string, separator: string): string[] {
  const parts: string[] = []
  let depth = 0
  let quote: string | null = null
  let start = 0
  for (let i = 0; i < text.length; i++) {
    const char = text[i]
    if (quote !== null) {
      if (char === '\\') i++
      else if (char === quote) quote = null
    } else if (char === '"' || char === "'") quote = char
    else if (char === '(' || char === '[') depth++
    else if (char === ')' || char === ']') depth--
    else if (char === separator && depth === 0) {
      parts.push(text.slice(start, i))
      start = i + 1
    }
  }
  parts.push(text.slice(start))
  return parts
}

function declarationsOf(body: string): (readonly [string, string])[] {
  return splitTop(body, ';').flatMap((declaration) => {
    const colon = declaration.indexOf(':')
    if (colon < 0) return []
    return [
      [
        declaration.slice(0, colon).trim().toLowerCase(),
        declaration
          .slice(colon + 1)
          .replace(/\s+/g, ' ')
          .trim(),
      ] as const,
    ]
  })
}

/** The text between the brace opened at `open` and its match. */
function blockAt(css: string, open: number): { readonly body: string; readonly end: number } {
  let depth = 0
  for (let i = open; i < css.length; i++) {
    if (css[i] === '{') depth++
    else if (css[i] === '}' && --depth === 0) return { body: css.slice(open + 1, i), end: i + 1 }
  }
  return { body: css.slice(open + 1), end: css.length }
}

/** The style rules of a stylesheet, in order. `@keyframes` is not read. */
export function cssRules(css: string): readonly CssRule[] {
  const rules: CssRule[] = []
  const read = (text: string, media: string | null) => {
    let position = 0
    while (position < text.length) {
      const open = text.indexOf('{', position)
      if (open < 0) return
      const prelude = text.slice(position, open).replace(/\s+/g, ' ').trim()
      const { body, end } = blockAt(text, open)
      position = end
      if (prelude.startsWith('@keyframes') || prelude.startsWith('@font-face')) continue
      if (prelude.startsWith('@')) {
        read(body, prelude)
        continue
      }
      rules.push({
        selector: prelude,
        declarations: declarationsOf(body),
        media,
        order: rules.length,
      })
    }
  }
  read(css.replace(/\/\*[\s\S]*?\*\//g, ' '), null)
  return rules
}

/** One compound selector with the combinator that joins it to the compound on its left. */
interface Compound {
  readonly text: string
  readonly combinator: ' ' | '>' | '+' | '~' | null
}

// The harness asks the same questions of a stylesheet thousands of times per design (every part of
// every item against every rule), and a stylesheet and a parsed page never change: what a selector
// reads as and what a compound says of an element are worked out once. Nothing here changes an answer.
const COMPOUNDS = new Map<string, readonly Compound[]>()
const SELECTORS = new Map<string, readonly string[]>()
const COMPOUND_ANSWERS = new WeakMap<HtmlElement, Map<string, boolean>>()
const REACHING = new WeakMap<HtmlElement, WeakMap<readonly CssRule[], readonly CssRule[]>>()

/** The selectors of a selector list, trimmed. */
function selectorsOf(list: string): readonly string[] {
  let parts = SELECTORS.get(list)
  if (parts === undefined) {
    parts = splitTop(list, ',').map((part) => part.trim())
    SELECTORS.set(list, parts)
  }
  return parts
}

function compoundsOf(selector: string): readonly Compound[] {
  let compounds = COMPOUNDS.get(selector)
  if (compounds === undefined) {
    compounds = readCompounds(selector)
    COMPOUNDS.set(selector, compounds)
  }
  return compounds
}

function readCompounds(selector: string): Compound[] {
  const compounds: Compound[] = []
  let depth = 0
  let current = ''
  let combinator: Compound['combinator'] = null
  const flush = () => {
    if (current !== '') compounds.push({ text: current, combinator })
    current = ''
  }
  for (const char of selector.trim()) {
    if (char === '(' || char === '[') depth++
    if (char === ')' || char === ']') depth--
    if (depth === 0 && (char === ' ' || char === '>' || char === '+' || char === '~')) {
      if (char === ' ' && current === '') continue
      flush()
      combinator = char === ' ' && combinator !== null && current === '' ? ' ' : (char as ' ')
      continue
    }
    current += char
  }
  flush()
  return compounds
}

/** Whether one compound (`.a.b[c="d"]:not(.e)`) holds for an element. */
function compoundMatches(element: HtmlElement, compound: string): boolean {
  let answers = COMPOUND_ANSWERS.get(element)
  if (answers === undefined) {
    answers = new Map()
    COMPOUND_ANSWERS.set(element, answers)
  }
  let answer = answers.get(compound)
  if (answer === undefined) {
    answer = readCompoundMatch(element, compound)
    answers.set(compound, answer)
  }
  return answer
}

function readCompoundMatch(element: HtmlElement, compound: string): boolean {
  let rest = compound
  const tag = /^[a-zA-Z][\w-]*/.exec(rest)
  if (tag !== null) {
    if (element.tag !== tag[0].toLowerCase()) return false
    rest = rest.slice(tag[0].length)
  }
  const classes = (element.attrs.class ?? '').split(/\s+/)
  while (rest !== '') {
    let match = /^\.([\w-]+)/.exec(rest)
    if (match !== null) {
      if (!classes.includes(match[1] as string)) return false
      rest = rest.slice(match[0].length)
      continue
    }
    match = /^\[([\w-]+)(?:([~^$*|]?=)"([^"]*)")?\]/.exec(rest)
    if (match !== null) {
      const value = element.attrs[match[1] as string]
      if (value === undefined) return false
      if (match[3] !== undefined && match[2] === '=' && value !== match[3]) return false
      rest = rest.slice(match[0].length)
      continue
    }
    match = /^::?([\w-]+)/.exec(rest)
    if (match === null) return true // something this reader does not know: read as applying
    const name = match[1] as string
    let after = rest.slice(match[0].length)
    let inner: string | null = null
    if (after.startsWith('(')) {
      let depth = 0
      let end = 0
      for (; end < after.length; end++) {
        if (after[end] === '(') depth++
        else if (after[end] === ')' && --depth === 0) break
      }
      inner = after.slice(1, end)
      after = after.slice(end + 1)
    }
    if (name === 'not' && inner !== null) {
      if (splitTop(inner, ',').some((part) => compoundMatches(element, part.trim()))) return false
    } else if ((name === 'is' || name === 'where') && inner !== null) {
      if (!splitTop(inner, ',').some((part) => compoundMatches(element, part.trim()))) return false
    }
    rest = after
  }
  return true
}

function complexMatches(element: HtmlElement, compounds: readonly Compound[]): boolean {
  const last = compounds.at(-1)
  if (last === undefined || !compoundMatches(element, last.text)) return false
  const left = compounds.slice(0, -1)
  if (left.length === 0) return true
  if (last.combinator === '>') {
    return element.parent !== null && complexMatches(element.parent, left)
  }
  if (last.combinator === '+' || last.combinator === '~') {
    // A sibling is not read: the rule counts as applying when the left side holds anywhere above.
    return true
  }
  for (let node = element.parent; node !== null; node = node.parent) {
    if (complexMatches(node, left)) return true
  }
  return false
}

const PSEUDO_ELEMENT = /::[\w-]+/

/** One selector of a list, read: whether it ends on a pseudo-element, and how specific it is. */
function selectorMatches(element: HtmlElement, selector: string): boolean {
  if (PSEUDO_ELEMENT.test(selector)) return false
  return complexMatches(element, compoundsOf(selector))
}

/** A selector's specificity as one number: ids count for nothing here, a face has none. */
function specificity(selector: string): number {
  const classes = (selector.match(/\.[\w-]+|\[[^\]]*\]|:(?!:)(?!not|is|where)[\w-]+/g) ?? []).length
  const tags = (selector.replace(/[.:#[][^\s>+~,)]*/g, ' ').match(/[a-zA-Z][\w-]*/g) ?? []).length
  return classes * 100 + tags
}

/** The rules that reach an element. Rules on a pseudo-element draw another box and are not its own. */
export function rulesFor(element: HtmlElement, rules: readonly CssRule[]): readonly CssRule[] {
  let byRules = REACHING.get(element)
  if (byRules === undefined) {
    byRules = new WeakMap()
    REACHING.set(element, byRules)
  }
  let reaching = byRules.get(rules)
  if (reaching === undefined) {
    reaching = rules.filter((rule) =>
      selectorsOf(rule.selector).some((part) => selectorMatches(element, part)),
    )
    byRules.set(rules, reaching)
  }
  return reaching
}

function bestSpecificity(element: HtmlElement, rule: CssRule): number {
  return Math.max(
    ...selectorsOf(rule.selector).map((part) =>
      selectorMatches(element, part) ? specificity(part) : -1,
    ),
  )
}

/**
 * The values `property` can take on an element: the cascade's winner without any at-rule, and with
 * every at-rule on, walking up to the parent where it inherits (`inherits: true`). Null when no rule
 * sets it anywhere up the tree.
 */
export function valuesOf(
  element: HtmlElement,
  property: string,
  rules: readonly CssRule[],
  inherits: boolean,
): readonly string[] {
  const winner = (candidates: readonly CssRule[]): string | null => {
    let best: string | null = null
    let bestRank = -1
    for (const rule of candidates) {
      for (const [name, value] of rule.declarations) {
        if (name !== property) continue
        const rank = bestSpecificity(element, rule) * 100_000 + rule.order
        if (rank >= bestRank) {
          best = value
          bestRank = rank
        }
      }
    }
    return best
  }
  const reaching = rulesFor(element, rules)
  const found = [
    winner(reaching.filter((rule) => rule.media === null)),
    winner(reaching.filter((rule) => !/\breduce\b/.test(rule.media ?? ''))),
  ].filter((value): value is string => value !== null)
  if (found.length > 0 && !found.every((value) => value === 'inherit')) {
    return [...new Set(found)]
  }
  if (inherits && element.parent !== null) {
    return valuesOf(element.parent, property, rules, inherits)
  }
  return []
}

/** `var(--x)` worked out from `tokens`, again and again, leaving a variable it does not know. */
export function withTokens(value: string, tokens: Readonly<Record<string, string>>): string {
  let out = value
  for (let round = 0; round < 8; round++) {
    const next = out.replace(/var\((--[\w-]+)\)/g, (whole, name: string) => tokens[name] ?? whole)
    if (next === out) break
    out = next
  }
  return out
}

/** `calc(14px * 1.125)` and `calc(1.4 * 8px)` worked out; any other `calc` stays as it is. */
export function withCalc(value: string): string {
  return value
    .replace(/calc\(\s*(-?[\d.]+)px\s*\*\s*(-?[\d.]+)\s*\)/g, (_, a: string, b: string) =>
      px(Number(a) * Number(b)),
    )
    .replace(/calc\(\s*(-?[\d.]+)\s*\*\s*(-?[\d.]+)px\s*\)/g, (_, a: string, b: string) =>
      px(Number(a) * Number(b)),
    )
}

function px(value: number): string {
  return `${Number(value.toFixed(4))}px`
}

/** A `font-size` in pixels at its smallest (a `clamp`'s floor), or null when it cannot be read. */
export function fontSizePx(value: string, tokens: Readonly<Record<string, string>>): number | null {
  const worked = withCalc(withTokens(value, tokens))
  const plain = /^(-?[\d.]+)px$/.exec(worked)
  if (plain !== null) return Number(plain[1])
  const clamp = /^clamp\(\s*(-?[\d.]+)px\s*,/.exec(worked)
  if (clamp !== null) return Number(clamp[1])
  return null
}

/**
 * The tokens on a face's root for this design: the root rule's custom properties, then those of each
 * `<root>[data-x="y"]` rule whose attribute the root carries. Only these names count; anything else
 * (the scheme's colours, for one) is not a design token.
 */
export function rootTokens(
  rules: readonly CssRule[],
  rootSelector: string,
  attrs: Readonly<Record<string, string | undefined>>,
  names: readonly string[],
): Readonly<Record<string, string>> {
  const tokens: Record<string, string> = {}
  for (const rule of rules) {
    if (rule.media !== null) continue
    const onlyRoot = !/[\s>+~]/.test(rule.selector)
    const on =
      rule.selector === rootSelector ||
      (onlyRoot &&
        rule.selector.startsWith(`${rootSelector}[`) &&
        attributeRuleOn(rule.selector, attrs))
    if (!on) continue
    for (const [name, value] of rule.declarations) {
      if (names.includes(name)) tokens[name] = value
    }
  }
  return tokens
}

/** Whether every `[data-x="y"]` of a selector's first compound is what the root says. */
function attributeRuleOn(
  selector: string,
  attrs: Readonly<Record<string, string | undefined>>,
): boolean {
  const first = selector.split(/[\s>+~]/)[0] ?? ''
  for (const match of first.matchAll(/\[([\w-]+)="([^"]*)"\]/g)) {
    if (attrs[match[1] as string] !== match[2]) return false
  }
  return true
}

/**
 * A stylesheet as a design draws it, one `selector { property: value }` line each: the design's
 * tokens worked out, a rule keyed on a root attribute of another value gone, and the tokens' own
 * declarations gone from the root. Two stylesheets that give the same lines draw the same. An option
 * added with its first value adds no line: its other values' rules are off, its token is worked out.
 */
export function resolvedCss(
  css: string,
  rootSelector: string,
  attrs: Readonly<Record<string, string | undefined>>,
  names: readonly string[],
  extra: Readonly<Record<string, string>> = {},
): string {
  const rules = cssRules(css)
  const tokens = { ...rootTokens(rules, rootSelector, attrs, names), ...extra }
  const lines: string[] = []
  for (const rule of rules) {
    const parts = splitTop(rule.selector, ',')
      .map((part) => part.trim())
      .filter((part) => !part.startsWith(`${rootSelector}[`) || attributeRuleOn(part, attrs))
    if (parts.length === 0) continue
    const at = rule.media === null ? '' : `${rule.media} `
    for (const [name, value] of rule.declarations) {
      const isRoot = parts.every((part) => part.split(/[\s>+~]/).length === 1)
      if (isRoot && names.includes(name)) continue
      lines.push(`${at}${parts.join(', ')} { ${name}: ${withCalc(withTokens(value, tokens))} }`)
    }
  }
  return `${lines.join('\n')}\n`
}
