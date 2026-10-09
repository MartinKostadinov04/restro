// The resolver's input context and output shape (brief S2-04; doc "Layers, ownership and
// resolution"). The output is the tier-3 resolved document: one value per field per node with
// its provenance, the computed fields, and the issues the composer and the publish gate read.

import type { Layer } from '../change-set'
import type { FieldValue } from '../field-types/catalog'
import type { NodeId } from '../ids'
import type { Locale } from '../locales'
import type { Money } from '../money'

/** What a resolution is for: one venue, its active editions, its languages and the time. */
export interface ResolveContext {
  /** The venue resolved for: its `venue:` rows beat `master` rows of the same layer. */
  readonly venueScope: `venue:${string}`
  /**
   * The active edition ids: a row in layer `edition:<id>` counts only when `<id>` is listed.
   * Omitted = every edition layer counts (edition layers can only hide or take off sale, so
   * applying all of them is the cautious reading); `[]` = none.
   */
  readonly edition?: readonly string[]
  /** The menu's enabled languages; the first is the default language (V3). */
  readonly locales: readonly Locale[]
  /** The resolution time (ISO 8601 with offset); only the `new` badge reads it. */
  readonly now: string
  /**
   * When each item was first published (ISO 8601), from the publisher's history. Without an
   * entry an item never gets the `new` badge: the document itself holds no publish dates.
   */
  readonly firstPublishedAt?: Readonly<Record<NodeId, string>>
}

/**
 * Who controls a resolved value, as the composer shows it: `barsy` (from barsy, read-only),
 * `owned` (set here, in the manual or import layer), `overridden` (our override of a barsy
 * value), `stale` (an override whose basis no longer matches barsy), `locked` (barsy-owned and
 * not changeable here: "Change this in barsy"), `none` (no layer holds a value).
 */
export type Provenance = 'barsy' | 'owned' | 'overridden' | 'stale' | 'locked' | 'none'

/** The layer a value came from, `default` for the field definition's default, or none. */
export type ResolvedLayer = Layer | 'default' | null

/** Provenance of one language of a `localized_text` field (each locale resolves on its own). */
export interface ResolvedLocale {
  readonly provenance: Provenance
  readonly layer: Exclude<ResolvedLayer, null>
}

/** One resolved field: its value (null = none), provenance and layer. */
export interface ResolvedField {
  readonly value: FieldValue | null
  readonly provenance: Provenance
  readonly layer: ResolvedLayer
  /** Set when layers disagree on a `must_agree` field (a person must choose). */
  readonly conflict?: true
  /**
   * `localized_text` only: provenance per language. The field's own `provenance` and `layer`
   * are those of the default language (or of the first language that has text).
   */
  readonly locales?: Readonly<Partial<Record<Locale, ResolvedLocale>>>
}

/** Fields of a node by key, in template order. Internal fields are never included. */
export type ResolvedFields = Readonly<Record<string, ResolvedField>>

/** What an issue blocks: the node (left out of the snapshot), nothing, or the whole publish. */
export type IssueSeverity = 'block_node' | 'warning' | 'block_menu'

/**
 * Issue codes: the doc's node and menu checks V3–V12 (V8 needs asset sizes and V11 the previous
 * resolution, so the resolver never emits them; see `compareVisibility`), plus:
 * - `stale_override`: an override's basis differs from barsy's current value (policy `review`);
 * - `link_missing` / `link_deleted`: the node's source link is missing or deleted (rule 6);
 * - `invalid_value`: a stored row is rejected or no longer valid for its definition; ignored;
 * - `ignored_value`: a row sits in a layer this field never reads (a manual price on a linked
 *   item, an edition value on a field editions may not change);
 * - `required_missing`: a required field has no value (V3, V4 and V6 have their own codes);
 * - `group_min_max`: a modifier group's minimum is above its maximum;
 * - `required_group_unsatisfiable`: a required modifier group has too few available options;
 * - `translation_review`: barsy's text changed after our translation of it (D24);
 * - `price_not_venue_scoped`: barsy's price for a linked item is not stored for this venue;
 * - `unplaced_item`: an otherwise visible item is in no section;
 * - `orphan_node`: a node whose parent is missing or cannot hold it;
 * - `missing_root`, `template_mismatch`, `venue_mismatch`, `invalid_context`, `no_locales`:
 *   the inputs do not fit together; the menu is blocked.
 */
