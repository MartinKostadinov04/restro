// The faults of the conformance suite, for the Stripe provider (#107). A `test-*` helper: only
// tests import it. Stripe's sandbox cannot be made to time out or fail on demand, so the harness
// puts a fetch between the provider and Stripe that does it for the next call of a step:
//
//   - land then time out: the request reaches Stripe, its answer is dropped, and stripe-node sees
//     a timeout (code `ETIMEDOUT`: stripe-node retries a closed connection once even with retries
//     off, but never a timeout);
//   - time out before landing: the request never leaves;
//   - refuse: a 400 `invalid_request_error`, as Stripe answers a request it will not do;
//   - stored server error: a 500 `api_error`, kept for the request's idempotency key and answered
//     again, with `Idempotent-Replayed: true`, for every repeat of that key, as Stripe does with a
//     500 it stored (https://docs.stripe.com/error-low-level.md#idempotency);
//   - failed reads: every GET from then on answers a 500.
// Faults made here never reach the recording: playback runs the same faults over the same tape.

import type { FaultStep } from '@restro/core/connectors/payment-testing'

type Fault = 'land_then_timeout' | 'timeout_before' | 'refuse' | 'server_error'

/** The step a provider request is, from its method and path; null for every other request. */
export function faultStepOf(method: string, path: string): FaultStep | null {
  if (method !== 'POST') return null
  if (path === '/v1/payment_intents') return 'createHold'
  if (/^\/v1\/payment_intents\/[^/]+\/capture$/.test(path)) return 'capture'
  if (/^\/v1\/payment_intents\/[^/]+\/cancel$/.test(path)) return 'release'
  return null
}

function timeout(): Error {
  return Object.assign(new Error('the conformance harness timed the request out'), {
    code: 'ETIMEDOUT',
  })
}

function errorResponse(status: number, type: string, replayed: boolean): Response {
  const body = { error: { type, message: `the conformance harness answered ${status}` } }
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json',
      ...(replayed ? { 'idempotent-replayed': 'true' } : {}),
    },
  })
}

export class StripeFaults {
  private readonly armed = new Map<FaultStep, Fault>()
  private readonly storedKeys = new Set<string>()
  private readsFail = false

  arm(step: FaultStep, fault: Fault): void {
    this.armed.set(step, fault)
  }

  failReads(): void {
    this.readsFail = true
  }

  clear(): void {
    this.armed.clear()
    this.storedKeys.clear()
    this.readsFail = false
  }

  /** The provider's fetch: `inner` (Stripe, or the recording) with the armed faults in front. */
  wrap(inner: typeof fetch): typeof fetch {
    return async (input, init) => {
      const method = (init?.method ?? 'GET').toUpperCase()
      const path = new URL(input instanceof Request ? input.url : String(input)).pathname
      const key = new Headers(init?.headers).get('idempotency-key')
      if (key !== null && this.storedKeys.has(key)) return errorResponse(500, 'api_error', true)
      if (method === 'GET' && this.readsFail) return errorResponse(500, 'api_error', false)
      const step = faultStepOf(method, path)
      const fault = step === null ? undefined : this.armed.get(step)
      if (step === null || fault === undefined) return inner(input, init)
      this.armed.delete(step)
      switch (fault) {
        case 'land_then_timeout':
          await (await inner(input, init)).text()
          throw timeout()
        case 'timeout_before':
          throw timeout()
        case 'refuse':
          return errorResponse(400, 'invalid_request_error', false)
        case 'server_error':
          if (key !== null) this.storedKeys.add(key)
          return errorResponse(500, 'api_error', false)
      }
    }
  }
}
