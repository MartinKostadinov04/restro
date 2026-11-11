// The never-list as a test (D130): `runDesignContract` renders a face on the contract's fixtures at
// every value of every option it draws and at every Style, and checks what no option may ever do.
// The full contract runs on each (`runFaceContract`: every placement once and in order, the fixed
// controls, the allergens' meaning), and on top of it:
//   - a name is never cut, by the markup or by the stylesheet;
//   - a price is in the ink, never struck through, and at or above the size of the description;
//   - the allergens stay on the item's row;
//   - every part the view has is drawn, marked with a contract marker;
//   - the §7.5 text floors hold at this design's sizes (12 px text, 16 px inputs), and the
//     stylesheet stays on the theme's tokens and inside the face's root.
// Targets, contrast and no sideways scroll at 320 px need a browser: apps/web's
// e2e/faces-design.spec.ts sweeps the same values through the audits at each width.
//
// `storedRendering` is the other half of "a new option never changes an existing look": what a Style
// draws, written so an option that sits at its first value leaves no mark. Later tickets add
// fixtures and options here; the checks stay as they are (guardrails only tighten, D67).

import {
  BASIC_DESIGN_VALUES,
  CORNER_RADIUS,
  DEPTH_SHADOW,
  DESIGN_MARKER_PAGES,
  DESIGN_PAGES,
  type DesignValues,
  designLayoutOf,
  fontFamilyOf,
} from '@restro/core'

import { buildViewModel } from '../src/build'
import { PREMADE_STYLES } from '../src/design/styles'
import { type FaceManifest, imageSlotsFor } from '../src/manifest'
import type { ViewItem, ViewModel, ViewSection } from '../src/view-model'
import { type ContractFailure, type RenderFn, runFaceContract } from './contract'
import { assertFaceScopedCss, assertThemeOnlyCss } from './css'
import { type CssRule, cssRules, fontSizePx, rootTokens, rulesFor, valuesOf } from './css-rules'
import { fixtures as allFixtures, type Fixture } from './fixtures'
import { allElements, type HtmlElement, parseHtml, textOf, withAttribute } from './html'

/** The attribute a part of the design carries (D130). */
export const PART_ATTRIBUTE = 'data-design-part'

/** The §7.5 floors of text, in pixels. */
export const TEXT_FLOOR_PX = 12
export const INPUT_FLOOR_PX = 16

/** The options a face draws: `{ general: ['corners', …], items: ['layout'] }`. */
export type DrawnOptions = Readonly<Record<string, readonly string[]>>

/** One design the never-list runs on. */
export interface DesignCase {
  /** `style:editorial`, or `general.corners=round`. */
  readonly id: string
  readonly values: DesignValues
}

/** The values of a Style over Basic's, as the publisher would write them. */
function styleValues(style: keyof typeof PREMADE_STYLES): DesignValues {
  const file = PREMADE_STYLES[style]
  const merged: Record<string, Record<string, string>> = {}
  for (const [page, options] of Object.entries(BASIC_DESIGN_VALUES)) {
    merged[page] = { ...options, ...(file?.values as Record<string, object>)?.[page] } as Record<
      string,
      string
    >
  }
  return merged as unknown as DesignValues
}

/** Every Style that has a file. */
export function styleCases(): readonly DesignCase[] {
  return (Object.keys(PREMADE_STYLES) as (keyof typeof PREMADE_STYLES)[]).map((style) => ({
    id: `style:${style}`,
    values: styleValues(style),
  }))
}

/** The allowed values of one option, from the contract. */
function valuesOfOption(pageId: string, optionId: string): readonly string[] {
  const page = DESIGN_PAGES.find((candidate) => candidate.id === pageId)
  const option = page?.options.find((candidate) => candidate.id === optionId)
  if (option === undefined || !('values' in option)) {
    throw new Error(`the contract has no option ${pageId}.${optionId} with values`)
  }
  return option.values.map((value) => value.id)
}

/**
 * Every Style, then every value but Basic's of every drawn option, over Basic: a value's rule that
 * only breaks in company with another Style still shows at that Style when the value is the Style's.
 */