export type IssueCode =
  | 'V3'
  | 'V4'
  | 'V5'
  | 'V6'
  | 'V7'
  | 'V8'
  | 'V9'
  | 'V10'
  | 'V11'
  | 'V12'
  | 'stale_override'
  | 'link_missing'
  | 'link_deleted'
  | 'invalid_value'
  | 'ignored_value'
  | 'required_missing'
  | 'group_min_max'
  | 'required_group_unsatisfiable'
  | 'translation_review'
  | 'price_not_venue_scoped'
  | 'unplaced_item'
  | 'orphan_node'
  | 'missing_root'
  | 'template_mismatch'
  | 'venue_mismatch'
  | 'invalid_context'
  | 'no_locales'

/** One finding of the resolver, for the composer's Data issues panel and the publish gate. */
export interface Issue {
  readonly code: IssueCode
  readonly severity: IssueSeverity
  readonly nodeId?: NodeId
  readonly fieldKey?: string
  readonly locale?: Locale
}

/** Fields the resolver computes and never stores (doc "Computed fields"). */
export interface ComputedItemFields {
  /**
   * Visible, linked to an active barsy article, priced by barsy for this venue, for sale per
   * barsy and every other layer, `order_mode` = `orderable`, and every required modifier group
   * satisfiable. The shell adds runtime context (ordering switched on, a table token).
   */
  readonly orderable: boolean
  /** Price plus the cheapest choice of every required modifier group, when that differs. */
  readonly priceFrom: Money | null
  /** `new` (first published under 14 days ago), then dietary labels and tags. */
  readonly badges: readonly string[]
}

/** A resolved item. */
export interface ResolvedItem {
  readonly id: NodeId
  readonly fields: ResolvedFields
  readonly computed: ComputedItemFields
  /** True if the item appears on the guest menu (see `resolve`). */
  readonly visible: boolean
  /** Its modifier groups (ordered by id: the document carries no order for them yet). */
  readonly modifierGroupIds: readonly NodeId[]
  readonly issues: readonly Issue[]
}

/** A resolved section: its fields, child sections and placed items in sort-key order. */
export interface ResolvedSection {
  readonly id: NodeId
  readonly fields: ResolvedFields
  readonly children: readonly ResolvedSection[]
  /** Every item placed here, visible or not, in placement sort-key order. */
  readonly itemIds: readonly NodeId[]
  /** True if the section appears on the guest menu (it and its parents shown, V9 passed). */
  readonly visible: boolean
  readonly issues: readonly Issue[]
}

/** A resolved modifier group of an item. */
export interface ResolvedModifierGroup {
  readonly id: NodeId
  readonly itemId: NodeId
  readonly fields: ResolvedFields
  /** True if `min` is at least 1: the guest must choose. */
  readonly required: boolean
  /** Its options (ordered by id: the document carries no order for them yet). */
  readonly optionIds: readonly NodeId[]
  readonly visible: boolean
  readonly issues: readonly Issue[]
}

/** A resolved option of a modifier group. */
export interface ResolvedOption {
  readonly id: NodeId
  readonly groupId: NodeId
  readonly fields: ResolvedFields
  readonly visible: boolean
  readonly issues: readonly Issue[]
}

/** The menu's root node. */
export interface ResolvedMenuRoot {
  readonly id: NodeId
  readonly fields: ResolvedFields
  readonly issues: readonly Issue[]
}

/** The resolved document of one menu for one venue and edition. */
export interface ResolvedMenu {
  readonly menuId: NodeId
  readonly venueScope: `venue:${string}`
  readonly menu: ResolvedMenuRoot
  /** Top-level sections (children of the menu), as a tree. */
  readonly sections: readonly ResolvedSection[]
  /** Every non-archived item of the document, placed or not. */
  readonly items: Readonly<Record<NodeId, ResolvedItem>>
  readonly modifierGroups: Readonly<Record<NodeId, ResolvedModifierGroup>>
  readonly options: Readonly<Record<NodeId, ResolvedOption>>
  /** Every issue: menu-level ones (no node) and those of every node, in a stable order. */
  readonly issues: readonly Issue[]
}
