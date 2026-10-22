// The ring of the last 64 action ids on the table's order row (D121 2.4; design §2.4): a repeat of
// an edit of the order gets the first answer and is never applied twice. Each entry keeps the
// answer and the order's version it produced. The ring is emptied with the order when the sitting
// ends.
//
// Pure: no I/O. The engine reads and writes the column under the order row's lock.

import { z } from 'zod'

import { type ServiceResult, ServiceResultSchema } from './results'

/** How many action ids the ring keeps; the database checks the same bound. */
export const ACTION_RING_SIZE = 64

/** One remembered action. */
export const RingEntrySchema = z.strictObject({
  actionId: z.uuid(),
  result: ServiceResultSchema,
  /** The order's version after the action. */
  version: z.number().int().nonnegative(),
})

/** One remembered action. */
export type RingEntry = z.infer<typeof RingEntrySchema>

/** The ring's entries as stored, oldest first; an entry that fails its schema is skipped. */
export function readRing(stored: unknown): RingEntry[] {
  if (!Array.isArray(stored)) return []
  return stored.flatMap((entry) => {
    const parsed = RingEntrySchema.safeParse(entry)
    return parsed.success ? [parsed.data] : []
  })
}

/** The first answer to `actionId`, or null when the ring doesn't remember it. */
export function findInRing(stored: unknown, actionId: string): ServiceResult | null {
  return readRing(stored).find((entry) => entry.actionId === actionId)?.result ?? null
}

/** The ring with `entry` added last, the oldest entries dropped past 64. */
export function pushToRing(stored: unknown, entry: RingEntry): RingEntry[] {
  const kept = readRing(stored).filter((old) => old.actionId !== entry.actionId)
  return [...kept, entry].slice(-ACTION_RING_SIZE)
}
