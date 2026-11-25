// The wallet domain job (#167; D125 3.6, D127).
//
//   wallet-domain  every 15 minutes: registers the guest page's host for wallets on each connected
//                  account that takes cards and has no registration for that host yet
//
// The registration is first tried when an account is read as taking cards (`readAccount`). A
// registration the provider did not take (a timeout, a refusal) is not tried again by anything
// but the next reading, which may be a long way off: this job tries again on its own schedule.
// Wallets are optional and paying works without them, so a failure here is only logged.
//
// One run at a time (`exclusive`): the registration is idempotent at the provider, but one call
// per account at a time keeps the log quiet.

import { JOB_NAMES } from '@restro/core'
import { paymentAccountVenues } from '@restro/core/service'

import { retryDomainRegistration } from '../payments/connection'
import { connectionProviders, type NoticeProviders } from './provider-notices'
import { defineJob, type JobDefinition } from './types'

export interface WalletDomainDeps {
  readonly providers: NoticeProviders
}

/** What one pass did. */
export interface WalletDomainCounts {
  /** Registrations tried: the provider was asked. */
  readonly attempted: number
  readonly registered: number
}

/**
 * One pass over every live venue of every provider this worker can ask about an account. One
 * venue's error never ends the pass; it is logged and the next venue goes on.
 */
export async function retryWalletDomains(
  env: Parameters<typeof retryDomainRegistration>[0],
  deps: WalletDomainDeps,
): Promise<WalletDomainCounts> {
  const providers = connectionProviders(deps.providers)
  let attempted = 0
  let registered = 0
  for (const kind of providers.keys()) {
    for (const venue of (await paymentAccountVenues(env.pool, kind, { liveOnly: true })).values()) {
      try {
        const outcome = await retryDomainRegistration(env, venue, providers)
        if (outcome !== 'not_due') attempted += 1
        if (outcome === 'registered') registered += 1
      } catch (error) {
        env.log.warn({ venueId: venue.venueId, err: error }, 'a wallet domain could not be retried')
      }
    }
  }
  return { attempted, registered }
}

/** The wallet domain job. */
export function createWalletDomainJob(deps: WalletDomainDeps): JobDefinition {
  return defineJob({
    name: JOB_NAMES.walletDomain,
    schedule: { cron: '*/15 * * * *', tz: 'Europe/Sofia' },
    options: {
      policy: 'exclusive',
      // The next run comes in 15 minutes; a failed one is not retried.
      queue: {
        retryLimit: 0,
        expireInSeconds: 10 * 60,
        retentionSeconds: 60 * 60,
        deleteAfterSeconds: 60 * 60,
      },
    },
    async handler(jobs, context) {
      const jobId = jobs[0]?.id ?? 'wallet-domain'
      const counts = await retryWalletDomains({ pool: context.pool, log: context.log, jobId }, deps)
      context.log[counts.attempted > 0 ? 'info' : 'debug'](counts, 'wallet domains retried')
    },
  }) as JobDefinition
}
