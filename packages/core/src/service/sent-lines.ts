// One line of a sent order as stored (`sent_orders.lines`, #77), apart from Send so the guards
// (#78) and the sent order's moves read it without importing Send.

import { z } from 'zod'

import { idSchema } from '../ids'
import { ORDER_LIMITS } from '../table-order'

/** One line of a sent order as stored (`sent_orders.lines`): no note (it is kept apart). */
export const SentOrderLineSchema = z.strictObject({
  id: idSchema('ol'),
  itemId: idSchema('nd'),
  optionIds: z.array(idSchema('nd')).max(ORDER_LIMITS.options),
  qty: z.int().min(1).max(ORDER_LIMITS.quantity),
  /** The unit price: the item's plus its options' deltas, in minor units. */
  unitMinor: z.int().nonnegative(),
  /** The POS's name where the item came from one, else the menu's (for staff, never a guest). */
  name: z.string().max(200),
  optionNames: z.array(z.string().max(200)).max(ORDER_LIMITS.options),
  /** Set when the order ended Not sent because the POS says this item ran out (#80). */
  outOfStock: z.literal(true).optional(),
})

/** One stored line of a sent order. */
export type SentOrderLine = z.output<typeof SentOrderLineSchema>

/** The stored lines of a sent order, each checked; a line that fails is dropped. */
export function sentOrderLinesOf(stored: unknown): SentOrderLine[] {
  if (!Array.isArray(stored)) return []
  return stored.flatMap((entry) => {
    const parsed = SentOrderLineSchema.safeParse(entry)
    return parsed.success ? [parsed.data] : []
  })
}
