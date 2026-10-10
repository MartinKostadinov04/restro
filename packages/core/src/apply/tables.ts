// Tables and their QR codes (brief S3-07, D61): the writers behind the venue's "Tables & QR" tab,
// and the readers it and the worker's token job use.
//
// A table is a barsy place (`places`, written by the sync: `upsertPlaces`). What a manager adds is
// a QR token (22 random base62 characters, never derived from a barsy id: rule 3), an optional name
// for the guest page, and the venue's choice of address on the codes (`venues.settings.qr`). None
// of this is the menu document, so these writers do not go through apply(); only this folder may
// import the write side of the database (rule 1's door).
//
// The writers only change rows. The public file `t/<token>.json` is written and removed by the
// worker's `publish-table-tokens` job (one writer of the publish store), which every writer here
// reports the work for: `venueId` (whose job to queue) and `retired` (the token whose file must go).

import { barsyVenues, type DbPool, type Place, places, venues, withTenant } from '@restro/db'
import { type WriteTx, withTenantWrite } from '@restro/db/write'
import { and, asc, eq, inArray, isNull, ne } from 'drizzle-orm'
import { z } from 'zod'

import { idSchema, isId, newTableToken, type TableId, type VenueId } from '../ids'
import {
  checkBaseUrl,
  checkOwnPattern,
  MAX_TABLE_LABEL_LENGTH,
  QR_MODES,
  type QrAddressProblem,
  tableDisplayLabel,
  type VenueQr,
  VenueQrSchema,
} from '../qr'

/** A table as the tab shows it. barsy's `place_id` and `bid` never leave this module (rule 3). */
export interface VenueTable {
  readonly id: TableId
  /** barsy's table number or name (`place_num`); null when barsy sends none. */
  readonly placeNum: string | null
  /** The hall (`salon_name`); null = no hall. */
  readonly salonName: string | null
  readonly isPublic: boolean
  /** `missing`: the last complete pull did not list it (it may come back; its code still works). */
  readonly state: 'active' | 'missing'
  /** The manager's name for it, or null (the guest page then says `placeNum`). */
  readonly label: string | null
  /** The QR token, or null when the table has no code. */
  readonly token: string | null
}

/** Why a table writer refused. Nothing is written when one is returned. */
export type TableWriteError =
  /** An id, name or setting that is not shaped right. */
  | 'invalid_input'
  /** The tenant has no such venue. */
  | 'unknown_venue'
  /** The tenant has no such table (or it is deleted, or its barsy venue serves no venue of ours). */
  | 'unknown_table'
  /** The table has neither a name of its own nor a number from barsy: there is nothing to show a guest. */
  | 'no_label'

/** A refused write. `field` and `problem` say which setting and why, for a bad address. */
export interface TableWriteRefusal {
  readonly ok: false
  readonly error: TableWriteError
  readonly reason: string
  readonly field?: 'baseUrl' | 'ownPattern'
  readonly problem?: QrAddressProblem
}

/** What a writer that changed one table answers. */
export interface TableChange {
  readonly ok: true
  /** Our venue the table belongs to: the token job to queue is for this venue. */
  readonly venueId: VenueId
  readonly table: VenueTable
  /** A token that stopped working because of this change; its file must be removed. Else null. */
  readonly retired: string | null
}

/** What `issueAllTableTokens` answers. */
export type IssueAllResult =
  | {
      readonly ok: true
      readonly venueId: VenueId
      /** How many tables got a code. */
      readonly issued: number
      /** Tables left without one because they have neither a name nor a number. */
      readonly skippedNoLabel: number
    }
  | TableWriteRefusal

function refusal(error: TableWriteError, reason: string): TableWriteRefusal {
  return { ok: false, error, reason }
}

function toTable(place: Place): VenueTable {
  return {
    id: place.id as TableId,
    placeNum: place.placeNum,
    salonName: place.salonName,
    isPublic: place.isPublic,
    state: place.state === 'missing' ? 'missing' : 'active',
    label: place.label,
    token: place.qrToken,
  }
}

// --- reading ------------------------------------------------------------------------------------

