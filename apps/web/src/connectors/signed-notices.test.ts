// The common timestamped HMAC check (#108): a matching v1 within the tolerance passes; anything
// unsigned, signed otherwise or signed too long ago (or ahead) is refused with its reason.
import { createHmac } from 'node:crypto'

import { describe, expect, it } from 'vitest'

import { checkSignedBody, parseSignatureHeader } from './signed-notices'

const secret = 'whsec_test_secret'
const body = '{"id":"evt_1"}'
const now = new Date('2026-10-26T12:00:00.000Z')
const t = Math.floor(now.getTime() / 1000)
const sign = (text: string, at = t, key = secret) =>
  createHmac('sha256', key).update(`${at}.${text}`).digest('hex')

describe('the signature header', () => {
  it('takes the timestamp and every v1, and ignores other schemes', () => {
    const a = sign(body)
    const b = sign(body, t, 'other')
    expect(parseSignatureHeader(`t=${t},v1=${a},v0=${b},v1=${b}`)).toEqual({
      timestamp: t,
      signatures: [a, b],
    })
  })

  it('has no usable signature without a timestamp, without a v1, or with odd values', () => {
    for (const header of [
      null,
      '',
      `v1=${sign(body)}`,
      `t=${t}`,
      `t=${t},v0=${sign(body)}`,
      `t=abc,v1=${sign(body)}`,
      `t=${t},v1=${sign(body).slice(1)}`,
      `t=${t},v1=${sign(body).toUpperCase()}`,
      'x'.repeat(5_000),
    ]) {
      expect(parseSignatureHeader(header), String(header)).toBeNull()
    }
  })
})

describe('the signed body', () => {
  it('passes a matching signature within five minutes either way', () => {
    expect(checkSignedBody(body, `t=${t},v1=${sign(body)}`, secret, now)).toBeNull()
    const early = t - 300
    expect(checkSignedBody(body, `t=${early},v1=${sign(body, early)}`, secret, now)).toBeNull()
  })

  it('passes when any v1 matches, as while a secret is rolled', () => {
    const header = `t=${t},v1=${sign(body, t, 'old_secret')},v1=${sign(body)}`
    expect(checkSignedBody(body, header, secret, now)).toBeNull()
  })

  it('refuses an unsigned body', () => {
    expect(checkSignedBody(body, null, secret, now)).toBe('unsigned')
    expect(checkSignedBody(body, `t=${t},v0=${sign(body)}`, secret, now)).toBe('unsigned')
  })

  it('refuses another body, another secret or another timestamp', () => {
    const header = `t=${t},v1=${sign(body)}`
    expect(checkSignedBody(`${body} `, header, secret, now)).toBe('bad_signature')
    expect(checkSignedBody(body, header, 'whsec_other', now)).toBe('bad_signature')
    expect(checkSignedBody(body, `t=${t + 1},v1=${sign(body)}`, secret, now)).toBe('bad_signature')
  })

  it('refuses a body signed more than five minutes ago or ahead (a replay)', () => {
    const old = t - 301
    expect(checkSignedBody(body, `t=${old},v1=${sign(body, old)}`, secret, now)).toBe('stale')
    const ahead = t + 301
    expect(checkSignedBody(body, `t=${ahead},v1=${sign(body, ahead)}`, secret, now)).toBe('stale')
  })
})
