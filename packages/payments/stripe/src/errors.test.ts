import { describe, expect, it } from 'vitest'

import { type Classified, classify, detailOf, type StripeErrorLike, type WriteStep } from './errors'

// Errors shaped as stripe-node 23 raises them: `type` is its class name, `rawType` Stripe's own
// error type (stripe/esm/Error.js). The codes are the ones the sandbox answered (10-26).

function apiError(
  statusCode: number,
  code?: string,
  extra: Partial<StripeErrorLike> = {},
): StripeErrorLike {
  return {
    type: 'StripeInvalidRequestError',
    rawType: 'invalid_request_error',
    statusCode,
    ...(code === undefined ? {} : { code }),
    message: `Stripe said ${code ?? statusCode}`,
    ...extra,
  }
}

function intent(status: string, cancellation_reason: string | null = null) {
  return {
    id: 'pi_1',
    object: 'payment_intent',
    status,
    amount: 1050,
    amount_capturable: 0,
    amount_received: status === 'succeeded' ? 1050 : 0,
    currency: 'eur',
    cancellation_reason,
  }
}

function code(step: WriteStep, error: unknown): string {
  const classified: Classified = classify(step, error)
  return classified.kind === 'refused' ? classified.refusal.code : classified.kind
}

describe('classify', () => {
  it('reads a timeout, a lost connection, a 5xx, a 409 and a rate limit as unknown', () => {
    const timeout = { type: 'StripeConnectionError', message: 'Request aborted due to timeout' }
    for (const error of [
      timeout,
      apiError(500),
      apiError(502),
      apiError(409, 'idempotency_key_in_use'),
      apiError(429, 'rate_limit'),
      apiError(400, 'lock_timeout'),
      'not even an object',
    ]) {
      for (const step of ['createHold', 'capture', 'release'] as const) {
        expect(code(step, error)).toBe('unknown')
      }
    }
  })

  it('says when Stripe answered a server error it stored for the key (D127 3.15)', () => {
    const replayed = apiError(500, undefined, {
      type: 'StripeAPIError',
      rawType: 'api_error',
      headers: { 'idempotent-replayed': 'true' },
    })
    const classified = classify('capture', replayed)
    expect(classified.kind).toBe('unknown')
    expect(classified.kind === 'unknown' && classified.reason).toContain('stored for this key')
    const first = classify('capture', apiError(500))
    expect(first.kind === 'unknown' && first.reason).not.toContain('stored for this key')
  })

  it('maps the refusals the sandbox gave', () => {
    const idempotency = {
      type: 'StripeIdempotencyError',
      rawType: 'idempotency_error',
      statusCode: 400,
      message: 'Keys for idempotent requests can only be used with the same parameters',
    }
    expect(code('createHold', idempotency)).toBe('key_reused')
    expect(code('capture', apiError(404, 'resource_missing'))).toBe('not_found')
    expect(code('capture', apiError(400, 'amount_too_large'))).toBe('amount_above_hold')
    expect(code('createHold', apiError(400, 'amount_too_small'))).toBe('amount_too_small')
    expect(code('capture', apiError(401))).toBe('access_lost')
    expect(code('capture', apiError(403))).toBe('access_lost')
    expect(code('capture', apiError(400, 'charge_expired_for_capture'))).toBe('hold_expired')
  })

  it('puts an account-wide refusal on the account, every other on the payment', () => {
    const lost = classify('capture', apiError(401))
    expect(lost.kind === 'refused' && lost.refusal.scope).toBe('account')
    const missing = classify('capture', apiError(404, 'resource_missing'))
    expect(missing.kind === 'refused' && missing.refusal.scope).toBe('payment')
  })

  it("reads a payment in the wrong state from the error's payment intent", () => {
    const wrong = (status: string, reason: string | null = null) =>
      apiError(400, 'payment_intent_unexpected_state', { payment_intent: intent(status, reason) })
    expect(code('capture', wrong('succeeded'))).toBe('already_captured')
    expect(code('release', wrong('succeeded'))).toBe('already_captured')
    expect(code('capture', wrong('canceled'))).toBe('not_held')
    expect(code('capture', wrong('canceled', 'automatic'))).toBe('hold_expired')
    expect(code('capture', wrong('requires_payment_method'))).toBe('not_held')
    expect(code('release', wrong('canceled'))).toBe('already_released')
    expect(code('capture', apiError(400, 'payment_intent_unexpected_state'))).toBe('not_held')
  })

  it('reads any other definite no as a refused capture, or a step Stripe does not do', () => {
    expect(code('capture', apiError(402, 'card_declined'))).toBe('capture_refused')
    expect(code('release', apiError(400))).toBe('not_supported')
    expect(code('prepareDomain', apiError(400, 'parameter_invalid'))).toBe('not_supported')
  })
})

describe('detailOf', () => {
  it("keeps Stripe's type, status, code and message, without a secret, within 500 characters", () => {
    const error = apiError(400, 'parameter_invalid', {
      message: `bad key sk_live_${'X1y2'.repeat(6)} and pi_1_secret_abc ${'x'.repeat(600)}`,
    })
    const detail = detailOf(error)
    expect(detail.startsWith('invalid_request_error 400 parameter_invalid bad key [key]')).toBe(
      true,
    )
    expect(detail).not.toContain('X1y2')
    expect(detail).not.toContain('secret_abc')
    expect(detail.length).toBeLessThanOrEqual(500)
  })
})
