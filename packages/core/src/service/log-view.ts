// How the Log screen groups and hides the kinds of `LOG_KINDS` (#86; plan
// `docs/deliverables/2026-10-27-tonight-log-plan.md` §3, §5). Pure data: no I/O.
//
// Every kind is in exactly one place: one of the four filter groups, or hidden. A kind added to
// `LOG_KINDS` without a place here is a type error (`satisfies Record<LogKind, ...>`) and a failing
// test, so the Log never shows "Something happened (kind)".

import { LOG_KINDS, type LogKind } from './log'

/** The Log's "Kind" filter, apart from "All" (plan §3). */
export const LOG_GROUPS = ['orders', 'money', 'pauses', 'settings'] as const

/** One group of the filter. */
export type LogGroup = (typeof LOG_GROUPS)[number]

/** Where each kind belongs; `null` never shows (D120: only the Restro team sees such entries). */
export const LOG_KIND_GROUP = {
  'sitting.opened': 'orders',
  'sitting.ended': 'orders',
  'sent_order.state': 'orders',
  'sent_order.landed_late': 'orders',
  'waiter_call.called': 'orders',
  'waiter_call.done': 'orders',
  'waiter_call.lapsed': 'orders',
  // Handled-like staff work at a table (the Money filter holds the payment's own kinds).
  'receipt.brought': 'orders',
  'service_day.closed': 'orders',
  'payment.state': 'money',
  'payment.answered': 'money',
  'payment.refund_seen': 'money',
  'payment.storno': 'money',
  'payment.dispute': 'money',
  'pause.started': 'pauses',
  'pause.lifted': 'pauses',
  'alert.raised': 'pauses',
  'alert.done': 'pauses',
  'alert.cleared': 'pauses',
  'guard.tripped': 'pauses',
  'settings.changed': 'settings',
  'role.changed': 'settings',
  'assignment.changed': 'settings',
  'staff.changed': 'settings',
  'pin.changed': 'settings',
  'pin.revealed': 'settings',
  'device.changed': 'settings',
  'table_code.reissued': 'settings',
  'table_code.revealed': 'settings',
  // A lease changing hands is the engine's bookkeeping, not something that happened at the venue.
  'lease.taken_over': null,
} as const satisfies Record<LogKind, LogGroup | null>

/** The kinds the venue sees, in `LOG_KINDS` order. */
export const SHOWN_LOG_KINDS: readonly LogKind[] = (Object.keys(LOG_KINDS) as LogKind[]).filter(
  (kind) => LOG_KIND_GROUP[kind] !== null,
)

/** The kinds a filter shows; all the shown kinds for no group. */
export function logKindsOf(group: LogGroup | null): readonly LogKind[] {
  return group === null
    ? SHOWN_LOG_KINDS
    : SHOWN_LOG_KINDS.filter((kind) => LOG_KIND_GROUP[kind] === group)
}

/** True for a filter name. */
export function isLogGroup(value: unknown): value is LogGroup {
  return typeof value === 'string' && (LOG_GROUPS as readonly string[]).includes(value)
}
