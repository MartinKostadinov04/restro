// What the Design page's Advanced panel knows, apart from React (D129, D130). Pure, so the rules are
// tested without a screen.
//
// The panel is driven by the contract file (`DESIGN_PAGES`): its pages, their order, their options and
// the labels all come from there, so an option added to the contract is a row here with no code of
// ours. What lives here is only what the contract cannot say: which row is switched off by another
// (Photo corners when the Frame is bleed), which row carries a note (Heavy on a font that stops
// short), what a tile draws and where the frame looks first, and the page a tap on the preview opens.
import {
  DESIGN_MARKER_PAGES,
  DESIGN_PAGES,
  type DesignChoiceOption,
  type DesignOption,
  type DesignPage,
  type DesignPageId,
  type DesignValues,
  THEME_FONTS,
} from '@restro/core'
import type { SpecimenPart } from '@restro/editorial-market/preview'

import type { DesignDraft } from './design-draft'

/** Simple is the Style, the colours and the fonts; Advanced is General and the component pages. */
export type PanelMode = 'simple' | 'advanced'

/** A page of the contract by its id. */
export function pageById(
  id: string,
  pages: readonly DesignPage[] = DESIGN_PAGES,
): DesignPage | undefined {
  return pages.find((page) => page.id === id)
}

/**
 * The page that owns a `data-design-part` marker, or null for a marker the contract does not list.
 * A marker the contract does not name takes its parent's page ("item.photo.x" -> "item.photo").
 */
export function pageOfMarker(marker: string): DesignPageId | null {
  let name = marker
  for (;;) {
    const page = DESIGN_MARKER_PAGES.get(name)
    if (page !== undefined) return page
    const cut = name.lastIndexOf('.')
    if (cut < 0) return null
    name = name.slice(0, cut)
  }
}

type Row = Record<string, string>

/** The value of an option in the draft's values (a tolerant read: an option the values lack is ''). */
export function valueIn(values: DesignValues, pageId: string, optionId: string): string {
  const page = (values as unknown as Record<string, Row | undefined>)[pageId]
  return page?.[optionId] ?? ''
}

/** The values with one option set. */
export function withOptionValue(
  values: DesignValues,
  pageId: string,
  optionId: string,
  value: string,
): DesignValues {
  const all = values as unknown as Record<string, Row>
  return { ...all, [pageId]: { ...all[pageId], [optionId]: value } } as unknown as DesignValues
}

/** The draft with one option set: one step for Undo, and nothing else about the draft changes. */
export function withOption(
  draft: DesignDraft,
  pageId: string,
  optionId: string,
  value: string,
): DesignDraft {
  return { ...draft, values: withOptionValue(draft.values, pageId, optionId, value) }
}

/** Why a row says something: a note under it, and whether the row can be picked at all. */
export type RowNote =
  | { readonly kind: 'bleed' }
  | { readonly kind: 'heavy'; readonly font: string; readonly heaviest: number }

export interface RowState {
  readonly disabled: boolean
  readonly note: RowNote | null
}

const FREE: RowState = { disabled: false, note: null }

/** The weight Heavy is asked for in the renderer; a font that serves less draws it at its own top. */
const HEAVY_WEIGHT = 850

/** The font that draws headings and names: the heading font, or the body font when it is "same". */
export function drawingFont(values: DesignValues): string {
  const { heading_font: heading, body_font: body } = values.general
  return heading === 'same' ? body : heading
}

/**
 * Whether a row can be picked and what it notes, from the draft's other values.
 * - Photos / Corners: an edge-to-edge photo has no corners of its own, so the row is off (D130).
 * - Heading weight and Name weight: a font that stops short of Heavy draws it at its heaviest; the
 *   row stays, with a note.
 */
export function rowStateOf(values: DesignValues, pageId: string, optionId: string): RowState {
  if (
    pageId === 'photos' &&
    optionId === 'corners' &&
    valueIn(values, 'photos', 'frame') === 'bleed'
  ) {
    return { disabled: true, note: { kind: 'bleed' } }
  }
  const weightRow =
    (pageId === 'general' && optionId === 'heading_weight') ||
    (pageId === 'items' && optionId === 'name_weight')
  if (weightRow) {
    const font = THEME_FONTS.find((entry) => entry.id === drawingFont(values))
    if (font !== undefined && font.heaviest < HEAVY_WEIGHT) {
      return {
        disabled: false,
        note: { kind: 'heavy', font: font.family, heaviest: font.heaviest },
      }
    }
  }
  return FREE
}

/** General's options that are rows of their own in Advanced, so General does not repeat them. */
const OWN_ROW_OPTIONS: ReadonlySet<string> = new Set([
  'style',
  'colours',
  'body_font',
  'heading_font',
])

