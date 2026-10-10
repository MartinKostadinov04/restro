// The default logger. Structured JSON (pino) on stdout, never personal data, never secrets
// (CLAUDE.md "Logs"). The client only ever logs method, bid, request id, duration, status and the
// error type; the redact paths below are a second line of defence in case a caller of the same
// logger ever adds a credential to a log object.

import { type DestinationStream, type Logger, pino } from 'pino'

export function createBarsyLogger(destination?: DestinationStream): Logger {
  return pino(
    {
      name: '@restro/barsy',
      redact: {
        paths: [
          'password',
          'authorization',
          '*.password',
          '*.authorization',
          'headers.authorization',
        ],
        censor: '[redacted]',
      },
    },
    destination,
  )
}
