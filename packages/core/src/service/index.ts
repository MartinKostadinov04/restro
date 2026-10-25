// @restro/core/service: the service write path (D122 §9; design
// `docs/deliverables/2026-10-21-service-data-design.md` §2; spec #64 Implementation Decisions 3).
// `applyService(command)` is the only writer of the service tables (sittings, the table's order,
// sent orders, locks, readings, the Log, waiter calls, alerts, pauses, service days and the staff
// side), beside `apply()`, which stays the menu's only write path. `readTableState`, `readTonight`
// and `readStaffSettings` are its read side; `identifyStaffByPin` finds the person a PIN names on
// a shared device (#72). Only the worker, the guest API's route handlers and the admin's
// server actions may import this entry (dependency-cruiser: `core-service-only-from-service-callers`);
// which tables it writes is pinned by `write-targets.test.ts`.

import type { DbPool } from '@restro/db'

import { SERVICE_COMMANDS } from './commands'
import type { ServiceContext } from './context'
import { executeCommand, type ServiceOptions } from './engine'
import { readTableState, type TableStateRead, type TableStateUnchanged } from './read'
import type { ServiceResult } from './results'

export {
  PIN_GUARD_FAILURES,
  PIN_GUARD_WAITS_MS,
  PIN_GUARD_WINDOW_MS,
  PinGuard,
  type PinGuardCheck,
} from '../pin-guard'
export { ACTION_RING_SIZE } from './action-ring'
export {
  SERVICE_COMMANDS,
  type ServiceCommand,
  ServiceCommandSchema,
  type ServiceCommandType,
} from './commands'
export {
  actorText,
  FRESH_SIGN_IN_MINUTES,
  isFreshSignIn,
  type Provenance,
  SERVICE_ORIGINS,
  type ServiceActor,
  type ServiceContext,
  type ServiceOrigin,
  type ServiceSource,
  VIA_VALUES,
  type Via,
} from './context'
export type { CommandHandler, Idempotency, ServiceTx } from './definition'
export { SERVICE_LOCK_TIMEOUT, SERVICE_STATEMENT_TIMEOUT, type ServiceOptions } from './engine'
export { identifyStaffByPin, type PinIdentity } from './identify'
export {
  holdsLease,
  LEASE_SCOPES,
  type LeaseClaim,
  type LeaseKey,
  type LeaseScope,
  readLease,
  releaseLease,
  renewLease,
  type TakeResult,
  takeLease,
} from './leases'
export { LOCK_RANKS, LockOrderError, type LockRank } from './lock-order'
export {
  appendLogEntry,
  LOG_KINDS,
  type LogEntryInput,
  type LogKind,
  type LogRetention,
  NIGHT_RETENTION_DAYS,
  RECORD_RETENTION_MONTHS,
  recordRetainUntil,
  retentionOf,
} from './log'
export {
  DEFAULT_ROLE_KINDS,
  DEFAULT_ROLE_PERMISSIONS,
  type DefaultRoleKind,
  isPermission,
  isSettingsPermission,
  OPERATOR_PERMISSIONS,
  PERMISSIONS,
  type Permission,
  PermissionSchema,
} from './permissions'
export { checkPinPepper, MIN_PIN_PEPPER_LENGTH } from './pins'
export {
  type AccountVenue,
  markProviderNoticeHandled,
  paymentAccountVenues,
  type StoredProviderNotice,
  unhandledProviderNotices,
} from './provider-notices'
export {
  type LeaseView,
  type PauseView,
  readTableState,
  readTonight,
  type TableStateRead,
  type TableStateUnchanged,
  TONIGHT_LOG_LIMIT,
  type Tonight,
  type TonightRefusal,
  type TonightTable,
} from './read'
export {
  REFUSAL_CODES,
  type RefusalCode,
  type ServiceResult,
  ServiceResultSchema,
} from './results'
export type { RowLocks, SentOrder, Sitting, TableOrder } from './rows'
export { SITTING_END_REASONS, type SittingEndReason } from './sittings'
export { MAX_REVEALED_PINS } from './staff'
export {
  type DeviceView,
  type RoleView,
  readStaffSettings,
  type StaffSettings,
  type StaffSettingsRefusal,
  type StaffView,
} from './staff-read'
export { MAX_REVEALED_CODES } from './table-codes'

/** Refusals made before the table was found: no table state goes with them. */
const STATELESS: ReadonlySet<string> = new Set([
  'invalid_command',
  'origin_not_allowed',
  'venue_missing',
  'venue_archived',
  'table_missing',
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
  return { result, state: await readTableState(pool, { tenantId: context.tenantId, tableId }) }
}
