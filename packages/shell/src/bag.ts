// The guest's bag: a draft of an order, kept by the face until the host accepts it (D72). Pure
// logic with no React, so every face has the same bag and the same estimate.
//
// A bag line keeps no name and no price, only what the guest chose: the item, the options, how
// many and a note. Names and prices are looked up in the current view model whenever the bag is
// drawn, so a price change or a sold-out item shows at once. A line whose item or option has left
// the view, or whose item no longer has ordering controls (R11), is flagged unavailable, and
// sending stays blocked until the guest removes it.
//
// The estimate is the one sum the shell does: the unit price plus the chosen options' deltas,
// times the quantity, added up with core's money module (rule 8). It is an estimate, labelled as
// one until the host's quote exists: totals, tips, VAT and splits come from the platform.
//
// `ViewPrice.minor` is the item's `price_from` (the cheapest way to order it) when `from` is set,
// and that price already holds the cheapest choice of every required group. The unit price below
// takes the cheapest choices out again before it adds the chosen ones, so a "from" item is not
// counted twice.

import { addMinor, MoneyError, multiplyMinor, type NodeId, subtractMinor } from '@restro/core'

import { viewMinor } from './money'
import { type OrderLine, SERVICE_LIMITS } from './services'
import type {
  ViewItem,
  ViewModel,
  ViewModifierGroup,
  ViewMoney,
  ViewOption,
  ViewSection,
} from './view-model'

/* ---------------------------------------------------------------------------------------------
 * The bag
 * ------------------------------------------------------------------------------------------- */

/** One line of the bag: what the guest chose, with no name and no price. */
export interface BagLine {
  /** What makes the line the same line: the item, its options and its note. */
  readonly key: string
  readonly itemId: NodeId
  readonly qty: number
  /** The chosen options, in a fixed order. */
  readonly optionIds: readonly NodeId[]
  readonly note: string
}

/** A line before it has a key. */
export type BagDraft = Omit<BagLine, 'key'>

/** What can happen to the bag. */
export type BagAction =
  | { readonly type: 'add'; readonly line: BagDraft }
  | { readonly type: 'qty'; readonly key: string; readonly delta: number }
  | { readonly type: 'remove'; readonly key: string }
  | { readonly type: 'replace'; readonly key: string; readonly line: BagDraft }
  /** The host accepted these lines: they leave the bag, and whatever the guest added meanwhile stays. */
  | { readonly type: 'spend'; readonly lines: readonly BagLine[] }
  | { readonly type: 'clear' }

/** The key of a line: the same item with the same options and note is the same line. */
export function lineKey(line: BagDraft): string {
  return `${line.itemId}|${[...line.optionIds].sort().join(',')}|${line.note.trim()}`
}

const clampQty = (qty: number): number =>
  Number.isFinite(qty) ? Math.min(Math.max(Math.trunc(qty), 1), SERVICE_LIMITS.quantity) : 1

/** A draft in its settled form: options in order and without repeats, the note trimmed and cut, a quantity in range. */
function settle(draft: BagDraft): BagLine {
  const optionIds = [...new Set(draft.optionIds)].sort()
  const note = draft.note.trim().slice(0, SERVICE_LIMITS.note)
  const settled = { itemId: draft.itemId, qty: clampQty(draft.qty), optionIds, note }
  return { ...settled, key: lineKey(settled) }
}

/** The bag after an action. A line is never more than 50 of an item, and the bag never more than 50 lines. */
export function bagReducer(bag: readonly BagLine[], action: BagAction): readonly BagLine[] {
  switch (action.type) {
    case 'add': {
      const line = settle(action.line)
      const hit = bag.find((existing) => existing.key === line.key)
      if (hit !== undefined) {
        const qty = Math.min(hit.qty + line.qty, SERVICE_LIMITS.quantity)
        return bag.map((existing) => (existing.key === line.key ? { ...existing, qty } : existing))
      }
      return bag.length >= SERVICE_LIMITS.lines ? bag : [...bag, line]
    }
    case 'qty':
      return bag.flatMap((line) => {
        if (line.key !== action.key) return [line]
        const qty = Math.min(line.qty + action.delta, SERVICE_LIMITS.quantity)
        return qty <= 0 ? [] : [{ ...line, qty }]
      })
    case 'remove':
      return bag.filter((line) => line.key !== action.key)
    case 'replace': {
      const next = settle(action.line)
      if (!bag.some((line) => line.key === action.key))
        return bagReducer(bag, { type: 'add', line: next })
      const twin = bag.find((line) => line.key === next.key && line.key !== action.key)
      if (twin === undefined) return bag.map((line) => (line.key === action.key ? next : line))
      // The edited line now equals another line: the two become one, at the other line's place.
      const qty = Math.min(twin.qty + next.qty, SERVICE_LIMITS.quantity)
      return bag
        .filter((line) => line.key !== action.key)
        .map((line) => (line.key === twin.key ? { ...line, qty } : line))
    }
    case 'spend':
      return bag.flatMap((line) => {
        const spent = action.lines.find((sent) => sent.key === line.key)
        if (spent === undefined) return [line]
        const qty = line.qty - spent.qty
        return qty <= 0 ? [] : [{ ...line, qty }]
      })
    case 'clear':
      return []
  }
}