export function designCases(drawn: DrawnOptions): readonly DesignCase[] {
  const cases = [...styleCases()]
  for (const [page, options] of Object.entries(drawn)) {
    for (const option of options) {
      const first = (BASIC_DESIGN_VALUES as Record<string, Record<string, string>>)[page]?.[option]
      for (const value of valuesOfOption(page, option)) {
        if (value === first) continue
        cases.push({
          id: `${page}.${option}=${value}`,
          values: {
            ...BASIC_DESIGN_VALUES,
            [page]: {
              ...(BASIC_DESIGN_VALUES as Record<string, Record<string, string>>)[page],
              [option]: value,
            },
          } as DesignValues,
        })
      }
    }
  }
  return cases
}

/** A fixture as the publisher writes it for a venue with this design (D129). */
export function withDesign(fixture: Fixture, values: DesignValues): Fixture {
  const { general } = values
  const screen = general.screen as 'auto' | 'light' | 'dark'
  return {
    ...fixture,
    snapshot: {
      ...fixture.snapshot,
      design: values,
      layout: designLayoutOf(values),
      theme: {
        ...fixture.snapshot.theme,
        font: fontFamilyOf(general.body_font),
        radius: CORNER_RADIUS[general.corners],
        shadow: DEPTH_SHADOW[general.depth],
        // A fixture that forces a scheme keeps it at `auto`: `auto` asks for nothing.
        ...(screen === 'auto' ? {} : { scheme: screen }),
      },
    },
  }
}

/** The view of a fixture for a face, as the contract builds it. */
export function designView(fixture: Fixture, manifest: FaceManifest): ViewModel {
  return buildViewModel(fixture.snapshot, fixture.overlay ?? null, {
    ...fixture.context,
    channel: manifest.channels[0],
    images: imageSlotsFor(manifest, 1),
  })
}

/** The fixtures of the never-list: all of them but `scheduled`, which is out of scope (D131). */
export function neverListFixtures(): readonly Fixture[] {
  return allFixtures().filter((fixture) => fixture.name !== 'scheduled')
}

function placements(sections: readonly ViewSection[]): ViewItem[] {
  return sections.flatMap((section) => [...section.items, ...placements(section.sections)])
}

function allSections(sections: readonly ViewSection[]): ViewSection[] {
  return sections.flatMap((section) => [section, ...allSections(section.sections)])
}

/** The parts a page must carry for what this view holds. */
function expectedParts(view: ViewModel, manifest: FaceManifest): string[] {
  const items = placements(view.sections)
  const sections = allSections(view.sections)
  const parts = ['header', 'header.title']
  const add = (part: string, on: boolean) => {
    if (on) parts.push(part)
  }
  add('header.logo', view.theme.logo !== null)
  add('nav', view.sections.length > 1)
  add('section', sections.length > 0)
  add('section.title', sections.length > 0)
  add(
    'strip',
    sections.some((section) => section.hints.layout === 'horizontal'),
  )
  add('footer', view.allergenLegend.length > 0)
  add(
    'layout.switch',
    view.layout.guestSwitch &&
      view.sections.some((section) => section.hints.layout !== 'horizontal'),
  )
  add('order.bar', view.features.ordering && manifest.features.includes('ordering'))
  return parts.concat(items.length > 0 ? ['item'] : [])
}

/** The parts of one item, by what it holds. */
function itemParts(item: ViewItem): string[] {
  const parts = ['item.name']
  const add = (part: string, on: boolean) => {
    if (on) parts.push(part)
  }
  add('item.price', item.price !== null)
  add('item.description', item.description !== null)
  add('item.photo', item.image !== null)
  add('item.marks', item.badges.length > 0)
  add('item.labels', item.dietary.length > 0 || item.tags.length > 0)
  add('item.allergens', item.allergens.length > 0)
  add('item.choices', item.modifierGroups.length > 0)
  return parts
}