/**
 * The tables of a venue that can still be used: those of the barsy venue mapped to it, except the
 * ones barsy deleted. Ordered by hall (no hall last) and number; the tab sorts numbers naturally.
 */
export async function listVenueTables(
  pool: DbPool,
  tenantId: string,
  venueId: string,
): Promise<VenueTable[]> {
  if (!isId('vn', venueId)) return []
  const rows = await withTenant(pool, tenantId, (tx) =>
    tx
      .select({ place: places })
      .from(places)
      .innerJoin(
        barsyVenues,
        and(
          eq(places.tenantId, barsyVenues.tenantId),
          eq(places.integrationId, barsyVenues.integrationId),
          eq(places.bid, barsyVenues.bid),
        ),
      )
      .where(and(eq(barsyVenues.venueId, venueId), ne(places.state, 'deleted')))
      .orderBy(asc(places.salonName), asc(places.placeNum), asc(places.id)),
  )
  return rows.map((row) => toTable(row.place))
}

/** What the token job writes for a venue: its slug and, per active code, the table's name. */
export interface TokenFiles {
  readonly venueSlug: string
  readonly files: readonly { readonly token: string; readonly tableLabel: string }[]
}

/**
 * The files `t/<token>.json` a venue should have: one per table with a code, none for a table
 * barsy deleted (its code was retired). A table with a code but no name cannot be shown to a guest
 * and is left out. Null when the tenant has no such venue.
 */
export async function loadTokenFiles(
  pool: DbPool,
  tenantId: string,
  venueId: string,
): Promise<TokenFiles | null> {
  if (!isId('vn', venueId)) return null
  return withTenant(pool, tenantId, async (tx) => {
    const [venue] = await tx
      .select({ slug: venues.slug })
      .from(venues)
      .where(eq(venues.id, venueId))
    if (venue === undefined) return null
    const rows = await tx
      .select({ place: places })
      .from(places)
      .innerJoin(
        barsyVenues,
        and(
          eq(places.tenantId, barsyVenues.tenantId),
          eq(places.integrationId, barsyVenues.integrationId),
          eq(places.bid, barsyVenues.bid),
        ),
      )
      .where(and(eq(barsyVenues.venueId, venueId), ne(places.state, 'deleted')))
      .orderBy(asc(places.id))
    const files: { token: string; tableLabel: string }[] = []
    for (const { place } of rows) {
      if (place.qrToken === null) continue
      const tableLabel = tableDisplayLabel(place)
      if (tableLabel !== null) files.push({ token: place.qrToken, tableLabel })
    }
    return { venueSlug: venue.slug, files }
  })
}

// --- writing: one table -------------------------------------------------------------------------

/** The table with its venue, locked for the rest of the transaction; null when it is not usable. */
async function lockTable(
  tx: WriteTx,
  tableId: string,
): Promise<{ place: Place; venueId: VenueId } | null> {
  if (!isId('tb', tableId)) return null
  // Lock the row alone: Postgres wants `FOR UPDATE OF` to name a relation without its schema,
  // which the query builder does not write, so the lock and the join are two queries.
  const [place] = await tx.select().from(places).where(eq(places.id, tableId)).for('update')
  if (place === undefined || place.state === 'deleted') return null
  const [barsy] = await tx
    .select({ venueId: barsyVenues.venueId })
    .from(barsyVenues)
    .where(and(eq(barsyVenues.integrationId, place.integrationId), eq(barsyVenues.bid, place.bid)))
  if (barsy === undefined || barsy.venueId === null) return null
  return { place, venueId: barsy.venueId as VenueId }
}

const UNKNOWN_TABLE = 'this venue has no such table'

/**
 * Gives a table a new code: a table without one gets its first, a table with one gets a different
 * one and the old token is returned as `retired` (the printed sticker stops working). Refused for
 * a table that has no name to show (`no_label`).
 */
