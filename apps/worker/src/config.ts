// The worker's settings, read once at start from environment variables. Values are validated
// here and nowhere else (with Zod, like every other boundary); an invalid or missing setting
// stops the process before anything opens a connection. Error messages name the variable, never
// its value (DATABASE_URL carries a password): every problem is "<VARIABLE> <what is wrong>",
// built from the schema's own path and the fixed text written below, not from the input.
import { hostname } from 'node:os'

import { z } from 'zod'

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

/** A variable left empty counts as unset, so its default applies. */
function unsetWhenBlank(value: unknown): unknown {
  return typeof value === 'string' && value.trim() === '' ? undefined : value
}

const NOT_SET =
  'is not set. It is the connection string of the app role restro_app (local: see .env.example).'
const NOT_A_POSTGRES_URL = 'must be a postgres:// or postgresql:// URL.'
const BAD_WORKER_ID = `must be 1 to ${MAX_WORKER_ID_LENGTH} characters.`
const BAD_PORT = 'must be a whole number from 1 to 65535.'
const BAD_LOG_LEVEL = `must be one of: ${LOG_LEVELS.join(', ')}.`

/**
 * The schema of the environment. Its keys are the variable names, so an issue's path names the
 * variable; every message is a continuation of that name (see {@link describeIssue}). Variables
 * not listed here are ignored.
 */
function environmentSchema(defaultWorkerId: () => string) {
  return z
    .object({
      DATABASE_URL: z
        .string({ error: NOT_SET })
        .trim()
        .min(1, { error: NOT_SET, abort: true })
        .refine(isPostgresUrl, { error: NOT_A_POSTGRES_URL }),
      WORKER_ID: z
        .string()
        .optional()
        .transform((value) => value?.trim() || defaultWorkerId())
        .pipe(z.string().min(1, BAD_WORKER_ID).max(MAX_WORKER_ID_LENGTH, BAD_WORKER_ID)),
      WORKER_HEALTH_PORT: z.preprocess(
        unsetWhenBlank,
        z
          .string()
          .trim()
          .refine((value) => /^\d+$/.test(value) && Number(value) >= 1 && Number(value) <= 65535, {
            error: BAD_PORT,
          })
          .transform(Number)
          .default(DEFAULT_HEALTH_PORT),
      ),
      LOG_LEVEL: z.preprocess(
        unsetWhenBlank,
        z
          .string()
          .trim()
          .toLowerCase()
          .pipe(z.enum(LOG_LEVELS, { error: BAD_LOG_LEVEL }))
          .default('info'),
      ),
      NODE_ENV: z.string().optional(),
    })
    .transform(
      (env): WorkerConfig => ({
        databaseUrl: env.DATABASE_URL,
        workerId: env.WORKER_ID,
        healthPort: env.WORKER_HEALTH_PORT,
        logLevel: env.LOG_LEVEL,
        prettyLogs: env.NODE_ENV !== 'production',
      }),
    )
}

/** "<VARIABLE> <message>": the variable from the schema path, the text fixed above. */
function describeIssue(issue: z.core.$ZodIssue): string {
  return `${issue.path.join('.')} ${issue.message}`
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
  const result = environmentSchema(defaultWorkerId).safeParse(env)
  if (!result.success) throw new ConfigError(result.error.issues.map(describeIssue))
  return result.data
}
