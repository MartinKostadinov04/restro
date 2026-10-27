// The message the venue's Telegram group gets when a service day closes (#86; plan
// `docs/deliverables/2026-10-27-tonight-end-of-night-plan.md` §7; decision log 3.3, D122 §7): the
// totals and the problems, in the venue's language. **Counts only: no money amounts and no tips**
// (Martin 10-27), because the group may hold staff and staff don't see tips. A venue with no
// Telegram group, or a worker with no bot token, sends nothing.
//
// Once per day: the service day's close writes its `service_days` row once and says so
// (`changed`), and only that run sends. A send that fails is logged, not repeated: nothing records
// that it went, so a later pass could not tell. (A `report_sent_at` column would let it retry; it
// is a schema change and is asked for in the report of #86.)

import { readOrderingSettings } from '@restro/core'
import { alertLocale, nightMessage, readNightReport, tableLabel } from '@restro/core/service'
import type { DbPool } from '@restro/db'

import type { Logger } from '../logger'
import type { TelegramClient } from './telegram'

/** One service day that was just closed. */
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
