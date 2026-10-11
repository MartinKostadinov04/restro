// `runFaceContract(renderFn, manifest)`: renders every fixture on every channel the face declares
// and checks what the doc's "Contract tests" ask for, plus the rules a face could break:
//   - every visible item has every required slot (`data-slot`), in snapshot order (R2, R7);
//   - an empty optional slot collapses; a declared optional slot with content is drawn (R8);
//   - names appear whole (R9) and in their own language (`lang`, R3);
//   - the state is on the page (`data-state`, R5);
//   - allergens are reachable the way the manifest says (R6);
//   - only `nd_`, `as_` and `tg_` ids appear (rule 3).
// The face renders a view model to an HTML string (`renderToStaticMarkup` in S3-03). It marks each
// item placement with `data-item="<nd_ id>"` and each slot with `data-slot="item.name"` etc.
// Menu-level slots used here: `menu.allergen_legend` (numbered legend) and `menu.allergen_info`
// (info link or QR code), and the five feature slots below (R15).
//
// R15, fail-closed: a control for a guest feature carries the slot named in FEATURE_SLOTS.
//   - when the view model has the feature off, no element with that slot may exist, whatever the
//     manifest declares (a hidden control must not be in the page at all);
//   - when the manifest declares the feature and the view model has it on, the slot must exist.

import { localeToBcp47 } from '@restro/core'

import { buildViewModel } from '../src/build'
import type { Channel } from '../src/context'
import { type FaceManifest, type FeatureName, imageSlotsFor } from '../src/manifest'
import type { ViewItem, ViewModel, ViewSection } from '../src/view-model'
import { fixtures as allFixtures, type Fixture } from './fixtures'
import {
  allElements,
  attributeValues,
  type HtmlElement,
  langsAround,
  parseHtml,
  textOf,
  withAttribute,
} from './html'

/** The attribute that marks one placement of an item. */
export const ITEM_ATTRIBUTE = 'data-item'
/** The attribute that names a slot. */
export const SLOT_ATTRIBUTE = 'data-slot'
/** The attribute that carries an item's state code on its `item.state` slot. */
export const STATE_ATTRIBUTE = 'data-state'

/** What a face is: a function from a view model to markup. */
export type RenderFn = (view: ViewModel) => string | Promise<string>

/** One thing a face got wrong. */
export interface ContractFailure {
  readonly fixture: string
  readonly channel: Channel
  readonly rule: string
  readonly message: string
}

/** What `runFaceContract` found. */
export interface ContractReport {
  /** Fixture-by-channel renders checked. */
  readonly renders: number
  /** Item placements checked. */
  readonly items: number
  readonly failures: readonly ContractFailure[]
}

/** Options for `runFaceContract`. */
export interface ContractOptions {
  /** Fixtures to render; all of them by default. */
  readonly fixtures?: readonly Fixture[]
  /** Pixel density to build the view models for. */
  readonly density?: number
}

/** The menu-level slot of each guest feature's control (R15). */
export const FEATURE_SLOTS: readonly { readonly slot: string; readonly feature: FeatureName }[] = [
  { slot: 'menu.filters', feature: 'filters' },
  { slot: 'menu.call_waiter', feature: 'call_waiter' },
  { slot: 'menu.bill', feature: 'bill' },
  { slot: 'menu.bag', feature: 'ordering' },
  { slot: 'menu.pay', feature: 'pay' },
]

/** Whether the view model has the feature on. */
function featureOn(view: ViewModel, feature: FeatureName): boolean {
  switch (feature) {
    case 'filters':
      return view.features.filters
    case 'call_waiter':
      return view.features.callWaiter !== null
    case 'bill':
      return view.features.bill
    case 'ordering':
      return view.features.ordering
    case 'pay':
      return view.features.pay
  }
}

/** Ids our snapshots and view models may show. Any other id-shaped string is a leak. */
const ALLOWED_ID_KINDS = new Set(['nd', 'as', 'tg'])
const ID_LIKE = /(?<![0-9A-Za-z_])([a-z]{2})_[0-9A-Za-z]{22}(?![0-9A-Za-z_])/g