export async function issueTableToken(
  pool: DbPool,
  tenantId: string,
  tableId: string,
): Promise<TableChange | TableWriteRefusal> {
  return withTenantWrite(pool, tenantId, async (tx) => {
    const found = await lockTable(tx, tableId)
    if (found === null) return refusal('unknown_table', UNKNOWN_TABLE)
    if (tableDisplayLabel(found.place) === null) {
      return refusal('no_label', 'the table has no number from barsy and no name of its own')
    }
    const token = newTableToken()
    const [updated] = await tx
      .update(places)
      .set({ qrToken: token })
      .where(eq(places.id, found.place.id))
      .returning()
    if (updated === undefined) return refusal('unknown_table', UNKNOWN_TABLE)
    return {
      ok: true,
      venueId: found.venueId,
      table: toTable(updated),
      retired: found.place.qrToken,
    } as const
  })
}

/** Turns a table's code off: its token is returned as `retired` (null if it had none). */
export async function retireTableToken(
  pool: DbPool,
  tenantId: string,
  tableId: string,
): Promise<TableChange | TableWriteRefusal> {
  return withTenantWrite(pool, tenantId, async (tx) => {
    const found = await lockTable(tx, tableId)
    if (found === null) return refusal('unknown_table', UNKNOWN_TABLE)
    if (found.place.qrToken === null) {
      return { ok: true, venueId: found.venueId, table: toTable(found.place), retired: null }
    }
    const [updated] = await tx
      .update(places)
      .set({ qrToken: null })
      .where(eq(places.id, found.place.id))
      .returning()
    if (updated === undefined) return refusal('unknown_table', UNKNOWN_TABLE)
    return {
      ok: true,
      venueId: found.venueId,
      table: toTable(updated),
      retired: found.place.qrToken,
    } as const
  })
}

/**
 * Sets the name a guest sees for a table, or clears it (`null`, or only spaces) so the number from
 * barsy is used again. At most 40 characters.
 */
export async function setTableLabel(
  pool: DbPool,
  tenantId: string,
  tableId: string,
  label: string | null,
): Promise<TableChange | TableWriteRefusal> {
  const text = label === null ? null : label.trim().replace(/\s+/g, ' ')
  if (text !== null && text.length > MAX_TABLE_LABEL_LENGTH) {
    return refusal('invalid_input', `a table name has at most ${MAX_TABLE_LABEL_LENGTH} characters`)
  }
  const next = text === '' ? null : text
  return withTenantWrite(pool, tenantId, async (tx) => {
    const found = await lockTable(tx, tableId)
    if (found === null) return refusal('unknown_table', UNKNOWN_TABLE)
    // A name cannot be taken away from a table that has a code and no number to fall back on.
    if (
      next === null &&
      found.place.qrToken !== null &&
      tableDisplayLabel({
        label: null,
        placeNum: found.place.placeNum,
      }) === null
    ) {
      return refusal('no_label', 'the table has a code, so it needs a name or a number from barsy')
    }
    const [updated] = await tx
      .update(places)
      .set({ label: next })
      .where(eq(places.id, found.place.id))
      .returning()
    if (updated === undefined) return refusal('unknown_table', UNKNOWN_TABLE)
    return { ok: true, venueId: found.venueId, table: toTable(updated), retired: null } as const
  })
}

// --- writing: the venue -------------------------------------------------------------------------

/**
 * Gives a code to every usable table of the venue that has none (state `active`, hidden tables
 * included: the tab shows which are hidden). Tables with neither a number nor a name are skipped
 * and counted. Tables that have a code are left alone.
 */
