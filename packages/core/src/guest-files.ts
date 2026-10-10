// The shapes of the small public files that lead a guest to a menu (brief S3-03, doc "Files on
// the CDN"). They live in core, which runs in the browser too, because the guest page reads them
// with these schemas; the publish store (packages/assets) and the worker write them with the same.
//
//   v/<venue slug>.json      {venue_id, menu_id}                 which menu `/m/<slug>` shows
//   t/<table token>.json     {venue_slug, table_label}           what a table's QR code means
//   m/<menu>/<venue>/current.json  {snapshot_id, version, hash}  which snapshot is current
//
// All three are public by design and hold nothing internal (rule 3).

import { z } from 'zod'

import { idSchema } from './ids'

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

/** A table token: opaque and URL-safe, 8 to 128 characters (S3-07 decides how tokens are made). */
export const TABLE_TOKEN_PATTERN = /^[A-Za-z0-9_-]{8,128}$/

/** `v/<slug>.json`: the venue and the menu a slug shows. */
export const VenueIndexSchema = z.strictObject({
  venue_id: idSchema('vn'),
  menu_id: idSchema('nd'),
})
/** The content of `v/<slug>.json`. */
export type VenueIndex = z.output<typeof VenueIndexSchema>

/** `t/<token>.json`: the venue a table code belongs to and how its table is called. */
export const TableTokenFileSchema = z.strictObject({
  venue_slug: z
    .string()
    .max(MAX_VENUE_SLUG_LENGTH)
    .regex(VENUE_SLUG_PATTERN, 'a venue slug (lower-case kebab-case)'),
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
