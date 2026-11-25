// Reads Tonight for the signed-in actor and shapes it for the screen (#85). Reads only: the
// service read side filters by what the actor holds and calls no POS (rule 3 and 4 of the plan).
import { guestNight, readOrderingSettings } from '@restro/core'
import {
  readTableState,
  readTonight,
  type ServiceActor,
  type TonightRefusal,
} from '@restro/core/service'
import type { Venue } from '@restro/db'

import { providerDisplayName } from '@/connectors/notices'

import { getPool } from '../db'
import { isOperator } from '../staff/service'
import { tillLabelOfVenue } from '../tables/service'
import { buildTonightView, type PhoneOrders, type TonightView } from './view'

/** Tonight for the venue, or why it can't be shown. */
export async function loadTonightView(input: {
  readonly tenantId: string
  readonly venue: Venue
  readonly userId: string
  readonly sessionId: string
  /** A person's own short session is on this shared device: no write asks for a PIN (#324). */
  readonly remembered?: boolean
  readonly now?: Date
}): Promise<
  | { readonly ok: true; readonly view: TonightView }
  | { readonly ok: false; readonly code: TonightRefusal }
> {
  const now = input.now ?? new Date()
  const readAs = (actor: ServiceActor) =>
    readTonight(getPool(), { tenantId: input.tenantId, venueId: input.venue.id, actor, now })
  const [own, source, operator] = await Promise.all([
    readAs({ kind: 'user', userId: input.userId, sessionId: input.sessionId }),
    tillLabelOfVenue(getPool(), input.tenantId, input.venue.id),
    isOperator(input.userId),
  ])
  // Restro's admin team, with no role here, still reads Tonight to lift a Restro pause (D120).
  const read =
    !own.ok && own.code === 'permission_denied' && operator
      ? await readAs({ kind: 'operator', userId: input.userId })
      : own
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
      operator,
      remembered: input.remembered === true,
      phoneOrders: phoneOrdersOf(input.venue, now),
      now,
    }),
  }
}

/**
 * Phone ordering tonight by the venue's service hours, as a guest's phone is told it (S4): when it
 * starts (`HH:mm`, the venue's own zone) while that is still to come, or that phones cannot order
 * tonight (a closed night, after last orders, an opening with no hour); null while it runs.
 */
function phoneOrdersOf(venue: Venue, now: Date): PhoneOrders {
  const night = guestNight(
    readOrderingSettings(venue.settings),
    venue.timezone,
    venue.serviceDayEndsAt,
    now,
  )
  if (night.state === 'opens_later' && night.at !== null) return { state: 'later', at: night.at }
  if (night.state === 'opens_later' || night.state === 'closed') return { state: 'none' }
  return null
}

/** What a table's sheet shows beyond its tile: the bill as last read (plan §3). */
export interface TableSheetBill {
  readonly totalMinor: number
  readonly currency: string
  readonly complete: boolean
}

/**
 * A table's linked group as its sheet shows it (D160 §1, decision log 1.7 and 1.8; #540): the
 * party's tables by our name, the group's total as the members' last bills add up, and whether
 * that total is final. A member that did not read well in its sitting is `updating`: its last
 * lines count, the total is not final, and the sheet says which table it waits for (rule 6).
 */
export interface TableSheetGroup {
  readonly tables: readonly {
    readonly id: string
    /** Our name over the table, else its number: the sheet words it with the table's own tile. */
    readonly label: string
    readonly updating: boolean
  }[]
  readonly totalMinor: number
  readonly currency: string
  /** False while any member table's bill is not known well now. */
  readonly final: boolean
}

/** What a table's sheet reads beyond its tile. */
export interface TableSheetRead {
  readonly bill: TableSheetBill | null
  /** Null where the table is in no group: the sheet then shows no party line. */
  readonly group: TableSheetGroup | null
}

/** The open sitting's bill of a table and its linked group, or nulls when closed or not read yet. */
export async function loadTableSheet(input: {
  readonly tenantId: string
  readonly venueId: string
  readonly tableId: string
}): Promise<TableSheetRead> {
  const none = { bill: null, group: null } as const
  const state = await readTableState(getPool(), input)
  if (state === null || state.unchanged) return none
  // The tenant's rows are all the database hides: a table of another venue has no bill here (RR-71).
  if (state.table.venueId !== input.venueId) return none
  const group = state.group
  return {
    bill:
      state.bill === null
        ? null
        : {
            totalMinor: state.bill.totalMinor,
            currency: state.bill.currency ?? 'EUR',
            complete: state.bill.complete,
          },
    group:
      group === null
        ? null
        : {
            tables: group.tables.map((member) => ({
              id: member.tableId,
              label: member.label,
              updating: member.reading !== 'complete',
            })),
            totalMinor: group.tables.reduce(
              (sum, member) => sum + (member.bill?.totalMinor ?? 0),
              0,
            ),
            currency:
              group.tables.map((member) => member.bill?.currency).find((one) => one != null) ??
              'EUR',
            final: !group.unread,
          },
  }
}