function placements(sections: readonly ViewSection[]): ViewItem[] {
  const out: ViewItem[] = []
  for (const section of sections) {
    out.push(...section.items)
    out.push(...placements(section.sections))
  }
  return out
}

function slotsIn(element: HtmlElement): Map<string, HtmlElement> {
  const slots = new Map<string, HtmlElement>()
  for (const found of withAttribute(element, SLOT_ATTRIBUTE)) {
    const name = found.attrs[SLOT_ATTRIBUTE]
    if (name !== undefined && !slots.has(name)) slots.set(name, found)
  }
  return slots
}

/** Which optional slots hold something for this item, by slot name. */
function slotContent(item: ViewItem): Record<string, boolean> {
  return {
    'item.description': item.description !== null,
    'item.image': item.image !== null,
    'item.badges': item.badges.length > 0,
    'item.portion': item.portion !== null,
    'item.dietary': item.dietary.length > 0,
    'item.tags': item.tags.length > 0,
    'item.extra_fields': item.extraFields.length > 0,
    'item.modifiers': item.modifierGroups.length > 0,
  }
}

function checkItem(
  item: ViewItem,
  element: HtmlElement,
  view: ViewModel,
  manifest: FaceManifest,
  fail: (rule: string, message: string) => void,
): void {
  const slots = slotsIn(element)
  const where = `item ${item.id}`

  // R7: required slots.
  if (!slots.has('item.name')) fail('R7', `${where} has no item.name slot`)
  if (!slots.has('item.state')) fail('R7', `${where} has no item.state slot`)
  if (item.price !== null && !slots.has('item.price')) {
    fail('R7', `${where} is priced but has no item.price slot`)
  }
  if (item.allergens.length > 0 && !slots.has('item.allergens')) {
    fail('R6', `${where} lists allergens but has no item.allergens slot`)
  }

  // R9: the name is whole. R3: and carries its real language.
  const nameSlot = slots.get('item.name')
  if (nameSlot !== undefined) {
    if (!textOf(nameSlot).includes(item.name.text)) {
      fail('R9', `${where}: the name is not shown whole`)
    }
    if (item.name.lang !== view.locale) {
      const expected = localeToBcp47(item.name.lang)
      if (!langsAround(nameSlot).includes(expected)) {
        fail('R3', `${where}: a ${item.name.lang} name needs lang="${expected}"`)
      }
    }
  }

  // R5: the state is on the page.
  const stateSlot = slots.get('item.state')
  if (stateSlot !== undefined && stateSlot.attrs[STATE_ATTRIBUTE] !== item.state.code) {
    fail('R5', `${where}: item.state needs ${STATE_ATTRIBUTE}="${item.state.code}"`)
  }

  // R8: empty optional slots collapse; declared optional slots with content are drawn.
  for (const [slot, filled] of Object.entries(slotContent(item))) {
    const declared = manifest.slots[slot as keyof typeof manifest.slots] !== undefined
    const present = slots.has(slot)
    const collapses = slot !== 'item.image' || manifest.no_image_layout === 'text_only'
    if (!filled && present && collapses) {
      fail('R8', `${where}: ${slot} is empty and must collapse, not print a placeholder`)
    }
    if (filled && declared && !present) fail('R8', `${where}: ${slot} has content but is not drawn`)
  }

  // R6: allergens are reachable the way the manifest says.
  const allergenSlot = slots.get('item.allergens')
  if (allergenSlot !== undefined) {
    const readable = [
      textOf(allergenSlot),
      ...attributeValues(allergenSlot, ['aria-label', 'title', 'alt', 'data-allergen']),
    ].join('\n')
    for (const allergen of item.allergens) {
      const reachable =
        manifest.allergen_mode === 'numbered_legend'
          ? readable.includes(String(allergen.number))
          : manifest.allergen_mode === 'info_link' || manifest.allergen_mode === 'info_qr'
            ? true
            : readable.includes(allergen.label.text) || readable.includes(allergen.code)
      if (!reachable)
        fail('R6', `${where}: allergen ${allergen.code} is not reachable in item.allergens`)
    }
  }
}