/** The options a part page shows: every option of the page, but General's own rows (D159). */
export function optionsOfPage(page: DesignPage): readonly DesignOption[] {
  if (page.id !== 'general') return page.options
  return page.options.filter((option) => !OWN_ROW_OPTIONS.has(option.id))
}

/** The choice options of a page, in the contract's order. */
export function choiceOptions(page: DesignPage): DesignChoiceOption[] {
  return page.options.filter((option): option is DesignChoiceOption => option.kind === 'choice')
}

// --- What a tile draws ---------------------------------------------------------------------------

/** What the frame of a tile (or the preview) shows first. */
export type Stage =
  /** The top of the menu. */
  | 'menu'
  /** The menu with one dish in the bag: the Add control and the order bar. */
  | 'order'
  /** The bag, open. */
  | 'bag'
  | 'bill'
  | 'call'
  | 'pay'
  /** The paid screen. */
  | 'receipt'
  /** A dish, open. */
  | 'dish'

export interface TilePlan {
  readonly stage: Stage
  /** The markers the frame scrolls to, the first one it finds. */
  readonly focus: readonly string[]
}

/** The stage of a page's tiles; the five guest-feature screens draw their own screen (D130). */
const STAGE_OF_PAGE: Readonly<Record<string, Stage>> = {
  dish: 'dish',
  sheets: 'bill',
  call: 'call',
  bill: 'bill',
  order: 'order',
  pay: 'pay',
  receipt: 'receipt',
}

/** A stage for one option when it differs from its page's. */
const STAGE_OF_OPTION: Readonly<Record<string, Stage>> = {
  // Buttons are drawn by the sheets; the Call a waiter sheet is the smallest with one.
  'general.buttons': 'call',
  // The photos of the bag's lines are in the open bag.
  'order.line_photos': 'bag',
}

/** The part to look at, for options whose part is finer than their page's first marker. */
const FOCUS_OF_OPTION: Readonly<Record<string, readonly string[]>> = {
  'header.title_size': ['header.title'],
  'header.logo_size': ['header.logo', 'header'],
  'sections.strip_card_size': ['strip'],
  'sections.title_size': ['section.title'],
  'sections.title_case': ['section.title'],
  'items.name_size': ['item.name'],
  'items.name_weight': ['item.name'],
  'items.name_case': ['item.name'],
  'items.price_place': ['item.price'],
  'items.portion_place': ['item.price'],
  'items.description_lines': ['item.description'],
  'items.guest_switch': ['layout.switch'],
  'photos.shape': ['item.photo'],
  'labels.labels': ['item.labels', 'item.marks'],
  'labels.allergens': ['item.allergens', 'footer'],
  'call.kinds': ['call.kinds'],
  'bill.rows': ['bill.lines'],
  'bill.lines': ['bill.lines'],
  'pay.tip': ['pay.tip'],
  'receipt.venue_block': ['receipt.venue'],
  'order.order_bar': ['order.bar'],
  'order.add_control': ['item.add'],
}

/** The page-wide options look at the top of the menu; a component page looks at its own part. */
export function tilePlanOf(
  pageId: string,
  optionId: string,
  pages: readonly DesignPage[] = DESIGN_PAGES,
): TilePlan {
  const key = `${pageId}.${optionId}`
  const stage = STAGE_OF_OPTION[key] ?? STAGE_OF_PAGE[pageId] ?? 'menu'
  const own = FOCUS_OF_OPTION[key]
  if (own !== undefined) return { stage, focus: own }
  if (pageId === 'general') return { stage, focus: [] }
  const page = pageById(pageId, pages)
  return { stage, focus: page === undefined ? [] : page.markers.slice(0, 2) }
}

/**
 * The part an option's tile draws alone (D159, the spec's §5.1): the face's specimen view of that
 * part, with nothing of the page around it. Every option of the contract is here: `null` for the
 * options that have no tiles of a part (a Style redraws the whole menu; the colours and the fonts are
 * fields), so a contract option missing from this table fails its test.
 */
