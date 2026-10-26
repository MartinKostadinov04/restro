// The alerts' jobs (#83; D120, D122 §7).
//
//   alert-delivery    every minute: runs the delivery pass (../alerts/deliver.ts) every 5 seconds
//                     for the rest of the minute, so the first message of an Unconfirmed order goes
//                     10 seconds after it was raised, not at the next minute. Registered when the
//                     Web Push keys or the Telegram bot token are set.
//   healthcheck-ping  every minute: pings the outside watchdog (Healthchecks.io) after a trivial
//                     database read, so a missing ping means the queue or the database is down as
//                     much as the process. Registered when HEALTHCHECKS_PING_URL is set. When the
//                     pings stop, Healthchecks alerts the Restro team by Telegram (its own setup).
//
// The Telegram long poll for Done presses is not a job: it is a loop the worker starts and stops
// (../alerts/telegram-poller.ts).

import { JOB_NAMES } from '@restro/core'
import { withSystem } from '@restro/db'
import { sql } from 'drizzle-orm'

import { deliverAlerts } from '../alerts/deliver'
import { createPushSender } from '../alerts/push'
import { createTelegramClient } from '../alerts/telegram'
import type { AlertsConfig } from '../config'
import type { Logger } from '../logger'
import { defineJob, type JobDefinition } from './types'

/** How often the delivery pass runs inside its minute. */
export const PASS_EVERY_MS = 5_000
/** How much of the minute the passes use; the next minute's job starts after this. */
export const PASS_BUDGET_MS = 55_000
/** A ping that takes longer than this is given up on; the next minute pings again. */
export const PING_TIMEOUT_MS = 10_000

type Fetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>

/**
 * Pings the watchdog; answers whether it was reached. Logs the failure without the address, which
 * is a secret of the watchdog check.
 */
export async function pingHealthcheck(
  url: string,
  log: Pick<Logger, 'warn'>,
  fetchImpl: Fetch = fetch,
): Promise<boolean> {
  try {
    const response = await fetchImpl(url, { signal: AbortSignal.timeout(PING_TIMEOUT_MS) })
    if (!response.ok) {
      log.warn({ status: response.status }, 'the watchdog did not take the ping')
      return false
    }
    return true
  } catch {
    log.warn('the watchdog could not be reached')
    return false
  }
}

interface Options {
  readonly alerts: AlertsConfig
  readonly passEveryMs?: number
  readonly budgetMs?: number
  /** Replaced in tests. */
  readonly sleep?: (ms: number, signal?: AbortSignal) => Promise<void>
  readonly fetch?: Fetch
}

const sleepFor = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms)
    signal?.addEventListener('abort', () => {
      clearTimeout(timer)
      resolve()
    })
  })

/** The alerts' jobs this configuration asks for. */
export function createAlertJobs(options: Options): JobDefinition[] {
  const { alerts } = options
  const jobs: JobDefinition[] = []
  const telegram =
    alerts.telegramToken === null
      ? null
      : createTelegramClient({
          token: alerts.telegramToken,
          ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
        })
  const push = alerts.vapid === null ? null : createPushSender({ vapid: alerts.vapid })
  const sleep = options.sleep ?? sleepFor

  if (telegram !== null || push !== null) {
    // When a send last failed, so a service that is down is not asked every pass.
    const retryAfter = new Map<string, number>()
    jobs.push(
      defineJob({
        name: JOB_NAMES.alertDelivery,
        schedule: { cron: '* * * * *' },
        options: {
          queue: {
            retryLimit: 0,
            expireInSeconds: 120,
            retentionSeconds: 10 * 60,
            deleteAfterSeconds: 60 * 60,
          },
        },
        async handler(batch, context) {
          const signal = batch[0]?.signal
          const aborted = () => signal?.aborted === true
          const started = context.now().getTime()
          const budget = options.budgetMs ?? PASS_BUDGET_MS
          let sent = 0
          do {
            sent += await deliverAlerts({
              pool: context.pool,
              log: context.log,
              now: context.now,
              push,
              telegram,
              teamChatId: alerts.teamChatId,
              retryAfter,
            })
            if (aborted()) break
            await sleep(options.passEveryMs ?? PASS_EVERY_MS, signal)
          } while (context.now().getTime() - started < budget && !aborted())
          if (sent > 0) context.log.info({ sent }, 'alert messages sent')
        },
      }),
    )
  }

  const pingUrl = alerts.healthchecksUrl
  if (pingUrl !== null) {
    jobs.push(
      defineJob({
        name: JOB_NAMES.healthcheckPing,
        schedule: { cron: '* * * * *' },
        options: {
          queue: {
            retryLimit: 0,
            expireInSeconds: 60,
            retentionSeconds: 10 * 60,
            deleteAfterSeconds: 60 * 60,
          },
        },
        async handler(_batch, context) {
          // No ping without the database: the watchdog should hear nothing when the queue's store is down.
          await withSystem(context.pool, (tx) => tx.execute(sql`select 1`))
          await pingHealthcheck(pingUrl, context.log, options.fetch)
        },
      }),
    )
  }
  return jobs
}
