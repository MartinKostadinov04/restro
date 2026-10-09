// What the item sheet's server code hands to its client component (brief S2-06b). Plain data
// only (it crosses the server/client boundary as JSON): field definitions, resolved values with
// their provenance, issues, the translation grid, the image with a short-lived URL. No barsy ids,
// no storage keys, no internal names beyond the template's own `internal_note` field (rule 3).
import type { FieldDefinition, Locale, LocalizedText } from '@restro/core'

/** Who controls a value as the sheet shows it (the resolver's `Provenance`). */
export type SheetProvenance = 'barsy' | 'owned' | 'overridden' | 'stale' | 'locked' | 'none'

/** Why a field has no edit button. */
export type ReadOnlyReason =
  /** Barsy owns it and it cannot be changed here (the price of a linked item): change it in barsy. */
  | 'locked_to_barsy'
  /** Barsy hides or takes off sale; our layers can only make the menu more cautious (rule 5). */
  | 'barsy_decides'
  /** Shown or hidden from the composer's list, not from here. */
  | 'composer_toggle'
  /** Sold-out marking arrives in Stage 3 (D55). */
  | 'sold_out_later'

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
  /** True if our override can be removed (the value is ours over barsy's). */
  readonly canRevert: boolean
  /** True if a stale override can be kept: barsy still holds a value to record as its basis. */
  readonly canKeep: boolean
  /** Barsy's current value, shown beside an override; null when barsy holds none. */
  readonly barsyValue: unknown | null
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
  /** The text that shows today (barsy's, an override's or ours); null = none. */
  readonly text: string | null
  readonly provenance: SheetProvenance
  /** Our own text for this language (the manual layer); null = none. This is what the cell edits. */
  readonly ourText: string | null
  /** False where barsy holds this language of a barsy-owned field: it is read-only there. */
  readonly editable: boolean
  /** No text in this language at all (the V7 gap). */
  readonly missing: boolean
  /** Barsy's text changed after our translation was written (D24); our text stays live. */
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

/** Everything the item sheet needs to draw its four tabs. */
export interface ItemSheetData {
  readonly itemId: string
  readonly venueId: string
  /** The item's name in the venue's default language (or any language there is). */
  readonly title: string
  /** The item has a barsy source link, in any state. */
  readonly linkedToBarsy: boolean
  readonly linkState: 'none' | 'active' | 'missing' | 'deleted'
  /** Goes up with each saved change: a key for things that must reload after one. */
  readonly revision: number
  readonly defaultLocale: Locale
  readonly enabledLocales: readonly Locale[]
  readonly currency: string
  readonly timezone: string
  /** The item shows on the guest menu (placed, shown, no blocking issue). */
  readonly visible: boolean
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
  readonly kind: 'set' | 'changed' | 'cleared'
  readonly actor: HistoryActor
  /** `manual`, `barsy:<integration>`, `import:<profile>`. */
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
  /** `apply()` refused the write (its own code is in `detail`). */
  | 'refused'
  | 'failed'

/** The result of a save: the refreshed sheet, or the reason nothing changed. */
export type SheetResult =
  | { readonly ok: true; readonly data: ItemSheetData }
  | { readonly ok: false; readonly error: SheetErrorCode; readonly detail?: string }
