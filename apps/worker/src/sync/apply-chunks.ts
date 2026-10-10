// Applying a change set through `apply()` in chunks, and adding the results up. The only write
// path to the menu document is core's `apply()` (rule 1); this only decides how big a bite it
// gets (chunk.ts). Every chunk carries the job id, so each event row names the run that wrote it.

import { type ChangeSet, type ChangeSetOp, newId } from '@restro/core'
import { type ApplyRejection, type ApplyResult, apply } from '@restro/core/apply'
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
  rejected: ApplyRejection[]
}

export const emptyTotals = (): AppliedTotals => ({
  chunks: 0,
  applied: 0,
  unchanged: 0,
  skipped: 0,
  eventsWritten: 0,
  createdNodes: 0,
  rejected: [],
})

export function addTotals(into: AppliedTotals, result: ApplyResult): void {
  into.chunks += 1
  into.applied += result.applied
  into.unchanged += result.unchanged
  into.skipped += result.skipped
  into.eventsWritten += result.eventsWritten
  into.createdNodes += result.createdNodeIds.length
  into.rejected.push(...result.rejected)
}

async function applyAll(
  env: SyncEnvironment,
  tenantId: string,
  sets: readonly ChangeSet[],
  totals: AppliedTotals,
): Promise<void> {
  for (const set of sets) {
    if (env.signal?.aborted) throw new SyncError('aborted', 'The worker is shutting down.')
    addTotals(totals, await apply(env.pool, tenantId, set))
  }
}

/** The mapper's change set, split by `chunkChangeSet` and applied in order. */
export async function applyMapped(
  env: SyncEnvironment,
  tenantId: string,
  changeSet: ChangeSet | null,
  totals: AppliedTotals,
): Promise<void> {
  if (changeSet === null) return
  await applyAll(
    env,
    tenantId,
    chunkChangeSet(changeSet, () => newId('cs')),
    totals,
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
