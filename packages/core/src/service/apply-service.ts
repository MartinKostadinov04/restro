// `applyService`, the service write path's one entry (see `./index.ts`), in a file of its own so
// the guest API's module (`./guest.ts`) can call it without a cycle through the index.

import type { DbPool } from '@restro/db'

import { SERVICE_COMMANDS } from './commands'
import type { ServiceContext } from './context'
import { executeCommand, type ServiceOptions } from './engine'
import { readTableState, type TableStateRead, type TableStateUnchanged } from './read'
import type { ServiceResult } from './results'

/** Refusals made before the table was found: no table state goes with them. */
const STATELESS: ReadonlySet<string> = new Set([
  'invalid_command',
  'origin_not_allowed',
  'venue_missing',
  'venue_archived',
  'table_missing',
  'code_retired',
])

/** What `applyService` answers: the result, and for a guest's command on a table its fresh state. */
export interface AppliedService {
  readonly result: ServiceResult
  /** The table's state after the command, for a guest command; null otherwise. */
  readonly state: TableStateRead | TableStateUnchanged | null
}

/**
 * Applies one service command: the only way anything writes the service tables. The result is
 * accepted or refused with a code, never a local success (D72). A guest's command on a table also
 * returns the table's state, read after the commit, so the phone that acted sees its change at
 * once (and the fresh state comes with a refusal). `options` carries what some commands need
 * from the caller's environment (the seal key a new table code is sealed with).
 */
export async function applyService(
  pool: DbPool,
  command: unknown,
  context: ServiceContext,
  options: ServiceOptions = {},
): Promise<AppliedService> {
  const result = await executeCommand(pool, SERVICE_COMMANDS, command, context, options)
  const named =
    typeof command === 'object' && command !== null && 'tableId' in command ? command.tableId : null
  const tableId = context.origin === 'guest' && typeof named === 'string' ? named : null
  if (tableId === null || (result.status === 'refused' && STATELESS.has(result.code))) {
    return { result, state: null }
  }
  return {
    result,
    state: await readTableState(pool, {
      tenantId: context.tenantId,
      tableId,
      ...(context.tableCodeHash === undefined ? {} : { tableCodeHash: context.tableCodeHash }),
    }),
  }
}
