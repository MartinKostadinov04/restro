// A venue's tag list (brief S3-06, D60): the writers behind the composer's Tags panel, the reader
// the composer and the publisher use, and the bulk assignment of tags to items.
//
// The tag list is a side table (`tags`), like the barsy venues and places: it is the vocabulary
// that an item's `tags` values point into, not part of the menu document, so these writers do not
// go through apply() (only this folder may import the write side of the database). What goes
// through apply() is the assignment: an item's `tags` field holds `tg_` ids in the manual layer,
// and `setItemTags` builds one atomic change set for a whole selection of items.
//
// Rules the writers keep:
// - a tag is archived, never deleted: items and old snapshots still name it by id;
// - the order is a fractional sort key (`sortKeyBetween`), so moving a tag writes one row;
// - every writer takes the tenant's document lock, so a tag cannot be archived while an assignment
//   of it is being checked (apply() checks the tag ids it is given).

import {
  type DbPool,
  fieldValues,
  type ReadTx,
  type TagRow,
  tags,
  venues,
  withTenant,
} from '@restro/db'
import { type WriteTx, withTenantWrite } from '@restro/db/write'
import { and, asc, eq, inArray, sql } from 'drizzle-orm'
import { z } from 'zod'

import { ActorSchema, type ChangeSet, type ChangeSetOp } from '../change-set'
import { canonicalJson } from '../hash'
import { idSchema, type NodeId, newId, type TagId, type VenueId } from '../ids'
import { isLocale, type Locale, type LocalizedText } from '../locales'
import type { TagVocabularyEntry } from '../snapshot/build'
import { sortKeyBetween } from '../sort-keys'
import {
  checkTagLabel,
  DEFAULT_TAG_COLOR,
  MAX_BULK_TAG_ITEMS,
  type Tag,
  type TagColor,
  TagColorSchema,
} from '../tags'
import { type ApplyResult, applyInTransaction } from './apply'
import { lockTenantDocument } from './lock'

/** Why a tag writer refused. Nothing is written when one is returned. */
export type TagWriteError =
  /** An id, colour, position or name that is not shaped right. */
  | 'invalid_input'
  /** The tenant has no such venue. */
  | 'unknown_venue'
  /** The venue has no such tag (or a position names one it does not have). */
  | 'unknown_tag'
  /** The name has no text in the venue's default language. */
  | 'default_language_missing'
  /** The name has text in a language the venue has not enabled. */
  | 'language_not_enabled'

/** What a tag writer answers. */
export type TagWriteResult =
  | { readonly ok: true; readonly tag: Tag }
  | { readonly ok: false; readonly error: TagWriteError; readonly reason: string }

/** Where a tag goes in the venue's order: the end, or just before another tag. */
export type TagPosition = 'end' | { readonly before: TagId }

const TagPositionSchema = z.union([z.literal('end'), z.strictObject({ before: idSchema('tg') })])

function failure(error: TagWriteError, reason: string): TagWriteResult {
  return { ok: false, error, reason }
}

function toTag(row: TagRow): Tag {
  const color = TagColorSchema.safeParse(row.color)
  return {
    id: row.id as TagId,
    venueId: row.venueId as VenueId,
    label: row.label as LocalizedText,
    color: color.success ? color.data : DEFAULT_TAG_COLOR,
    sortKey: row.sortKey,
    archived: row.archivedAt !== null,
  }
}

// --- reading ------------------------------------------------------------------------------------

/** What `listTags` can be asked. */
export interface ListTagsOptions {
  /** Include archived tags (the Tags panel shows them to restore). Default: no. */
  readonly includeArchived?: boolean
}

async function readTags(tx: ReadTx, venueId: string, includeArchived: boolean): Promise<Tag[]> {
  const rows = await tx
    .select()
    .from(tags)
    .where(eq(tags.venueId, venueId))
    .orderBy(asc(tags.sortKey), asc(tags.id))
  return rows.map(toTag).filter((tag) => includeArchived || !tag.archived)
}

/** The venue's tags in order. Archived ones only when asked for. */
export async function listTags(
  pool: DbPool,
  tenantId: string,
  venueId: string,
  options: ListTagsOptions = {},
): Promise<Tag[]> {
  return withTenant(pool, tenantId, (tx) => readTags(tx, venueId, options.includeArchived === true))
}

/**
 * The venue's tag vocabulary for a snapshot: its non-archived tags, in order, with name and colour
 * token. The publisher reads it inside its own transaction.
 */
