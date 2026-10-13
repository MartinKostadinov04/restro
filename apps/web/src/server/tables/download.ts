// "Download PNG" and "Download SVG" of a table's code (briefs S3-07, S5): the file for one table of
// the signed-in person's organisation, made from this installation's address (address.ts, D94).
// A route handler (app/api/tables/[tableId]/qr/route.ts) calls this with the tenant it found; the
// tenant is never taken from the request. Nothing is fetched.
import { findVenueTable, tableLabel } from '@restro/core/apply'
import type { DbPool } from '@restro/db'

import { codeAddress, codeBaseUrl } from './address'
import { qrPng, qrSvgFile } from './qr-image'

/** The two file kinds. */
export type QrFileFormat = 'png' | 'svg'

/** What the route answers with. */
export type QrDownload =
  | {
      readonly ok: true
      readonly body: Uint8Array | string
      readonly contentType: string
      /** An ASCII file name, e.g. `restro-table-12.png`. */
      readonly filename: string
    }
  | { readonly ok: false }

/** `png` for anything but `svg`. */
export function parseFormat(value: string | null): QrFileFormat {
  return value === 'svg' ? 'svg' : 'png'
}

/** A table's name made safe for a file name; a name with no ASCII letters or digits gives `qr`. */
export function fileNamePart(shownAs: string | null): string {
  const safe = (shownAs ?? '')
    .normalize('NFKD')
    .replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 24)
  return safe === '' ? 'qr' : safe
}

/** The file of one table's code, or `{ ok: false }` when the table is not usable or has no code. */
export async function buildQrDownload(
  deps: { readonly pool: DbPool; readonly defaultBaseUrl: string | null },
  tenantId: string,
  tableId: string,
  format: QrFileFormat,
): Promise<QrDownload> {
  const found = await findVenueTable(deps.pool, tenantId, tableId)
  if (found === null || found.table.token === null) return { ok: false }
  const address = codeAddress(codeBaseUrl(deps.defaultBaseUrl), found.table.token)
  if (address === null) return { ok: false }
  const name = `restro-table-${fileNamePart(tableLabel(found.table))}`
  return format === 'svg'
    ? {
        ok: true,
        body: await qrSvgFile(address),
        contentType: 'image/svg+xml; charset=utf-8',
        filename: `${name}.svg`,
      }
    : {
        ok: true,
        body: new Uint8Array(await qrPng(address)),
        contentType: 'image/png',
        filename: `${name}.png`,
      }
}
