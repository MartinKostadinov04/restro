import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { SCRUBBED, scrubBody, unscrubbed } from './test-scrub'

const RECORDINGS = fileURLToPath(new URL('../../fixtures/recordings', import.meta.url))

// Made-up values of the right shape: no real secret is ever in a test.
const SECRET_KEY = `sk_test_${'A1b2C3d4'.repeat(4)}`
const CLIENT_SECRET = `pi_3Abc123_${'secret'}_${'Q7w8E9r0'.repeat(3)}`

describe('the scrubbing of recordings (#107)', () => {
  it('removes keys, client secrets, link tokens, receipts, fingerprints and personal data', () => {
    const answer = {
      id: 'pi_3Abc123',
      client_secret: CLIENT_SECRET,
      description: `made with ${SECRET_KEY}`,
      receipt_email: 'guest@example.org',
      latest_charge: {
        receipt_url: 'https://pay.stripe.com/receipts/payment/CAcaFwoV',
        billing_details: { email: 'guest@example.org', phone: '+359888123456', name: null },
        payment_method_details: { card: { fingerprint: 'Xq3k9LmNoP', last4: '0005' } },
      },
      url: 'https://connect.stripe.com/setup/s/acct_1UUjd8H6CXJeKV2v/Tok3nV4lue',
      contact_email: 'owner@venue.bg',
      note: 'write to owner@venue.bg, webhook whsec_abc123DEF',
    }
    const text = JSON.stringify(answer)
    expect(unscrubbed(text).length).toBeGreaterThan(0)
    const scrubbed = scrubBody(text)
    expect(unscrubbed(scrubbed)).toEqual([])
    for (const secret of [
      'A1b2C3d4',
      'Q7w8E9r0',
      'guest@',
      'owner@',
      '+359888123456',
      'CAcaFwoV',
      'Xq3k9LmNoP',
      'Tok3nV4lue',
      'abc123DEF',
    ]) {
      expect(scrubbed).not.toContain(secret)
    }
    const kept = JSON.parse(scrubbed)
    expect(kept.id).toBe('pi_3Abc123')
    expect(kept.latest_charge.payment_method_details.card.last4).toBe('0005')
    expect(kept.latest_charge.billing_details.name).toBeNull()
    expect(kept.url).toBe(`https://connect.stripe.com/setup/s/acct_1UUjd8H6CXJeKV2v/${SCRUBBED}`)
  })

  it('scrubs a body that is not JSON as text', () => {
    expect(scrubBody(`oops ${SECRET_KEY} ${CLIENT_SECRET}`)).toBe('oops [key] [client secret]')
  })

  it('finds nothing secret or personal in any committed recording', () => {
    const files = readdirSync(RECORDINGS).filter((name) => name.endsWith('.json'))
    expect(files.length).toBeGreaterThan(0)
    const found = files.flatMap((name) => {
      const text = readFileSync(join(RECORDINGS, name), 'utf8')
      const { entries } = JSON.parse(text) as { entries: { body: string }[] }
      return [text, ...entries.map((entry) => entry.body)]
        .flatMap(unscrubbed)
        .map((what) => `${name}: ${what}`)
    })
    expect(found).toEqual([])
  })
})
