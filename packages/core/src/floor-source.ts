// Which part of a POS instance's floor a venue serves (spec #64 Implementation Decisions 10 and the
// connector-fitness verification, round-2 row 11): two venues may share one POS installation (a
// club and its restaurant on one login), and each picks its halls or its bars out of it. The pick
// is `venues.settings.floor_source`, Zod-checked, written only by `setFloorSource` (core/apply).
// A venue that never saved one serves the whole floor.
//
// A table belongs to the venue when it is in one of the picked halls or served by one of the
// picked bars (a union), or when nothing is picked at all. Halls are named by the POS's own name
// for them, since that is all a hall is; bars by the key the POS reports (backend only, rule 3:
// `venues.settings` never reaches a snapshot or a guest). `paymentTables` lists tables, by their
// POS name, to mark as payment tables when they first appear (D122 §8: marked once, by the
// venue's setup; a manager's later mark stays, and a POS that marks its own is always followed).
//
// Pure data and pure functions: no I/O, safe in the browser.

import { z } from 'zod'

const PickSchema = z.array(z.string().min(1).max(200)).min(1).max(200)

/** `venues.settings.floor_source` as stored. */
export const FloorSourceSchema = z.strictObject({
  /** The halls this venue serves, by the POS's name; null: not picked by hall. */
  halls: PickSchema.nullable(),
  /** The bars this venue serves, by the POS's key; null: not picked by bar. */
  bars: PickSchema.nullable(),
  /** Tables to mark as payment tables when they first appear, by the POS's table name. */
  paymentTables: z.array(z.string().min(1).max(200)).max(200),
})

/** A venue's pick of a POS floor. */
export type FloorSource = z.infer<typeof FloorSourceSchema>

/** What applies until a venue saves its own: the whole floor, no payment table named. */
export const WHOLE_FLOOR: FloorSource = { halls: null, bars: null, paymentTables: [] }

/** The venue's floor source from `venues.settings`, the whole floor where none is saved. */
export function readFloorSource(settings: Readonly<Record<string, unknown>>): FloorSource {
  const parsed = FloorSourceSchema.safeParse(settings.floor_source)
  return parsed.success ? parsed.data : WHOLE_FLOOR
}

/** What the source needs to know about one table of the floor. */
export interface FloorSourceTable {
  /** The table's hall as the POS names it, or null. */
  readonly area: string | null
  /** The key of the bar that serves it, or null where the POS has none or can't say. */
  readonly bar: string | null
}

/** True when the venue serves this table: no pick, or its hall or its bar is picked. */
export function inFloorSource(source: FloorSource, table: FloorSourceTable): boolean {
  if (source.halls === null && source.bars === null) return true
  if (source.halls !== null && table.area !== null && source.halls.includes(table.area)) return true
  return source.bars !== null && table.bar !== null && source.bars.includes(table.bar)
}
