// The barsy read client: one HTTP transport for every read method, with the 30-second limit,
// typed errors, request-id logging and lossless number parsing built in.
//
// Wire format (official docs, verified by the lead 2026-10-08, https://docs.lukanet.com/barsy.api/usage/raw.html):
//   single call:  POST https://<host>/endpoints/json/<Method>?bid=<venueId>
//   multi call:   POST https://<host>/endpoints/json/?bid=<venueId>  with { "<Method>": {params}, ... }
//   HTTP Basic auth, Content-Type: application/json, body = a JSON object of the method's parameters.
//   `bid` is optional (without it barsy uses the user's default venue).
//
// Only methods on the read allowlist (./read-methods.ts) can be sent: rule 7, sync never writes.
// Nothing here logs a body, the password or the Authorization header.

import type { Logger } from 'pino'
import { z } from 'zod'

import { type BarsyClientConfigInput, parseClientConfig } from './config.ts'
import {
  BarsyAuthError,
  type BarsyCallContext,
  BarsyCallError,
  BarsyConfigError,
  BarsyHttpError,
  type BarsyIssue,
  BarsyMethodNotAllowedError,
  BarsyNetworkError,
  BarsyResponseError,
  BarsyTimeoutError,
} from './errors.ts'
import { assertHostAllowed, type BarsyEnv } from './hosts.ts'
import { hasJsonSourceAccess, parseBarsyJson } from './json.ts'
import { createBarsyLogger } from './logger.ts'
import { type BarsyReadMethod, barsyMethodAuth, isBarsyReadMethod } from './read-methods.ts'

const ENDPOINT_PATH = '/endpoints/json/'
/** Both ping methods "return 1" (official docs). */
const PING_RESPONSE = z.literal(1)
const REQUEST_ID_HEADER = 'BARSY_REQUEST_ID'

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue }

/** A method's parameters: a JSON object (or array). Flags and numbers are often sent as strings. */
export type BarsyParams = { readonly [key: string]: JsonValue } | readonly JsonValue[]

/** A barsy venue id (`bid`). */
export type BarsyBid = string | number

export interface BarsyCallOptions<T> {
  /** Venue. Without it barsy uses the API user's default venue. */
  readonly bid?: BarsyBid
  /** Validates (and types) the parsed response. A mismatch throws `BarsyResponseError`. */
  readonly schema?: z.ZodType<T>
}

export interface BarsyResult<T> {
  readonly data: T
  readonly status: number
  /** BARSY_REQUEST_ID of the response; Lukanet support asks for it. */
  readonly requestId: string | null
  readonly durationMs: number
}

/** The response exactly as received, uninterpreted. Used by the fixture recorder. */
export interface BarsyRawResponse {
  readonly method: string
  readonly bid: string | null
  readonly status: number
  readonly requestId: string | null
  /** The response body as text, byte for byte. */
  readonly body: string
  readonly durationMs: number
}

/** One entry of a multi-method call. */
export interface BarsyCallSpec {
  readonly params?: BarsyParams
  readonly schema?: z.ZodType
}

/** Methods of a multi-method call, keyed by method name (the wire format is an object, so a method appears once). */
export type BarsyCallMap = { readonly [M in BarsyReadMethod]?: BarsyCallSpec }

export type BarsyManyData<C extends BarsyCallMap> = {
  [K in keyof C]-?: C[K] extends { readonly schema: z.ZodType<infer T> } ? T : unknown
}

export interface BarsyClientOptions {
  /** A pino logger. Defaults to a JSON logger on stdout with credentials redacted. */
  readonly logger?: Logger
}

export interface BarsyClient {
  /** The normalised host this client talks to. */
  readonly host: string
  readonly env: BarsyEnv
  call<T = unknown>(
    method: BarsyReadMethod,
    params?: BarsyParams,
    options?: BarsyCallOptions<T>,
  ): Promise<BarsyResult<T>>
  callMany<C extends BarsyCallMap>(
    calls: C,
    options?: { readonly bid?: BarsyBid },
  ): Promise<BarsyResult<BarsyManyData<C>>>
  /** Sends the call and returns status, request id and body text without interpreting them. */
  callRaw(
    method: BarsyReadMethod,
    params?: BarsyParams,
    options?: { readonly bid?: BarsyBid },
  ): Promise<BarsyRawResponse>
  /** https://docs.lukanet.com/barsy.api/methods/misc/ping.html — anonymous heartbeat, returns 1. */
  ping(options?: { readonly bid?: BarsyBid }): Promise<BarsyResult<1>>
  /** https://docs.lukanet.com/barsy.api/methods/misc/ping_user.html — API reachable and credentials valid, returns 1. */
  pingUser(options?: { readonly bid?: BarsyBid }): Promise<BarsyResult<1>>
}

