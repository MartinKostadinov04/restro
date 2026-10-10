// What `createVenueAction` answers. Lives outside venues-actions.ts because a 'use server' file may
// export async functions only. The dialog shows `error` next to the field it belongs to.

/** A new venue's time zone and currency: the dialog shows them, the action sends exactly these. */
export const NEW_VENUE_TIMEZONE = 'Europe/Sofia'
export const NEW_VENUE_CURRENCY = 'EUR'

/**
 * - `not_allowed`: the person's role may not add a venue (owners and admins may);
 * - `slug_taken`: some venue (of any organisation) already has this public address;
 * - `invalid`: the request is malformed or asks for something the rules forbid;
 * - `failed`: something broke on the server (logged there).
 */
export type CreateVenueError = 'not_allowed' | 'slug_taken' | 'invalid' | 'failed'

/** The answer of `createVenueAction`; on success the new venue's id (`vn_…`). */
export type CreateVenueResult =
  | { readonly ok: true; readonly venueId: string }
  | { readonly ok: false; readonly error: CreateVenueError }
