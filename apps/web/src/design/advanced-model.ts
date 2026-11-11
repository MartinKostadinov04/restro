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
  type DesignPage,
  type DesignPageId,
  type DesignValues,
  THEME_FONTS,
} from '@restro/core'

import type { DesignDraft } from './design-draft'

/** Simple is the Style, the colours and the fonts; Advanced is General and the component pages. */
export type PanelMode = 'simple' | 'advanced'

/** The page that opens first in Advanced. */
export const FIRST_PAGE: DesignPageId = DESIGN_PAGES[0].id

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
