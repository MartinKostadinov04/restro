// The shapes of the small public files that lead a guest to a menu (brief S3-03, doc "Files on
// the CDN"). They live in core, which runs in the browser too, because the guest page reads them
// with these schemas; the publish store (packages/assets) and the worker write them with the same.
//
//   v/<venue public code>.json  {venue_id, menu_id, slug}                   which menu `/m/<slug>-<code>` shows
//   t/<table token>.json        {venue_public_id, venue_slug, table_label}  what a table's QR code means
//   m/<menu>/<venue>/current.json  {snapshot_id, version, hash}             which snapshot is current
//
// All three are public by design and hold nothing internal (rule 3). The code in the first two is
// the venue's random public code (`public-id.ts`, D68); the slug is the current readable name,
// which the guest page uses to correct the address bar. Files of the older shape, `v/<slug>.json`
// and token files without `venue_public_id`, were test data only: they are not migrated and no
// reader accepts them (a path or shape that does not fit is simply "unknown").

import { z } from 'zod'

import { idSchema } from './ids'
import { PUBLIC_ID_PATTERN } from './public-id'

/** Venue slugs: lower-case kebab-case, 1 to 63 characters (`demo-club`). */
export const VENUE_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
/** The longest venue slug. */
export const MAX_VENUE_SLUG_LENGTH = 63

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
 * `v/<public code>.json`: the venue and the menu a code shows, and the venue's current slug (the
 * guest page corrects a stale or missing slug in the address bar from it).
 */
export const VenueIndexSchema = z.strictObject({
  venue_id: idSchema('vn'),
  menu_id: idSchema('nd'),
  slug: VenueSlugSchema,
})
/** The content of `v/<public code>.json`. */
export type VenueIndex = z.output<typeof VenueIndexSchema>

/** `t/<token>.json`: the venue a table code belongs to and how its table is called. */
export const TableTokenFileSchema = z.strictObject({
  /** The venue's public code: what `/t/<token>` and the guest page match the table against. */
  venue_public_id: PublicIdSchema,
  /** The venue's slug when the file was written; only decoration in the address it leads to. */
  venue_slug: VenueSlugSchema,
  /** Shown in the guest page's banner: "12", "VIP 3". */
  table_label: z.string().trim().min(1).max(40),
})
/** The content of `t/<token>.json`. */
export type TableTokenFile = z.output<typeof TableTokenFileSchema>

/** `m/<menu>/<venue>/current.json`: which snapshot is current. */
export const CurrentPointerSchema = z.strictObject({
  snapshot_id: idSchema('sn'),
  version: z.int().min(1),
  hash: z.string().min(1).max(128),
})
/** The content of `current.json`. */
export type CurrentPointer = z.output<typeof CurrentPointerSchema>
