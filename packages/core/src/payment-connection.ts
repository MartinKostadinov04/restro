// A venue's payment account as the platform reads it (D125 §The venue's side, 2.3 and 2.4; ticket
// #109): the checks stored on `payment_accounts.checks`, and the rule that paying turns on only when
// every check passes. Pure data and pure functions: no I/O, safe in the browser.
//
// The four checks of D125 2.3 and where each one comes from:
//   - `cardPayments`: the provider allows card payments on the account. Read from the provider
//     (`readConnection`), stored as last read.
//   - `paymentTables`: payment tables are marked. Read from the venue's own tables (a payment table
//     in every queue that has real tables), never stored.
//   - `cardTypeInTill`: the card payment type is chosen in the till. The connector seam gives no way
//     to read it, so it is the owner's explicit tick, stored with who and when. Not done until ticked.
//   - `receiptEmailsOff`: the provider's guest receipt emails are off. The provider seam gives no way
//     to read it, so it is the owner's explicit tick. Not done until ticked.
// An unknown is never a pass: a tick is the owner saying so, and the default is "not done".

import { z } from 'zod'

/** The checks, in the order D125 2.3 lists them. */
export const PAYING_CHECKS = [
  'cardPayments',
  'cardTypeInTill',
  'paymentTables',
  'receiptEmailsOff',
] as const
export type PayingCheck = (typeof PAYING_CHECKS)[number]

/** The checks only the owner can say are done (the platform cannot read them). */
export const OWNER_TICKS = ['cardTypeInTill', 'receiptEmailsOff'] as const
export type OwnerTick = (typeof OWNER_TICKS)[number]

/** Why a venue's account that once took payments does not now (D125 2.4). */
export const LOST_REASONS = ['access_removed', 'account_restricted'] as const
export type LostReason = (typeof LOST_REASONS)[number]

/** Who ticked a check and when: the actor as the provenance columns write it. */
export const TickSchema = z.strictObject({
  at: z.iso.datetime({ offset: true }),
  by: z.string().min(1).max(140),
})
export type Tick = z.output<typeof TickSchema>

/** `payment_accounts.checks` as stored. A key left out is "not done" or "none". */
export const AccountChecksSchema = z.strictObject({
  /** The provider allowed card payments when it was last read. */
  cardPayments: z.boolean().default(false),
  /** The provider's own words for what it still asks of the owner, as last read. */
  missing: z.array(z.string().min(1).max(200)).max(100).default([]),
  /** Set while the account is `lost_access`: whether it can come back by itself. */
  lostReason: z.enum(LOST_REASONS).nullable().default(null),
  /** The guest page's host the venue's wallets should work on (D125 3.6), as the web app named it. */
  guestHost: z.string().min(1).max(253).nullable().default(null),
  /** The host registered for wallets on the account so far, or null. */
  domainHost: z.string().min(1).max(253).nullable().default(null),
  ticks: z
    .strictObject({
      cardTypeInTill: TickSchema.nullable().default(null),
      receiptEmailsOff: TickSchema.nullable().default(null),
    })
    .default({ cardTypeInTill: null, receiptEmailsOff: null }),
})
export type AccountChecks = z.output<typeof AccountChecksSchema>

/** Nothing read, nothing ticked: what a new account starts with. */
export const NO_CHECKS: AccountChecks = {
  cardPayments: false,
  missing: [],
  lostReason: null,
  guestHost: null,
  domainHost: null,
  ticks: { cardTypeInTill: null, receiptEmailsOff: null },
}

/** The checks from the stored JSON; anything that does not parse reads as nothing done. */
export function readAccountChecks(stored: unknown): AccountChecks {
  const parsed = AccountChecksSchema.safeParse(stored ?? {})
  return parsed.success ? parsed.data : NO_CHECKS
}

/** The states of `payment_accounts.state` (`PAYMENT_ACCOUNT_STATES` in `@restro/db`). */
export type AccountState = 'connecting' | 'connected' | 'lost_access' | 'disconnected'

/** What the venue's tables say about "payment tables are marked". */
export interface PaymentTableFacts {
  /** Payment tables marked in the venue. */
  readonly paymentTables: number
  /** Queues (a bar, or no bar) with real tables but no payment table of their own. */
  readonly queuesWithoutOne: number
}

/** One check's standing, with where it is decided. */
export interface CheckStanding {
  readonly check: PayingCheck
  readonly passed: boolean
  /** `provider` and `venue` are read; `owner` is the owner's tick. */
  readonly source: 'provider' | 'venue' | 'owner'
}

/** Whether paying is on, and what is missing when it is not. */
export interface PayingReadiness {
  /** True only when the account is connected and every check passes. */
  readonly on: boolean
  readonly checks: readonly CheckStanding[]
  /** The checks not passed, in D125's order. */
  readonly missing: readonly PayingCheck[]
  /** The provider's own words for what it still asks of the owner. */
  readonly providerMissing: readonly string[]
}

/**
 * The reading the settings show and `pay.start` obeys (D125 2.3): paying is on only when the
 * account is connected and all four checks pass. Any other state is off.
 */
export function payingReadiness(input: {
  readonly state: AccountState | null
  readonly checks: AccountChecks
  readonly tables: PaymentTableFacts
}): PayingReadiness {
  const { checks, tables } = input
  const standings: CheckStanding[] = [
    { check: 'cardPayments', passed: checks.cardPayments, source: 'provider' },
    { check: 'cardTypeInTill', passed: checks.ticks.cardTypeInTill !== null, source: 'owner' },
    {
      check: 'paymentTables',
      passed: tables.paymentTables > 0 && tables.queuesWithoutOne === 0,
      source: 'venue',
    },
    { check: 'receiptEmailsOff', passed: checks.ticks.receiptEmailsOff !== null, source: 'owner' },
  ]
  const missing = standings.filter((standing) => !standing.passed).map((s) => s.check)
  return {
    on: input.state === 'connected' && missing.length === 0,
    checks: standings,
    missing,
    providerMissing: checks.cardPayments ? [] : checks.missing,
  }
}