interface PreparedRequest {
  /** Method name, or the names joined with "," for a multi-method call (used in logs and errors). */
  readonly label: string
  /** The method name for a single call; empty for a multi-method call. */
  readonly path: string
  readonly body: string
  readonly sendCredentials: boolean
  readonly bid: string | null
}

type Interpreter<R> = (raw: BarsyRawResponse, context: BarsyCallContext) => R

export function createBarsyClient(
  input: BarsyClientConfigInput,
  options: BarsyClientOptions = {},
): BarsyClient {
  if (!hasJsonSourceAccess()) {
    throw new BarsyConfigError(
      'this runtime cannot read the source text of JSON numbers (Node 24 or newer is required)',
    )
  }
  const config = parseClientConfig(input)
  const host = assertHostAllowed(config.host, config.env, config.allowedHosts)
  const authorization = `Basic ${Buffer.from(`${config.user}:${config.password}`, 'utf8').toString('base64')}`
  const timeoutMs = config.timeoutMs
  const log = (options.logger ?? createBarsyLogger()).child({ component: 'barsy-client' })

  async function perform<R>(prepared: PreparedRequest, interpret: Interpreter<R>): Promise<R> {
    const startedAt = performance.now()
    const elapsed = () => Math.round(performance.now() - startedAt)
    let requestId: string | null = null
    let status: number | null = null
    const context = (): BarsyCallContext => ({
      method: prepared.label,
      bid: prepared.bid,
      requestId,
      durationMs: elapsed(),
    })
    const signal = AbortSignal.timeout(timeoutMs)

    try {
      let raw: BarsyRawResponse
      try {
        const url = new URL(`https://${host}${ENDPOINT_PATH}${prepared.path}`)
        if (prepared.bid !== null) url.searchParams.set('bid', prepared.bid)
        const headers: Record<string, string> = { 'Content-Type': 'application/json' }
        if (prepared.sendCredentials) headers.Authorization = authorization
        // A redirect is never followed: it would hide where a POST (and the credentials) ended up.
        const response = await fetch(url, {
          method: 'POST',
          headers,
          body: prepared.body,
          redirect: 'manual',
          signal,
        })
        requestId = response.headers.get(REQUEST_ID_HEADER)
        status = response.status
        const body = await response.text()
        raw = {
          method: prepared.label,
          bid: prepared.bid,
          status: response.status,
          requestId,
          body,
          durationMs: elapsed(),
        }
      } catch (cause) {
        // The timeout is the only thing that aborts the signal.
        if (signal.aborted) throw new BarsyTimeoutError(context(), timeoutMs, { cause })
        throw new BarsyNetworkError(context(), { cause })
      }

      const result = interpret(raw, context())
      log.info(
        {
          method: prepared.label,
          bid: prepared.bid,
          requestId,
          durationMs: elapsed(),
          status,
        },
        'barsy call completed',
      )
      return result
    } catch (error) {
      log.error(
        {
          method: prepared.label,
          bid: prepared.bid,
          requestId,
          durationMs: elapsed(),
          status,
          errorType: error instanceof Error ? error.name : 'unknown',
          issues: error instanceof BarsyResponseError ? error.issues : undefined,
        },
        error instanceof BarsyCallError ? error.message : 'barsy call failed unexpectedly',
      )
      throw error
    }
  }

  function prepareSingle(
    method: BarsyReadMethod,
    params: BarsyParams | undefined,
    bid: BarsyBid | undefined,
  ): PreparedRequest {
    assertReadMethod(method)
    return {
      label: method,
      path: method,
      body: JSON.stringify(params ?? {}),
      sendCredentials: barsyMethodAuth(method) === 'basic',
      bid: normaliseBid(bid),
    }
  }

  async function call<T = unknown>(
    method: BarsyReadMethod,
    params?: BarsyParams,
    callOptions: BarsyCallOptions<T> = {},
  ): Promise<BarsyResult<T>> {
    const prepared = prepareSingle(method, params, callOptions.bid)
    return perform(prepared, (raw, context) => {
      assertSuccessStatus(raw, context)
      const parsed = parseBody(raw, context)
      const data = callOptions.schema
        ? validate(callOptions.schema, parsed, context)
        : (parsed as T)
      return { data, status: raw.status, requestId: raw.requestId, durationMs: context.durationMs }
    })
  }

  async function callRaw(
    method: BarsyReadMethod,
    params?: BarsyParams,
    rawOptions: { readonly bid?: BarsyBid } = {},
  ): Promise<BarsyRawResponse> {
    return perform(prepareSingle(method, params, rawOptions.bid), (raw) => raw)
  }

  async function callMany<C extends BarsyCallMap>(
    calls: C,
    manyOptions: { readonly bid?: BarsyBid } = {},
  ): Promise<BarsyResult<BarsyManyData<C>>> {
    const methods: BarsyReadMethod[] = []
    for (const name of Object.keys(calls)) {
      assertReadMethod(name)
      methods.push(name)
    }
    if (methods.length === 0) {
      throw new BarsyConfigError('callMany needs at least one method')
    }
    const specs: BarsyCallMap = calls
    const wireBody: Record<string, BarsyParams> = {}
    let sendCredentials = false
    for (const method of methods) {
      wireBody[method] = specs[method]?.params ?? {}
      if (barsyMethodAuth(method) === 'basic') sendCredentials = true
    }
    const prepared: PreparedRequest = {
      label: methods.join(','),
      path: '',
      body: JSON.stringify(wireBody),
      sendCredentials,
      bid: normaliseBid(manyOptions.bid),
    }
    return perform(prepared, (raw, context) => {
      assertSuccessStatus(raw, context)
      const parsed = parseBody(raw, context)
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        throw new BarsyResponseError(context, [{ path: '', code: 'invalid_type' }])
      }
      const data: Record<string, unknown> = {}
      for (const method of methods) {
        if (!Object.hasOwn(parsed, method)) {
          throw new BarsyResponseError(context, [{ path: method, code: 'missing_method_result' }])
        }
        const value = (parsed as Record<string, unknown>)[method]
        const schema = specs[method]?.schema
        data[method] = schema ? validate(schema, value, context, method) : value
      }
      return {
        data: data as BarsyManyData<C>,
        status: raw.status,
        requestId: raw.requestId,
        durationMs: context.durationMs,
      }
    })
  }

  return {
    host,
    env: config.env,
    call,
    callMany,
    callRaw,
    // https://docs.lukanet.com/barsy.api/methods/misc/ping.html
    ping: (pingOptions = {}) =>
      call('Misc_ping', undefined, { bid: pingOptions.bid, schema: PING_RESPONSE }),
    // https://docs.lukanet.com/barsy.api/methods/misc/ping_user.html
    pingUser: (pingOptions = {}) =>
      call('Misc_ping_user', undefined, { bid: pingOptions.bid, schema: PING_RESPONSE }),
  }
}

