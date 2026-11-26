// A write transaction as a job queue's `db` (the outbox pattern, #592): a queue entry saved with the
// write or not at all. The service write path hands it to a command's `queueJobs`
// (core/service/engine.ts); core/apply's Tables & QR writes hand it to their caller's owed jobs
// (`tables.ts`, the booking file after an Area or a Table change, #580 review). It runs a job
// queue's insert only (pg-boss's `send` with `{ db }`), never a row of ours.
import type { WriteTx } from '@restro/db/write'
import { type SQLChunk, sql } from 'drizzle-orm'

/** Runs one parameterised statement (`$1`, `$2`…) on the command's transaction: pg-boss's `db`. */
export interface QueueExecutor {
  executeSql(text: string, values?: unknown[]): Promise<{ rows: unknown[] }>
}

/**
 * The transaction as a `QueueExecutor`. Each `$n` becomes a bound parameter, the way pg-boss's own
 * adapters read its statements; no value is ever written into the SQL text.
 */
export function queueExecutorOf(tx: WriteTx): QueueExecutor {
  return {
    async executeSql(text, values = []) {
      const chunks: SQLChunk[] = []
      let last = 0
      for (const match of text.matchAll(/\$(\d+)/g)) {
        chunks.push(sql.raw(text.slice(last, match.index)), sql.param(values[Number(match[1]) - 1]))
        last = match.index + match[0].length
      }
      chunks.push(sql.raw(text.slice(last)))
      const { rows } = await tx.execute(sql.join(chunks))
      return { rows }
    },
  }
}