export async function loadTagVocabulary(
  tx: ReadTx,
  venueId: string,
): Promise<Record<TagId, TagVocabularyEntry>> {
  const vocabulary: Record<TagId, TagVocabularyEntry> = {}
  for (const tag of await readTags(tx, venueId, false)) {
    vocabulary[tag.id] = { label: tag.label, color: tag.color }
  }
  return vocabulary
}

// --- writing ------------------------------------------------------------------------------------

interface VenueLanguages {
  readonly defaultLocale: Locale
  readonly enabledLocales: readonly Locale[]
}

/** Runs one writer for a venue of the tenant, under the document lock. */
async function inVenue(
  pool: DbPool,
  tenantId: string,
  venueId: string,
  run: (tx: WriteTx, languages: VenueLanguages) => Promise<TagWriteResult>,
): Promise<TagWriteResult> {
  if (!idSchema('vn').safeParse(venueId).success) {
    return failure('invalid_input', 'venueId must be a vn_ id')
  }
  return withTenantWrite(pool, tenantId, async (tx) => {
    await lockTenantDocument(tx, tenantId)
    const [venue] = await tx.select().from(venues).where(eq(venues.id, venueId))
    if (!venue) return failure('unknown_venue', `this tenant has no venue ${venueId}`)
    const enabled = venue.enabledLocales.filter(isLocale)
    const defaultLocale = isLocale(venue.defaultLocale)
      ? venue.defaultLocale
      : (enabled[0] ?? 'bg_BG')
    return run(tx, { defaultLocale, enabledLocales: enabled })
  })
}

/** The sort key that puts a tag at `position` among `ordered` (the venue's tags, all of them). */
function keyAt(
  ordered: readonly { readonly id: string; readonly sortKey: string }[],
  position: TagPosition,
  movingId: string | null,
): string | null {
  const others = ordered.filter((tag) => tag.id !== movingId)
  if (position === 'end') return sortKeyBetween(others.at(-1)?.sortKey ?? null, null)
  const index = others.findIndex((tag) => tag.id === position.before)
  const next = others[index]
  if (next === undefined) return null
  return sortKeyBetween(others[index - 1]?.sortKey ?? null, next.sortKey)
}

async function venueOrder(tx: WriteTx, venueId: string) {
  return tx
    .select({ id: tags.id, sortKey: tags.sortKey })
    .from(tags)
    .where(eq(tags.venueId, venueId))
    .orderBy(asc(tags.sortKey), asc(tags.id))
}

async function tagOf(tx: WriteTx, venueId: string, id: string): Promise<TagRow | undefined> {
  const [row] = await tx
    .select()
    .from(tags)
    .where(and(eq(tags.venueId, venueId), eq(tags.id, id)))
  return row
}

const unknownTag = (id: string) => failure('unknown_tag', `the venue has no tag ${id}`)

/** The tag a position names, for the "no such tag" answer. */
const beforeId = (position: TagPosition): string => (position === 'end' ? '' : position.before)

/** What `createTag` takes. */
export interface CreateTagInput {
  readonly venueId: string
  /** A `tg_` id the caller made (so a retry or an optimistic screen agrees on it). Default: a new one. */
  readonly id?: string
  /** The name per language; at least the venue's default language. */
  readonly label: unknown
  /** A colour token (`TAG_COLORS`). Default: `accent`. */
  readonly color?: unknown
  /** Default: the end. */
  readonly position?: unknown
}

/**
 * Adds a tag to the venue's list. A `tg_` id the venue already has is answered with the stored tag
 * (a retried request creates nothing twice).
 */
export async function createTag(
  pool: DbPool,
  tenantId: string,
  input: CreateTagInput,
): Promise<TagWriteResult> {
  const id = input.id === undefined ? newId('tg') : input.id
  const color = TagColorSchema.safeParse(input.color ?? DEFAULT_TAG_COLOR)
  const position = TagPositionSchema.safeParse(input.position ?? 'end')
  if (!idSchema('tg').safeParse(id).success) {
    return failure('invalid_input', 'id must be a tg_ id')
  }
  if (!color.success) return failure('invalid_input', 'color must be one of the tag colours')
  if (!position.success) return failure('invalid_input', 'position is not valid')
  return inVenue(pool, tenantId, input.venueId, async (tx, languages) => {
    const checked = checkTagLabel(input.label, languages)
    if (!checked.ok) {
      return failure(
        checked.problem === 'invalid' ? 'invalid_input' : checked.problem,
        checked.reason,
      )
    }
    const [existing] = await tx.select().from(tags).where(eq(tags.id, id))
    if (existing) {
      return existing.venueId === input.venueId
        ? { ok: true, tag: toTag(existing) }
        : failure('invalid_input', 'that tag id is taken')
    }
    const sortKey = keyAt(await venueOrder(tx, input.venueId), position.data, null)
    if (sortKey === null) return unknownTag(beforeId(position.data))
    // Another tenant's tag with this id is invisible here (row-level security) but still owns the
    // primary key: that reads as taken, not as an error.
    const [row] = await tx
      .insert(tags)
      .values({
        id,
        tenantId,
        venueId: input.venueId,
        label: checked.label,
        color: color.data,
        sortKey,
      })
      .onConflictDoNothing()
      .returning()
    return row ? { ok: true, tag: toTag(row) } : failure('invalid_input', 'that tag id is taken')
  })
}

