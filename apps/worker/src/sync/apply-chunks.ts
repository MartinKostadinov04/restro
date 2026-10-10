// Applying a change set through `apply()` in chunks, and adding the results up. The only write
// path to the menu document is core's `apply()` (rule 1); this only decides how big a bite it
// gets (chunk.ts). Every chunk carries the job id, so each event row names the run that wrote it.
//
// With `hold` (setting `publish.new_items = hold`, S3-04), the items a chunk CREATED are hidden
// right after that chunk, in a change set of their own: source `manual`, actor `system`, the
// manual layer, `visible = false`. That only makes the menu more cautious (rule 5), and the
// composer shows the item as "new from barsy, hidden until you show it". Done per chunk, so a
// run that stops half way has held the items it created so far (the next run sees them as linked,
// not as new, and would not hold them).

import { type ChangeSet, type ChangeSetOp, type NodeId, newId } from '@restro/core'
import {
  type ApplyRejection,
  type ApplyResult,
  apply,
  HELD_NEW_ACTOR,
  heldNewItemOps,
} from '@restro/core/apply'
import { chunkChangeSet, sliceOps } from './chunk'
import type { SyncEnvironment } from './context'
import { SyncError } from './errors'

/** What a series of apply() calls did, summed. */
export interface AppliedTotals {
  chunks: number
  applied: number
  unchanged: number
  skipped: number
  eventsWritten: number
  createdNodes: number
  /** New items hidden for review (`hold`); not part of `applied`. */
  held: number
  rejected: ApplyRejection[]
}

export const emptyTotals = (): AppliedTotals => ({
  chunks: 0,
  applied: 0,
  unchanged: 0,
  skipped: 0,
  eventsWritten: 0,
  createdNodes: 0,
  held: 0,
  rejected: [],
})

/** Asks `applyMapped` to hide the items it creates. */
export interface HoldNewItems {
  /** The `jb_` id of the run: the hide carries it as its job. */
  readonly runId: string
  /** When the run observed the data (the run's start). */
  readonly observedAt: string
}

export function addTotals(into: AppliedTotals, result: ApplyResult): void {
  into.chunks += 1
  into.applied += result.applied
  into.unchanged += result.unchanged
  into.skipped += result.skipped
  into.eventsWritten += result.eventsWritten
  into.createdNodes += result.createdNodeIds.length
  into.rejected.push(...result.rejected)
}

/** The ids of the items a chunk created (a `createNode` that resolved onto a linked node is not one). */
function createdItemIds(set: ChangeSet, result: ApplyResult): NodeId[] {
  const items = new Set<string>(
    set.ops.flatMap((op: ChangeSetOp) =>
      op.op === 'createNode' && op.nodeType === 'item' ? [op.id] : [],
    ),
  )
  return result.createdNodeIds.filter((id) => items.has(id))
}

async function holdItems(
  env: SyncEnvironment,
  tenantId: string,
  hold: HoldNewItems,
  itemIds: readonly NodeId[],
  totals: AppliedTotals,
): Promise<void> {
  const result = await apply(env.pool, tenantId, {
    id: newId('cs'),
    source: 'manual',
    jobId: hold.runId,
    actor: HELD_NEW_ACTOR,
    observedAt: hold.observedAt,
    ops: heldNewItemOps(itemIds),
  })
  totals.held += result.applied
  totals.eventsWritten += result.eventsWritten
  totals.rejected.push(...result.rejected)
}

async function applyAll(
  env: SyncEnvironment,
  tenantId: string,
  sets: readonly ChangeSet[],
  totals: AppliedTotals,
  hold?: HoldNewItems,
): Promise<void> {
  for (const set of sets) {
    if (env.signal?.aborted) throw new SyncError('aborted', 'The worker is shutting down.')
    const result = await apply(env.pool, tenantId, set)
    addTotals(totals, result)
    if (hold !== undefined) {
      const created = createdItemIds(set, result)
      if (created.length > 0) await holdItems(env, tenantId, hold, created, totals)
    }
  }
}

/** The mapper's change set, split by `chunkChangeSet` and applied in order. */
export async function applyMapped(
  env: SyncEnvironment,
  tenantId: string,
  changeSet: ChangeSet | null,
  totals: AppliedTotals,
  hold?: HoldNewItems,
): Promise<void> {
  if (changeSet === null) return
  await applyAll(
    env,
    tenantId,
    chunkChangeSet(changeSet, () => newId('cs')),
    totals,
    hold,
  )
}

/** Independent ops (link-state updates) in change sets of their own, applied in order. */
export async function applyOps(
  env: SyncEnvironment,
  tenantId: string,
  base: Pick<ChangeSet, 'source' | 'jobId' | 'actor' | 'observedAt'>,
  ops: readonly ChangeSetOp[],
  totals: AppliedTotals,
): Promise<void> {
  await applyAll(
    env,
    tenantId,
    sliceOps(base, ops, () => newId('cs')),
    totals,
  )
}
