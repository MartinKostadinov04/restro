// `service_day.report_sent` (#179; #86): the worker tells that Telegram accepted a closed day's
// end-of-night message. `service_days.report_sent_at` is set once, by one conditional update, so a
// repeat changes nothing and two workers racing cannot both claim it. A day with no `service_days`
// row is refused `day_not_closed`: only a closed day has a message to mark.

import { serviceDays } from '@restro/db'
import { and, eq, isNull, sql } from 'drizzle-orm'

import type { ServiceTx } from './definition'
import { accepted, refused, type ServiceResult } from './results'

export async function markNightReportSent(
  stx: ServiceTx,
  command: { readonly serviceDate: string },
): Promise<ServiceResult> {
  const marked = await stx.tx
    .update(serviceDays)
    .set({ reportSentAt: sql`now()`, ...stx.provenance })
    .where(
      and(
        eq(serviceDays.venueId, stx.venueId),
        eq(serviceDays.serviceDate, command.serviceDate),
        isNull(serviceDays.reportSentAt),
      ),
    )
    .returning({ serviceDate: serviceDays.serviceDate })
  if (marked.length > 0) return accepted(null, { details: { changed: true } })
  const [row] = await stx.tx
    .select({ serviceDate: serviceDays.serviceDate })
    .from(serviceDays)
    .where(
      and(eq(serviceDays.venueId, stx.venueId), eq(serviceDays.serviceDate, command.serviceDate)),
    )
  if (row === undefined) return refused(null, 'day_not_closed')
  return accepted(null, { details: { changed: false } })
}
