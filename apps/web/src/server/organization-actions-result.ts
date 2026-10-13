// What `updateOrganizationAction` answers (Settings › General, D84, D91). Lives outside
// organization-actions.ts because a 'use server' file may export async functions only.

/**
 * What `updateOrganizationAction` can refuse:
 * - `not_allowed`: only an owner changes the organisation's name or address name;
 * - `invalid`: nothing to change was sent, the name is empty or over 200 characters, or the
 *   address name is not lower-case Latin letters, digits and single hyphens (1 to 63 characters);
 * - `taken`: another organisation holds this address name now, or held it before (its old
 *   addresses keep redirecting, D84). The organisation's own earlier names may be taken back;
 * - `failed`: something broke on the server (logged there); nothing was changed.
 */
export type UpdateOrganizationError = 'not_allowed' | 'invalid' | 'taken' | 'failed'

/**
 * The answer of `updateOrganizationAction`: the name and the address name as stored now.
 * `filesQueued` is false when the jobs that carry a new address name to the published files
 * (the organisation's index with the redirect from the old name, every venue's table files and
 * live menu) could not all be queued: the change is saved, and the next publish of a venue brings
 * its files up to date. It is true when the address name did not change (nothing to carry).
 */
export type UpdateOrganizationResult =
  | {
      readonly ok: true
      readonly name: string
      readonly slug: string
      readonly filesQueued: boolean
    }
  | { readonly ok: false; readonly error: UpdateOrganizationError }
