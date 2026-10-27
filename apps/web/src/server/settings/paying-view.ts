// What the Paying section draws (#109 reads it; the screens are #116): the venue's payment account
// as the platform stores it, and what paying still waits for (D125 2.3). Reads only; plain data safe
// for the browser: it carries no provider id, no key and no onboarding link (rule 3).
import {
  type AccountState,
  type CheckStanding,
  type PayingCheck,
  readPayingSettings,
} from '@restro/core'
import { readPayingConnection } from '@restro/core/service'
import type { Venue } from '@restro/db'

import { getPool } from '../db'

/** One check as the section lists it. */
export interface PayingCheckView {
  readonly check: PayingCheck
  readonly passed: boolean
  /** `owner`: the owner ticks it; `provider` and `venue` are read by Restro. */
  readonly source: CheckStanding['source']
}

/** Everything the Paying section draws about the account. */
export interface PayingView {
  readonly venueId: string
  /** Null: the venue never pressed Connect. */
  readonly state: AccountState | null
  readonly accountName: string | null
  /** The four checks in D125's order; paying is on only when all pass. */
  readonly checks: readonly PayingCheckView[]
  readonly missing: readonly PayingCheck[]
  /** The provider's own words for what it still asks of the owner. */
  readonly providerMissing: readonly string[]
  /** True only when the account is connected and every check passes. */
  readonly payingOn: boolean
  /** Why paying is paused on a lost account: "Reconnect" is offered. */
  readonly lostReason: 'access_removed' | 'account_restricted' | null
  /** True when the signed-in person holds `settings.connect_payments`: otherwise read-only. */
  readonly canConnect: boolean
  /** The smallest card payment the owner chose (#104), minor units, or null for the provider's. */
  readonly minCardMinor: number | null
}

/** The venue's Paying view. */
export async function loadPayingView(input: {
  readonly tenantId: string
  readonly venue: Venue
  readonly canConnect: boolean
}): Promise<PayingView> {
  const connection = await readPayingConnection(getPool(), input.tenantId, input.venue.id)
  const { readiness } = connection
  return {
    venueId: input.venue.id,
    state: connection.state,
    accountName: connection.accountName,
    checks: readiness.checks.map(({ check, passed, source }) => ({ check, passed, source })),
    missing: readiness.missing,
    providerMissing: readiness.providerMissing,
    payingOn: readiness.on,
    lostReason: connection.state === 'lost_access' ? connection.checks.lostReason : null,
    canConnect: input.canConnect,
    minCardMinor: readPayingSettings(input.venue.settings).minCardMinor,
  }
}
