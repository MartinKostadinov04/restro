// What a composer server action answers. Lives outside actions.ts because a 'use server' file may
// export async functions only. The client shows `error` as a toast (messages `composer.errors`)
// and the optimistic change rolls back by itself.

/**
 * - `not_found`: the venue, menu or node is not the signed-in organisation's (or is gone);
 * - `invalid`: the request is malformed or asks for something the rules forbid;
 * - `not_allowed`: the person's role may not do this (marking sold out, or making an item, is for
 *   owners and admins);
 * - `till_venue`: the venue has a till, which is where its items come from (D66): items made by
 *   hand are for venues without one, and only those can be renamed inline or deleted (D89);
 * - `till_section`: the section mirrors a category of the till: it can be hidden, never deleted
 *   (D92; the venue's own sections can be);
 * - `rejected`: apply() refused an op (for example a move that would nest sections too deep);
 * - `failed`: something broke on the server (logged there).
 */
export type ActionErrorCode =
  | 'not_found'
  | 'invalid'
  | 'not_allowed'
  | 'till_venue'
  | 'till_section'
  | 'rejected'
  | 'failed'

/**
 * The answer of a composer action. `warning: 'live_not_queued'` means the change was saved but
 * the job that tells guests could not be queued: guests follow within a few minutes anyway.
 */
export type ActionResult =
  | { readonly ok: true; readonly warning?: 'live_not_queued' }
  | { readonly ok: false; readonly error: ActionErrorCode }
