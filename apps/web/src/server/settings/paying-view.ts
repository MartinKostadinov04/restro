// What the Paying section draws (#109 reads it; the screens are #116): the venue's payment account
// as the platform stores it, and what paying still waits for (D125 2.3). Reads only; plain data safe
// for the browser: it carries no provider id, no key and no onboarding link (rule 3).
import {
  type AccountState,
  type CheckStanding,
  CURRENCIES,
  type Currency,
  type LegalDetails,
  type PayingCheck,
  type PayingMissing,
  type PaymentMode,
  readPayingSettings,
} from '@restro/core'
import { readPayFirstOverview, readPayingConnection, readPayingOffer } from '@restro/core/service'
import type { Venue } from '@restro/db'

import { providerOf } from '../../connectors/providers'
import { getPool } from '../db'
import { tillLabelOfVenue } from '../tables/service'

/** One check as the section lists it. */
export interface PayingCheckView {
  readonly check: PayingCheck
  readonly passed: boolean
  /** `owner`: the owner ticks it; `provider` and `venue` are read by Restro. */
  readonly source: CheckStanding['source']
}

/**
 * The "Pay first" card (#216): the venue's item default, whether pay first applies at every table,
 * and how many areas and tables have a choice of their own.
 */
export interface PayFirstCard {
  readonly itemMode: PaymentMode
  readonly applies: boolean
  readonly overrides: number
}

/** Everything the Paying section draws about the account. */
export interface PayingView {
  readonly venueId: string
  /** Null: the venue never pressed Connect. */
  readonly state: AccountState | null
  readonly accountName: string | null
  /** The four checks in D125's order; paying is on only when all pass. */
  readonly checks: readonly PayingCheckView[]
  readonly missing: readonly PayingMissing[]
  /** True only when the account is connected and every check passes. */
  readonly payingOn: boolean
  /** Why paying is paused on a lost account: "Reconnect" is offered. */
  readonly lostReason: 'access_removed' | 'account_restricted' | null
  /** True when the signed-in person holds `settings.connect_payments`: otherwise read-only. */
  readonly canConnect: boolean
  /** The smallest card payment the owner chose (#104), minor units, or null for the provider's. */
  readonly minCardMinor: number | null
  /** The provider's smallest card payment in the venue's currency, minor units. */
  readonly providerMinimumMinor: number
  /** The venue's currency. */
  readonly currency: string
  /** The name that fills `{provider}`. */
  readonly provider: string
  /** The POS's name that fills `{source}`. */
  readonly source: string
  /** A POS serving the venue puts a tip on the same receipt. */
  readonly tips: boolean
  /** The venue's legal details (#198), or null until all four are filled in. */
  readonly legal: LegalDetails | null
  /**
   * The "Pay first" card, or null where it is not shown: no POS of the venue declares
   * `firstItemsOpenBill`, or card payments are not on (connecting, details missing, disconnected).
   * The saved choices are kept meanwhile (#216).
   */
  readonly payFirst: PayFirstCard | null
  /** The signed-in person's email, for the password again. */
  readonly email: string
}

/** The venue's Paying view. */
export async function loadPayingView(input: {
  readonly tenantId: string
  readonly venue: Venue
  readonly canConnect: boolean
  readonly email: string
}): Promise<PayingView> {
  const connection = await readPayingConnection(getPool(), input.tenantId, input.venue.id)
  const { readiness } = connection
  const currency = CURRENCIES.find((c): c is Currency => c === input.venue.currency) ?? 'EUR'
  const provider = providerOf(connection.providerKind)
  const [offer, source, payFirst] = await Promise.all([
    readPayingOffer(getPool(), input.tenantId, input.venue.id),
    tillLabelOfVenue(getPool(), input.tenantId, input.venue.id),
    readPayFirstOverview(getPool(), input.tenantId, input.venue.id, input.venue.settings),
  ])
  return {
    venueId: input.venue.id,
    state: connection.state,
    accountName: connection.accountName,
    checks: readiness.checks.map(({ check, passed, source }) => ({ check, passed, source })),
    missing: readiness.missing,
    payingOn: readiness.on,
    lostReason: connection.state === 'lost_access' ? connection.checks.lostReason : null,
    canConnect: input.canConnect,
    minCardMinor: readPayingSettings(input.venue.settings).minCardMinor,
    providerMinimumMinor: provider?.minimumMinor(currency) ?? 0,
    currency: input.venue.currency,
    provider: provider?.label ?? connection.providerKind ?? '',
    source: source ?? '',
    tips: offer.tips,
    legal: connection.legal,
    payFirst: payFirst.possible
      ? {
          itemMode: payFirst.settings.itemMode,
          applies: payFirst.settings.applies,
          overrides: payFirst.overrides,
        }
      : null,
    email: input.email,
  }
}
