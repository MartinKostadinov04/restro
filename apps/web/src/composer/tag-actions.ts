'use server'

// The composer's tag writes (brief S3-06, D60). Like ./actions.ts: each is a server action that
// checks who is asking (requireTenant), that the venue is theirs, parses its input with Zod and
// hands it to core: the tag list through the writers in `@restro/core/apply` (a venue's side
// table), the assignment of tags to items through `setItemTags`, which builds one atomic change
// set for `apply()` (rule 1). Then it revalidates the venue page so the client gets the fresh
// view in the same round trip.
import { idSchema, TagColorSchema, TagLabelSchema } from '@restro/core'
import {
  ApplyError,
  archiveTag,
  createTag,
  moveTag,
  restoreTag,
  SetItemTagsError,
  setItemTags,
  type TagWriteResult,
  updateTag,
} from '@restro/core/apply'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { getPool } from '@/server/db'
import { logError } from '@/server/log'
import { requireTenant } from '@/server/session'
import { getVenue } from '@/server/venues'

import type { ActionResult } from './action-result'

const venueId = idSchema('vn')
const tagId = idSchema('tg')
const nodeId = idSchema('nd')

const CreateTagInput = z.strictObject({
  venueId,
  id: tagId,
  label: TagLabelSchema,
  color: TagColorSchema,
})
const UpdateTagInput = z.strictObject({
  venueId,
  id: tagId,
  label: TagLabelSchema.optional(),
  color: TagColorSchema.optional(),
})
const MoveTagInput = z.strictObject({
  venueId,
  id: tagId,
  /** The tag it goes before; `null` = to the end. */
  beforeId: tagId.nullable(),
})
const ArchiveTagInput = z.strictObject({ venueId, id: tagId, archived: z.boolean() })
const SetItemTagsInput = z.strictObject({
  venueId,
  itemIds: z.array(nodeId).min(1).max(1000),
  add: z.array(tagId).max(50),
  remove: z.array(tagId).max(50),
})

const INVALID: ActionResult = { ok: false, error: 'invalid' }
const NOT_FOUND: ActionResult = { ok: false, error: 'not_found' }

/** What a tag writer's refusal means to the person. */
function answer(result: TagWriteResult): ActionResult {
  if (result.ok) return { ok: true }
  return result.error === 'unknown_venue' || result.error === 'unknown_tag' ? NOT_FOUND : INVALID
}

/** Runs one tag action for a venue of the signed-in person's organisation. */
async function perform(
  venue: string,
  run: (context: { tenantId: string; userId: string; venueId: string }) => Promise<ActionResult>,
): Promise<ActionResult> {
  try {
    const { organization, user } = await requireTenant()
    const found = await getVenue(organization.id, venue)
    if (!found) return NOT_FOUND
    const result = await run({ tenantId: organization.id, userId: user.id, venueId: found.id })
    if (result.ok) revalidatePath(`/venues/${found.id}`)
    return result
  } catch (error) {
    // redirect() and notFound() are control flow, not failures.
    if (error instanceof Error && 'digest' in error) throw error
    logError('composer_tag_action_failed', error)
    return { ok: false, error: 'failed' }
  }
}

/** Adds a tag to the venue's list, at the end. The caller names the id (a retry is harmless). */
export async function createTagAction(input: unknown): Promise<ActionResult> {
  const parsed = CreateTagInput.safeParse(input)
  if (!parsed.success) return INVALID
  const { venueId: venue, ...tag } = parsed.data
  return perform(venue, async ({ tenantId, venueId: id }) =>
    answer(await createTag(getPool(), tenantId, { venueId: id, ...tag })),
  )
}

/** Renames and/or recolours a tag. */
export async function updateTagAction(input: unknown): Promise<ActionResult> {
  const parsed = UpdateTagInput.safeParse(input)
  if (!parsed.success) return INVALID
  const { venueId: venue, ...change } = parsed.data
  return perform(venue, async ({ tenantId, venueId: id }) =>
    answer(await updateTag(getPool(), tenantId, { venueId: id, ...change })),
  )
}

/** Moves a tag before another tag, or to the end. */
export async function moveTagAction(input: unknown): Promise<ActionResult> {
  const parsed = MoveTagInput.safeParse(input)
  if (!parsed.success) return INVALID
  const { venueId: venue, id: tag, beforeId } = parsed.data
  return perform(venue, async ({ tenantId, venueId: id }) =>
    answer(
      await moveTag(getPool(), tenantId, {
        venueId: id,
        id: tag,
        position: beforeId === null ? 'end' : { before: beforeId },
      }),
    ),
  )
}

/** Archives a tag (hidden from pickers and the next snapshots) or brings it back. */
export async function setTagArchivedAction(input: unknown): Promise<ActionResult> {
  const parsed = ArchiveTagInput.safeParse(input)
  if (!parsed.success) return INVALID
  const { venueId: venue, id: tag, archived } = parsed.data
  return perform(venue, async ({ tenantId, venueId: id }) =>
    answer(
      await (archived ? archiveTag : restoreTag)(getPool(), tenantId, { venueId: id, id: tag }),
    ),
  )
}

/**
 * Adds tags to and removes tags from a selection of items: one atomic change set, so either every
 * item changes or none does.
 */
export async function setItemTagsAction(input: unknown): Promise<ActionResult> {
  const parsed = SetItemTagsInput.safeParse(input)
  if (!parsed.success) return INVALID
  const { venueId: venue, ...change } = parsed.data
  return perform(venue, async ({ tenantId, userId, venueId: id }) => {
    try {
      await setItemTags(getPool(), tenantId, {
        venueId: id,
        ...change,
        actor: `user:${userId}`,
      })
      return { ok: true }
    } catch (error) {
      if (error instanceof ApplyError && error.code === 'change_set_rejected') {
        const codes = error.rejected.map((rejection) => rejection.code).join(',')
        logError('composer_tags_rejected', new Error(`rejected: ${codes}`))
        return { ok: false, error: 'rejected' }
      }
      if (error instanceof ApplyError || error instanceof SetItemTagsError) return INVALID
      throw error
    }
  })
}
