// R15 Features, fail-closed (D71): which guest controls the face may draw. A control is shown only
// when every condition holds, and a missing, unreadable or unknown input switches it off.
//
//   features = snapshot.features, else core's DEFAULT_GUEST_FEATURES (filters on, services off)
//   filters  = features.filters  AND  the menu has at least one chip (a tag or a dietary label)
//   service(x) = the venue switched x on   (snapshot)
//            AND the platform supports x   (context.capabilities.x)
//            AND the channel is interactive (qr, kiosk)
//            AND a confirmed table token is present
//   callWaiter = service(callWaiter) AND at least one request kind        → { kinds } or null
//   bill, pay  = service(bill), service(pay)
//   ordering   = service(ordering)  AND  R11's `ordering.enabled`
//
// R11 (`order.controls`, `ordering.enabled`) is unchanged: this rule only decides whether the
// control that opens the bag is drawn at all. Allergen information is not a feature and has no
// switch (R6).
//
// The request kinds are core's `CALL_WAITER_KINDS` (SH-01), re-exported here as `SERVICE_KINDS`:
// the shell keeps no second list.

import {
  CALL_WAITER_KINDS,
  type CallWaiterKind,
  DEFAULT_GUEST_FEATURES,
  type GuestFeatures,
} from '@restro/core'

import type { ShellCapabilities } from './context'

/** The request kinds a guest can ask staff for (core's `CALL_WAITER_KINDS`). */
export const SERVICE_KINDS = CALL_WAITER_KINDS

/** One request kind. */
export type ServiceKind = CallWaiterKind

/** R15: what the face may draw for this venue, platform, channel and table. */
export interface ViewFeatures {
  /** Show the filter control: the venue left filters on and the menu has chips. */
  readonly filters: boolean
  /** Call-a-waiter with the request kinds the venue allows, or null. */
  readonly callWaiter: { readonly kinds: readonly ServiceKind[] } | null
  readonly bill: boolean
  /** Ordering controls; also needs today's R11 `ordering.enabled`. */
  readonly ordering: boolean
  readonly pay: boolean
}

/** What R15 reads, already worked out by the caller. */
export interface FeatureInputs {
  /** The snapshot's `features`, or undefined for a snapshot published before D71. */
  readonly features: GuestFeatures | undefined
  readonly capabilities: ShellCapabilities
  /** The channel is one a guest can touch (qr, kiosk). */
  readonly interactive: boolean
  /** The confirmed table token of the page, or null. */
  readonly tableToken: string | null
  /** How many filter chips (tags plus dietary labels) the menu has. */
  readonly chips: number
  /** R11: ordering is on for this venue, channel and table. */
  readonly orderingEnabled: boolean
}

/** Applies R15. Pure: the same inputs always give the same features. */
export function viewFeatures(input: FeatureInputs): ViewFeatures {
  const features = input.features ?? DEFAULT_GUEST_FEATURES
  const { capabilities } = input
  const reachable = input.interactive && input.tableToken !== null
  const service = (switchedOn: boolean, supported: boolean) => switchedOn && supported && reachable

  const asked = new Set<string>(features.call_waiter.kinds)
  const kinds = SERVICE_KINDS.filter((kind) => asked.has(kind))
  return {
    filters: features.filters && input.chips > 0,
    callWaiter:
      service(features.call_waiter.enabled, capabilities.callWaiter) && kinds.length > 0
        ? { kinds }
        : null,
    bill: service(features.bill, capabilities.bill),
    ordering: service(features.ordering, capabilities.ordering) && input.orderingEnabled,
    pay: service(features.pay, capabilities.pay),
  }
}
