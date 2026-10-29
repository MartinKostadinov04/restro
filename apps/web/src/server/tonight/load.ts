// Reads Tonight for the signed-in actor and shapes it for the screen (#85). Reads only: the
// service read side filters by what the actor holds and calls no POS (rule 3 and 4 of the plan).
import { readTableState, readTonight, type TonightRefusal } from '@restro/core/service'
import type { Venue } from '@restro/db'

import { providerDisplayName } from '@/connectors/notices'

import { getPool } from '../db'
import { tillLabelOfVenue } from '../tables/service'
import { buildTonightView, type TonightView } from './view'

/** Tonight for the venue, or why it can't be shown. */
export async function loadTonightView(input: {
  readonly tenantId: string
  readonly venue: Venue
  readonly userId: string
  readonly sessionId: string
  readonly now?: Date
}): Promise<
  | { readonly ok: true; readonly view: TonightView }
  | { readonly ok: false; readonly code: TonightRefusal }
> {
  const now = input.now ?? new Date()
  const [read, source] = await Promise.all([
    readTonight(getPool(), {
      tenantId: input.tenantId,
      venueId: input.venue.id,
      actor: { kind: 'user', userId: input.userId, sessionId: input.sessionId },
      now,
    }),
    tillLabelOfVenue(getPool(), input.tenantId, input.venue.id),
  ])
  if (!read.ok) return read
  return {
    ok: true,
    view: buildTonightView({
      tonight: read.tonight,
      venueId: input.venue.id,
      timezone: input.venue.timezone,
      source: source ?? '',
      currency: input.venue.currency,
      provider: providerDisplayName(read.tonight.payingProvider),
      now,
    }),
  }
}

/** What a table's sheet shows beyond its tile: the bill as last read (plan §3). */
export interface TableSheetBill {
  readonly totalMinor: number
  readonly currency: string
  readonly complete: boolean
}

/** The open sitting's bill of a table, or null when it is closed or not read yet. */
export async function loadTableBill(input: {
  readonly tenantId: string
  readonly tableId: string
}): Promise<TableSheetBill | null> {
  const state = await readTableState(getPool(), input)
  if (state === null || state.unchanged || state.bill === null) return null
  return {
    totalMinor: state.bill.totalMinor,
    currency: state.bill.currency ?? 'EUR',
    complete: state.bill.complete,
  }
}
