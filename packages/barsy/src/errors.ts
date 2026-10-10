// Typed errors for the barsy read client. Nothing in here ever holds a password, an Authorization
// header or a response body: bodies can carry personal data, so errors carry only status codes,
// the barsy request id (Lukanet support asks for it) and Zod issue paths.

/** Where a failed or successful call happened. `requestId` is the BARSY_REQUEST_ID header, if seen. */
export interface BarsyCallContext {
  /** Method name, or the method names joined with "," for a multi-method call. */
  readonly method: string
  readonly bid: string | null
  readonly requestId: string | null
  readonly durationMs: number
}

/** One Zod issue reduced to its location and code. Messages are left out on purpose (they can echo values). */
export interface BarsyIssue {
  readonly path: string
  readonly code: string
}

/** Base of every error this package throws on purpose (`instanceof BarsyError`). */
export abstract class BarsyError extends Error {}

/** The client was configured wrongly (missing variable, malformed host, ...). */
export class BarsyConfigError extends BarsyError {
  override readonly name: string = 'BarsyConfigError'
}

/** Rule 9: the host is not one this environment may talk to. */
export class BarsyHostNotAllowedError extends BarsyConfigError {
  override readonly name: string = 'BarsyHostNotAllowedError'
  readonly host: string
  readonly env: string

  constructor(message: string, host: string, env: string) {
    super(message)
    this.host = host
    this.env = env
  }
}

/** Rule 7: only methods on the read allowlist may be sent. */
export class BarsyMethodNotAllowedError extends BarsyError {
  override readonly name: string = 'BarsyMethodNotAllowedError'
  readonly method: string

  constructor(method: string) {
    super(`barsy method "${method}" is not on the read allowlist; this client never sends it`)
    this.method = method
  }
}

/** A call that reached (or tried to reach) barsy. Carries what support and our logs need. */
export abstract class BarsyCallError extends BarsyError {
  readonly method: string
  readonly bid: string | null
  readonly requestId: string | null
  readonly durationMs: number

  constructor(message: string, context: BarsyCallContext, options?: ErrorOptions) {
    super(withRequestId(message, context.requestId), options)
    this.method = context.method
    this.bid = context.bid
    this.requestId = context.requestId
    this.durationMs = context.durationMs
  }
}

/** Any status outside 2xx other than 401/403 (those are `BarsyAuthError`). */
export class BarsyHttpError extends BarsyCallError {
  override readonly name: string = 'BarsyHttpError'
  readonly status: number

  constructor(context: BarsyCallContext, status: number) {
    super(`barsy ${context.method} failed with HTTP ${status}`, context)
    this.status = status
  }
}

/**
 * 401 or 403. barsy documents "a standard authorisation error" for bad credentials but not its
 * shape, so a 200 response carrying an auth-error payload is not detected yet: record one with
 * `pnpm barsy:record` first, then teach the client (see the open question in the S1-04 report).
 */
export class BarsyAuthError extends BarsyCallError {
  override readonly name: string = 'BarsyAuthError'
  readonly status: number

  constructor(context: BarsyCallContext, status: number) {
    super(`barsy ${context.method} was refused: HTTP ${status} (check the API user)`, context)
    this.status = status
  }
}

/** barsy ends every call after 30 seconds; the client gives up at the same limit. */
export class BarsyTimeoutError extends BarsyCallError {
  override readonly name: string = 'BarsyTimeoutError'
  readonly timeoutMs: number

  constructor(context: BarsyCallContext, timeoutMs: number, options?: ErrorOptions) {
    super(`barsy ${context.method} timed out after ${timeoutMs} ms`, context, options)
    this.timeoutMs = timeoutMs
  }
}

/** The request never produced a response (DNS, connection, TLS, redirect, ...). */
export class BarsyNetworkError extends BarsyCallError {
  override readonly name: string = 'BarsyNetworkError'

  constructor(context: BarsyCallContext, options?: ErrorOptions) {
    super(`barsy ${context.method} could not be sent`, context, options)
  }
}

/** The response was not valid JSON or did not match the Zod schema the caller expects. */
export class BarsyResponseError extends BarsyCallError {
  override readonly name: string = 'BarsyResponseError'
  readonly issues: readonly BarsyIssue[]

  constructor(context: BarsyCallContext, issues: readonly BarsyIssue[]) {
    const where = issues.map((issue) => `${issue.path || '(root)'}: ${issue.code}`).join(', ')
    super(`barsy ${context.method} returned an unexpected response (${where})`, context)
    this.issues = issues
  }
}

function withRequestId(message: string, requestId: string | null): string {
  return requestId === null ? message : `${message} [request ${requestId}]`
}
