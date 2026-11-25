// @restro/core/events: the guest events and their one write path (D142; ticket #335, tracker T84).
// `recordEvents(tx, scope, events)` is the only writer of `restro.guest_events` (rule 1), append-
// only, and the kinds it accepts are a closed union with no field for personal data (D111, rule 3).
//
// Only the service write path (`packages/core/src/service/`), the worker and the web app's server
// code and route handlers may import this entry (dependency-cruiser:
// `core-events-only-from-event-callers`); which table it writes is pinned by
// `packages/core/src/write-targets.test.ts`.

export {
  GUEST_EVENT_BATCH_MAX,
  GUEST_EVENT_KIND_NAMES,
  GUEST_EVENT_KINDS,
  type GuestEvent,
  GuestEventBatchSchema,
  type GuestEventInput,
  GuestEventInputSchema,
  type GuestEventKind,
  GuestEventOutcomeSchema,
  type GuestEventRetention,
  guestEventAmount,
  guestEventOutcome,
  guestEventRetentionOf,
  isPhoneReportedKind,
  PHONE_REPORTED_KINDS,
  type PhoneReportedKind,
} from './kinds'
export {
  GUEST_EVENT_SOURCES,
  type GuestEventScope,
  GuestEventScopeSchema,
  type GuestEventSource,
  recordEvents,
} from './record'
