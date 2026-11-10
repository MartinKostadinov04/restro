// The six states a spot on the floor plan reads as (#327, #329), in the order the legend names
// them.
//
// They live in a file of their own, which imports nothing at all, for the reason `statuses.ts`
// does: the browser draws the legend and the tiles, and a client module that took the list from
// `src/server/reservations/view.ts` would pull core's service engine — and with it the database
// driver — into the page's bundle. `view.ts` holds this list to core's own `SPOT_STATES` at type
// level, so a state core adds or renames fails the build rather than quietly losing a tile's word.
export const RV_SPOT_STATES = ['free', 'held', 'sitting', 'in_use', 'late', 'blocked'] as const

/** One spot state, as the browser names it. */
export type RvSpotStateName = (typeof RV_SPOT_STATES)[number]