function assertReadMethod(method: string): asserts method is BarsyReadMethod {
  if (!isBarsyReadMethod(method)) {
    throw new BarsyMethodNotAllowedError(method)
  }
}

function normaliseBid(bid: BarsyBid | undefined): string | null {
  if (bid === undefined) return null
  if (typeof bid === 'number') {
    if (!Number.isSafeInteger(bid) || bid < 0) {
      throw new BarsyConfigError('barsy bid must be a non-negative integer or a non-empty string')
    }
    return String(bid)
  }
  if (bid === '') {
    throw new BarsyConfigError('barsy bid must be a non-negative integer or a non-empty string')
  }
  return bid
}

function assertSuccessStatus(raw: BarsyRawResponse, context: BarsyCallContext): void {
  if (raw.status === 401 || raw.status === 403) {
    throw new BarsyAuthError(context, raw.status)
  }
  if (raw.status < 200 || raw.status > 299) {
    throw new BarsyHttpError(context, raw.status)
  }
}

function parseBody(raw: BarsyRawResponse, context: BarsyCallContext): unknown {
  try {
    return parseBarsyJson(raw.body)
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new BarsyResponseError(context, [{ path: '', code: 'invalid_json' }])
    }
    throw error
  }
}

function validate<T>(
  schema: z.ZodType<T>,
  value: unknown,
  context: BarsyCallContext,
  prefix?: string,
): T {
  const result = schema.safeParse(value)
  if (result.success) return result.data
  const issues: BarsyIssue[] = result.error.issues.map((issue) => ({
    path: [...(prefix === undefined ? [] : [prefix]), ...issue.path.map(String)].join('.'),
    code: issue.code,
  }))
  throw new BarsyResponseError(context, issues)
}