export const PART_OF_OPTION: Readonly<Record<string, SpecimenPart | null>> = {
  'general.style': null,
  'general.colours': null,
  'general.body_font': null,
  'general.heading_font': null,
  'general.screen': 'section-two',
  'general.heading_weight': 'section',
  'general.corners': 'dish-card',
  'general.depth': 'dish-card',
  'general.density': 'dish-rows',
  'general.text_size': 'dish-row',
  'general.buttons': 'call-foot',
  'header.band': 'header',
  'header.arrangement': 'header',
  'header.title_size': 'header',
  'header.logo_size': 'header',
  'navigation.marker': 'rail',
  'navigation.band': 'header-rail',
  'sections.header': 'section',
  'sections.title_size': 'section',
  'sections.title_case': 'section',
  'sections.strip_card_size': 'strip',
  'items.frame': 'two-dishes',
  'items.name_size': 'dish-row',
  'items.name_weight': 'dish-row',
  'items.name_case': 'dish-row',
  'items.price_place': 'dish-row',
  'items.portion_place': 'dish-row',
  'items.description_lines': 'dish-long',
  'items.layout': 'four-dishes',
  'items.guest_switch': 'switch',
  'photos.shape': 'dish-row',
  'photos.fit': 'dish-row',
  'photos.backdrop': 'dish-row',
  'photos.frame': 'dish-row',
  'photos.corners': 'dish-row',
  'labels.labels': 'dish-row',
  'labels.allergens': 'dish-allergens',
  'dish.kind': 'dish-open',
  'dish.photo': 'dish-open',
  'sheets.sheets': 'call-sheet',
  'call.kinds': 'call-kinds',
  'bill.rows': 'bill-lines',
  'bill.lines': 'bill-lines',
  'order.add_control': 'dish-add',
  'order.order_bar': 'order-bar',
  'order.line_photos': 'bag-lines',
  'pay.tip': 'tip',
  'receipt.venue_block': 'receipt-top',
}

/**
 * The part an option's tile draws alone, or null where it has none: the tile then draws the menu at
 * its stage (`tilePlanOf`), as an option the contract gained before this table did.
 */
export function specimenPartOf(pageId: string, optionId: string): SpecimenPart | null {
  return PART_OF_OPTION[`${pageId}.${optionId}`] ?? null
}

// --- A tap on the preview ------------------------------------------------------------------------

/**
 * The page a tap on the preview opens in Advanced, or null to stay where the panel is. `marker` is
 * the part tapped (the innermost); `opens` the part the tap opens, if any (a dish tapped open is
 * `dish`). The panel stays when the open page owns either: a dish tapped open on the Dish page keeps
 * the Dish page's options in view. The parts the tap merely sits in (the section around a dish) play
 * no part.
 */
export function pageOfTap(
  marker: string,
  opens: string | null,
  open: DesignPageId,
): DesignPageId | null {
  const owner = pageOfMarker(marker)
  if (owner === null || owner === open) return null
  if (opens !== null && pageOfMarker(opens) === open) return null
  return owner
}

/** What the live preview shows: a stage it opens (none for the menu itself), and the part it scrolls to. */
export interface PreviewPlan {
  readonly stage?: Stage
  readonly focus: readonly string[]
}

/** The top of the menu: what the preview shows with the list, or a part of the panel's own, open. */
export const MENU_TOP: PreviewPlan = { focus: ['header'] }

/**
 * What the live preview shows while a part is open (D159): a page of the contract shows its part,
 * at its first option's stage (a sheet open, a dish open) and scrolled to the page's own part, so
 * its options are seen at work; the list and the panel's own parts (Style, colours, fonts, layout)
 * show the top of the menu. Leaving a stage for the menu closes what the stage opened.
 */
export function previewStageOf(
  part: string | null,
  pages: readonly DesignPage[] = DESIGN_PAGES,
): PreviewPlan {
  const page = part === null ? undefined : pageById(part, pages)
  const first =
    page === undefined ? undefined : optionsOfPage(page).find((option) => option.kind === 'choice')
  if (page === undefined || first === undefined) return MENU_TOP
  const plan = tilePlanOf(page.id, first.id, pages)
  const focus = plan.focus.length > 0 ? plan.focus : MENU_TOP.focus
  return plan.stage === 'menu' ? { focus } : { stage: plan.stage, focus }
}

// --- How a row lists its values ------------------------------------------------------------------

/** The sizes, smallest first. */
const SIZE_ORDER = ['s', 'm', 'l', 'xl']

/**
 * The values of an option in the order the row shows them. A row of sizes reads as a scale, small to
 * large, and a row of counts upwards; the contract keeps Basic's value first (D130), which is the
 * stored order and stays so.
 */
export function shownValues<T extends { readonly id: string }>(values: readonly T[]): readonly T[] {
  if (values.every((value) => SIZE_ORDER.includes(value.id))) {
    return [...values].sort((a, b) => SIZE_ORDER.indexOf(a.id) - SIZE_ORDER.indexOf(b.id))
  }
  // A row of counts (description lines: 1, 2, 3, all) reads up, "all" last.
  const count = (id: string) => (id === 'all' ? Number.POSITIVE_INFINITY : Number(id))
  if (values.every((value) => value.id === 'all' || /^\d+$/.test(value.id))) {
    return [...values].sort((a, b) => count(a.id) - count(b.id))
  }
  return values
}
