// What the item sheet's server code hands to its client component (brief S2-06b). Plain data
// only (it crosses the server/client boundary as JSON): field definitions, resolved values with
// their provenance, issues, the translation grid, the image with a short-lived URL. No external ids,
// no storage keys, no internal names beyond the template's own `internal_note` field (rule 3).
import type { FieldDefinition, Locale, LocalizedText, PaymentMode } from '@restro/core'

/**
 * Where the item sheet's actions look: the venue (its live menu), or the venue and the menu the
 * composer has open (brief S6).
 */
export type SheetTarget = string | { readonly venueId: string; readonly menuId: string }

/** Who controls a value as the sheet shows it (the resolver's `Provenance`). */
export type SheetProvenance = 'till' | 'owned' | 'overridden' | 'stale' | 'locked' | 'none'

/** Why a field has no edit button. */
export type ReadOnlyReason =
  /** The till owns it and it cannot be changed here (the price of a linked item): change it there. */
  | 'locked_to_till'
  /** The till hides or takes off sale; our layers can only make the menu more cautious (rule 5). */
  | 'till_decides'
  /** Shown or hidden from the composer's list, not from here. */
  | 'composer_toggle'
  /** Sold out tonight is marked with the control at the top of this tab (S3-08, D46). */
  | 'sold_out_control'

/** How a field is edited from the sheet. */
export type FieldAccess =
  /** With the field editor sheet, saved through `apply()`. */
  | { readonly kind: 'edit' }
  /** On the Media tab (the image field). */
  | { readonly kind: 'media' }
  | { readonly kind: 'readonly'; readonly reason: ReadOnlyReason }

/** One field of the item as the Details tab shows it, in template order. */
export interface SheetField {
  readonly key: string
  readonly definition: FieldDefinition
  /** The resolved value; null = none. */
  readonly value: unknown | null
  readonly provenance: SheetProvenance
  /** The layer the value came from, or `default`, or null. */
  readonly layer: string | null
  /** Layers disagree on a `must_agree` field: a person must choose. */
  readonly conflict: boolean
  /** `localized_text` only: provenance per language, when it is known. */
  readonly localeProvenance?: Readonly<Partial<Record<Locale, SheetProvenance>>>
  readonly access: FieldAccess
  /** True if our override can be removed (the value is ours over the till's). */
  readonly canRevert: boolean
  /** True if a stale override can be kept: the till still holds a value to record as its basis. */
  readonly canKeep: boolean
  /** The till's current value, shown beside an override; null when the till holds none. */
  readonly tillValue: unknown | null
}

/** A finding of the resolver about this item (the sheet turns the code into a sentence). */
export interface SheetIssue {
  readonly code: string
  readonly severity: 'block_node' | 'warning' | 'block_menu'
  readonly fieldKey?: string
  readonly locale?: Locale
}

/** One language of one localized field in the Translations grid. */
export interface TranslationCell {
  /** The text that shows today (the till's, an override's or ours); null = none. */
  readonly text: string | null
  readonly provenance: SheetProvenance
  /** Our own text for this language (the manual layer); null = none. This is what the cell edits. */
  readonly ourText: string | null
  /** False where the till holds this language of a till-owned field: it is read-only there. */
  readonly editable: boolean
  /** No text in this language at all (the V7 gap). */
  readonly missing: boolean
  /** The till's text changed after our translation was written (D24); our text stays live. */
  readonly review: boolean
}

/** The localized fields of the item, each across the venue's languages. */
export interface TranslationRow {
  readonly fieldKey: string
  readonly definition: FieldDefinition
  readonly cells: Readonly<Partial<Record<Locale, TranslationCell>>>
}

/** The item's picture, with a link for the admin's browser (never stored in a field value). */
export interface SheetImage {
  readonly assetId: string
  /** Presigned or signed for an hour; null when the stored file could not be linked. */
  readonly url: string | null
  readonly width: number | null
  readonly height: number | null
  readonly contentType: string | null
  readonly alt: LocalizedText
  readonly focal: { readonly x: number; readonly y: number } | null
  readonly provenance: SheetProvenance
  /** True if our own (manual) image is set, so "Remove" shows what is under it. */
  readonly canRemove: boolean
}

