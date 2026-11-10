// Why a spot is taken out of use (#327; D137: blocking asks for a reason). A **code**, never free
// text: the reason is stored on the block's reservation row, which allows a code only, and the
// screen words it in the person's own language — so a reason typed in Bulgarian at one club is
// still readable in English on the same night's Log.
//
// The list is the browser's, as `statuses.ts` is: core puts no rule on a reason beyond its shape,
// and the screen offers these four and "other" as a segmented pick (two to five word options, the
// operational-screens pattern).

/** The reasons the Block dialog offers, in the order it shows them. */
export const BLOCK_REASONS = ['repair', 'private_event', 'cleaning', 'broken', 'other'] as const

/** One block reason. */
export type BlockReason = (typeof BLOCK_REASONS)[number]

/** True for a reason the list holds, so a stored code we no longer offer is worded as itself. */
export function isBlockReason(value: unknown): value is BlockReason {
  return typeof value === 'string' && (BLOCK_REASONS as readonly string[]).includes(value)
}
