import { describe, expect, it } from 'vitest'

import {
  APP_POOL_MAX,
  IDLE_IN_TRANSACTION_TIMEOUT_MS,
  QUEUE_POOL_MAX,
  STATEMENT_TIMEOUT_MS,
  withSessionTimeouts,
} from './connection'

const BASE = 'postgres://restro_app:pw@localhost:54329/restro'

describe('withSessionTimeouts', () => {
  it('adds both timeouts to a URL without a query', () => {
    expect(withSessionTimeouts(BASE)).toBe(
      `${BASE}?statement_timeout=${STATEMENT_TIMEOUT_MS}` +
        `&idle_in_transaction_session_timeout=${IDLE_IN_TRANSACTION_TIMEOUT_MS}`,
    )
  })

  it('keeps existing parameters byte for byte and appends after them', () => {
    const url = `${BASE}?sslmode=verify-full&sslrootcert=%2Fcerts%2Fca.pem`
    expect(withSessionTimeouts(url)).toBe(
      `${url}&statement_timeout=${STATEMENT_TIMEOUT_MS}` +
        `&idle_in_transaction_session_timeout=${IDLE_IN_TRANSACTION_TIMEOUT_MS}`,
    )
  })

  it('lets the URL override one timeout and adds only the other', () => {
    const url = `${BASE}?statement_timeout=5000`
    expect(withSessionTimeouts(url)).toBe(
      `${url}&idle_in_transaction_session_timeout=${IDLE_IN_TRANSACTION_TIMEOUT_MS}`,
    )
  })

  it('leaves a URL alone that sets both, or sets options', () => {
    const both = `${BASE}?statement_timeout=1&idle_in_transaction_session_timeout=2`
    expect(withSessionTimeouts(both)).toBe(both)
    const options = `${BASE}?options=-c%20statement_timeout%3D1`
    expect(withSessionTimeouts(options)).toBe(options)
  })

  it('rejects text that is not a URL', () => {
    expect(() => withSessionTimeouts('not a url')).toThrow()
  })
})

describe('pool sizes', () => {
  it('keep the whole worker at five connections or fewer (Supabase session pooler)', () => {
    expect(APP_POOL_MAX + QUEUE_POOL_MAX).toBeLessThanOrEqual(5)
  })
})