/** Declarations that cut text or take an element out of the page. */
function cutting(element: HtmlElement, rules: readonly CssRule[]): string[] {
  return allElements(element).flatMap((node) => {
    const reaching = rulesFor(node, rules)
    const clipped = reaching.some((rule) =>
      rule.declarations.some(([name, value]) => name === 'overflow' && value === 'hidden'),
    )
    return reaching.flatMap((rule) =>
      rule.declarations.flatMap(([name, value]) =>
        name === 'text-overflow' ||
        name === '-webkit-line-clamp' ||
        (name === 'display' && value === 'none') ||
        (name === 'visibility' && value === 'hidden') ||
        (name === 'white-space' && value === 'nowrap' && clipped)
          ? [`${rule.selector} { ${name}: ${value} }`]
          : [],
      ),
    )
  })
}

/** What the never-list reads of a case's stylesheet. */
interface CaseStyles {
  readonly rules: readonly CssRule[]
  readonly tokens: Readonly<Record<string, string>>
  readonly inkValues: readonly string[]
}

function checkItem(
  item: ViewItem,
  card: HtmlElement,
  styles: CaseStyles,
  fail: (rule: string, message: string) => void,
): void {
  const where = `item ${item.id}`
  const part = (name: string) => withAttribute(card, PART_ATTRIBUTE, name)
  for (const name of itemParts(item)) {
    if (part(name).length === 0) fail('parts', `${where} has no ${name} part`)
  }

  const [name] = part('item.name')
  if (name !== undefined) {
    if (!textOf(name).includes(item.name.text)) fail('name', `${where}: the name is not whole`)
    for (const cut of cutting(name, styles.rules)) fail('name', `${where}: ${cut} cuts the name`)
  }

  const [price] = part('item.price')
  if (price !== undefined && item.price !== null) {
    if (!textOf(price).includes(item.price.text)) fail('price', `${where}: the price is not whole`)
    for (const node of allElements(price)) {
      if (['s', 'del', 'strike'].includes(node.tag)) {
        fail('price', `${where}: the price is struck through (<${node.tag}>)`)
      }
      for (const rule of rulesFor(node, styles.rules)) {
        for (const [property, value] of rule.declarations) {
          if (property.startsWith('text-decoration') && value.includes('line-through')) {
            fail('price', `${where}: ${rule.selector} strikes the price through`)
          }
          if (property === 'opacity' && Number(value) < 1) {
            fail('price', `${where}: ${rule.selector} fades the price`)
          }
        }
      }
    }
    for (const cut of cutting(price, styles.rules))
      fail('price', `${where}: ${cut} hides the price`)
    for (const colour of valuesOf(price, 'color', styles.rules, true)) {
      if (!styles.inkValues.includes(colour)) {
        fail('price', `${where}: the price is ${colour}, not in the ink`)
      }
    }
    const [description] = part('item.description')
    if (description !== undefined) {
      const sizes = (element: HtmlElement) =>
        allElements(element).flatMap((node) =>
          valuesOf(node, 'font-size', styles.rules, true).map((value) =>
            fontSizePx(value, styles.tokens),
          ),
        )
      const priceSize = Math.min(...sizes(price).map((size) => size ?? 0))
      const descriptionSize = Math.max(...sizes(description).map((size) => size ?? 0))
      if (priceSize < descriptionSize) {
        fail(
          'price',
          `${where}: the price (${priceSize}px) is under the description (${descriptionSize}px)`,
        )
      }
    }
  }

  const [allergens] = part('item.allergens')
  if (allergens !== undefined) {
    for (const cut of cutting(allergens, styles.rules)) {
      fail('allergens', `${where}: ${cut} hides the allergens`)
    }
  }

  const [choices] = part('item.choices')
  if (choices !== undefined) {
    for (const cut of cutting(choices, styles.rules)) {
      fail('parts', `${where}: ${cut} takes the choices off the row`)
    }
    // R2: groups and options in their order.
    const text = textOf(choices)
    let from = 0
    for (const group of item.modifierGroups) {
      for (const label of [group.name.text, ...group.options.map((option) => option.name.text)]) {
        const at = text.indexOf(label, from)
        if (at < 0) fail('order', `${where}: "${label}" is out of its order`)
        else from = at
      }
    }
  }

  if (item.order.askWaiter !== null && !textOf(card).includes(item.order.askWaiter.text)) {
    fail('parts', `${where}: "${item.order.askWaiter.text}" is not drawn`)
  }
  if (item.state.label !== null && !textOf(card).includes(item.state.label.text)) {
    fail('parts', `${where}: the state label is not drawn`)
  }
}

