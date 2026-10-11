// What Settings -> Integrations and the venue's Menu source card read of the records the barsy sync left behind, in barsy's own words:
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

/** How many of the latest completed full pulls are looked through for a complete one (all venues together). */
const FULL_PULL_LOOKBACK = 100

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

/** A held conclusion and the venue (ours, `vn_…`) of the run that held it; null: an older run, which names none. */
export interface HeldSyncEntry {
  readonly venueId: string | null
  readonly held: HeldSync
}

/** The part of a full-pull run that decides whether it was held, newest first in the list. */
export interface FullPullRunRow {
  readonly counters: Readonly<Record<string, number>>
  readonly details: unknown
  readonly finishedAt: Date | null
}

/** The `venue_id` a run's details name (CF-09b), or null for a run recorded before runs named one. */
function venueOfRun(details: unknown): string | null {
  if (typeof details !== 'object' || details === null) return null
  const venueId = (details as { venue_id?: unknown }).venue_id
  return typeof venueId === 'string' ? venueId : null
}

/**
 * Which venues' latest COMPLETE full pull was held (T62, CF-02): then the menu was left as it was
 * and the manager should look at the category and the till venue.
 *
 * A pull is complete when it read every page (`failed_pages` is 0); a pull that failed a page, or
 * one that only queued itself again behind a running pull, concluded nothing and says nothing about
 * an earlier hold, so it is passed over. For each venue the newest complete one decides: held means
 * a warning, anything else means none. Runs recorded before runs named their venue count as one
 * venue of their own (`venueId: null`), but only until a pull that names its venue has completed:
 * from then on they are old news and are passed over. `runs` are newest first.
 */
export function heldSyncsOf(runs: readonly FullPullRunRow[]): HeldSyncEntry[] {
  const decided = new Set<string | null>()
  const entries: HeldSyncEntry[] = []
  for (const run of runs) {
    if (run.counters.failed_pages !== 0) continue
    const venueId = venueOfRun(run.details)
    if (venueId === null && [...decided].some((key) => key !== null)) continue
    if (decided.has(venueId)) continue
    decided.add(venueId)
    const held = absenceHeldOf(run.details)
    if (held !== null) {
      entries.push({
        venueId,
        held: { ...held, finishedAt: run.finishedAt?.toISOString() ?? null },
      })
    }
  }
  return entries
}

/**
 * The held full pulls of the integration, one per venue (see `heldSyncsOf`). This looks at the
 * full pulls alone, not at the latest twenty runs of every kind, so the warning stays when many
 * change checks have run since.
 */
export async function readHeldSyncs(tx: ReadTx, integrationId: string): Promise<HeldSyncEntry[]> {
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
  return heldSyncsOf(rows)
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
