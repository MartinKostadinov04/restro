// The Log entry of a "sold out tonight" mark made during service (D147, #437). The mark itself is
// a menu change and goes through apply() (`apply/sold-out.ts`, rule 1); this command is the one
// that says who may make it and writes the night's line, so the club can read at 03:00 who marked
// the Jaegermeister gone and when.
//
// Whoever reviews sent orders may mark (`sold_out`, a Staff permission since D147): at 01:00 that
// is the bartender holding the empty bottle, not a manager.
//
// It is NOT a quick answer on a shared device, unlike the answers to an Unconfirmed order. Every
// other quick answer writes service data; this one writes the menu, and RR-83 (D122 Section 7)
// holds the tablet back from a menu change until somebody types their PIN. The PIN is also what
// makes the entry worth reading: the night’s line then names the bartender, not the tablet, which
// is what D147’s 01:00 scene asks of it.
//
// The entry names our own item id and nothing else: no POS id (rule 3), no free text, and not the
// item's name either, which the Log has no field for. Taking a mark off is the same command with
// `soldOut: false` and lands as its own entry, so an item marked and put back twice reads as four
// lines, in order.

import { z } from 'zod'

import { MAX_SOLD_OUT_ITEMS } from '../apply/sold-out'
import { idSchema } from '../ids'
import { defineCommand, type ServiceTx } from './definition'
import { accepted, type ServiceResult } from './results'

const MarkSchema = z.strictObject({
  type: z.literal('sold_out.mark'),
  /** Our own item ids, as the screen knows them; the same bound apply() takes. */
  itemIds: z.array(idSchema('nd')).min(1).max(MAX_SOLD_OUT_ITEMS),
  /** True for a mark, false for an item put back on sale. */
  soldOut: z.boolean(),
})

/** The `sold_out.mark` command, as its schema parses it. */
export type SoldOutMark = z.output<typeof MarkSchema>

/** Writes one Log entry per item: the night's record of who marked what. */
async function recordSoldOutMark(stx: ServiceTx, command: SoldOutMark): Promise<ServiceResult> {
  const itemIds = [...new Set(command.itemIds)].sort()
  for (const itemId of itemIds) {
    await stx.log({
      kind: command.soldOut ? 'sold_out.marked' : 'sold_out.cleared',
      details: { itemId },
    })
  }
  return accepted(null, { details: { items: itemIds.length, soldOut: command.soldOut } })
}

/** `sold_out.mark` (D147, #437): the Log entry of a mark made where orders are reviewed. */
export function soldOutMark() {
  return defineCommand({
    schema: MarkSchema,
    origins: ['staff'],
    permission: 'sold_out',
    // Repeating it says the same thing again: the mark is a state, not a count.
    idempotency: 'by_nature',
    handle: recordSoldOutMark,
  })
}
