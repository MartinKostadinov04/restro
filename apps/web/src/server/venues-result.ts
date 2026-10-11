// What `createVenueAction` and `renameVenueSlugAction` answer. Lives outside venues-actions.ts
// because a 'use server' file may export async functions only.

/** A new venue's time zone and currency: the dialog shows them, the action sends exactly these. */
export const NEW_VENUE_TIMEZONE = 'Europe/Sofia'
export const NEW_VENUE_CURRENCY = 'EUR'

/**
 * - `not_allowed`: the person's role may not add a venue (owners and admins may);
 * - `invalid`: the request is malformed or asks for something the rules forbid;
 * - `failed`: something broke on the server (logged there).
 *
 * There is no "address taken": the readable part of the address does not have to be unique, a
 * random code in it finds the venue (D68).
 */
export type CreateVenueError = 'not_allowed' | 'invalid' | 'failed'

/** The answer of `createVenueAction`; on success the new venue's id (`vn_…`). */
export type CreateVenueResult =
  | { readonly ok: true; readonly venueId: string }
  | { readonly ok: false; readonly error: CreateVenueError }

/**
 * What `renameVenueSlugAction` can refuse:
 * - `not_allowed`: only owners and admins change a venue's address;
 * - `invalid`: the slug is not lower-case Latin letters, digits and single hyphens, or the venue
 *   is not one of this organisation's;
 * - `failed`: something broke on the server (logged there).
 */
export type RenameVenueSlugError = 'not_allowed' | 'invalid' | 'failed'

/**
 * The answer of `renameVenueSlugAction`. On success the new slug and the new menu path (the code
 * stays); `filesQueued` is false when the job that carries the new slug to the published files
 * could not be queued (the rename is saved; the next publish brings the files up to date).
 */
export type RenameVenueSlugResult =
  | {
      readonly ok: true
      readonly slug: string
      readonly path: string
      readonly filesQueued: boolean
    }
  | { readonly ok: false; readonly error: RenameVenueSlugError }