/** Where the item stands on sale (brief S3-08, D46), for the control on the Details tab. */
export interface SheetSale {
  /**
   * A manager marked it sold out tonight and nothing else takes it off sale. The mark lapses by
   * itself when the service day ends.
   */
  readonly soldOutTonight: boolean
  /**
   * Off sale for another reason: `till` (the till's own flag) or `other` (another layer). Ours can
   * only add caution (rule 5), so there is no "Back on sale" for it.
   */
  readonly offSale: 'till' | 'other' | null
  /** The person may mark and unmark (owner or admin). */
  readonly canMark: boolean
}

/** Everything the item sheet needs to draw its four tabs. */
export interface ItemSheetData {
  readonly itemId: string
  readonly venueId: string
  /** The item's name in the venue's default language (or any language there is). */
  readonly title: string
  /** The item has a till link (source `till:<integration>`), in any state. */
  readonly linkedToTill: boolean
  /** The name of the item's till (`{source}` in "From {source}"); '' for a hand-made item. */
  readonly tillLabel: string
  readonly linkState: 'none' | 'active' | 'missing' | 'deleted'
  /** Goes up with each saved change: a key for things that must reload after one. */
  readonly revision: number
  readonly defaultLocale: Locale
  readonly enabledLocales: readonly Locale[]
  readonly currency: string
  readonly timezone: string
  /** The item shows on the guest menu (placed, shown, no blocking issue). */
  readonly visible: boolean
  /** Sold out tonight, or off sale (S3-08). */
  readonly sale: SheetSale
  /** The name shown is the till's own, because the till has no public one (D75). Warns only. */
  readonly nameFromTill: boolean
  /**
   * The venue's item default, shown beside "Same as the venue" (#218). Null where pay first can't
   * take effect (D122 §8): the Payment mode row is then not on the sheet at all.
   */
  readonly payFirstDefault: PaymentMode | null
  readonly fields: readonly SheetField[]
  readonly issues: readonly SheetIssue[]
  readonly translations: readonly TranslationRow[]
  readonly image: SheetImage | null
}

/** Whom an event is attributed to. */
export interface HistoryActor {
  readonly kind: 'user' | 'integration' | 'system'
  /** The person's name for a user, when it is known. */
  readonly name: string | null
}

/** One line of the History tab. */
export interface HistoryEntry {
  readonly seq: number
  /** ISO 8601 instant. */
  readonly at: string
  readonly fieldKey: string
  /** The field's definition when the template still has it; null for anything else. */
  readonly definition: FieldDefinition | null
  readonly layer: string
  readonly scope: string
  /** The value before; null = there was none. */
  readonly oldValue: unknown | null
  /** The value after; null = removed. */
  readonly newValue: unknown | null
  /** `structure` = a structural event (node, placement, status, link); see `op`. */
  readonly kind: 'set' | 'changed' | 'cleared' | 'structure'
  /** The event's op (`setField`, `clearField`, `createNode`, `setPlacement`, …). */
  readonly op: string
  readonly actor: HistoryActor
  /** `manual` or `till:<integration>`. */
  readonly source: string
}

/** A page of history, newest first. */
export interface HistoryPage {
  readonly entries: readonly HistoryEntry[]
  /** Pass as `before` to get the next (older) page; null when this is the last. */
  readonly nextBefore: number | null
}

/** Why a save was not done; the sheet turns it into a sentence. */
export type SheetErrorCode =
  | 'not_found'
  | 'read_only'
  | 'locked'
  | 'nothing_to_revert'
  | 'no_basis'
  | 'invalid_value'
  | 'asset_not_found'
  /** Marking sold out is for owners and admins. */
  | 'not_allowed'
  /** `apply()` refused the write (its own code is in `detail`). */
  | 'refused'
  | 'failed'

/** The result of a save: the refreshed sheet, or the reason nothing changed. */
export type SheetResult =
  | { readonly ok: true; readonly data: ItemSheetData }
  | { readonly ok: false; readonly error: SheetErrorCode; readonly detail?: string }
