// What `createVenueAction`, `renameVenueSlugAction`, `renameVenueAction`, `deleteVenueAction` and
// `restoreVenueAction` answer. Lives outside venues-actions.ts because a 'use server' file may
// export async functions only.

/** A new venue's time zone and currency: the dialog shows them, the action sends exactly these. */
export const NEW_VENUE_TIMEZONE = 'Europe/Sofia'
export const NEW_VENUE_CURRENCY = 'EUR'

/**
 * - `not_allowed`: the person's role may not add a venue (owners and admins may);
 * - `invalid`: the request is malformed or asks for something the rules forbid;
 * - `taken`: another venue of the organisation holds this address name (D84: one name per
 *   organisation; another organisation may hold the same one);
 * - `failed`: something broke on the server (logged there).
 */
export type CreateVenueError = 'not_allowed' | 'invalid' | 'taken' | 'failed'

/** The answer of `createVenueAction`; on success the new venue's id (`vn_…`). */
export type CreateVenueResult =
  | { readonly ok: true; readonly venueId: string }
  | { readonly ok: false; readonly error: CreateVenueError }

/**
 * What `renameVenueSlugAction` can refuse:
 * - `not_allowed`: only owners and admins change a venue's address;
 * - `invalid`: the slug is not lower-case Latin letters, digits and single hyphens, or the venue
 *   is not one of this organisation's;
 * - `taken`: another venue of the organisation holds this address name (D84);
 * - `failed`: something broke on the server (logged there).
 */
export type RenameVenueSlugError = 'not_allowed' | 'invalid' | 'taken' | 'failed'

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
 * - `till_taken`: another venue serves the till venue this one had (adjustments V1); `holder`
 *   is that venue's name, and nothing changed;
 * - `failed`: something broke on the server (logged there).
 */
export type RestoreVenueError = 'not_allowed' | 'invalid' | 'till_taken' | 'failed'

/**
 * The answer of `restoreVenueAction`: the venue's name, for the message, and whether its till was
 * linked again (`relinked`). The venue comes back unpublished (D86); the publish brings its
 * address and table codes back.
 */
export type RestoreVenueResult =
  | { readonly ok: true; readonly name: string; readonly relinked: boolean }
  | { readonly ok: false; readonly error: RestoreVenueError; readonly holder?: string }

/**
 * What `unpublishVenueAction` can refuse:
 * - `not_allowed`: only owners and admins unpublish a venue;
 * - `invalid`: the request is malformed, or the venue is not one of this organisation's;
 * - `venue_archived`: the venue is in the bin;
 * - `failed`: something broke on the server (logged there).
 */
export type UnpublishVenueError = 'not_allowed' | 'invalid' | 'venue_archived' | 'failed'

/**
 * The answer of `unpublishVenueAction` (D86): the venue's name, for the message. `filesQueued` is
 * false when the jobs that withdraw its guest files could not be queued (the venue is unpublished
 * in the database; the next job for it withdraws them).
 */
export type UnpublishVenueResult =
  | { readonly ok: true; readonly name: string; readonly filesQueued: boolean }
  | { readonly ok: false; readonly error: UnpublishVenueError }

/**
 * What `purgeVenueAction` ("Delete permanently", D83) can refuse:
 * - `not_allowed`: only owners erase a venue;
 * - `invalid`: the request is malformed, or the venue is not one of this organisation's;
 * - `not_deleted`: the venue is not in the bin (delete it first);
 * - `name_mismatch`: the typed name is not the venue's;
 * - `failed`: something broke on the server (logged there).
 */
export type PurgeVenueError = 'not_allowed' | 'invalid' | 'not_deleted' | 'name_mismatch' | 'failed'

/**
 * The answer of `purgeVenueAction`: the venue's name, for the message. The erasing itself is the
 * worker's purge job; `queued` is false when it could not be queued (the daily purge erases the
 * venue 30 days after its deletion anyway).
 */
export type PurgeVenueResult =
  | { readonly ok: true; readonly name: string; readonly queued: boolean }
  | { readonly ok: false; readonly error: PurgeVenueError }
