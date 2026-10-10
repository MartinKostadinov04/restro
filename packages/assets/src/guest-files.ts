// Reading and writing the two small files that lead a guest to a menu (brief S3-03). Their shapes
// are in @restro/core (the guest page, which runs in the browser, reads them with the same
// schemas); this is the store side:
//
//   v/<venue slug>.json      {venue_id, menu_id}        which menu `/m/<slug>` shows
//   t/<table token>.json     {venue_slug, table_label}  what the QR code of a table means
//
// The worker writes the first with every publish (apps/worker, writePublishFiles). The second is
// written when a table gets a code and removed when it is retired, both by the worker's
// `publish-table-tokens` job (S3-07; `writeTableTokenFile`, `deleteTableTokenFile`). The web app
// reads both, never the database (rule 4), and never writes the store.
import {
  type TableTokenFile,
  TableTokenFileSchema,
  type VenueIndex,
  VenueIndexSchema,
} from '@restro/core'
import type { z } from 'zod'

import { publishPutOptions, tableTokenPath, venueIndexPath } from './publish-paths'
import type { PublishStore } from './publish-store'

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

/** The bytes of a table code's file. */
export function tableTokenBytes(file: TableTokenFile): Uint8Array {
  return encode(TableTokenFileSchema.parse(file))
}

/** Writes the file behind a table code (the worker's `publish-table-tokens` job; tests). */
export async function writeTableTokenFile(
  store: Pick<PublishStore, 'put'>,
  token: string,
  file: TableTokenFile,
): Promise<void> {
  const path = tableTokenPath(token)
  await store.put(path, tableTokenBytes(file), publishPutOptions(path))
}

/** Removes the file behind a retired table code, so `/t/<token>` says "code not active". */
export async function deleteTableTokenFile(
  store: Pick<PublishStore, 'delete'>,
  token: string,
): Promise<void> {
  await store.delete(tableTokenPath(token))
}
