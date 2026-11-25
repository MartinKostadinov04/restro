// The files a table's code may have in the publish store (#70). A module of its own, with no
// write-path imports, so the till mirror and the venue lifecycle can name them without importing
// the Tables write path (which imports the till mirror back).
import type { VenueTableRow } from '@restro/db'

/**
 * The names of the files a table's code may have in the publish store: its hash and, while the
 * code is still stored in plain (before the `seal-table-codes` job reached it), the plain code.
 */
export function codeFileNames(row: Pick<VenueTableRow, 'qrToken' | 'qrCodeHash'>): string[] {
  return [row.qrCodeHash, row.qrToken].filter((name): name is string => name !== null)
}
