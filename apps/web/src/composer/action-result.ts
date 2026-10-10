// What a composer server action answers. Lives outside actions.ts because a 'use server' file may
// export async functions only. The client shows `error` as a toast (messages `composer.errors`)
// and the optimistic change rolls back by itself.

/**
 * - `not_found`: the venue, menu or node is not the signed-in organisation's (or is gone);
 * - `invalid`: the request is malformed or asks for something the rules forbid;
 * - `rejected`: apply() refused an op (for example a move that would nest sections too deep);
 * - `failed`: something broke on the server (logged there).
 */
export type ActionErrorCode = 'not_found' | 'invalid' | 'rejected' | 'failed'

/** The answer of a composer action. */
export type ActionResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly error: ActionErrorCode }
