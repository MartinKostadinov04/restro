// The shapes of the small public files that lead a guest to a menu (brief S3-03, D84, D95; doc
// "Files on the CDN"). They live in core, which runs in the browser too, because the guest page
// reads them with these schemas; the publish store (packages/assets) and the worker write them
// with the same.
//
//   o/<organisation slug>.json  the organisation's venues by address name (current and old names,
//                               each venue's internal code and live menu), or, under an old
//                               organisation name, {redirect_to}: where `/m/<organisation>/<venue>`
//                               starts (D84)
//   v/<venue public code>.json  {venue_id, menu_id, slug, organization}  what the old address
//                               `/m/<slug>-<code>` shows, and where it redirects to (D68 → D84)
//   t/<code's SHA-256>.json     {venue_public_id, venue_slug, organization_slug, table_label, menu_id}
//                               what a table's QR code means and which menu it opens (D95)
//   m/<menu>/<venue>/current.json  {snapshot_id, version, hash}  which snapshot is current
//
// All are public by design and hold nothing internal (rule 3). The code is the venue's random
// public code (`public-id.ts`), an internal key of the CDN since D84; the slugs are the current
// readable names, which the guest page uses to correct the address bar. Files of the older shape,
// `v/<slug>.json` and token files without `venue_public_id`, were test data only: they are not
// migrated and no reader accepts them (a path or shape that does not fit is simply "unknown").
// The CDN keeps these small files for 30 seconds: a renamed organisation or venue reaches guests
// who typed the old address within that time, through the redirect entries.

import { z } from 'zod'

import { idSchema } from './ids'
import { PUBLIC_ID_PATTERN } from './public-id'

/** Venue slugs: lower-case kebab-case, 1 to 63 characters (`demo-club`). */
export const VENUE_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
/** The longest venue slug. */
export const MAX_VENUE_SLUG_LENGTH = 63

/**
 * Organisation slugs (D84): the first part of `/m/<organisation>/<venue>`, Better Auth's
 * `auth_organization.slug`, unique platform-wide; the same shape as a venue slug.
 */
export const ORGANIZATION_SLUG_PATTERN = VENUE_SLUG_PATTERN
/** The longest organisation slug. */
export const MAX_ORGANIZATION_SLUG_LENGTH = MAX_VENUE_SLUG_LENGTH

/** True for a string that can be an organisation slug. */
export function isOrganizationSlug(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length >= 1 &&
    value.length <= MAX_ORGANIZATION_SLUG_LENGTH &&
    ORGANIZATION_SLUG_PATTERN.test(value)
  )
}

/** True for a string that can be a venue slug. */
export function isVenueSlug(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length >= 1 &&
    value.length <= MAX_VENUE_SLUG_LENGTH &&
    VENUE_SLUG_PATTERN.test(value)
  )
}

/** A venue slug as a schema (`demo-club`): lower-case kebab-case, 1 to 63 characters. */
export const VenueSlugSchema = z
  .string()
  .min(1)
  .max(MAX_VENUE_SLUG_LENGTH)
  .regex(VENUE_SLUG_PATTERN, 'a venue slug (lower-case kebab-case)')

/** A venue's public code as a schema: 12 characters of `a-z0-9`. */
export const PublicIdSchema = z
  .string()
  .regex(PUBLIC_ID_PATTERN, 'a venue public code (12 characters of a-z and 0-9)')

/** A table token: opaque and URL-safe, 8 to 128 characters (S3-07 decides how tokens are made). */
export const TABLE_TOKEN_PATTERN = /^[A-Za-z0-9_-]{8,128}$/

/**
 * A table code's SHA-256, lower-case hex (`hashTableCode`): what its published file is named by
 * (`t/<hash>.json`) and the database looks it up by (D122 §9). The code itself is never a file name.
 */
export const TABLE_CODE_HASH_PATTERN = /^[0-9a-f]{64}$/

/** An organisation slug as a schema (`demo-club`): lower-case kebab-case, 1 to 63 characters. */
export const OrganizationSlugSchema = z
  .string()
  .min(1)
  .max(MAX_ORGANIZATION_SLUG_LENGTH)
  .regex(ORGANIZATION_SLUG_PATTERN, 'an organisation slug (lower-case kebab-case)')

