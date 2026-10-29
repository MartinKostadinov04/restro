'use server'

// The reads of Tonight's other three screens that the browser asks again (#86): the sent orders
// list and one sent order's sheet, and the Log. Read-only server actions: each checks its input
// with Zod, finds who is asking (`requireTenant`: the tenant is the person's organisation, never
// the request's) and that the venue is theirs, then reads as that signed-in account; the service
// read side checks the permission again. The answers to a sent order are `answerSentOrderAction`
// (actions.ts), not here.
import { idSchema } from '@restro/core'
import { getLocale, getTranslations } from 'next-intl/server'
import { z } from 'zod'

import { logError } from '../log'
import { requireTenant } from '../session'
import { getVenue } from '../venues'
import { loadLog, loadSentOrderDetail, loadSentOrders, type NightScope } from './night-load'
import type { Frame, LogView, SentDetailView, SentListView } from './night-view'

const venueId = idSchema('vn')
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
const search = z.string().max(60)
const limit = z.int().min(1).max(2000)

const SentOrders = z.strictObject({
  venueId,
  day: day.optional(),
  search: search.optional(),
  notAddedOnly: z.boolean().optional(),
  limit: limit.optional(),
})
const SentOrder = z.strictObject({ venueId, sentOrderId: idSchema('so') })
const Log = z.strictObject({
  venueId,
  day: day.optional(),
  search: search.optional(),
  group: z.string().max(20).optional(),
  limit: limit.optional(),
})

/** What a read answers: the data and the frame, or that it could not be read. */
export type ReadAnswer<T> =
  | ({ readonly ok: true; readonly frame: Frame } & T)
  | { readonly ok: false }

const FAILED = { ok: false } as const

/** The scope of the signed-in account for one of its venues, or null. */
async function scopeOf(id: string): Promise<NightScope | null> {
  const { organization, user, sessionId } = await requireTenant()
  const venue = await getVenue(organization.id, id)
  if (!venue) return null
  return {
    tenantId: organization.id,
    venue,
    actor: { kind: 'user', userId: user.id, sessionId },
    sourceNone: (await getTranslations('tonight'))('source_none'),
  }
}

async function answer<T>(
  event: string,
  run: () => Promise<ReadAnswer<T> | { readonly ok: false; readonly code: string }>,
): Promise<ReadAnswer<T>> {
  try {
    const result = await run()
    return result.ok ? result : FAILED
  } catch (error) {
    // redirect() and notFound() are control flow, not failures.
    if (error instanceof Error && 'digest' in error) throw error
    logError(event, error)
    return FAILED
  }
}

/** The service day's sent orders (screen 2), or a day's for the end of the night. */
export async function sentOrdersAction(
  input: unknown,
): Promise<ReadAnswer<{ list: SentListView }>> {
  const parsed = SentOrders.safeParse(input)
  if (!parsed.success) return FAILED
  const { venueId: id, ...query } = parsed.data
  return answer('tonight_sent_orders_failed', async () => {
    const scope = await scopeOf(id)
    if (scope === null) return FAILED
    return loadSentOrders(scope, {
      ...(query.day === undefined ? {} : { day: query.day }),
      ...(query.search === undefined ? {} : { search: query.search }),
      ...(query.notAddedOnly === undefined ? {} : { notAddedOnly: query.notAddedOnly }),
      ...(query.limit === undefined ? {} : { limit: query.limit }),
    })
  })
}

/** One sent order's sheet. */
export async function sentOrderDetailAction(
  input: unknown,
): Promise<ReadAnswer<{ detail: SentDetailView | null }>> {
  const parsed = SentOrder.safeParse(input)
  if (!parsed.success) return FAILED
  return answer('tonight_sent_order_failed', async () => {
    const scope = await scopeOf(parsed.data.venueId)
    if (scope === null) return FAILED
    return loadSentOrderDetail(scope, parsed.data.sentOrderId)
  })
}

/** The Log of one service day (screen 3), for those who hold `log.view`. */
export async function logAction(input: unknown): Promise<ReadAnswer<{ log: LogView }>> {
  const parsed = Log.safeParse(input)
  if (!parsed.success) return FAILED
  const { venueId: id, ...query } = parsed.data
  return answer('tonight_log_failed', async () => {
    const scope = await scopeOf(id)
    if (scope === null) return FAILED
    const locale = (await getLocale()) === 'en' ? 'en' : 'bg'
    return loadLog(scope, {
      locale,
      ...(query.day === undefined ? {} : { day: query.day }),
      ...(query.search === undefined ? {} : { search: query.search }),
      ...(query.group === undefined ? {} : { group: query.group }),
      ...(query.limit === undefined ? {} : { limit: query.limit }),
    })
  })
}
