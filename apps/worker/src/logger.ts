// Structured logs (pino). JSON, one object per line, in production, which is what Railway's log
// view reads; readable lines in development. Never personal data, never secrets (CLAUDE.md
// "Logs"): errors go through `describeError` (see errors.ts), and the redact paths below are a
// second line of defence if a caller ever puts a credential in a log object.
import { type DestinationStream, type Logger, pino } from 'pino'

import type { LogLevel } from './config'
import { describeError } from './errors'

export type { Logger }

export interface LoggerOptions {
  readonly level: LogLevel
  /** Human-readable lines (needs the dev dependency pino-pretty) instead of JSON. */
  readonly pretty: boolean
  /** Where lines go. Default: stdout. Tests pass their own stream. */
  readonly destination?: DestinationStream
}

const REDACT_PATHS = [
  'password',
  'authorization',
  'connectionString',
  'databaseUrl',
  'DATABASE_URL',
  '*.password',
  '*.authorization',
  '*.connectionString',
  '*.databaseUrl',
  '*.DATABASE_URL',
]

export async function createLogger(options: LoggerOptions): Promise<Logger> {
  let destination = options.destination
  if (!destination && options.pretty) {
    try {
      // pino-pretty is a dev dependency: not installed in production images, hence the import
      // here and the JSON fallback below instead of a static import.
      const { default: pinoPretty } = await import('pino-pretty')
      destination = pinoPretty({
        colorize: true,
        translateTime: 'SYS:HH:MM:ss.l',
        ignore: 'pid,hostname',
        sync: true,
      })
    } catch {
      // Not installed: plain JSON is still correct, just harder to read.
    }
  }
  return pino(
    {
      name: 'restro-worker',
      level: options.level,
      redact: { paths: REDACT_PATHS, censor: '[redacted]' },
      serializers: { err: (error: unknown) => describeError(error) },
    },
    destination,
  )
}
