// A venue's payment account, the worker's side (#109; D125 §The venue's side, D127 1.2): the only
// place that asks the provider about it. Every provider call runs here, outside any transaction, and
// what the provider answers is recorded through core/service as the worker:
//
// - `startAccountConnection`: the owner pressed "Connect" (or refresh, or "Reconnect"). The service
//   path checks `settings.connect_payments` and the 15-minute sign-in, makes the row `connecting`,
//   and only then is the provider asked for the hosted onboarding link. Only that address leaves
//   the worker; the provider's account and keys never do (rule 3).
// - `readAccount`: reads the provider's account back and records it (`payment_account.observed`).
//   The owner's return, an `account.updated` notice and the lost-access check all come here: a
//   notice is a nudge, the reading is the fact (D125 3.8). When card payments are allowed and the
//   guest page's host is not registered for wallets, it is registered now (D125 3.6).
// - `recordLostAccess`: the provider says the venue took Restro's access away (D125 2.4); paying
//   pauses at once, with no reading in the way.
//
// A timeout is `unknown`, never a refusal: the owner is told to try again, and nothing is recorded
// that the provider did not say. A partial reading concludes nothing.

import { randomUUID } from 'node:crypto'

import { type PaymentProvider, providerRef, readAccountChecks } from '@restro/core'
import { applyService, type ServiceContext } from '@restro/core/service'
import { type DbPool, paymentAccounts, withTenant } from '@restro/db'
import { eq } from 'drizzle-orm'

import type { Logger } from '../logger'

/** What the connection steps need of a provider. */
export type ConnectionProvider = Pick<
  PaymentProvider,
  'kind' | 'startConnection' | 'readConnection' | 'prepareDomain'
>

export interface ConnectionEnv {
  readonly pool: DbPool
  readonly log: Logger
  readonly jobId: string
}

/** The venue's account row as the worker reads it. */
interface AccountRow {
  readonly providerKind: string
  readonly accountRef: string | null
  readonly state: string
  readonly checks: unknown
  readonly updatedAt: Date
}

async function accountOf(
  env: ConnectionEnv,
  target: { readonly tenantId: string; readonly venueId: string },
): Promise<AccountRow | null> {
  const [row] = await withTenant(env.pool, target.tenantId, (tx) =>
    tx
      .select({
        providerKind: paymentAccounts.providerKind,
        accountRef: paymentAccounts.accountRef,
        state: paymentAccounts.state,
        checks: paymentAccounts.checks,
        updatedAt: paymentAccounts.updatedAt,
      })
      .from(paymentAccounts)
      .where(eq(paymentAccounts.venueId, target.venueId)),
  )
  return row ?? null
}

const asWorker = (
  env: ConnectionEnv,
  target: { readonly tenantId: string; readonly venueId: string },
): ServiceContext => ({
  tenantId: target.tenantId,
  venueId: target.venueId,
  origin: 'worker',
  actor: { kind: 'system' },
  jobId: env.jobId,
})

/** Why a connection step did not finish; the owner is told in words by the screen. */
export type ConnectionFailure =
  /** The provider could not be asked, or did not answer: nothing was recorded; try again. */
  | 'provider_unavailable'
  /** The provider said no (it names no reason the owner can act on here). */
  | 'provider_refused'
  /** This worker has no such provider. */
  | 'no_provider'
  /** The service path refused (a missing right, an old sign-in, or no account to read). */
  | { readonly refused: string }

export type StartOutcome =
  | { readonly kind: 'link'; readonly url: string }
  | { readonly kind: 'failed'; readonly failure: ConnectionFailure }

/**
 * The hosted onboarding link, after the service path agreed. `context` is the person's (the
 * staff command checks their right); the provider call and the recording of its account are the
 * worker's own.
 */
export async function startAccountConnection(
  env: ConnectionEnv,
  context: ServiceContext,
  provider: ConnectionProvider,
  request: { readonly returnUrl: string; readonly refreshUrl: string; readonly guestHost: string },
): Promise<StartOutcome> {
  const target = { tenantId: context.tenantId, venueId: context.venueId }
  const { result } = await applyService(
    env.pool,
    { type: 'payment_account.connect', providerKind: provider.kind },
    context,
  )
  if (result.status === 'refused') return { kind: 'failed', failure: { refused: result.code } }

  const account = await accountOf(env, target)
  if (account === null) return { kind: 'failed', failure: { refused: 'account_missing' } }

  // The link is single-use, so once there is an account every press makes a new link with a fresh
  // key. While no account is recorded the key stays the same for the whole connecting attempt: a
  // double press or a timeout then gets the same provider account again, not a second one left
  // behind. The attempt is the row as `connect` last changed it (a repeat press changes nothing).
  const attempt = account.accountRef === null ? account.updatedAt.getTime() : randomUUID()
  const outcome = await provider.startConnection({
    venueId: context.venueId as `vn_${string}`,
    accountRef: account.accountRef === null ? null : providerRef(account.accountRef),
    returnUrl: request.returnUrl,
    refreshUrl: request.refreshUrl,
    idempotencyKey: `connect:${context.venueId}:${attempt}`,
  })
  if (outcome.kind === 'unknown') {
    env.log.warn({ venueId: context.venueId }, 'the provider did not answer a connection start')
    return { kind: 'failed', failure: 'provider_unavailable' }
  }
  if (outcome.kind === 'refused') {
    env.log.warn(
      { venueId: context.venueId, code: outcome.refusal.code, scope: outcome.refusal.scope },
      'the provider refused a connection start',
    )
    return { kind: 'failed', failure: 'provider_refused' }
  }

  const { result: recorded } = await applyService(
    env.pool,
    {
      type: 'payment_account.started',
      accountRef: outcome.result.accountRef.provider,
      guestHost: request.guestHost,
    },
    asWorker(env, target),
  )
  if (recorded.status === 'refused') {
    return { kind: 'failed', failure: { refused: recorded.code } }
  }
  return { kind: 'link', url: outcome.result.redirectUrl }
}