export async function issueAllTableTokens(
  pool: DbPool,
  tenantId: string,
  venueId: string,
): Promise<IssueAllResult> {
  if (!isId('vn', venueId)) return refusal('invalid_input', 'venueId must be a vn_ id')
  return withTenantWrite(pool, tenantId, async (tx) => {
    const [venue] = await tx.select({ id: venues.id }).from(venues).where(eq(venues.id, venueId))
    if (venue === undefined) return refusal('unknown_venue', 'the tenant has no such venue')
    const candidates = await tx
      .select({ id: places.id })
      .from(places)
      .innerJoin(
        barsyVenues,
        and(
          eq(places.tenantId, barsyVenues.tenantId),
          eq(places.integrationId, barsyVenues.integrationId),
          eq(places.bid, barsyVenues.bid),
        ),
      )
      .where(
        and(eq(barsyVenues.venueId, venueId), eq(places.state, 'active'), isNull(places.qrToken)),
      )
    // Lock them (in id order, so two runs cannot wait for each other) and look again: a sync or
    // another manager may have changed one in between.
    const rows =
      candidates.length === 0
        ? []
        : await tx
            .select()
            .from(places)
            .where(
              and(
                inArray(
                  places.id,
                  candidates.map((candidate) => candidate.id),
                ),
                eq(places.state, 'active'),
                isNull(places.qrToken),
              ),
            )
            .orderBy(asc(places.id))
            .for('update')
    let issued = 0
    let skippedNoLabel = 0
    for (const place of rows) {
      if (tableDisplayLabel(place) === null) {
        skippedNoLabel += 1
        continue
      }
      await tx.update(places).set({ qrToken: newTableToken() }).where(eq(places.id, place.id))
      issued += 1
    }
    return { ok: true, venueId: venueId as VenueId, issued, skippedNoLabel } as const
  })
}

const QrSettingsInputSchema = z.strictObject({
  venueId: idSchema('vn'),
  mode: z.enum(QR_MODES),
  /** The base address of "our link", or null to use the app's own address from the environment. */
  baseUrl: z.string().nullable(),
  /** The venue's own pattern with `{token}`, or null for none. Required when `mode` is `own`. */
  ownPattern: z.string().nullable(),
})

/** What `setVenueQrSettings` needs. */
export type SetVenueQrSettingsInput = z.input<typeof QrSettingsInputSchema>

/** What `setVenueQrSettings` answers: the setting as stored. */
export type VenueQrSaved = { readonly ok: true; readonly qr: VenueQr } | TableWriteRefusal

/**
 * Saves which address the venue's codes carry (`venues.settings.qr`). Every address given is
 * checked (`checkBaseUrl`, `checkOwnPattern`); `own` needs a pattern. Both addresses are kept
 * whichever mode is chosen. Other keys of `venues.settings` are left alone. Codes already printed
 * keep their old address: the token files do not hold it, so no job is needed.
 */
export async function setVenueQrSettings(
  pool: DbPool,
  tenantId: string,
  input: SetVenueQrSettingsInput,
): Promise<VenueQrSaved> {
  const parsed = QrSettingsInputSchema.safeParse(input)
  if (!parsed.success) return refusal('invalid_input', z.prettifyError(parsed.error))
  const { venueId, mode } = parsed.data

  let baseUrl: string | undefined
  if (parsed.data.baseUrl !== null && parsed.data.baseUrl.trim() !== '') {
    const checked = checkBaseUrl(parsed.data.baseUrl)
    if (!checked.ok) {
      return {
        ...refusal('invalid_input', `the base address is not usable (${checked.problem})`),
        field: 'baseUrl',
        problem: checked.problem,
      }
    }
    baseUrl = checked.value
  }
  let ownPattern: string | undefined
  if (parsed.data.ownPattern !== null && parsed.data.ownPattern.trim() !== '') {
    const checked = checkOwnPattern(parsed.data.ownPattern)
    if (!checked.ok) {
      return {
        ...refusal('invalid_input', `the pattern is not usable (${checked.problem})`),
        field: 'ownPattern',
        problem: checked.problem,
      }
    }
    ownPattern = checked.value
  }
  if (mode === 'own' && ownPattern === undefined) {
    return {
      ...refusal('invalid_input', 'the venue’s own link needs a pattern'),
      field: 'ownPattern',
      problem: 'empty',
    }
  }
  const qr: VenueQr = VenueQrSchema.parse({
    mode,
    ...(baseUrl === undefined ? {} : { base_url: baseUrl }),
    ...(ownPattern === undefined ? {} : { own_pattern: ownPattern }),
  })

  return withTenantWrite(pool, tenantId, async (tx) => {
    const [venue] = await tx.select().from(venues).where(eq(venues.id, venueId)).for('update')
    if (venue === undefined) return refusal('unknown_venue', 'the tenant has no such venue')
    await tx
      .update(venues)
      .set({ settings: { ...venue.settings, qr } })
      .where(eq(venues.id, venueId))
    return { ok: true, qr } as const
  })
}
