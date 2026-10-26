// Stock from the POS (D122 §4 Stock, D124 §6; ticket #80): what a stock pass writes, decided
// here without a database. Stock lives in the POS: on a POS venue nobody marks sold out in Restro.
// A pass that finds an item run out (the check of a Send's lines where the connector declares
// "item availability", or the POS's refusal that names the item) writes a sold-out mark in the
// POS layer (`for_sale = false`, layer `till`, the venue's scope), through apply(); a later
// complete reading that shows the item available clears that mark again. Pure.
//
// Rule 5 is the point: a plan only ever marks, or clears a mark a stock pass wrote. It never
// writes `true` and never clears the POS's own flag (a menu reading's `for_sale`), so clearing
// can only reveal what the POS itself last said. Rule 6: an incomplete reading concludes nothing,
// and an item a complete reading does not name is left as it was (absence is not "available").

/** The POS layer's `for_sale` of one item at the venue's scope, as a stock pass finds it. */
export interface StockSlot {
  /** The stored value, or null when the POS layer holds none there. */
  readonly value: boolean | null
  /** True when the stored value is a stock pass's own mark (its source record says so). */
  readonly ours: boolean
}

/** One item, by our id, as a reading of the POS saw it. */
export interface StockObservation {
  readonly itemId: string
  readonly available: boolean
}

/** What a stock pass read: complete, with the items it names, or incomplete (concludes nothing). */
export type StockReading =
  | { readonly complete: true; readonly items: readonly StockObservation[] }
  | { readonly complete: false }

/** What a stock pass writes: items to mark sold out, and our marks to clear. */
export interface StockPlan {
  readonly mark: readonly string[]
  readonly clear: readonly string[]
}

/**
 * The plan for a reading. `current` holds the items linked to the POS; an item it lacks is
 * skipped (a POS-layer value needs a link). An item named twice takes the cautious answer.
 */
export function planStock(
  current: ReadonlyMap<string, StockSlot>,
  reading: StockReading,
): StockPlan {
  if (!reading.complete) return { mark: [], clear: [] }
  const available = new Map<string, boolean>()
  for (const item of reading.items) {
    available.set(item.itemId, (available.get(item.itemId) ?? true) && item.available)
  }
  const mark: string[] = []
  const clear: string[] = []
  for (const [itemId, isAvailable] of [...available].sort(([a], [b]) => (a < b ? -1 : 1))) {
    const slot = current.get(itemId)
    if (slot === undefined) continue
    if (!isAvailable && slot.value !== false) mark.push(itemId)
    if (isAvailable && slot.value === false && slot.ours) clear.push(itemId)
  }
  return { mark, clear }
}

/**
 * The marks that lapse with their service day: a mark is a fact about one night, and a POS that
 * no reading asks again (it declares no item availability) would otherwise keep it for good.
 * The next night starts from what the POS itself says, and a run-out item it refuses again is
 * marked again. A mark whose day can't be read lapses too.
 */
export function lapsedStockMarks(
  marks: readonly { readonly itemId: string; readonly serviceDate: string | null }[],
  today: string,
): string[] {
  return marks
    .filter((mark) => mark.serviceDate === null || mark.serviceDate < today)
    .map((mark) => mark.itemId)
}