/** The attributes of the face's root in a rendering. */
function rootAttributes(html: string): Readonly<Record<string, string | undefined>> {
  const root = allElements(parseHtml(html)).find(
    (element) => element.attrs['data-face'] !== undefined,
  )
  return root?.attrs ?? {}
}

/** The never-list on one rendering. */
function checkRendering(
  view: ViewModel,
  html: string,
  manifest: FaceManifest,
  rules: readonly CssRule[],
  options: {
    readonly rootSelector: string
    readonly tokens: readonly string[]
    readonly inkValues: readonly string[]
  },
  fail: (rule: string, message: string) => void,
): void {
  const root = parseHtml(html)
  const styles: CaseStyles = {
    rules,
    tokens: rootTokens(rules, options.rootSelector, rootAttributes(html), options.tokens),
    inkValues: options.inkValues,
  }

  // Every part drawn, with a marker of the contract.
  const drawn = new Set(
    withAttribute(root, PART_ATTRIBUTE).map((element) => element.attrs[PART_ATTRIBUTE] as string),
  )
  for (const part of drawn) {
    if (!DESIGN_MARKER_PAGES.has(part)) fail('parts', `${part} is no marker of the contract`)
  }
  for (const part of expectedParts(view, manifest)) {
    if (!drawn.has(part)) fail('parts', `the ${part} part is not drawn`)
  }

  const cards = withAttribute(root, 'data-item')
  placements(view.sections).forEach((item, index) => {
    const card = cards[index]
    if (card !== undefined) checkItem(item, card, styles, fail)
  })

  if (view.menu.schedule !== null && !textOf(root).includes(view.menu.schedule.text.text)) {
    fail('parts', 'the closed-menu note is not drawn')
  }
}