/** The bag as the lines of an `order.send` command: our ids, quantities and notes, no price. */
export function orderLines(bag: readonly BagLine[]): OrderLine[] {
  return bag.map((line) => ({
    itemId: line.itemId,
    optionIds: [...line.optionIds],
    qty: line.qty,
    note: line.note,
  }))
}

/* ---------------------------------------------------------------------------------------------
 * Choices on the dish page
 * ------------------------------------------------------------------------------------------- */

/** The options picked in each group of an item: group id → option ids. */
export type Selection = Readonly<Record<string, readonly string[]>>

/** Whether the picks in a group satisfy it: at least its minimum (one for a required group), at most its maximum (0 = no limit). */
export function groupValid(group: ViewModifierGroup, picked: readonly string[] = []): boolean {
  const min = group.required ? Math.max(1, group.min) : group.min
  return picked.length >= min && (group.max <= 0 || picked.length <= group.max)
}

/** Whether every group of the item is satisfied. */
export function selectionValid(
  groups: readonly ViewModifierGroup[],
  selection: Selection,
): boolean {
  return groups.every((group) => groupValid(group, selection[group.id]))
}

/** The picks of a group after the guest taps an option: off if on; replaces the pick in a pick-one group; ignored at the maximum. */
export function toggleOption(
  group: ViewModifierGroup,
  picked: readonly string[] = [],
  optionId: string,
): readonly string[] {
  if (picked.includes(optionId)) return picked.filter((id) => id !== optionId)
  if (group.max === 1) return [optionId]
  if (group.max > 0 && picked.length >= group.max) return picked
  return [...picked, optionId]
}

/** Whether the guest must choose before the item can go in the bag (a required group). */
export function needsChoices(item: ViewItem): boolean {
  return item.modifierGroups.some((group) => group.required || group.min > 0)
}

/** The picked options as ids, in the order of the item's groups. */
export function selectedOptionIds(
  groups: readonly ViewModifierGroup[],
  selection: Selection,
): NodeId[] {
  return groups.flatMap((group) =>
    group.options.filter((option) => selection[group.id]?.includes(option.id)).map((o) => o.id),
  )
}

/** The picks that make up a bag line's options (to edit a line). Options the item no longer has are left out. */
export function selectionOf(
  groups: readonly ViewModifierGroup[],
  optionIds: readonly string[],
): Selection {
  const selection: Record<string, string[]> = {}
  for (const group of groups) {
    const picked = group.options.filter((option) => optionIds.includes(option.id))
    if (picked.length > 0) selection[group.id] = picked.map((option) => option.id)
  }
  return selection
}

/* ---------------------------------------------------------------------------------------------
 * The estimate
 * ------------------------------------------------------------------------------------------- */

/** One bag line with what the current view says about it. */
export interface ResolvedBagLine {
  readonly line: BagLine
  /** The item as the view has it now, or null when it left the view. */
  readonly item: ViewItem | null
  /** The chosen options as the view has them now, in the order of the item's groups. */
  readonly options: readonly ViewOption[]
  /** The price of one: the item's price plus the options' deltas; null when unavailable. */
  readonly unit: ViewMoney | null
  /** The price of the line: `unit` times the quantity; null when unavailable. */
  readonly total: ViewMoney | null
  /** False when the item or an option left the view, or the item no longer has ordering controls (R11). */
  readonly available: boolean
}

/** The bag as drawn: its lines with names and prices from the current view, and the estimate. */
export interface ResolvedBag {
  readonly lines: readonly ResolvedBagLine[]
  /** How many things are in the bag (the quantities added up). */
  readonly count: number
  /** The estimate: the lines that can still be ordered, added up. */
  readonly total: ViewMoney
  /** The bag has lines and every one can still be ordered. */
  readonly canSend: boolean
}

