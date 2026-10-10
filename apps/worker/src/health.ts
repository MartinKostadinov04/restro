// What "healthy" means for the worker, as pure code. `GET /health` (health-server.ts) answers
// with the result.
//
// Healthy = pg-boss is started AND the worker-heartbeat job has run within the last three
// minutes. The beat is the proof that the whole path works: the cron schedule creates a job, a
// worker fetches it and writes to Postgres. The heartbeat is recorded in memory after the write
// succeeds, so a probe never touches the database itself.

/** The heartbeat is stale when it is older than this. The job runs every minute. */
export const HEARTBEAT_MAX_AGE_MS = 3 * 60_000

export type PgBossState = 'starting' | 'started' | 'stopping' | 'stopped'

export interface HealthReport {
  /** 200 while healthy, 503 otherwise. */
  readonly httpStatus: 200 | 503
  readonly body: {
    readonly status: 'ok' | 'unavailable'
    /** ISO time of the last heartbeat this process recorded, or null before the first. */
    readonly lastBeatAt: string | null
    readonly pgboss: PgBossState
    /** Why the worker is unavailable. Absent while healthy. */
    readonly reason?: string
  }
}

export function evaluateHealth(input: {
  readonly pgboss: PgBossState
  readonly lastBeatAt: Date | null
  readonly now: Date
}): HealthReport {
  const { pgboss, lastBeatAt, now } = input
  const base = { lastBeatAt: lastBeatAt?.toISOString() ?? null, pgboss }

  if (pgboss !== 'started') {
    return {
      httpStatus: 503,
      body: { status: 'unavailable', ...base, reason: `pg-boss is ${pgboss}` },
    }
  }
  if (lastBeatAt === null) {
    return {
      httpStatus: 503,
      body: { status: 'unavailable', ...base, reason: 'no heartbeat recorded yet' },
    }
  }
  if (now.getTime() - lastBeatAt.getTime() > HEARTBEAT_MAX_AGE_MS) {
    return {
      httpStatus: 503,
      body: {
        status: 'unavailable',
        ...base,
        reason: `last heartbeat is older than ${HEARTBEAT_MAX_AGE_MS / 60_000} minutes`,
      },
    }
  }
  return { httpStatus: 200, body: { status: 'ok', ...base } }
}

/** The state the health endpoint reports, shared by the worker and the jobs. */
export class WorkerStatus {
  #pgboss: PgBossState = 'starting'
  #lastBeatAt: Date | null = null

  setPgBoss(state: PgBossState): void {
    this.#pgboss = state
  }

  /** Called by the heartbeat job after its write to Postgres succeeded. */
  recordBeat(at: Date): void {
    if (this.#lastBeatAt === null || at > this.#lastBeatAt) this.#lastBeatAt = at
  }

  get pgboss(): PgBossState {
    return this.#pgboss
  }

  get lastBeatAt(): Date | null {
    return this.#lastBeatAt
  }

  report(now: Date = new Date()): HealthReport {
    return evaluateHealth({ pgboss: this.#pgboss, lastBeatAt: this.#lastBeatAt, now })
  }
}
