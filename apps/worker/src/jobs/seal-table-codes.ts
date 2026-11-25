// `seal-table-codes` (D122 §9; ticket #70): moves the table codes stored in plain before #70 to
// the stored form, a hash and a copy sealed for this worker. Per organisation, in batches:
//   1. seal: every code still in plain gets its sealed copy (the plain code stays for now);
//   2. the venue's files are written under the codes' hashes (`writeTableTokenFiles`), which is
//      where `/t/<code>` looks since #70;
//   3. the old files named by the plain code are removed;
//   4. the plain code is cleared, only where the row still holds that code and its sealed copy.
// Each step is decided from the rows as they are, so a run cut short anywhere is finished by the
// next and a second run finds nothing to do. Scheduled daily and sent once at every worker start
// (worker.ts), so a deploy moves the codes within seconds. Never logs a code.
import type { KeyObject } from 'node:crypto'

import { type PublishStore, tableTokenPath } from '@restro/assets'
import { JOB_NAMES } from '@restro/core'
import { clearPlainTableCodes, listPlainTableCodes, sealPlainTableCodes } from '@restro/core/apply'
import { authOrganization, type DbPool, withSystem } from '@restro/db'

import { writeTableTokenFiles } from '../publish/table-tokens'
import { defineJob, type JobDefinition } from './types'

/** Codes handled per batch. */
const BATCH = 500
/** Batches per organisation and run; a larger backlog is finished by the next run. */
const MAX_BATCHES = 100

/** What one organisation's run did. */
export interface SealedTableCodes {
  readonly sealed: number
  readonly filesRemoved: number
  readonly cleared: number
}

/** Runs the four steps (see the header) for one organisation. */
export async function sealTableCodesOf(
  deps: { readonly pool: DbPool; readonly store: PublishStore; readonly publicKey: KeyObject },
  tenantId: string,
): Promise<SealedTableCodes> {
  let sealed = 0
  let filesRemoved = 0
  let cleared = 0
  for (let batch = 0; batch < MAX_BATCHES; batch++) {
    const sealedNow = await sealPlainTableCodes(deps.pool, tenantId, deps.publicKey, BATCH)
    sealed += sealedNow
    const plain = await listPlainTableCodes(deps.pool, tenantId, BATCH)
    if (plain.length === 0) {
      if (sealedNow === 0) break
      continue
    }
    for (const venueId of new Set(plain.map((code) => code.venueId))) {
      await writeTableTokenFiles(
        { pool: deps.pool, store: deps.store },
        { tenantId, venueId, retired: [] },
      )
    }
    for (const { code } of plain) {
      const path = tableTokenPath(code)
      if ((await deps.store.get(path)) === null) continue
      await deps.store.delete(path)
      filesRemoved += 1
    }
    const clearedNow = await clearPlainTableCodes(deps.pool, tenantId, plain)
    cleared += clearedNow
    // Nothing moved (every listed row changed meanwhile): the next run looks again.
    if (clearedNow === 0 && sealedNow === 0) break
  }
  return { sealed, filesRemoved, cleared }
}

/** The job; needs the publish store and the worker's public seal key. */
export function createSealTableCodesJob(deps: {
  readonly publishStore: PublishStore
  readonly publicKey: KeyObject
}): JobDefinition {
  return defineJob({
    name: JOB_NAMES.sealTableCodes,
    // A safety net beside the run at every start: early morning, after the service day.
    schedule: { cron: '45 4 * * *', tz: 'Europe/Sofia' },
    options: {
      queue: {
        retryLimit: 3,
        retryDelay: 5 * 60,
        retryBackoff: true,
        expireInSeconds: 60 * 60,
        retentionSeconds: 24 * 60 * 60,
      },
      work: { pollingIntervalSeconds: 30 },
    },
    async handler(_jobs, context) {
      const organizations = await withSystem(context.pool, (tx) =>
        tx.select({ id: authOrganization.id }).from(authOrganization),
      )
      for (const { id: tenantId } of organizations) {
        const done = await sealTableCodesOf(
          { pool: context.pool, store: deps.publishStore, publicKey: deps.publicKey },
          tenantId,
        )
        if (done.sealed + done.filesRemoved + done.cleared > 0) {
          context.log.info({ tenantId, ...done }, 'table codes moved to their sealed form')
        }
      }
    },
  })
}