/**
 * `v/<public code>.json`: the venue and the menu a code shows, and the venue's current slug (the
 * guest page corrects a stale or missing slug in the address bar from it). Since D84 the file
 * also names the organisation, so the old address `/m/<slug>-<code>` leads to the new one,
 * `/m/<organisation>/<slug>`; a file from before carries no organisation and is shown in place.
 */
export const VenueIndexSchema = z.strictObject({
  venue_id: idSchema('vn'),
  menu_id: idSchema('nd'),
  slug: VenueSlugSchema,
  organization: OrganizationSlugSchema.optional(),
})
/** The content of `v/<public code>.json`. */
export type VenueIndex = z.output<typeof VenueIndexSchema>

/** One venue in an organisation's index: what `/m/<organisation>/<venue>` needs to start. */
export const OrganizationVenueEntrySchema = z.strictObject({
  venue_id: idSchema('vn'),
  /** The venue's live menu (D88); the menu whose files the page reads unless a table says otherwise. */
  menu_id: idSchema('nd'),
  /** The venue's public code: the key of its `v/` file, and what a table's file is matched against. */
  public_id: PublicIdSchema,
})
/** One venue in an organisation's index. */
export type OrganizationVenueEntry = z.output<typeof OrganizationVenueEntrySchema>

/**
 * `o/<organisation slug>.json` under the organisation's CURRENT slug: its venues that are live
 * (published and not unpublished or deleted, D86) by address name, and the old names of its venues
 * with the current name each leads to. Nothing internal beyond the ids every other file carries.
 */
export const OrganizationIndexSchema = z.strictObject({
  organization_id: idSchema('tn'),
  /** The organisation's current slug: the file's own name, so a reader can tell a stale copy. */
  slug: OrganizationSlugSchema,
  venues: z.record(VenueSlugSchema, OrganizationVenueEntrySchema),
  /** An earlier venue name → the current one (empty when nothing was renamed). */
  old_names: z.record(VenueSlugSchema, VenueSlugSchema),
})
/** The content of `o/<organisation slug>.json` for a current organisation slug. */
export type OrganizationIndex = z.output<typeof OrganizationIndexSchema>

/** `o/<old organisation slug>.json`: the organisation was renamed; its index is under `redirect_to`. */
export const OrganizationRedirectSchema = z.strictObject({
  redirect_to: OrganizationSlugSchema,
})
/** The content of `o/<slug>.json` under an old organisation slug. */
export type OrganizationRedirect = z.output<typeof OrganizationRedirectSchema>

/** Whatever `o/<slug>.json` holds: the index, or a redirect to it. */
export const OrganizationFileSchema = z.union([OrganizationIndexSchema, OrganizationRedirectSchema])
/** The content of `o/<slug>.json`. */
export type OrganizationFile = z.output<typeof OrganizationFileSchema>

/** `t/<code hash>.json`: the venue a table code belongs to, how its table is called, and which menu it shows. */
export const TableTokenFileSchema = z.strictObject({
  /** The venue's public code: what `/t/<token>` and the guest page match the table against. */
  venue_public_id: PublicIdSchema,
  /** The venue's slug when the file was written; only decoration in the address it leads to. */
  venue_slug: VenueSlugSchema,
  /**
   * The organisation's slug when the file was written (D84): `/t/<token>` leads to
   * `/m/<organisation>/<venue>` with it. Absent in files from before: the old address then.
   */
  organization_slug: OrganizationSlugSchema.optional(),
  /** Shown in the guest page's banner: "12", "VIP 3". */
  table_label: z.string().trim().min(1).max(40),
  /**
   * The menu this table shows (D95: the table's own, else its area's, else the venue's live menu;
   * resolved by the publisher). Absent in files from before the routing: the live menu then.
   */
  menu_id: idSchema('nd').optional(),
})
/** The content of `t/<code hash>.json`. */
export type TableTokenFile = z.output<typeof TableTokenFileSchema>

/** `m/<menu>/<venue>/current.json`: which snapshot is current. */
export const CurrentPointerSchema = z.strictObject({
  snapshot_id: idSchema('sn'),
  version: z.int().min(1),
  hash: z.string().min(1).max(128),
})
/** The content of `current.json`. */
export type CurrentPointer = z.output<typeof CurrentPointerSchema>
