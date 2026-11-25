// The eight states of a reservation (D138), in the order the night's filters draw them.
//
// They live in a file of their own, which imports nothing at all, because the browser draws the
// chips: a client module that took the list from `src/server/reservations/view.ts` would pull
// core's service engine — and with it the database driver — into the page's bundle, and the
// production build fails. `view.ts` holds this list to core's own list at type level, so a state
// core adds or renames fails the build rather than quietly losing a row's filter.
export const RV_STATUSES = [
  'reserved',
  'waiting',
  'seated',
  'finished',
  'no_show',
  'not_seated',
  'cancelled',
  'requested',
] as const
