// The worker's names for the first connector's tables (D82, D67): a venue of ours serves one till
// venue (`tillVenueLinks`). Platform code in the worker (the purge job) reads and erases the links
// under this name, so no vendor word reaches it; the columns are the connector's own. The same
// pair apps/web keeps in src/connectors/till-venues.ts and core in
// packages/core/src/connectors/till-venues.ts.

import { randomUUID } from 'node:crypto'

import type { PaymentProvider, ProviderRef } from '@restro/core'
import { checkSimPayEnv, createSimPayProvider, SIM_PAY_KIND, SimPayEngine } from '@restro/sim-pay'
import { createStripeProvider, STRIPE_KIND } from '@restro/stripe'

export { barsyVenues as tillVenueLinks } from '@restro/db'

/**
 * The provider's name for a sentence (`{provider}`, #222): the group's message about a refund names
 * the place the venue made it. The web app keeps the same names (`apps/web/src/connectors`).
 */
export function providerDisplayName(kind: string | null): string | null {
  switch (kind) {
    case STRIPE_KIND:
      return 'Stripe'
    case SIM_PAY_KIND:
      return 'Sim Pay'
    default:
      return null
  }
}

/** The payment providers the worker pays through, by kind (`payments.provider_kind`). */
export type PaymentProviders = ReadonlyMap<string, PaymentProvider>

/**
 * The simulated provider's engine, one for the whole worker process. It keeps every account and
 * payment in memory, so the connection endpoint, the payment jobs and the notices must all talk to
 * the same one: an owner who connected on one engine would otherwise find the guest's payment
 * asking another that has never heard of the account (#398).
 */
let sharedSimEngine: SimPayEngine | null = null
function simEngine(env: NodeJS.ProcessEnv): SimPayEngine {
  sharedSimEngine ??= new SimPayEngine({
    clock: { now: () => new Date() },
    run: randomUUID().replaceAll('-', ''),
    // `WORKER_PAYMENTS_SIM_CARD=accept`: the bank accepts the card as the hold is made, because
    // nothing outside this process can play the guest at the simulator's form and a walk-through
    // would otherwise stop there for ever. Only the demo club's walk sets it; the end-to-end tests
    // play the guest themselves. It is read once, when the engine is made, like the run.
    ...(env.WORKER_PAYMENTS_SIM_CARD === 'accept'
      ? { switches: { guestCardAccepted: true } }
      : {}),
  })
  // The engine keeps its accounts in memory, so a worker start forgets the account a database
  // already records and refuses every call about it (`access_lost`): the demo club's paying would
  // read as paused on a club that is set up. Naming the same reference at every start keeps the
  // two in step. Development only: the simulator is refused in production, and a real provider has
  // no such setting.
  const seeded = seededSimAccount(env)
  if (seeded !== null) sharedSimEngine.addNamedAccount(seeded.ref, seeded.displayName)
  return sharedSimEngine
}

/**
 * The account the demo seed records (`apps/web/scripts/seed-demo.ts`), as
 * `WORKER_PAYMENTS_SIM_ACCOUNT` names it, with the display name beside it; `null` when the setting
 * is unset or blank, so a worker nobody told about a demo club invents no account.
 */
export function seededSimAccount(
  env: NodeJS.ProcessEnv,
): { readonly ref: string; readonly displayName: string | null } | null {
  const ref = env.WORKER_PAYMENTS_SIM_ACCOUNT?.trim()
  if (ref === undefined || ref === '') return null
  return { ref, displayName: env.WORKER_PAYMENTS_SIM_ACCOUNT_NAME?.trim() || null }
}

/**
 * The payment providers the worker pays through (#110) and reads notices back from (#108), by kind, built from the
 * worker's configuration (#107). Stripe is built when `STRIPE_SECRET_KEY` is set (the platform's
 * secret or restricted key), checked against `PAYMENTS_ENV`: a live key only in production, a test
 * key never there, and a key without a valid `PAYMENTS_ENV` stops the worker at start
 * (`StripeConfigError`, which never carries the key). A stored notice of a provider not listed
 * waits (`provider-notices`), and the job logs it once it is a day old.
 *
 * The simulated provider (#103) is built only with `WORKER_PAYMENTS_SIM=on`, for walking the
 * owner's Paying settings (#116) and paying by hand (#398): one in-memory engine for the whole
 * process, refused in production by `createSimPayProvider`, so no setting can make a guest "pay" a
 * simulator there. Two settings of that engine's own serve the demo club's walk-through and
 * nothing else: `WORKER_PAYMENTS_SIM_ACCOUNT` (the account the seed records, so a restart knows it
 * again) and `WORKER_PAYMENTS_SIM_CARD=accept` (the bank accepts the card at the hold). Both are
 * refused in production with the provider itself.
 */
export function paymentProviders(env: NodeJS.ProcessEnv = process.env): PaymentProviders {
  const providers = new Map<string, PaymentProvider>()
  const stripeKey = env.STRIPE_SECRET_KEY
  if (stripeKey !== undefined && stripeKey !== '') {
    providers.set(
      STRIPE_KIND,
      createStripeProvider({ env: env.PAYMENTS_ENV ?? '', key: stripeKey }),
    )
  }
  if (env.WORKER_PAYMENTS_SIM === 'on') {
    providers.set(
      SIM_PAY_KIND,
      createSimPayProvider({ env: env.PAYMENTS_ENV ?? '', engine: simEngine(env) }),
    )
  }
  return providers
}

/**
 * What the simulated provider can do that no real provider can (#398): finish its hosted form for
 * the owner, so the owner's whole route (Connect, the form, back, the account read) can be walked
 * by hand. Empty without `WORKER_PAYMENTS_SIM=on`; it throws in production like the provider does.
 * Both guards stand on their own, and the web page has a third (`apps/web/src/connectors/sim-pay`).
 */
export type SimulatedForms = ReadonlyMap<string, (accountRef: ProviderRef) => void>

export function simulatedForms(env: NodeJS.ProcessEnv = process.env): SimulatedForms {
  if (env.WORKER_PAYMENTS_SIM !== 'on') return new Map()
  checkSimPayEnv(env.PAYMENTS_ENV ?? '')
  const engine = simEngine(env)
  return new Map([[SIM_PAY_KIND, (accountRef) => engine.finishConnecting(accountRef)]])
}
