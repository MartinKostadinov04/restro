// @restro/core/service: the service write path (D122 §9; design
// `docs/deliverables/2026-10-21-service-data-design.md` §2; spec #64 Implementation Decisions 3).
// `applyService(command)` is the only writer of the service tables (sittings, the table's order,
// sent orders, locks, readings, the Log, waiter calls, alerts, pauses, service days and the staff
// side), beside `apply()`, which stays the menu's only write path. `readTableState`, `readTonight`
// and `readStaffSettings` are its read side; `identifyStaffByPin` finds the person a PIN names on
// a shared device (#72). Only the worker, the guest API's route handlers and the admin's
// server actions may import this entry (dependency-cruiser: `core-service-only-from-service-callers`);
// which tables it writes is pinned by `write-targets.test.ts`.

export {
  PIN_GUARD_FAILURES,
  PIN_GUARD_WAITS_MS,
  PIN_GUARD_WINDOW_MS,
  PinGuard,
  type PinGuardCheck,
} from '../pin-guard'
export { ACTION_RING_SIZE } from './action-ring'
export { type AppliedService, applyService } from './apply-service'
export {
  type BillLineView,
  type BillPartView,
  type BillView,
  billBackendValues,
  checkBillIdKey,
  FRESH_READING_MS,
  forbiddenPaths,
  MIN_BILL_ID_KEY_LENGTH,
  type ReadBill,
  type ReadLine,
  type TableReading,
  TableReadingSchema,
  wantsFreshReading,
} from './bill'
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
export {
  ForbiddenValueError,
  forgetGuestCodes,
  GUEST_POLL_MS,
  GUEST_VIEWS,
  type GuardEvent,
  type GuestActed,
  type GuestActInput,
  type GuestCheck,
  type GuestCommandResult,
  type GuestLocation,
  type GuestLocationState,
  type GuestRefusal,
  type GuestStateInput,
  type GuestStateless,
  type GuestTableState,
  type GuestUnchanged,
  type GuestView,
  guestAct,
  guestResult,
  guestState,
  type HumanCheck,
  type HumanCheckVerdict,
  projectGuestState,
} from './guest'
export { GUEST_LIMITS, type GuestLimit, GuestLimiter, type GuestLimitName } from './guest-limits'
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
export {
  checkPassKey,
  type LocationPassClaims,
  MAX_PASS_LENGTH,
  MIN_PASS_KEY_LENGTH,
  openLocationPass,
  passHolds,
  sealLocationPass,
} from './location-pass'
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
export { ORDER_RATE_ALERT } from './order-rate'
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
  type UnhandledNoticesPage,
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
export { waiterCallLapsesAt } from './waiter-call'
