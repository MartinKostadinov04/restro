// My styles (D129): the organisation's own saved Styles beside Restro's premade ones on the Design
// page, and the design in use at each of its other venues, so one venue copies another's look with
// one tap.
//
// Reads run inside `withTenant`, so row-level security shows only this organisation's rows. Writes
// go through `apply` (rule 1): `setStyle` saves one, `setStyleStatus` removes one or puts it back
// (a soft removal, so the toast's Undo is a restore, never an insert of a new row, and nothing is
// deleted from app code, D83).
//
// What a Style carries is `StyleValues`: every choice option but the body font, and never the
// colours, the Advanced roles or the logo (D128). That is why copying another venue's design can
// never carry that venue's brand: `styleValuesOf` drops the one brand option, and the page puts the
// reading venue's own body font back.
import {
  type Actor,
  type ChangeSet,
  newId,
  readDesign,
  type SavedStyle,
  SavedStyleContentSchema,
  type StyleStatus,
  type StyleValues,
  styleValuesOf,
} from '@restro/core'
import { apply } from '@restro/core/apply'
import { type DbPool, designStyles, venues, withTenant } from '@restro/db'
import { and, asc, isNull, ne } from 'drizzle-orm'

/** One venue's design as a tile under My styles: "In use at {venue}". */
export interface VenueStyle {
  readonly venueId: string
  readonly venueName: string
  /** The design's values as a Style carries them: no colours, no roles, no logo, no body font. */
  readonly values: StyleValues
  /** The premade Style those values came from. */
  readonly style: string
}

/** What the My styles group shows. */
export interface MyStyles {
  /** The organisation's saved Styles that are not removed, by name. */
  readonly saved: readonly SavedStyle[]
  /** The design in use at the organisation's other live venues, by name. */
  readonly venues: readonly VenueStyle[]
}

/** The organisation's saved Styles that are not removed, by name. */
export async function loadSavedStyles(pool: DbPool, tenantId: string): Promise<SavedStyle[]> {
  const rows = await withTenant(pool, tenantId, (tx) =>
    tx
      .select({
        id: designStyles.id,
        name: designStyles.name,
        style: designStyles.style,
        styleValues: designStyles.styleValues,
      })
      .from(designStyles)
      .where(isNull(designStyles.removedAt))
      .orderBy(asc(designStyles.name), asc(designStyles.id)),
  )
  return rows.flatMap((row) => {
    // A row whose values no longer fit the contract (an option removed since) is left out rather
    // than offered as a tile that would fill the draft with a value the renderer cannot draw.
    const parsed = SavedStyleContentSchema.safeParse({
      name: row.name,
      style: row.style,
      values: row.styleValues,
    })
    return parsed.success ? [{ id: row.id, ...parsed.data }] : []
  })
}

/**
 * The design in use at the organisation's other live venues, by name: a tile each, so this venue
 * copies one with one tap. The values carry no brand (`styleValuesOf`).
 */
export async function loadVenueStyles(
  pool: DbPool,
  tenantId: string,
  exceptVenueId: string,
): Promise<VenueStyle[]> {
  const rows = await withTenant(pool, tenantId, (tx) =>
    tx
      .select({ id: venues.id, name: venues.name, settings: venues.settings })
      .from(venues)
      .where(and(isNull(venues.archivedAt), ne(venues.id, exceptVenueId)))
      .orderBy(asc(venues.name), asc(venues.id)),
  )
  return rows.map((row) => {
    const { design } = readDesign(row.settings)
    return {
      venueId: row.id,
      venueName: row.name,
      values: styleValuesOf(design.values),
      style: design.style,
    }
  })
}

/** Everything the My styles group shows, in one go. */
export async function loadMyStyles(
  pool: DbPool,
  tenantId: string,
  venueId: string,
): Promise<MyStyles> {
  const [saved, venueStyles] = await Promise.all([
    loadSavedStyles(pool, tenantId),
    loadVenueStyles(pool, tenantId, venueId),
  ])
  return { saved, venues: venueStyles }
}

export type StyleSaveError = 'invalid' | 'forbidden' | 'not_found' | 'name_taken' | 'failed'

/** What saving or removing a Style answers; a save carries the id, new or the one it replaced. */
export type StyleSaveResult =
  | { readonly ok: true; readonly styleId: string }
  | { readonly ok: false; readonly error: StyleSaveError }

const errorOf = (code: string | undefined): StyleSaveError => {
  if (code === 'style_name_taken') return 'name_taken'
  if (code === 'unknown_style') return 'not_found'
  return 'invalid'
}

/** A change set of one op, as the Design page's writes are made: manual, the member as the actor. */
function oneOp(actor: Actor, op: ChangeSet['ops'][number]): ChangeSet {
  return {
    id: newId('cs'),
    source: 'manual',
    jobId: newId('jb'),
    actor,
    observedAt: new Date().toISOString(),
    ops: [op],
  }
}

/**
 * Saves one of the organisation's Styles through `apply` (rule 1): a new row when `styleId` is
 * null, else the name and values of the one it names. The caller has checked the person's role and
 * their device.
 */
export async function saveStyle(
  pool: DbPool,
  tenantId: string,
  input: {
    readonly styleId: string | null
    readonly name: string
    readonly style: string
    readonly values: StyleValues
    readonly actor: Actor
  },
): Promise<StyleSaveResult> {
  const styleId = input.styleId ?? newId('ds')
  const content = SavedStyleContentSchema.safeParse({
    name: input.name,
    style: input.style,
    values: input.values,
  })
  if (!content.success) return { ok: false, error: 'invalid' }
  const result = await apply(
    pool,
    tenantId,
    oneOp(input.actor, { op: 'setStyle', styleId: styleId as never, content: content.data }),
  )
  const rejected = result.rejected[0]
  if (rejected === undefined) return { ok: true, styleId }
  return { ok: false, error: errorOf(rejected.code) }
}

/** Removes one of the organisation's Styles, or puts it back (the toast's Undo). */
export async function setStyleStatus(
  pool: DbPool,
  tenantId: string,
  input: { readonly styleId: string; readonly status: StyleStatus; readonly actor: Actor },
): Promise<StyleSaveResult> {
  const result = await apply(
    pool,
    tenantId,
    oneOp(input.actor, {
      op: 'setStyleStatus',
      styleId: input.styleId as never,
      status: input.status,
    }),
  )
  const rejected = result.rejected[0]
  if (rejected === undefined) return { ok: true, styleId: input.styleId }
  return { ok: false, error: errorOf(rejected.code) }
}
