// Where a dropped item or section goes: fractional sort keys between the neighbours, so a move
// writes one row (D47). Pure; the client computes the keys, `apply()` stores them as given.

import { sortKeyBetween, sortKeysBetween } from '@restro/core'

/** An id and its sort key among its siblings. */
export interface KeyedId<Id extends string = string> {
  readonly id: Id
  readonly key: string
}

/**
 * The keys to write so that `movedId` sits at `index` among `others` (the siblings without it,
 * in order). Normally one entry: a key strictly between its two neighbours. If the neighbours'
 * keys are equal or out of order (two clients picked the same key, or old data), nothing can go
 * between them, so the whole list gets fresh, evenly spread keys: the moved id and every other
 * one, in the new order.
 */
export function planKeys<Id extends string>(
  others: readonly KeyedId<Id>[],
  movedId: Id,
  index: number,
): KeyedId<Id>[] {
  const at = Math.max(0, Math.min(index, others.length))
  const before = others[at - 1]?.key ?? null
  const after = others[at]?.key ?? null
  if (before === null || after === null || before < after) {
    return [{ id: movedId, key: sortKeyBetween(before, after) }]
  }
  const order = [
    ...others.slice(0, at).map((x) => x.id),
    movedId,
    ...others.slice(at).map((x) => x.id),
  ]
  const keys = sortKeysBetween(null, null, order.length)
  return order.map((id, position) => ({ id, key: keys[position] ?? '' }))
}

/** The key that puts something after the last of `others` (the first key for an empty list). */
export function keyAtEnd(others: readonly KeyedId[]): string {
  let last: string | null = null
  for (const { key } of others) if (last === null || key > last) last = key
  return sortKeyBetween(last, null)
}
