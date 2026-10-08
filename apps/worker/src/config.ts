// The worker's settings, read once at start from environment variables. Values are validated
// here and nowhere else; an invalid or missing setting stops the process before anything opens a
// connection. Error messages name the variable, never its value (DATABASE_URL carries a
// password).
import { hostname } from 'node:os'

/** Port of the health endpoint when WORKER_HEALTH_PORT is not set. */
export const DEFAULT_HEALTH_PORT = 8081

/** The levels pino knows, plus 'silent'. */
export const LOG_LEVELS = ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'] as const
export type LogLevel = (typeof LOG_LEVELS)[number]

const MAX_WORKER_ID_LENGTH = 128

export interface WorkerConfig {
  /** Connection string of the app role `restro_app` (never the migration owner). */
  readonly databaseUrl: string
  /** Identifies this process in `restro.worker_heartbeats`. */
  readonly workerId: string
  /** TCP port of `GET /health`. `0` picks a free port (tests only; the environment cannot set it). */
  readonly healthPort: number
  readonly logLevel: LogLevel
  /** True: human-readable log lines (development). False: one JSON object per line (production). */
  readonly prettyLogs: boolean
}

/** Thrown by {@link loadConfig}; the message lists every problem found. */
export class ConfigError extends Error {
  constructor(problems: readonly string[]) {
    super(`Invalid worker configuration:\n- ${problems.join('\n- ')}`)
    this.name = 'ConfigError'
  }
}

function isPostgresUrl(value: string): boolean {
  try {
    const { protocol } = new URL(value)
    return protocol === 'postgres:' || protocol === 'postgresql:'
  } catch {
    return false
  }
}

/**
 * Reads the configuration from `env`.
 *
 * | Variable | Meaning | Default |
 * |---|---|---|
 * | `DATABASE_URL` | postgres:// URL of the app role `restro_app` | required |
 * | `WORKER_ID` | name of this process in `worker_heartbeats` | the host name |
 * | `WORKER_HEALTH_PORT` | port of `GET /health` | 8081 |
 * | `LOG_LEVEL` | fatal, error, warn, info, debug, trace or silent | info |
 * | `NODE_ENV` | `production` switches the logs to JSON | pretty logs |
 */
export function loadConfig(
  env: Readonly<Record<string, string | undefined>> = process.env,
  defaultWorkerId: () => string = hostname,
): WorkerConfig {
  const problems: string[] = []

  const databaseUrl = env.DATABASE_URL?.trim() ?? ''
  if (databaseUrl === '') {
    problems.push(
      'DATABASE_URL is not set. It is the connection string of the app role restro_app ' +
        '(local: see .env.example).',
    )
  } else if (!isPostgresUrl(databaseUrl)) {
    problems.push('DATABASE_URL must be a postgres:// or postgresql:// URL.')
  }

  const workerId = env.WORKER_ID?.trim() || defaultWorkerId()
  if (workerId === '' || workerId.length > MAX_WORKER_ID_LENGTH) {
    problems.push(`WORKER_ID must be 1 to ${MAX_WORKER_ID_LENGTH} characters.`)
  }

  let healthPort = DEFAULT_HEALTH_PORT
  const rawPort = env.WORKER_HEALTH_PORT?.trim()
  if (rawPort) {
    healthPort = Number(rawPort)
    if (!/^\d+$/.test(rawPort) || healthPort < 1 || healthPort > 65535) {
      problems.push('WORKER_HEALTH_PORT must be a whole number from 1 to 65535.')
    }
  }

  const rawLevel = env.LOG_LEVEL?.trim().toLowerCase() || 'info'
  const logLevel = LOG_LEVELS.find((level) => level === rawLevel)
  if (!logLevel) {
    problems.push(`LOG_LEVEL must be one of: ${LOG_LEVELS.join(', ')}.`)
  }

  if (problems.length > 0 || !logLevel) throw new ConfigError(problems)

  return {
    databaseUrl,
    workerId,
    healthPort,
    logLevel,
    prettyLogs: env.NODE_ENV !== 'production',
  }
}