/** What `updateTag` takes: the name and/or the colour. */
export interface UpdateTagInput {
  readonly venueId: string
  readonly id: string
  readonly label?: unknown
  readonly color?: unknown
}

/** Renames and/or recolours a tag (archived ones too). Saying what it already is changes nothing. */
export async function updateTag(
  pool: DbPool,
  tenantId: string,
  input: UpdateTagInput,
): Promise<TagWriteResult> {
  const color = input.color === undefined ? undefined : TagColorSchema.safeParse(input.color)
  if (!idSchema('tg').safeParse(input.id).success) {
    return failure('invalid_input', 'id must be a tg_ id')
  }
  if (color !== undefined && !color.success) {
    return failure('invalid_input', 'color must be one of the tag colours')
  }
  return inVenue(pool, tenantId, input.venueId, async (tx, languages) => {
    const row = await tagOf(tx, input.venueId, input.id)
    if (!row) return unknownTag(input.id)
    let label: LocalizedText | undefined
    if (input.label !== undefined) {
      const checked = checkTagLabel(input.label, languages)
      if (!checked.ok) {
        return failure(
          checked.problem === 'invalid' ? 'invalid_input' : checked.problem,
          checked.reason,
        )
      }
      label = checked.label
    }
    const nextColor: TagColor | undefined = color?.success ? color.data : undefined
    const labelChanged = label !== undefined && canonicalJson(label) !== canonicalJson(row.label)
    const colorChanged = nextColor !== undefined && nextColor !== row.color
    if (!labelChanged && !colorChanged) return { ok: true, tag: toTag(row) }
    const [updated] = await tx
      .update(tags)
      .set({
        ...(labelChanged && label !== undefined ? { label } : {}),
        ...(colorChanged && nextColor !== undefined ? { color: nextColor } : {}),
      })
      .where(eq(tags.id, input.id))
      .returning()
    return updated ? { ok: true, tag: toTag(updated) } : unknownTag(input.id)
  })
}

/** Moves a tag to another place in the venue's order. */
export async function moveTag(
  pool: DbPool,
  tenantId: string,
  input: { readonly venueId: string; readonly id: string; readonly position: unknown },
): Promise<TagWriteResult> {
  const position = TagPositionSchema.safeParse(input.position)
  if (!idSchema('tg').safeParse(input.id).success) {
    return failure('invalid_input', 'id must be a tg_ id')
  }
  if (!position.success) return failure('invalid_input', 'position is not valid')
  return inVenue(pool, tenantId, input.venueId, async (tx) => {
    const row = await tagOf(tx, input.venueId, input.id)
    if (!row) return unknownTag(input.id)
    if (position.data !== 'end' && position.data.before === input.id) {
      return { ok: true, tag: toTag(row) }
    }
    const sortKey = keyAt(await venueOrder(tx, input.venueId), position.data, input.id)
    if (sortKey === null) return unknownTag(beforeId(position.data))
    const [updated] = await tx
      .update(tags)
      .set({ sortKey })
      .where(eq(tags.id, input.id))
      .returning()
    return updated ? { ok: true, tag: toTag(updated) } : unknownTag(input.id)
  })
}

async function setArchived(
  pool: DbPool,
  tenantId: string,
  input: { readonly venueId: string; readonly id: string },
  archived: boolean,
): Promise<TagWriteResult> {
  if (!idSchema('tg').safeParse(input.id).success) {
    return failure('invalid_input', 'id must be a tg_ id')
  }
  return inVenue(pool, tenantId, input.venueId, async (tx) => {
    const row = await tagOf(tx, input.venueId, input.id)
    if (!row) return unknownTag(input.id)
    if ((row.archivedAt !== null) === archived) return { ok: true, tag: toTag(row) }
    const [updated] = await tx
      .update(tags)
      .set({ archivedAt: archived ? sql`now()` : null })
      .where(eq(tags.id, input.id))
      .returning()
    return updated ? { ok: true, tag: toTag(updated) } : unknownTag(input.id)
  })
}