/** The §7.5 text floors over a whole stylesheet at this design's tokens; the offenders, one line each. */
export function assertTextFloors(
  css: string,
  tokens: Readonly<Record<string, string>>,
): readonly string[] {
  const found: string[] = []
  for (const rule of cssRules(css)) {
    for (const [name, value] of rule.declarations) {
      if (name !== 'font-size' || value === 'inherit') continue
      const size = fontSizePx(value, tokens)
      if (size === null) {
        found.push(`${rule.selector}: cannot read font-size: ${value}`)
        continue
      }
      const input = /(?:^|[\s,>+~(])(?:input|textarea|select)(?![-\w])/.test(rule.selector)
      const floor = input ? INPUT_FLOOR_PX : TEXT_FLOOR_PX
      if (size < floor) found.push(`${rule.selector}: ${size}px is under ${floor}px`)
    }
  }
  return found
}

/** What `runDesignContract` is given. */
export interface DesignContractOptions {
  readonly manifest: FaceManifest
  readonly render: RenderFn
  /** The face's whole stylesheet. */
  readonly css: string
  /** The options it draws; each value of each is one case, as is each Style. */
  readonly drawn: DrawnOptions
  /** The selector of the face's root, whose rules hold the tokens (`.rm`). */
  readonly rootSelector: string
  /** The design tokens the stylesheet works through (`--rm-type`, …). */
  readonly tokens: readonly string[]
  /** What the price's colour may read as: the face's ink (`var(--rm-text)`, `inherit`). */
  readonly inkValues: readonly string[]
  /** The fixtures; the never-list's by default. */
  readonly fixtures?: readonly Fixture[]
  /** The cases; `designCases(drawn)` by default. */
  readonly cases?: readonly DesignCase[]
}

/** One thing the never-list found. */
export interface DesignFailure extends ContractFailure {
  readonly design: string
}

/** What `runDesignContract` found. */
export interface DesignReport {
  readonly cases: number
  readonly renders: number
  readonly failures: readonly DesignFailure[]
}

/** Runs the never-list over every case. An empty `failures` means no option breaks it. */
export async function runDesignContract(options: DesignContractOptions): Promise<DesignReport> {
  const { manifest, render, css, drawn, rootSelector, tokens, inkValues } = options
  const cases = options.cases ?? designCases(drawn)
  const fixtures = options.fixtures ?? neverListFixtures()
  const rules = cssRules(css)
  const failures: DesignFailure[] = []
  let renders = 0

  // The stylesheet is one, whatever the case: its floors at each text size, its tokens once.
  for (const face of [...assertThemeOnlyCss(css), ...assertFaceScopedCss(css)]) {
    failures.push({
      design: 'stylesheet',
      fixture: '',
      channel: manifest.channels[0] ?? 'qr',
      rule: '§7.5',
      message: face,
    })
  }

  for (const designCase of cases) {
    const mapped = fixtures.map((fixture) => withDesign(fixture, designCase.values))
    const seen: { view: ViewModel; html: string }[] = []
    const report = await runFaceContract(
      async (view, host) => {
        const html = await render(view, host)
        if (host === undefined) seen.push({ view, html })
        return html
      },
      manifest,
      { fixtures: mapped },
    )
    renders += report.renders
    for (const failure of report.failures) failures.push({ ...failure, design: designCase.id })

    // The contract renders each fixture on each channel, in order, once without a host.
    seen.forEach(({ view, html }, index) => {
      const fixture = mapped[Math.floor(index / manifest.channels.length)]?.name ?? ''
      const fail = (rule: string, message: string) => {
        failures.push({ design: designCase.id, fixture, channel: view.channel, rule, message })
      }
      checkRendering(view, html, manifest, rules, { rootSelector, tokens, inkValues }, fail)
      if (index === 0) {
        const at = rootTokens(rules, rootSelector, rootAttributes(html), tokens)
        for (const breach of assertTextFloors(css, at)) fail('§7.5', breach)
      }
    })
  }
  return { cases: cases.length, renders, failures }
}

/**
 * A rendering as it is stored (D130): the markup without its stylesheet, one element a line, and
 * without any root attribute that sits at its option's first value. So an option added with its
 * first value leaves no mark, and a Style's file holds only what makes it that Style.
 */
export function storedRendering(
  html: string,
  firstValues: Readonly<Record<string, string>>,
): string {
  const markup = html
    .replace(/<style>[\s\S]*?<\/style>/, '')
    .replace(/<div [^>]*data-face=[^>]*>/, (root) =>
      Object.entries(firstValues).reduce(
        (text, [attribute, first]) => text.replace(` ${attribute}="${first}"`, ''),
        root,
      ),
    )
    .replace(/></g, '>\n<')
    .trim()
  return `${markup}\n`
}

/** The root attribute of each General option at its first value, as `storedRendering` wants them. */
export function firstRootAttributes(
  general: Readonly<Record<string, string>> = BASIC_DESIGN_VALUES.general,
): Readonly<Record<string, string>> {
  return Object.fromEntries(
    Object.entries(general).flatMap(([option, value]) =>
      option === 'style' || option === 'colours'
        ? []
        : [[`data-${option.replace(/_/g, '-')}`, value]],
    ),
  )
}

/**
 * The root attribute of every option of the design at its first value, as `storedRendering` wants
 * them: General's by `firstRootAttributes`, every other page's with the page in front
 * (`items.name_size` to `data-items-name-size`). So a Basic rendering stores none of them.
 */
export function firstDesignAttributes(
  general?: Readonly<Record<string, string>>,
): Readonly<Record<string, string>> {
  const attributes: Record<string, string> = { ...firstRootAttributes(general) }
  for (const [page, options] of Object.entries(BASIC_DESIGN_VALUES)) {
    if (page === 'general') continue
    for (const [option, value] of Object.entries(options as Readonly<Record<string, string>>)) {
      attributes[`data-${page}-${option}`.replace(/_/g, '-')] = value
    }
  }
  return attributes
}

/** A short fingerprint of a long rendering (the 300-item menu is stored as this, not whole). */
export function fingerprint(text: string): string {
  let a = 0x811c9dc5
  let b = 0x01000193
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i)
    a = Math.imul(a ^ code, 0x01000193)
    b = Math.imul(b + code, 0x85ebca6b)
  }
  return `${(a >>> 0).toString(16)}${(b >>> 0).toString(16)}`
}
