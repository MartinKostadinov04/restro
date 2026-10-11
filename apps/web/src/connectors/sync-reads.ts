// What Settings -> Integrations and the venue's Menu source card read of the records the barsy sync left behind, in barsy's own words:
// the kind of its full-pull runs, the type of its stored venue records and the fields of those
// records. Everything else in the tab stays neutral. This is the web app's home for such code
// (`apps/web/src/connectors/`, where the vendor-word test lets a connector name its vendor, D67).
//
// Read only, and only our own database: nothing here calls barsy (the web app never does).
import { isLocale, type NodeId } from '@restro/core'
import { fieldValues, jobRuns, type ReadTx, sourceRecords } from '@restro/db'
import { and, desc, eq, inArray, or, sql } from 'drizzle-orm'

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

// --- names that stand in for a missing public name (D75, CF-17) ------------------------------

/** A text key of the till's own words the way the mapping reads it: `sr_RS@latin` is `sr_RS`, `bg-BG` is `bg_BG`. */
function isOurLanguageKey(key: string): boolean {
  const base = (key.split('@', 1)[0] ?? '').replace('-', '_')
  return isLocale(base)
}

function isFilled(value: unknown): boolean {
  return typeof value === 'string' && value.trim() !== ''
}

/**
 * True if a stored record holds a public name: the plain public text, or text in at least one
 * language the mapping knows. This is the mapping's own test for "the public name is empty"
 * (the till's own name stands in for it only when it is), less one thing it cannot know here: the
 * installation's list of languages. A name only in a language the installation does not hold is
 * shown by the mapping as the own name, and read here as public: no warning for that rare case.
 */
export function hasPublicName(plain: unknown, perLanguage: unknown): boolean {
  if (isFilled(plain)) return true
  if (typeof perLanguage !== 'object' || perLanguage === null || Array.isArray(perLanguage)) {
    return false
  }
  return Object.entries(perLanguage).some(([key, text]) => isOurLanguageKey(key) && isFilled(text))
}

/** What the stored record a till name was mapped from says about its public name. */
export interface PublicNameRow {
  readonly externalType: string
  /**
   * The record carries the public-name fields at all (whether or not they are filled). An article
   * read without them says nothing about a public name, and the mapping then writes no name and
   * falls back to none; a category is always mapped, so for it this is not asked.
   */
  readonly carriesPublicFields: boolean
  readonly plain: unknown
  readonly perLanguage: unknown
}

/**
 * True if the name stored for this node is the till's own name standing in for a public one: the
 * record it was mapped from holds no public name. Items and options come from an article record
 * (read with the public-name fields), sections from a category record; any other record is not
 * asked.
 */
export function usesOwnName(row: PublicNameRow): boolean {
  if (hasPublicName(row.plain, row.perLanguage)) return false
  if (row.externalType === 'category') return true
  return row.externalType === 'article' && row.carriesPublicFields
}

/**
 * The nodes (items, options, sections) whose till-layer name is the till's own name, standing in
 * for a public name the till does not have (D75). Derived from the stored source records: the name
 * (`name` of an article, `title` of a category) cites the record it was mapped from, and that
 * record's public fields are empty. A name the sync wrote before D75 left the field empty, so
 * nothing is flagged until the next full pull writes the names. Pass `nodeIds` to ask about some.
 *
 * Whether the guest menu really shows that name is the resolver's answer (a name typed here wins),
 * so the caller asks it too; see the composer's view model.
 */
export async function readNameFallbackNodeIds(
  tx: ReadTx,
  nodeIds?: readonly string[],
): Promise<NodeId[]> {
  if (nodeIds !== undefined && nodeIds.length === 0) return []
  const rows = await tx
    .select({
      nodeId: fieldValues.nodeId,
      externalType: sourceRecords.externalType,
      articleAsked: sql<boolean>`(jsonb_exists(${sourceRecords.payload}, 'article_name_public') or jsonb_exists(${sourceRecords.payload}, 'article_name_public_ml'))`,
      articlePlain: sql<unknown>`${sourceRecords.payload} -> 'article_name_public'`,
      articleMl: sql<unknown>`${sourceRecords.payload} -> 'article_name_public_ml'`,
      categoryPlain: sql<unknown>`${sourceRecords.payload} -> 'cat_name_public'`,
      categoryMl: sql<unknown>`${sourceRecords.payload} -> 'cat_name_public_ml'`,
    })
    .from(fieldValues)
    .innerJoin(
      sourceRecords,
      and(
        eq(sourceRecords.tenantId, fieldValues.tenantId),
        eq(sourceRecords.id, fieldValues.sourceRecordId),
      ),
    )
    .where(
      and(
        eq(fieldValues.layer, 'till'),
        eq(fieldValues.scope, 'master'),
        or(
          and(eq(fieldValues.fieldKey, 'name'), eq(sourceRecords.externalType, 'article')),
          and(eq(fieldValues.fieldKey, 'title'), eq(sourceRecords.externalType, 'category')),
        ),
        nodeIds === undefined ? undefined : inArray(fieldValues.nodeId, [...nodeIds]),
      ),
    )
  return rows
    .filter((row) =>
      usesOwnName(
        row.externalType === 'article'
          ? {
              externalType: row.externalType,
              carriesPublicFields: row.articleAsked,
              plain: row.articlePlain,
              perLanguage: row.articleMl,
            }
          : {
              externalType: row.externalType,
              carriesPublicFields: true,
              plain: row.categoryPlain,
              perLanguage: row.categoryMl,
            },
      ),
    )
    .map((row) => row.nodeId as NodeId)
}