/**
 * Archives a tag: it leaves the pickers and the next snapshots. Items keep its id, so restoring
 * the tag brings every assignment back. Archiving an archived tag changes nothing.
 */
export function archiveTag(
  pool: DbPool,
  tenantId: string,
  input: { readonly venueId: string; readonly id: string },
): Promise<TagWriteResult> {
  return setArchived(pool, tenantId, input, true)
}

/** Brings an archived tag back. Restoring a tag that is not archived changes nothing. */
export function restoreTag(
  pool: DbPool,
  tenantId: string,
  input: { readonly venueId: string; readonly id: string },
): Promise<TagWriteResult> {
  return setArchived(pool, tenantId, input, false)
}

// --- assigning to items -------------------------------------------------------------------------

const SetItemTagsSchema = z
  .strictObject({
    venueId: idSchema('vn'),
    itemIds: z.array(idSchema('nd')).min(1).max(MAX_BULK_TAG_ITEMS),
    add: z.array(idSchema('tg')).max(50),
    remove: z.array(idSchema('tg')).max(50),
    actor: ActorSchema,
  })
  .refine((input) => input.add.length + input.remove.length > 0, 'add or remove at least one tag')

/** What `setItemTags` takes. */
export type SetItemTagsInput = z.input<typeof SetItemTagsSchema>

/** Why `setItemTags` was refused before it reached apply(). */
export class SetItemTagsError extends Error {
  override name = 'SetItemTagsError'
}

/**
 * Adds tags to and removes tags from a whole selection of items, as ONE atomic change set (one
 * `setField` or `clearField` per item that changes, in the manual layer): either every item gets
 * its new tags or none does. Each item ends with (what it holds, plus `add`, minus `remove`); one
 * that would not change is left out. Anything apply() refuses (a tag that is not an active tag of
 * the item's venue, an id that is not an item) refuses the whole selection with an `ApplyError`
 * (`change_set_rejected`, the rejections in `error.rejected`).
 *
 * The items' current tags are read in the same transaction as the write, under the document lock,
 * so a change somebody else makes in between is not overwritten.
 */
export async function setItemTags(
  pool: DbPool,
  tenantId: string,
  input: SetItemTagsInput,
  options: { readonly now?: Date } = {},
): Promise<ApplyResult> {
  const parsed = SetItemTagsSchema.safeParse(input)
  if (!parsed.success) {
    throw new SetItemTagsError(parsed.error.issues[0]?.message ?? 'invalid input')
  }
  const { itemIds, add, remove, actor } = parsed.data
  const unique = [...new Set<NodeId>(itemIds)]
  return withTenantWrite(pool, tenantId, async (tx) => {
    await lockTenantDocument(tx, tenantId)
    const rows = await tx
      .select({ nodeId: fieldValues.nodeId, value: fieldValues.value, valid: fieldValues.valid })
      .from(fieldValues)
      .where(
        and(
          eq(fieldValues.fieldKey, 'tags'),
          eq(fieldValues.layer, 'manual'),
          eq(fieldValues.scope, 'master'),
          inArray(fieldValues.nodeId, unique),
        ),
      )
    const held = new Map<string, string[]>()
    for (const row of rows) {
      if (row.valid && Array.isArray(row.value)) {
        held.set(
          row.nodeId,
          row.value.filter((id): id is string => typeof id === 'string'),
        )
      }
    }
    const removed = new Set<string>(remove)
    const ops: ChangeSetOp[] = []
    for (const id of unique) {
      const current = held.get(id) ?? []
      const next = [...new Set([...current.filter((tag) => !removed.has(tag)), ...add])].sort()
      if (canonicalJson(next) === canonicalJson([...current].sort())) continue
      ops.push(
        next.length === 0
          ? { op: 'clearField', node: { id }, fieldKey: 'tags', layer: 'manual', scope: 'master' }
          : {
              op: 'setField',
              node: { id },
              fieldKey: 'tags',
              layer: 'manual',
              scope: 'master',
              value: next,
            },
      )
    }
    if (ops.length === 0) {
      return {
        applied: 0,
        unchanged: unique.length,
        skipped: 0,
        rejected: [],
        createdNodeIds: [],
        eventsWritten: 0,
      }
    }
    const changeSet: ChangeSet = {
      id: newId('cs'),
      source: 'manual',
      jobId: newId('jb'),
      actor,
      observedAt: (options.now ?? new Date()).toISOString(),
      ops,
    }
    const result = await applyInTransaction(tx, tenantId, changeSet, { atomic: true })
    return { ...result, unchanged: result.unchanged + (unique.length - ops.length) }
  })
}
