// The two small files that lead a guest to a menu (brief S3-03), and the code that reads and
// writes them. Both are public by design and hold nothing internal:
//
//   v/<venue slug>.json      {venue_id, menu_id}        which menu `/m/<slug>` shows
//   t/<table token>.json     {venue_slug, table_label}  what the QR code of a table means
//
// The worker writes the first with every publish (apps/worker, writePublishFiles). The second is
// written when a table gets a code and removed when it is retired (S3-07); until then only tests
// write it (`writeTableTokenFile`). The web app reads both, never the database (rule 4).
import { idSchema } from '@restro/core'
import { z } from 'zod'

import type { PublishStore } from './publish-store'
import {
  PUBLISH_SLUG_PATTERN,
  publishPutOptions,
  tableTokenPath,
  venueIndexPath,
} from './publish-paths'

/** `v/<slug>.json`: the venue and the menu a slug shows. */
export const VenueIndexSchema = z.strictObject({
  venue_id: idSchema('vn'),
  menu_id: idSchema('nd'),
})
/** The content of `v/<slug>.json`. */
export type VenueIndex = z.output<typeof VenueIndexSchema>

/** `t/<token>.json`: the venue a table code belongs to and how its table is called. */
export const TableTokenFileSchema = z.strictObject({
  venue_slug: z.string().max(63).regex(PUBLISH_SLUG_PATTERN),
  /** Shown in the guest page's banner: "12", "VIP 3". */
  table_label: z.string().trim().min(1).max(40),
})
/** The content of `t/<token>.json`. */
export type TableTokenFile = z.output<typeof TableTokenFileSchema>

const encode = (value: unknown): Uint8Array => new TextEncoder().encode(JSON.stringify(value))

/** The bytes of a slug index file. */
export function venueIndexBytes(index: VenueIndex): Uint8Array {
  return encode(VenueIndexSchema.parse(index))
}

/** Parses the bytes of a file into `schema`; null for anything that does not fit. */
export function parseGuestFile<S extends z.ZodType>(
  schema: S,
  bytes: Uint8Array | null,
): z.output<S> | null {
  if (bytes === null) return null
  try {
    const parsed = schema.safeParse(JSON.parse(new TextDecoder().decode(bytes)))
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}

/** The slug index of a venue slug as the store holds it, or null (no file, or not valid). */
export async function readVenueIndex(
  store: Pick<PublishStore, 'get'>,
  slug: string,
): Promise<VenueIndex | null> {
  return parseGuestFile(VenueIndexSchema, await store.get(venueIndexPath(slug)))
}

/** What a table code means, or null for an unknown, retired or malformed token. */
export async function readTableTokenFile(
  store: Pick<PublishStore, 'get'>,
  token: string,
): Promise<TableTokenFile | null> {
  return parseGuestFile(TableTokenFileSchema, await store.get(tableTokenPath(token)))
}

/** Writes the file behind a table code (tests today; S3-07 when tables get codes). */
export async function writeTableTokenFile(
  store: Pick<PublishStore, 'put'>,
  token: string,
  file: TableTokenFile,
): Promise<void> {
  const path = tableTokenPath(token)
  await store.put(path, encode(TableTokenFileSchema.parse(file)), publishPutOptions(path))
}
