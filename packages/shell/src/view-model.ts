// The view model: everything a face draws, already decided (doc "The visualization shell"). It is
// plain JSON (no Maps, no functions, no dates) so it can cross from server to browser. A face
// changes how it looks, never what is shown, in what order, or in what state.
//
// Empty optional slots collapse (R8): a `null` or an empty array here means "draw nothing", never
// placeholder text. Only `nd_`, `as_` and `tg_` ids appear (rule 3).

import type {
  Allergen,
  AssetId,
  Currency,
  DietaryLabel,
  Locale,
  MeasurementUnit,
  NodeId,
  TagId,
} from '@restro/core'

import type { Channel } from './context'
import type { SnapshotFieldType } from './fields'
import type { ViewImage } from './images'
import type { ViewMoney, ViewPrice } from './money'
import type { Palette, SemanticColours } from './palette'
import type { ViewSchedule } from './schedule'
import type { ViewText } from './text'

export type { ViewImage, ViewMoney, ViewPrice, ViewSchedule, ViewText }

/** R5: how an item is offered right now. */
export const ITEM_STATES = ['available', 'sold_out', 'scheduled', 'unavailable'] as const

/** One item state. */
export type ItemState = (typeof ITEM_STATES)[number]

/** An item's state with the words for it. `label` is null for `available` (nothing to say). */
export interface ViewState {
  readonly code: ItemState
  readonly label: ViewText | null
  /** Set when the state is `scheduled`: when the item can be had. */
  readonly schedule: ViewSchedule | null
}

/** R6: an allergen with its stable legend number (1–14, EU 1169/2011 Annex II order). */
export interface ViewAllergen {
  readonly code: Allergen
  readonly number: number
  readonly label: ViewText
}

/** A dietary label with its name. */
export interface ViewDietary {
  readonly code: DietaryLabel
  readonly label: ViewText
}

/** A venue-defined tag with its name (D60). */
export interface ViewTag {
  readonly id: TagId
  readonly label: ViewText
}

/** A badge the publisher passed through. Dietary labels and tags already shown in their own slot are not repeated here. */
export type ViewBadge =
  | { readonly kind: 'new'; readonly label: ViewText }
  | { readonly kind: 'dietary'; readonly code: DietaryLabel; readonly label: ViewText }
  | { readonly kind: 'tag'; readonly id: TagId; readonly label: ViewText }

/** R9: the description, with whether this channel may cut it (it offers a way to read the rest). */
export interface ViewDescription extends ViewText {
  readonly truncatable: boolean
}

/** A portion: "90 ml". */
export interface ViewPortion {
  readonly value: number
  readonly unit: MeasurementUnit
  readonly text: string
}

/** R12: one public custom field, already formatted for the language. */
export interface ViewExtraField {
  readonly key: string
  readonly type: SnapshotFieldType
  readonly label: ViewText
  readonly text: string
  /** The language of `text` when it is text in a known language; null for numbers, dates … */
  readonly lang: Locale | null
}

/** An option of a modifier group. `delta` is "+3,00 €", or null when it costs nothing extra. */
export interface ViewOption {
  readonly id: NodeId
  readonly name: ViewText
  readonly delta: ViewMoney | null
}

/** A modifier group, with its options in snapshot order (R2). */
export interface ViewModifierGroup {
  readonly id: NodeId
  readonly name: ViewText
  readonly min: number
  readonly max: number
  /** True when the guest must choose (`min` 1 or more). */
  readonly required: boolean
  readonly options: readonly ViewOption[]
}

/** R11: what a guest can do about ordering this item. */
export interface ViewOrder {
  /** Draw ordering controls: ordering on, channel and table token fit, item orderable and available. */
  readonly controls: boolean
  /** "Ask your waiter", for an item that is not orderable by phone; null otherwise. */
  readonly askWaiter: ViewText | null
}

/** One item as placed in one section. */
export interface ViewItem {
  readonly id: NodeId
  /** R7, required, never truncated (R9). */
  readonly name: ViewText
  /** R7, required when the item is priced. */
  readonly price: ViewPrice | null
  /** R7, required. */
  readonly state: ViewState
  /** R6/R7, required: the face must make these reachable. Empty when the item lists none. */
  readonly allergens: readonly ViewAllergen[]
  readonly description: ViewDescription | null
  /** R10. */
  readonly image: ViewImage | null
  /** True when there is no image: the face uses its declared no-image layout. */
  readonly noImage: boolean
  readonly badges: readonly ViewBadge[]
  readonly portion: ViewPortion | null
  readonly dietary: readonly ViewDietary[]
  readonly tags: readonly ViewTag[]
  readonly extraFields: readonly ViewExtraField[]
  readonly modifierGroups: readonly ViewModifierGroup[]
  readonly order: ViewOrder
}

/** A section (or sub-section) with what it holds, in snapshot order. */
export interface ViewSection {
  readonly id: NodeId
  readonly title: ViewText
  readonly description: ViewText | null
  readonly image: ViewImage | null
  readonly hints: {
    readonly color: string | null
    /** A text colour that reads on `color`. */
    readonly onColor: string | null
    readonly icon: string | null
  }
  readonly sections: readonly ViewSection[]
  readonly items: readonly ViewItem[]
}

/** R13: theme tokens. Faces use these and nothing hard-coded. */
export interface ViewTheme {
  /** Token `palette.<step>`. */
  readonly palette: { readonly [S in `${keyof Palette}`]: string }
  /** Token `color.<name>`: the semantic colours. */
  readonly colors: SemanticColours
  /** The same colours for a dark screen; a face that follows the guest's colour scheme uses them. */
  readonly colorsDark: SemanticColours
  readonly font: string
  readonly radius: number
  readonly shadow: number
  /** The venue logo, or null. */
  readonly logo: ViewImage | null
}

/** The whole view model of one menu for one context. */
export interface ViewModel {
  /** The interface language: the requested one if the menu has it, else the menu default. */
  readonly locale: Locale
  readonly currency: Currency
  readonly channel: Channel
  readonly menu: {
    readonly id: NodeId
    readonly title: ViewText | null
    readonly intro: ViewText | null
    /** Set while the whole menu is outside its schedule. */
    readonly schedule: ViewSchedule | null
  }
  readonly sections: readonly ViewSection[]
  /** R6: the allergens on this menu, numbered, in legend order. */
  readonly allergenLegend: readonly ViewAllergen[]
  /** For the guest filter chips: what is on the menu, in reading order. */
  readonly filters: {
    readonly tags: readonly ViewTag[]
    readonly dietary: readonly ViewDietary[]
  }
  /** R11: ordering is on for this venue, channel and table. */
  readonly ordering: { readonly enabled: boolean }
  readonly theme: ViewTheme
}

/** Ids a view model may hold, by kind. Used by the contract tests. */
export type ViewId = NodeId | AssetId | TagId
