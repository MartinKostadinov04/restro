// What `createVenueAction`, `renameVenueSlugAction`, `renameVenueAction`, `deleteVenueAction` and
// `restoreVenueAction` answer. Lives outside venues-actions.ts because a 'use server' file may
// export async functions only.

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

/**
 * What `renameVenueAction` can refuse:
 * - `not_allowed`: only owners and admins rename a venue;
 * - `invalid`: the name is empty or over 120 characters, or the venue is not one of this
 *   organisation's;
 * - `venue_archived`: the venue was deleted (in another tab, say);
 * - `failed`: something broke on the server (logged there).
 */
export type RenameVenueError = 'not_allowed' | 'invalid' | 'venue_archived' | 'failed'

/** The answer of `renameVenueAction`: the name as stored (trimmed), and whether it changed. */
export type RenameVenueResult =
  | { readonly ok: true; readonly name: string; readonly changed: boolean }
  | { readonly ok: false; readonly error: RenameVenueError }

/**
 * What `deleteVenueAction` can refuse:
 * - `not_allowed`: only owners delete a venue;
 * - `invalid`: the request is malformed, or the venue is not one of this organisation's;
 * - `name_mismatch`: the name typed to confirm is not the venue's name (checked here as well as
 *   in the dialog);
 * - `venue_archived`: the venue was deleted already (in another tab, say);
 * - `failed`: something broke on the server (logged there).
 */
export type DeleteVenueError =
  | 'not_allowed'
  | 'invalid'
  | 'name_mismatch'
  | 'venue_archived'
  | 'failed'

/**
 * The answer of `deleteVenueAction`. `filesQueued` is false when the jobs that take the venue's
 * pages and QR codes off the guests' side could not be queued: the venue is deleted all the same
 * (the admin and the sync have stopped), and the guest pages stop working once the files are taken
 * out, which an operator can still trigger.
 */
export type DeleteVenueResult =
  | { readonly ok: true; readonly filesQueued: boolean }
  | { readonly ok: false; readonly error: DeleteVenueError }

/**
 * What `restoreVenueAction` can refuse:
 * - `not_allowed`: only owners restore a venue;
 * - `invalid`: the request is malformed, or the venue is not one of this organisation's;
 * - `failed`: something broke on the server (logged there).
 */
export type RestoreVenueError = 'not_allowed' | 'invalid' | 'failed'

/**
 * The answer of `restoreVenueAction`: the venue's name, for the message. `filesQueued` is false
 * when the table files job could not be queued (the next publish queues it again).
 */
export type RestoreVenueResult =
  | { readonly ok: true; readonly name: string; readonly filesQueued: boolean }
  | { readonly ok: false; readonly error: RestoreVenueError }
