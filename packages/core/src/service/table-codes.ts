// The table-code commands (D122 §9; ticket #70). A table's code is stored as its hash and a copy
// sealed for the worker; these are the two staff commands around it that the Log must show:
// - `table_code.reissue` gives a table a new code. core/apply writes the code columns
//   (`reissueTableCodeIn`); this counts the table's code generation (its one writer: a phone that
//   joined with the old code is no longer at the table) and writes a `record` Log entry.
// - `table_code.reveal` lets the admin see codes again (to print a sticker or show a thumbnail).
//   It checks the tables are the venue's and writes one `record` Log entry per reveal; the worker's
//   reveal endpoint opens the sealed copies only after this is accepted. Nothing here holds a code.

import { venueTables } from '@restro/db'
import { and, eq, inArray, isNull, sql } from 'drizzle-orm'

import { reissueTableCodeIn } from '../apply/tables'
import type { ServiceTx } from './definition'
import { accepted, refused, type ServiceResult } from './results'

/** The most tables one reveal opens: a page of the admin's Tables screen. */
export const MAX_REVEALED_CODES = 500

/** Gives the table a new code, counts its generation and logs it. */
export async function reissueTableCode(
  stx: ServiceTx,
  command: { readonly tableId: string },
): Promise<ServiceResult> {
  if (stx.sealPublicKey === null) {
    throw new Error('table_code.reissue needs the worker’s public seal key')
  }
  const change = await reissueTableCodeIn(stx.tx, command.tableId, stx.sealPublicKey)
  if (!change.ok) {
    return refused(null, change.error === 'unknown_table' ? 'table_missing' : change.error)
  }
  await stx.tx
    .update(venueTables)
    .set({ codeGeneration: sql`${venueTables.codeGeneration} + 1` })
    .where(eq(venueTables.id, command.tableId))
  await stx.log({ kind: 'table_code.reissued', tableId: command.tableId })
  // The old code's files, for the caller's token job (hashes; a code still in plain names its
  // plain file too). Never stored: a staff answer is not kept.
  return accepted(null, { details: { retired: change.retired.join(',') } })
}

/** Checks the tables are the venue's live tables and logs one reveal of their codes. */
export async function revealTableCodes(
  stx: ServiceTx,
  command: { readonly tableIds: readonly string[] },
): Promise<ServiceResult> {
  const wanted = [...new Set(command.tableIds)]
  const found = await stx.tx
    .select({ id: venueTables.id })
    .from(venueTables)
    .where(
      and(
        inArray(venueTables.id, wanted),
        eq(venueTables.venueId, stx.venueId),
        isNull(venueTables.archivedAt),
      ),
    )
  if (found.length !== wanted.length) return refused(null, 'table_missing')
  await stx.log({
    kind: 'table_code.revealed',
    ...(wanted.length === 1 ? { tableId: wanted[0] } : {}),
    details: { count: wanted.length },
  })
  return accepted(null, { details: { count: wanted.length } })
}