function checkDocument(
  root: HtmlElement,
  html: string,
  view: ViewModel,
  manifest: FaceManifest,
  fail: (rule: string, message: string) => void,
): number {
  // Rule 3: only our own kinds of id.
  for (const match of html.matchAll(ID_LIKE)) {
    if (!ALLOWED_ID_KINDS.has(match[1] ?? ''))
      fail('rule 3', `an id of kind ${match[1]}_ appears in the markup`)
  }

  // R2 and R7: every placement is drawn once, in snapshot order.
  const expected = placements(view.sections)
  const drawn = withAttribute(root, ITEM_ATTRIBUTE)
  const order = drawn.map((element) => element.attrs[ITEM_ATTRIBUTE])
  if (JSON.stringify(order) !== JSON.stringify(expected.map((item) => item.id))) {
    fail(
      'R2',
      `items are not drawn once each in snapshot order (drawn ${order.length}, expected ${expected.length})`,
    )
  } else {
    expected.forEach((item, index) => {
      const element = drawn[index]
      if (element !== undefined) checkItem(item, element, view, manifest, fail)
    })
  }

  // R6 at menu level.
  const documentSlots = new Set(
    allElements(root).flatMap((e) =>
      e.attrs[SLOT_ATTRIBUTE] ? [e.attrs[SLOT_ATTRIBUTE] as string] : [],
    ),
  )
  if (view.allergenLegend.length > 0) {
    if (
      manifest.allergen_mode === 'numbered_legend' &&
      !documentSlots.has('menu.allergen_legend')
    ) {
      fail('R6', 'a numbered-legend face must draw the legend (menu.allergen_legend)')
    }
    if (
      (manifest.allergen_mode === 'info_link' || manifest.allergen_mode === 'info_qr') &&
      !documentSlots.has('menu.allergen_info')
    ) {
      fail('R6', 'an info-link or info-QR face must draw menu.allergen_info')
    }
  }

  // R15: feature controls appear only when the view model has the feature on.
  for (const { slot, feature } of FEATURE_SLOTS) {
    const on = featureOn(view, feature)
    const drawn = documentSlots.has(slot)
    if (!on && drawn) {
      fail('R15', `${slot} is drawn while the ${feature} feature is off (R15 is fail-closed)`)
    }
    if (on && !drawn && manifest.features.includes(feature)) {
      fail('R15', `the manifest declares ${feature} and it is on, but ${slot} is not drawn`)
    }
  }
  return expected.length
}

/**
 * Renders every fixture on every channel the face declares and reports what breaks the contract.
 * An empty `failures` list means the face may be installed.
 */
export async function runFaceContract(
  render: RenderFn,
  manifest: FaceManifest,
  options: ContractOptions = {},
): Promise<ContractReport> {
  const failures: ContractFailure[] = []
  let renders = 0
  let items = 0
  for (const fixture of options.fixtures ?? allFixtures()) {
    for (const channel of manifest.channels) {
      const view = buildViewModel(fixture.snapshot, fixture.overlay, {
        ...fixture.context,
        channel,
        images: { ...imageSlotsFor(manifest, options.density ?? 1) },
      })
      const html = await render(view)
      const fail = (rule: string, message: string) =>
        failures.push({ fixture: fixture.name, channel, rule, message })
      items += checkDocument(parseHtml(html), html, view, manifest, fail)
      renders++
    }
  }
  return { renders, items, failures }
}

/** Like `runFaceContract`, but throws one error that lists every failure. */
export async function assertFaceContract(
  render: RenderFn,
  manifest: FaceManifest,
  options?: ContractOptions,
): Promise<ContractReport> {
  const report = await runFaceContract(render, manifest, options)
  if (report.failures.length > 0) {
    const lines = report.failures.map((f) => `[${f.fixture}/${f.channel}] ${f.rule}: ${f.message}`)
    throw new Error(`face contract failed:\n${lines.join('\n')}`)
  }
  return report
}
