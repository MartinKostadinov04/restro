// RED by design (the repair-review's A7, RR-5). D127: "A redirect's address is cleaned before any
// request." The address is cleaned in a `useEffect`; the first request is the redirect's own, and
// the page it gets back carries the whole query, client secret included, in the router's inline
// payload (next's app-render, `c` and `q`), where it stays after `replaceState`.
//
// Needs a running app, so it is skipped unless ATTACK_BASE_URL names one on localhost:
//   ATTACK_BASE_URL=http://127.0.0.1:3711 pnpm vitest run --project apps/web \
//     apps/web/src/server/security/return-address.red.test.ts --reporter=dot
// The secret is made up; it stands for no payment.
import { describe, expect, it } from 'vitest'

const BASE = process.env.ATTACK_BASE_URL

describe.skipIf(BASE === undefined)('the guest page, answering a return from a card form', () => {
  const secret = 'pi_made_up_secret_abc123'
  const url = `${BASE}/m/x/y?payment_intent=pi_made_up&payment_intent_client_secret=${secret}&redirect_status=succeeded`

  it('runs on localhost only', () => {
    expect(new URL(BASE as string).hostname).toMatch(/^(127\.0\.0\.1|localhost)$/)
  })

  it('the page must not carry the client secret back', async () => {
    const answer = await fetch(url)
    expect(await answer.text()).not.toContain(secret)
  }, 120_000)

  it('control: the answer is not stored, and sends no referrer', async () => {
    const answer = await fetch(url)
    await answer.arrayBuffer()
    expect(answer.headers.get('cache-control')).toContain('no-store')
    expect(answer.headers.get('referrer-policy')).toBe('no-referrer')
  }, 120_000)
})
