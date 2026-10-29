// patchPayFirstSettingsIn(): the one writer of a venue's pay-first settings, `venues.settings.payFirst`
// (D113, D122 §5; tickets #113, #216). Rule 1 keeps every write of the venue's data in core/apply;
// the service command `pay_first.set` (the owner's Paying card, the Tables & QR rows and Undo) calls
// this and nothing else does.
//
// It changes one thing at a time and merges it into what is saved, under the venue's row lock, so
// two saves of different tables both stay. It also drops what no longer exists: a hall, bar or table
// that was deleted since it was set. Without that the stored maps would name ids the schema's checks
// of a whole-object save refuse, and a deleted table would block every later save.

import { isDeepStrictEqual } from 'node:util'

import { areas, bars, venues, venueTables } from '@restro/db'
import type { WriteTx } from '@restro/db/write'
import { and, eq, inArray, isNull } from 'drizzle-orm'

import {
  type PayFirstSettings,
  PayFirstSettingsSchema,
  readPayFirstSettings,
} from '../pay-first-settings'
import type { PaymentMode } from '../templates/venue-menu'
import { lockLiveVenue, venueRefusalText } from './venue-lock'

/** Why `patchPayFirstSettingsIn` refused. */
export type PayFirstSettingsErrorCode =
  /** The tenant has no such venue. */
  | 'venue_not_found'
  /** The venue was deleted (D76). */
  | 'venue_archived'
  /** The table the change names is not a live table of the venue. */
  | 'table_missing'
  /** The bar or hall the change names is not a live one of the venue. */
  | 'group_missing'

/** Thrown by `patchPayFirstSettingsIn`. */
export class PayFirstSettingsError extends Error {
  override name = 'PayFirstSettingsError'
  readonly code: PayFirstSettingsErrorCode

  constructor(code: PayFirstSettingsErrorCode, message: string) {
    super(message)
    this.code = code
  }
}

/**
 * One change of the pay-first settings. A `value` of null takes the group's or table's own choice
 * away, so it follows the level above again.
 */
export type PayFirstPatch =
  /** The payment mode of an item that sets none. */
  | { readonly itemMode: PaymentMode }
  /** Whether pay-first applies at the venue's tables unless a hall, bar or table says otherwise. */
  | { readonly applies: boolean }
  /** A bar's or hall's own choice, or null for none. */
  | { readonly group: string; readonly value: boolean | null }
  /** A table's own choice, or null for none. */
  | { readonly table: string; readonly value: boolean | null }

/** What `patchPayFirstSettingsIn` did. */
export interface PayFirstPatched {
  /** What applies now. */
  readonly settings: PayFirstSettings
  /** True when the change altered a value; false for a repeat (the stored maps may still have been pruned). */
  readonly changed: boolean
  /** The value the change replaced: `itemMode`, `applies`, or the group's or table's own (null: none). */
  readonly previous: PaymentMode | boolean | null
}

/** The ids of `ids` that are live (not archived) in `venueId`, of one kind of row. */
async function liveIds(
  tx: WriteTx,
  venueId: string,
  kind: 'bar' | 'area' | 'table',
  ids: readonly string[],
): Promise<Set<string>> {
  if (ids.length === 0) return new Set()
  const rows =
    kind === 'bar'
      ? await tx
          .select({ id: bars.id })
          .from(bars)
          .where(
            and(eq(bars.venueId, venueId), inArray(bars.id, [...ids]), isNull(bars.archivedAt)),
          )
      : kind === 'area'
        ? await tx
            .select({ id: areas.id })
            .from(areas)
            .where(
              and(
                eq(areas.venueId, venueId),
                inArray(areas.id, [...ids]),
                isNull(areas.archivedAt),
              ),
            )
        : await tx
            .select({ id: venueTables.id })
            .from(venueTables)
            .where(
              and(
                eq(venueTables.venueId, venueId),
                inArray(venueTables.id, [...ids]),
                isNull(venueTables.archivedAt),
              ),
            )
  return new Set(rows.map((row) => row.id))
}

