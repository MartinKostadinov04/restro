// The message the venue's Telegram group gets when a service day closes (#86; plan
// `docs/deliverables/2026-10-27-tonight-end-of-night-plan.md` §7; decision log 3.3, D122 §7): the
// totals and the problems, in the venue's language. **Counts only: no money amounts and no tips**
// (Martin 10-27), because the group may hold staff and staff don't see tips. A venue with no
// Telegram group, or a worker with no bot token, sends nothing.
//
// Until it has gone (#179): `service-day-tick` sends each recent closed day's message and marks the
// day (`service_days.report_sent_at`, through `service_day.report_sent`) when Telegram accepts it,
// so a send that fails is tried again at the next tick. This file only sends one day's message and
// answers whether one went; the marker and the retry are the tick's (`jobs/service-day.ts`).

import { readOrderingSettings } from '@restro/core'
import {
  alertLocale,
  nightMessage,
  readNightPaymentsReport,
  readNightReport,
  tableLabel,
} from '@restro/core/service'
import type { DbPool } from '@restro/db'

import type { Logger } from '../logger'
import type { TelegramClient } from './telegram'

/** One closed service day. */
export interface ClosedDay {
  readonly tenantId: string
  readonly venueId: string
  readonly serviceDate: string
}

/** Sends the end-of-night message of one closed day; answers whether one went. */
export async function sendNightReport(
  deps: {
    readonly pool: DbPool
    readonly telegram: TelegramClient | null
    readonly log: Pick<Logger, 'warn'>
  },
  day: ClosedDay,
): Promise<boolean> {
  if (deps.telegram === null) return false
  try {
    const report = await readNightReport(deps.pool, {
      tenantId: day.tenantId,
      venueId: day.venueId,
      day: day.serviceDate,
    })
    if (report === null) return false
    const chatId = readOrderingSettings(report.settings).telegramChatId
    if (chatId === null) return false
    // The venue's language decides the words, as for its alerts.
    const locale = alertLocale(report.defaultLocale)
    const paid = await readNightPaymentsReport(deps.pool, {
      tenantId: day.tenantId,
      venueId: day.venueId,
      day: day.serviceDate,
    })
    await deps.telegram.sendMessage(
      chatId,
      nightMessage(locale, {
        venueName: report.venueName,
        day: report.day,
        sentOrders: report.sentOrders,
        added: report.added,
        notSent: report.notSent,
        unconfirmed: report.unconfirmed,
        fix: report.fix.map((problem) => ({
          reference: problem.reference,
          table: tableLabel(locale, problem),
        })),
        payments: {
          taken: paid.taken,
          fix: paid.fix.map((problem) => ({
            table: tableLabel(locale, problem),
            what: problem.what,
            ...(problem.paymentNumber === undefined
              ? {}
              : { paymentNumber: problem.paymentNumber }),
          })),
        },
      }),
    )
    return true
  } catch (error) {
    deps.log.warn(
      { venueId: day.venueId, serviceDate: day.serviceDate, err: error },
      'the end-of-night message could not be sent',
    )
    return false
  }
}