/** Every placement of an item in the view, by id; where an item is placed twice, one with ordering controls wins. */
function itemIndex(
  sections: readonly ViewSection[],
  found = new Map<string, ViewItem>(),
): Map<string, ViewItem> {
  for (const section of sections) {
    for (const item of section.items) {
      const known = found.get(item.id)
      if (known === undefined || (!known.order.controls && item.order.controls)) {
        found.set(item.id, item)
      }
    }
    itemIndex(section.sections, found)
  }
  return found
}

/** What the cheapest valid choice in one required group adds, as core's `price_from` counts it. */
function cheapestInGroup(group: ViewModifierGroup): number {
  const deltas = group.options.map((option) => option.delta?.minor ?? 0).sort((a, b) => a - b)
  return deltas.slice(0, group.min).reduce((sum, delta) => addMinor(sum, delta), 0)
}

/**
 * The price of one of the item with the chosen options, in minor units, or null for an item with
 * no price. A "from" price already holds the cheapest choice of every required group; a group
 * the guest has picked from swaps that cheapest choice for the picks, and a group still to be
 * picked keeps it. So a half-chosen dish reads "from …" and moves as the guest chooses, and a
 * complete choice is the price plus the deltas.
 */
function unitMinor(item: ViewItem, options: readonly ViewOption[]): number | null {
  if (item.price === null) return null
  let base = item.price.minor
  if (item.price.from) {
    for (const group of item.modifierGroups) {
      const picked = group.options.some((option) => options.some((o) => o.id === option.id))
      if (group.min > 0 && picked) base = subtractMinor(base, cheapestInGroup(group))
    }
  }
  return options.reduce((sum, option) => addMinor(sum, option.delta?.minor ?? 0), base)
}

/** The options of the item that these ids name, in the order of its groups. */
function offeredOptions(item: ViewItem, optionIds: readonly string[]): ViewOption[] {
  return item.modifierGroups
    .flatMap((group) => group.options)
    .filter((option) => optionIds.includes(option.id))
}

/**
 * What a draft line of `qty` of the item with these options costs, whether or not the choices
 * are complete: for the dish page, which shows the price while the guest is still choosing.
 * Null for an item with no price, a choice the item does not offer or a quantity out of range.
 */
export function draftPrice(
  view: ViewModel,
  item: ViewItem,
  optionIds: readonly string[],
  qty: number,
): ViewMoney | null {
  const options = offeredOptions(item, optionIds)
  if (options.length !== new Set(optionIds).size) return null
  try {
    const unit = unitMinor(item, options)
    if (unit === null) return null
    return viewMinor(multiplyMinor(unit, qty), view.currency, view.locale)
  } catch (error) {
    if (error instanceof MoneyError) return null
    throw error
  }
}

function resolveLine(
  view: ViewModel,
  items: ReadonlyMap<string, ViewItem>,
  line: BagLine,
): ResolvedBagLine {
  const gone: ResolvedBagLine = {
    line,
    item: null,
    options: [],
    unit: null,
    total: null,
    available: false,
  }
  const item = items.get(line.itemId)
  if (item === undefined) return gone
  const options = offeredOptions(item, line.optionIds)
  const flagged: ResolvedBagLine = { ...gone, item, options }
  if (!item.order.controls || options.length !== line.optionIds.length) return flagged
  if (!selectionValid(item.modifierGroups, selectionOf(item.modifierGroups, line.optionIds))) {
    return flagged
  }
  try {
    const unit = unitMinor(item, options)
    if (unit === null) return flagged
    return {
      line,
      item,
      options,
      unit: viewMinor(unit, view.currency, view.locale),
      total: viewMinor(multiplyMinor(unit, line.qty), view.currency, view.locale),
      available: true,
    }
  } catch (error) {
    if (error instanceof MoneyError) return flagged
    throw error
  }
}

/** Looks every line of the bag up in the view and adds the estimate up. */
export function resolveBag(view: ViewModel, bag: readonly BagLine[]): ResolvedBag {
  const items = itemIndex(view.sections)
  const lines = bag.map((line) => resolveLine(view, items, line))
  let count = 0
  let total = 0
  for (const resolved of lines) {
    count += resolved.line.qty
    if (resolved.total !== null) total = addMinor(total, resolved.total.minor)
  }
  return {
    lines,
    count,
    total: viewMinor(total, view.currency, view.locale),
    canSend: lines.length > 0 && lines.every((resolved) => resolved.available),
  }
}

/**
 * The bag estimate: how many things are in the bag and what they come to, from the current
 * prices. A line that can no longer be ordered adds to the count but not to the total. Label it
 * as an estimate until the host's quote exists.
 */
export function bagEstimate(
  view: ViewModel,
  bag: readonly BagLine[],
): { readonly count: number; readonly total: ViewMoney } {
  const { count, total } = resolveBag(view, bag)
  return { count, total }
}
