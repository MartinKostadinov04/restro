// What the Integration tab reads of the records the barsy sync left behind, in barsy's own words:
// the kind of its full-pull runs, the type of its stored venue records and the fields of those
// records. Everything else in the tab stays neutral. This is the web app's home for such code
// (`apps/web/src/connectors/`, where the vendor-word test lets a connector name its vendor, D67).
//
// Read only, and only our own database: nothing here calls barsy (the web app never does).
import { jobRuns, type ReadTx, sourceRecords } from '@restro/db'
import { and, desc, eq } from 'drizzle-orm'

import type { AbsenceHeldView, HeldSync } from '@/server/integration/view'

/** The kind the worker gives the run of a full pull. */
const FULL_PULL_KIND = 'barsy_full_pull'

/** The type of the stored record of a venue (`Barsys_getlist`, one record per venue). */
const VENUE_RECORD_TYPE = 'barsy_venue'

/** How many of the latest completed full pulls are looked through for a complete one. */
const FULL_PULL_LOOKBACK = 20

/** The longest address shown; a longer one is cut (the record is the till's, not ours). */
const MAX_ADDRESS_LENGTH = 200

function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

/**
 * The `absence_held` of a run's details (`{ reason, would_hide, active }`, written by the sync
 * when a complete full pull held its conclusion back), or null when the run has none or it does not
 * look as expected.
 */
export function absenceHeldOf(details: unknown): AbsenceHeldView | null {
  if (typeof details !== 'object' || details === null) return null
  const held = (details as { absence_held?: unknown }).absence_held
  if (typeof held !== 'object' || held === null) return null
  const { reason, would_hide: wouldHide, active } = held as Record<string, unknown>
  if (reason !== 'empty_read' && reason !== 'too_many_missing') return null
  if (!isCount(wouldHide) || !isCount(active)) return null
  return { reason, wouldHide, active }
}

/**
 * Whether the latest COMPLETE full pull of the integration was held (T62, CF-02): then the menu was
 * left as it was and the manager should look at the category and the venue.
 *
 * A pull is complete when it read every page (`failed_pages` is 0); a pull that failed a page, or
 * one that only queued itself again behind a running pull, concluded nothing and says nothing about
 * an earlier hold, so it is passed over. The newest complete one decides: held means a warning,
 * anything else means none. This looks at the full pulls alone, not at the latest twenty runs of
 * every kind, so the warning stays when many change checks have run since.
 */
export async function readHeldSync(tx: ReadTx, integrationId: string): Promise<HeldSync | null> {
  const rows = await tx
    .select({
      counters: jobRuns.counters,
      details: jobRuns.details,
      finishedAt: jobRuns.finishedAt,
    })
    .from(jobRuns)
    .where(
      and(
        eq(jobRuns.integrationId, integrationId),
        eq(jobRuns.kind, FULL_PULL_KIND),
        eq(jobRuns.status, 'completed'),
      ),
    )
    .orderBy(desc(jobRuns.createdAt), desc(jobRuns.id))
    .limit(FULL_PULL_LOOKBACK)
  for (const row of rows) {
    if (row.counters.failed_pages !== 0) continue
    const held = absenceHeldOf(row.details)
    return held === null ? null : { ...held, finishedAt: row.finishedAt?.toISOString() ?? null }
  }
  return null
}

/** What the stored record of a venue says that the pickers can hint at. */
export interface VenueHint {
  /** The public address of the venue, trimmed; null when there is none. */
  readonly address: string | null
  /** The category the venue names as its public menu; null when it has none. */
  readonly publicCatId: number | null
}

/** The hint of one stored venue record (`public_address`, `public_cat_id`); null if it is not an object. */
export function venueHintOf(payload: unknown): VenueHint | null {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) return null
  const { public_address: address, public_cat_id: catId } = payload as Record<string, unknown>
  const text = typeof address === 'string' ? address.trim() : ''
  return {
    address: text === '' ? null : text.slice(0, MAX_ADDRESS_LENGTH),
    publicCatId:
      typeof catId === 'number' && Number.isSafeInteger(catId) && catId > 0 ? catId : null,
  }
}

/**
 * The hints of every venue of the integration, by the venue's number in the till, from the latest
 * stored record of each (the connection check stores them as they came, one record per venue).
 */
export async function readVenueHints(
  tx: ReadTx,
  integrationId: string,
): Promise<ReadonlyMap<number, VenueHint>> {
  const rows = await tx
    .selectDistinctOn([sourceRecords.externalId], {
      externalId: sourceRecords.externalId,
      payload: sourceRecords.payload,
    })
    .from(sourceRecords)
    .where(
      and(
        eq(sourceRecords.integrationId, integrationId),
        eq(sourceRecords.externalType, VENUE_RECORD_TYPE),
        eq(sourceRecords.scope, 'master'),
      ),
    )
    .orderBy(sourceRecords.externalId, desc(sourceRecords.fetchedAt), desc(sourceRecords.id))
  const hints = new Map<number, VenueHint>()
  for (const row of rows) {
    const key = Number(row.externalId)
    const hint = venueHintOf(row.payload)
    if (Number.isSafeInteger(key) && hint !== null) hints.set(key, hint)
  }
  return hints
}