/** `settings` without the bars, halls and tables that are not live in the venue. */
async function pruned(
  tx: WriteTx,
  venueId: string,
  settings: PayFirstSettings,
  extra: { readonly group?: string; readonly table?: string } = {},
): Promise<{ readonly settings: PayFirstSettings; readonly live: ReadonlySet<string> }> {
  const groupIds = Object.keys(settings.groups)
  const tableIds = Object.keys(settings.tables)
  const barIds = [...groupIds, ...(extra.group?.startsWith('br_') ? [extra.group] : [])].filter(
    (id) => id.startsWith('br_'),
  )
  const areaIds = [...groupIds, ...(extra.group?.startsWith('ar_') ? [extra.group] : [])].filter(
    (id) => id.startsWith('ar_'),
  )
  const live = new Set([
    ...(await liveIds(tx, venueId, 'bar', barIds)),
    ...(await liveIds(tx, venueId, 'area', areaIds)),
    ...(await liveIds(tx, venueId, 'table', [
      ...tableIds,
      ...(extra.table === undefined ? [] : [extra.table]),
    ])),
  ])
  const keep = <V>(map: Readonly<Record<string, V>>): Record<string, V> =>
    Object.fromEntries(Object.entries(map).filter(([id]) => live.has(id)))
  return {
    settings: {
      ...settings,
      groups: keep(settings.groups) as PayFirstSettings['groups'],
      tables: keep(settings.tables) as PayFirstSettings['tables'],
    },
    live,
  }
}

/**
 * Changes one of the venue's pay-first settings inside the caller's transaction, under the venue's
 * row lock, merging it into what is saved and dropping the halls, bars and tables that no longer
 * exist. The service write path's `pay_first.set` calls it and writes the Log entry beside it;
 * nothing else does. Other keys of `venues.settings` are left alone. A group or table the change
 * names must be live in the venue (`PayFirstSettingsError`); nothing is written then. Idempotent.
 */
export async function patchPayFirstSettingsIn(
  tx: WriteTx,
  venueId: string,
  patch: PayFirstPatch,
): Promise<PayFirstPatched> {
  const locked = await lockLiveVenue(tx, venueId, 'update')
  if (locked.refused !== null) {
    throw new PayFirstSettingsError(
      locked.refused === 'venue_archived' ? 'venue_archived' : 'venue_not_found',
      venueRefusalText(venueId, locked.refused),
    )
  }
  const { payFirst: _stored, ...others } = locked.venue.settings
  const current = readPayFirstSettings(locked.venue.settings)
  const { settings: before, live } = await pruned(tx, venueId, current, {
    ...('group' in patch ? { group: patch.group } : {}),
    ...('table' in patch ? { table: patch.table } : {}),
  })

  let next: PayFirstSettings
  let previous: PaymentMode | boolean | null
  if ('itemMode' in patch) {
    previous = before.itemMode
    next = { ...before, itemMode: patch.itemMode }
  } else if ('applies' in patch) {
    previous = before.applies
    next = { ...before, applies: patch.applies }
  } else if ('group' in patch) {
    if (!live.has(patch.group)) {
      throw new PayFirstSettingsError(
        'group_missing',
        `not a live bar or hall of venue ${venueId}: ${patch.group}`,
      )
    }
    const groups: Record<string, boolean> = { ...before.groups }
    previous = groups[patch.group] ?? null
    if (patch.value === null) delete groups[patch.group]
    else groups[patch.group] = patch.value
    next = { ...before, groups: groups as PayFirstSettings['groups'] }
  } else {
    if (!live.has(patch.table)) {
      throw new PayFirstSettingsError(
        'table_missing',
        `not a live table of venue ${venueId}: ${patch.table}`,
      )
    }
    const tables: Record<string, boolean> = { ...before.tables }
    previous = tables[patch.table] ?? null
    if (patch.value === null) delete tables[patch.table]
    else tables[patch.table] = patch.value
    next = { ...before, tables: tables as PayFirstSettings['tables'] }
  }

  const changed = !isDeepStrictEqual(next, before)
  // A repeat that prunes nothing writes nothing; a pruned map is saved even when the change itself
  // was a repeat, so a deleted table's entry does not wait for the next real change.
  if (!isDeepStrictEqual(next, current)) {
    await tx
      .update(venues)
      .set({ settings: { ...others, payFirst: PayFirstSettingsSchema.parse(next) } })
      .where(eq(venues.id, venueId))
  }
  return { settings: next, changed, previous }
}
