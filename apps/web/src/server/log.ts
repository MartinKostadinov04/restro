// Structured server logs: one JSON line per event, never personal data or secrets.
// Database errors are logged through their `cause` (Postgres's message and code): Drizzle's own
// message contains the query parameters.

function rootCause(error: unknown): unknown {
  let current: unknown = error
  while (current instanceof Error && current.cause !== undefined && current.cause !== current) {
    current = current.cause
  }
  return current
}

/** What is safe to log about an error: its class, and the Postgres code and message if any. */
export function describeError(error: unknown): Record<string, string> {
  const cause = rootCause(error)
  if (cause instanceof Error) {
    const { code } = cause as { code?: unknown }
    return {
      error: cause.name,
      ...(typeof code === 'string' ? { code } : {}),
      message: cause.message,
    }
  }
  return { error: typeof cause }
}

export function logError(event: string, error?: unknown): void {
  console.error(
    JSON.stringify({
      level: 'error',
      event,
      ...(error === undefined ? {} : describeError(error)),
    }),
  )
}

export function logInfo(event: string, fields: Record<string, string | number> = {}): void {
  console.info(JSON.stringify({ level: 'info', event, ...fields }))
}

export function logWarn(event: string, fields: Record<string, string | number> = {}): void {
  console.warn(JSON.stringify({ level: 'warn', event, ...fields }))
}
