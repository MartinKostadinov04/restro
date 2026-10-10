// Turns any thrown value into a form that is safe to log and to store in a pg-boss job record.
//
// Why: Drizzle wraps every failed query in a DrizzleQueryError whose message is
// "Failed query: <sql>\nparams: <values>", so logging `error.message` (or its stack, whose first
// line is the message) would write query parameters, which can be tenant data, into the log. The
// reason the query failed is the error's `cause` (the Postgres error: message and SQLSTATE
// code). Postgres's own `detail`, `where` and `hint` can quote row values, so they are never
// copied either (CLAUDE.md "Logs": never personal data, never secrets).
//
// pino calls this through the `err` serializer (see logger.ts), so `log.error({ err }, '...')`
// is safe everywhere.

const MAX_MESSAGE_LENGTH = 1000
const MAX_CAUSE_DEPTH = 5
const MAX_STACK_LINES = 12

export interface SafeError {
  /** The error's class name, e.g. `error` (Postgres), `TypeError`, `DrizzleQueryError`. */
  readonly type: string
  /** Absent for a query wrapper: its message is the SQL and the parameters. */
  readonly message?: string
  /** SQLSTATE for a Postgres error, a system code such as ECONNREFUSED, or any string `code`. */
  readonly code?: string
  /** Absent for a query wrapper (the stack starts with the message). */
  readonly stack?: string
  readonly cause?: SafeError
}

function truncate(text: string): string {
  return text.length > MAX_MESSAGE_LENGTH ? `${text.slice(0, MAX_MESSAGE_LENGTH)}...` : text
}

/** True for Drizzle's "Failed query: <sql> params: <values>" wrapper. */
function isQueryWrapper(error: object): boolean {
  if (error.constructor?.name === 'DrizzleQueryError') return true
  if ('query' in error && 'params' in error) return true
  return 'message' in error && typeof error.message === 'string'
    ? error.message.startsWith('Failed query:')
    : false
}

function stringField(error: object, field: string): string | undefined {
  const value = (error as Record<string, unknown>)[field]
  return typeof value === 'string' && value !== '' ? value : undefined
}

/** A thrown value reduced to its type, message, code, a short stack and its cause chain. */
export function describeError(error: unknown, depth = 0): SafeError {
  if (typeof error !== 'object' || error === null) {
    // `throw 'text'` and the like: keep the text, it was thrown on purpose.
    return { type: typeof error, message: truncate(String(error)) }
  }
  const wrapper = isQueryWrapper(error)
  const type = error instanceof Error ? error.constructor.name || error.name : 'object'
  const message = wrapper ? undefined : stringField(error, 'message')
  const stack = !wrapper && error instanceof Error ? error.stack : undefined
  const cause = (error as { cause?: unknown }).cause
  return {
    type,
    ...(message !== undefined && { message: truncate(message) }),
    ...(stringField(error, 'code') !== undefined && { code: stringField(error, 'code') }),
    ...(stack !== undefined && { stack: stack.split('\n').slice(0, MAX_STACK_LINES).join('\n') }),
    ...(cause !== undefined &&
      depth < MAX_CAUSE_DEPTH && { cause: describeError(cause, depth + 1) }),
  }
}

/**
 * One line that names the failure and its causes, e.g.
 * `DrizzleQueryError, caused by DatabaseError: relation "x" does not exist (42P01)`.
 * Used as the message of the error a failed job rethrows, so that pg-boss stores this and not
 * the original error (whose message may hold query parameters) in the job record.
 */
export function summarizeError(error: unknown): string {
  const parts: string[] = []
  let current: SafeError | undefined = describeError(error)
  while (current) {
    const detail = [current.message, current.code && `(${current.code})`].filter(Boolean).join(' ')
    parts.push(detail ? `${current.type}: ${detail}` : current.type)
    current = current.cause
  }
  return parts.join(', caused by ')
}