export type ReadOutcome =
  | { readonly kind: 'read'; readonly state: string }
  /** No account of ours to read, or none with a provider reference yet. */
  | { readonly kind: 'no_account' }
  | { readonly kind: 'no_provider' }
  /** The provider could not be read in full: nothing was recorded. */
  | { readonly kind: 'unreadable' }
  | { readonly kind: 'refused'; readonly code: string }

/**
 * Reads the venue's account back from the provider and records it. `afterReturn` is the owner's
 * return from the hosted form; a notice passes false. `guestHost` is the host the web app named
 * (a notice names none; the one remembered from the start is used).
 */
export async function readAccount(
  env: ConnectionEnv,
  target: { readonly tenantId: string; readonly venueId: string },
  providers: ReadonlyMap<string, ConnectionProvider>,
  options: { readonly afterReturn: boolean; readonly guestHost: string | null },
): Promise<ReadOutcome> {
  const account = await accountOf(env, target)
  if (account === null || account.accountRef === null) return { kind: 'no_account' }
  const provider = providers.get(account.providerKind)
  if (provider === undefined) return { kind: 'no_provider' }

  let reading: Awaited<ReturnType<ConnectionProvider['readConnection']>>
  try {
    reading = await provider.readConnection(providerRef(account.accountRef))
  } catch (error) {
    env.log.warn({ venueId: target.venueId, err: error }, 'a payment account could not be read')
    return { kind: 'unreadable' }
  }
  if (!reading.complete) {
    env.log.warn(
      { venueId: target.venueId, reason: reading.reason },
      'a payment account reading was incomplete',
    )
    return { kind: 'unreadable' }
  }

  const { result } = await applyService(
    env.pool,
    {
      type: 'payment_account.observed',
      accountRef: account.accountRef,
      canTakePayments: reading.value.canTakePayments,
      missing: [...reading.value.missing],
      afterReturn: options.afterReturn,
      guestHost: options.guestHost,
      displayName: reading.value.displayName,
    },
    asWorker(env, target),
  )
  if (result.status === 'refused') return { kind: 'refused', code: result.code }
  const state = typeof result.details.state === 'string' ? result.details.state : account.state

  if (state === 'connected' && reading.value.canTakePayments) {
    await registerDomain(env, target, provider, account.accountRef)
  }
  return { kind: 'read', state }
}

/**
 * The scheduled retry of a registration that did not go through (`wallet-domain` job): a venue
 * whose account takes cards and whose guest host is not registered yet is tried again on its own
 * schedule, not only when some other reading happens. Nothing is asked of a provider for an account
 * that is not connected, cannot take cards, or has its host registered already.
 */
export async function retryDomainRegistration(
  env: ConnectionEnv,
  target: { readonly tenantId: string; readonly venueId: string },
  providers: ReadonlyMap<string, ConnectionProvider>,
): Promise<void> {
  const account = await accountOf(env, target)
  if (account === null || account.accountRef === null || account.state !== 'connected') return
  if (!readAccountChecks(account.checks).cardPayments) return
  const provider = providers.get(account.providerKind)
  if (provider === undefined) return
  await registerDomain(env, target, provider, account.accountRef)
}

/** Registers the guest page's host for wallets, once per host (D125 3.6); wallets are optional. */
async function registerDomain(
  env: ConnectionEnv,
  target: { readonly tenantId: string; readonly venueId: string },
  provider: ConnectionProvider,
  accountRef: string,
): Promise<void> {
  const row = await accountOf(env, target)
  const checks = readAccountChecks(row?.checks)
  const host = checks.guestHost
  if (host === null || checks.domainHost === host) return
  try {
    const outcome = await provider.prepareDomain({
      accountRef: providerRef(accountRef),
      host,
      idempotencyKey: `domain:${target.venueId}:${host}`,
    })
    if (outcome.kind !== 'done') {
      // Wallets stay off for this venue until the `wallet-domain` job (or a later reading) tries
      // again; paying itself works.
      env.log.warn(
        { venueId: target.venueId, outcome: outcome.kind },
        'the guest domain was not registered for wallets',
      )
      return
    }
    await applyService(
      env.pool,
      { type: 'payment_account.domain', accountRef, host },
      asWorker(env, target),
    )
  } catch (error) {
    env.log.warn({ venueId: target.venueId, err: error }, 'registering the guest domain failed')
  }
}

export type LostOutcome = 'lost' | 'unknown_account'

/**
 * The provider says the venue took Restro's access away (D125 2.4): paying pauses at once and
 * owners and managers are alerted, whatever a reading of the account would say. The notice is
 * signature-checked and stored once by its event id, and `payment_account.lost` is idempotent. No
 * read-back gates it: what a provider's read of an account answers after the venue disconnects is
 * not documented (docs/deliverables/2026-10-22-stripe-knowledge.md, Open), so a read that works
 * proves nothing about access.
 */
export async function recordLostAccess(
  env: ConnectionEnv,
  target: { readonly tenantId: string; readonly venueId: string },
  accountRef: string,
): Promise<LostOutcome> {
  const { result } = await applyService(
    env.pool,
    { type: 'payment_account.lost', accountRef },
    asWorker(env, target),
  )
  return result.status === 'accepted' ? 'lost' : 'unknown_account'
}
