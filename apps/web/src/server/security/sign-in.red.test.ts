// The sign-in limit, attacked (the repair-review's A7). The route's own words: "Better Auth's rate
// limiter guards sign-in here". The limit counts per address (3 tries in 10 seconds), in this
// process, and never per account, so many addresses can keep trying one account's password. RED by
// design: the rotating case. The first two are controls. No account exists; every try is wrong.
import { afterEach, beforeAll, describe, expect, it } from 'vitest'

import { getAuth } from '../auth'
import { hasDatabase, useTestServerEnvironment } from '../test-database'

const signIn = (headers: Record<string, string>) =>
  getAuth().handler(
    new Request('http://localhost:3000/api/auth/sign-in/email', {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'http://localhost:3000', ...headers },
      body: JSON.stringify({ email: 'nobody@example.test', password: 'wrong-password-000' }),
    }),
  )

/** Every run on its own addresses: the limiter's memory outlives a test. */
let block = 0

describe.skipIf(!hasDatabase)('sign-in attempts', () => {
  beforeAll(() => {
    useTestServerEnvironment()
  })
  afterEach(() => {
    block += 1
  })

  const statuses = async (headersOf: (attempt: number) => Record<string, string>) => {
    const seen: number[] = []
    for (let attempt = 0; attempt < 8; attempt++) {
      seen.push((await signIn(headersOf(attempt))).status)
    }
    return seen
  }

  it('control: one address is limited', async () => {
    const seen = await statuses(() => ({ 'x-forwarded-for': `198.51.100.${block}` }))
    expect(seen).toContain(429)
  }, 60_000)

  it('control: a claimed first address does not escape; the last entry counts', async () => {
    const seen = await statuses((attempt) => ({
      'x-forwarded-for': `203.0.113.${attempt}, 198.51.100.${100 + block}`,
    }))
    expect(seen).toContain(429)
  }, 60_000)

  it('many addresses against one account must be limited too', async () => {
    const seen = await statuses((attempt) => ({
      'x-forwarded-for': `192.0.2.${10 * block + attempt}`,
    }))
    expect(seen).toContain(429)
  }, 60_000)
})
