// Reads for Tonight's other three screens (#86), as the signed-in actor, shaped for the screens by
// `night-view.ts`. Reads only: nothing here writes and no POS is called. The service read side
// refuses what the actor does not hold, so a screen a role may not see never gets its data.
import {
  type NightAccess,
  readLog,
  readNight,
  readNightAccess,
  readSentOrderDetail,
  readSentOrders,
  type ServiceActor,
} from '@restro/core/service'
import type { Venue } from '@restro/db'

import { getPool } from '../db'
import { logInfo } from '../log'
import { tillLabelOfVenue } from '../tables/service'
import {
  type Frame,
  frameOf,
  type LogView,
  logView,
  type NightView,
  nightView,
  type SentDetailView,
  type SentListView,
  sentDetailView,
  sentListView,
  unknownReasons,
} from './night-view'

/** Who is asking, for which venue. */
export interface NightScope {
  readonly tenantId: string
  readonly venue: Pick<Venue, 'id' | 'timezone'>
  readonly actor: ServiceActor
  readonly now?: Date
  /** What `{source}` reads for a venue with no POS ("the POS"), in the admin's language. */
  readonly sourceNone: string
}

/** Why a read was refused, or that it failed: the screen shows its own failure block. */
export type NightResult<T> =
  | ({ readonly ok: true; readonly frame: Frame } & T)
  | { readonly ok: false; readonly code: string }

export const sourceOf = async (scope: NightScope, access: NightAccess): Promise<string> =>
  (await tillLabelOfVenue(getPool(), scope.tenantId, access.venue.id)) ?? scope.sourceNone

/** What the screens need of the actor, without reading any of the screens. */
export async function loadNightAccess(
  scope: NightScope,
): Promise<NightResult<{ access: NightAccess }>> {
  const read = await readNightAccess(getPool(), {
    tenantId: scope.tenantId,
    venueId: scope.venue.id,
    actor: scope.actor,
    ...(scope.now === undefined ? {} : { now: scope.now }),
  })
  if (!read.ok) return read
  const now = scope.now ?? new Date()
  return {
    ok: true,
    access: read.access,
    frame: frameOf(read.access, {
      venueId: scope.venue.id,
      source: await sourceOf(scope, read.access),
      now,
    }),
  }
}

/** The service day's sent orders; a sent order reason without a word is reported, never shown. */
export async function loadSentOrders(
  scope: NightScope,
  query: {
    readonly day?: string
    readonly search?: string
    readonly notAddedOnly?: boolean
    readonly limit?: number
  },
): Promise<NightResult<{ list: SentListView }>> {
  const read = await readSentOrders(getPool(), {
    tenantId: scope.tenantId,
    venueId: scope.venue.id,
    actor: scope.actor,
    ...(scope.now === undefined ? {} : { now: scope.now }),
    ...query,
  })
  if (!read.ok) return read
  for (const reason of unknownReasons(read.page.rows)) {
    logInfo('sent_order_reason_without_word', { reason })
  }
  const now = scope.now ?? new Date()
  return {
    ok: true,
    frame: frameOf(read.access, {
      venueId: scope.venue.id,
      source: await sourceOf(scope, read.access),
      now,
    }),
    list: sentListView(read.page, read.access.venue.timezone),
  }
}

/** One sent order for its sheet; null `detail` when it is not this venue's. */
export async function loadSentOrderDetail(
  scope: NightScope,
  sentOrderId: string,
): Promise<NightResult<{ detail: SentDetailView | null }>> {
  const read = await readSentOrderDetail(getPool(), {
    tenantId: scope.tenantId,
    venueId: scope.venue.id,
    actor: scope.actor,
    sentOrderId,
  })
  if (!read.ok) return read
  const now = scope.now ?? new Date()
  return {
    ok: true,
    frame: frameOf(read.access, {
      venueId: scope.venue.id,
      source: await sourceOf(scope, read.access),
      now,
    }),
    detail: read.detail === null ? null : sentDetailView(read.detail, read.access.venue.timezone),
  }
}

/** The Log of one service day. */
export async function loadLog(
  scope: NightScope,
  query: {
    readonly locale: 'bg' | 'en'
    readonly day?: string
    readonly search?: string
    readonly group?: string
    readonly limit?: number
  },
): Promise<NightResult<{ log: LogView }>> {
  const { locale, ...rest } = query
  const read = await readLog(getPool(), {
    tenantId: scope.tenantId,
    venueId: scope.venue.id,
    actor: scope.actor,
    ...(scope.now === undefined ? {} : { now: scope.now }),
    ...rest,
  })
  if (!read.ok) return read
  const now = scope.now ?? new Date()
  const source = await sourceOf(scope, read.access)
  return {
    ok: true,
    frame: frameOf(read.access, { venueId: scope.venue.id, source, now }),
    log: logView(read.page, {
      timezone: read.access.venue.timezone,
      locale,
      source,
      venueName: read.access.venue.name,
    }),
  }
}

/** The end of one service day. */
export async function loadNight(
  scope: NightScope,
  query: { readonly day?: string },
): Promise<NightResult<{ night: NightView }>> {
  const read = await readNight(getPool(), {
    tenantId: scope.tenantId,
    venueId: scope.venue.id,
    actor: scope.actor,
    ...(scope.now === undefined ? {} : { now: scope.now }),
    ...query,
  })
  if (!read.ok) return read
  for (const reason of unknownReasons(read.night.sent.notAdded.rows)) {
    logInfo('sent_order_reason_without_word', { reason })
  }
  const now = scope.now ?? new Date()
  return {
    ok: true,
    frame: frameOf(read.access, {
      venueId: scope.venue.id,
      source: await sourceOf(scope, read.access),
      now,
    }),
    night: nightView(read.night, read.access.venue.timezone),
  }
}
