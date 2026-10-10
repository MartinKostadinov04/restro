// The QR addresses (brief S3-07, D61): the checks of the base address and the venue's own pattern,
// the address a code carries, and the stored setting. Pure.
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'

import { newTableToken } from './ids'
import {
  checkBaseUrl,
  checkOwnPattern,
  isLocalHost,
  isTableToken,
  MAX_QR_BASE_URL_LENGTH,
  MAX_QR_PATTERN_LENGTH,
  ownAddress,
  qrAddress,
  readVenueQr,
  tableDisplayLabel,
  VenueQrSchema,
} from './qr'

const TOKEN = 'Ab3dEfGh1jKlMnOpQrStUv'

describe('isLocalHost', () => {
  it.each([
    'localhost',
    'LOCALHOST',
    'app.localhost',
    'my-pc.local',
    '127.0.0.1',
    '10.0.0.7',
    '192.168.1.20',
    '172.16.0.1',
    '172.31.255.254',
    '169.254.1.1',
    '[::1]',
  ])('%s is this PC or the local network', (host) => {
    expect(isLocalHost(host)).toBe(true)
  })

  it.each([
    'example.com',
    'club.bg',
    '8.8.8.8',
    '172.15.0.1',
    '172.32.0.1',
    '192.169.1.1',
    'localhost.example.com',
    '192.168.1.20.example.com',
  ])('%s is not', (host) => {
    expect(isLocalHost(host)).toBe(false)
  })
})

describe('checkBaseUrl', () => {
  it('accepts an https address and tidies it', () => {
    expect(checkBaseUrl(' HTTPS://Menu.Club.bg/ ')).toEqual({
      ok: true,
      value: 'https://menu.club.bg',
    })
    expect(checkBaseUrl('https://club.bg/menu///')).toEqual({
      ok: true,
      value: 'https://club.bg/menu',
    })
    expect(checkBaseUrl('https://club.bg:8443')).toEqual({
      ok: true,
      value: 'https://club.bg:8443',
    })
  })

  it('accepts plain http for this PC and the local network while building', () => {
    expect(checkBaseUrl('http://localhost:3000/')).toEqual({
      ok: true,
      value: 'http://localhost:3000',
    })
    expect(checkBaseUrl('http://192.168.1.20:3000')).toEqual({
      ok: true,
      value: 'http://192.168.1.20:3000',
    })
    expect(checkBaseUrl('http://[::1]:3000')).toEqual({ ok: true, value: 'http://[::1]:3000' })
  })

  it.each([
    ['', 'empty'],
    ['   ', 'empty'],
    ['club.bg', 'not_a_url'],
    ['ftp://club.bg', 'not_a_url'],
    ['javascript:alert(1)', 'not_a_url'],
    ['http://club.bg', 'not_https'],
    ['http://8.8.8.8:3000', 'not_https'],
    ['https://user:pw@club.bg', 'credentials'],
    ['https://club.bg/?a=1', 'query_or_fragment'],
    ['https://club.bg/#top', 'query_or_fragment'],
    ['https://club.bg/?', 'query_or_fragment'],
    ['https://club .bg', 'whitespace'],
    [`https://club.bg/${'a'.repeat(MAX_QR_BASE_URL_LENGTH)}`, 'too_long'],
  ])('refuses %j (%s)', (value, problem) => {
    expect(checkBaseUrl(value)).toEqual({ ok: false, problem })
  })
})

describe('checkOwnPattern', () => {
  it('accepts an https pattern with {token} in the path or the query', () => {
    expect(checkOwnPattern('https://menu.club.bg/t/{token}')).toEqual({
      ok: true,
      value: 'https://menu.club.bg/t/{token}',
    })
    expect(checkOwnPattern('  https://club.bg/go?t={token}&src=qr ')).toEqual({
      ok: true,
      value: 'https://club.bg/go?t={token}&src=qr',
    })
  })

  it('accepts plain http for this PC and the local network', () => {
    expect(checkOwnPattern('http://localhost:3000/t/{token}').ok).toBe(true)
    expect(checkOwnPattern('http://192.168.0.5/t/{token}').ok).toBe(true)
    expect(checkOwnPattern('http://10.1.2.3:8080/go/{token}').ok).toBe(true)
  })

  it.each([
    ['', 'empty'],
    ['https://menu.club.bg/t/', 'missing_token'],
    ['https://menu.club.bg/t/{Token}', 'unknown_placeholder'],
    ['https://menu.club.bg/{venue}/t/{token}', 'unknown_placeholder'],
    ['https://menu.club.bg/t/{token', 'unknown_placeholder'],
    ['https://{token}.club.bg/t', 'token_in_host'],
    ['https://club.bg{token}', 'token_in_host'],
    ['http://menu.club.bg/t/{token}', 'not_https'],
    ['menu.club.bg/t/{token}', 'not_a_url'],
    ['ftp://club.bg/{token}', 'not_a_url'],
    ['https://user:pw@club.bg/t/{token}', 'credentials'],
    ['https://club.bg/t/{token}#x', 'query_or_fragment'],
    ['https://club.bg/t/ {token}', 'whitespace'],
    [`https://club.bg/${'a'.repeat(MAX_QR_PATTERN_LENGTH)}{token}`, 'too_long'],
  ])('refuses %j (%s)', (value, problem) => {
    expect(checkOwnPattern(value)).toEqual({ ok: false, problem })
  })
})

describe('addresses', () => {
  it('ours is the base and /t/<token>, however the base ends', () => {
    const qr = readVenueQr({}, 'http://localhost:3000')
    expect(qrAddress(qr, TOKEN)).toBe(`http://localhost:3000/t/${TOKEN}`)
    expect(qrAddress({ ...qr, baseUrl: 'https://x.bg/menu/' }, TOKEN)).toBe(
      `https://x.bg/menu/t/${TOKEN}`,
    )
  })

  it('the venue’s own pattern puts the token in every {token}', () => {
    expect(ownAddress('https://club.bg/t/{token}', TOKEN)).toBe(`https://club.bg/t/${TOKEN}`)
    expect(ownAddress('https://club.bg/{token}/x?t={token}', TOKEN)).toBe(
      `https://club.bg/${TOKEN}/x?t=${TOKEN}`,
    )
  })

  it('property: an address the checks accept ends up with the token in it and nothing else open', () => {
    fc.assert(
      fc.property(
        fc.constantFrom('https://a.bg', 'https://menu.club.bg/x', 'http://localhost:3000'),
        fc.constantFrom('/t/', '/go/', '/q?id=', '/'),
        (origin, path) => {
          const pattern = `${origin}${path}{token}`
          const checked = checkOwnPattern(pattern)
          expect(checked.ok).toBe(true)
          const token = newTableToken()
          const address = ownAddress(pattern, token)
          expect(address).toBe(`${origin}${path}${token}`)
          expect(address).not.toMatch(/[{}]/)
        },
      ),
    )
  })
})

describe('the stored setting', () => {
  it('reads nothing, or nonsense, as "our link" on the default base address', () => {
    for (const settings of [{}, null, undefined, [], { qr: null }, { qr: { mode: 'sideways' } }]) {
      expect(readVenueQr(settings, 'http://localhost:3000')).toEqual({
        mode: 'ours',
        baseUrl: 'http://localhost:3000',
        baseIsDefault: true,
        ownPattern: null,
      })
    }
  })

  it('has no base address at all when nothing is saved and there is no default', () => {
    const qr = readVenueQr({}, null)
    expect(qr.baseUrl).toBeNull()
    expect(qrAddress(qr, TOKEN)).toBeNull()
    // A default that is not usable is no default.
    expect(readVenueQr({}, 'club.bg').baseUrl).toBeNull()
  })

  it('reads a saved base address and a saved pattern, and uses the mode', () => {
    const ours = readVenueQr(
      { qr: { mode: 'ours', base_url: 'http://192.168.1.20:3000' } },
      'http://localhost:3000',
    )
    expect(ours).toMatchObject({ mode: 'ours', baseUrl: 'http://192.168.1.20:3000' })
    expect(ours.baseIsDefault).toBe(false)

    const own = readVenueQr(
      { qr: { mode: 'own', own_pattern: 'https://club.bg/t/{token}' } },
      'http://localhost:3000',
    )
    expect(own).toMatchObject({ mode: 'own', ownPattern: 'https://club.bg/t/{token}' })
    expect(qrAddress(own, TOKEN)).toBe(`https://club.bg/t/${TOKEN}`)
    // The base address is kept for switching back.
    expect(own.baseUrl).toBe('http://localhost:3000')
  })

  it('does not use "own" without a valid pattern', () => {
    expect(readVenueQr({ qr: { mode: 'own' } }, 'http://localhost:3000').mode).toBe('ours')
    expect(
      readVenueQr({ qr: { mode: 'own', own_pattern: 'https://club.bg/no-token' } }, null).mode,
    ).toBe('ours')
  })

  it('the schema refuses unknown keys and unusable addresses', () => {
    expect(VenueQrSchema.safeParse({ mode: 'ours', extra: 1 }).success).toBe(false)
    expect(VenueQrSchema.safeParse({ mode: 'ours', base_url: 'club.bg' }).success).toBe(false)
    expect(VenueQrSchema.safeParse({ mode: 'own', own_pattern: 'https://x.bg/' }).success).toBe(
      false,
    )
    expect(VenueQrSchema.safeParse({ mode: 'ours' }).success).toBe(true)
  })
})

describe('table names and tokens', () => {
  it('the guest page says the manager’s name, else the barsy number', () => {
    expect(tableDisplayLabel({ label: 'VIP 3', placeNum: '12' })).toBe('VIP 3')
    expect(tableDisplayLabel({ label: null, placeNum: '12' })).toBe('12')
    expect(tableDisplayLabel({ label: '  ', placeNum: ' 12 ' })).toBe('12')
    expect(tableDisplayLabel({ label: null, placeNum: null })).toBeNull()
    expect(tableDisplayLabel({ label: '', placeNum: '' })).toBeNull()
    expect(tableDisplayLabel({ label: null, placeNum: 'x'.repeat(60) })).toBe('x'.repeat(40))
  })

  it('a new token is 22 base62 characters and fits what /t/<token> accepts', () => {
    const seen = new Set<string>()
    for (let index = 0; index < 500; index += 1) {
      const token = newTableToken()
      expect(token).toMatch(/^[0-9A-Za-z]{22}$/)
      expect(isTableToken(token)).toBe(true)
      seen.add(token)
    }
    expect(seen.size).toBe(500)
    expect(isTableToken('short')).toBe(false)
    expect(isTableToken('has space 123456789')).toBe(false)
    expect(isTableToken(undefined)).toBe(false)
  })

  it('property: a token never contains a barsy-looking id (it takes no input to derive from)', () => {
    expect(newTableToken.length).toBe(0)
    fc.assert(
      fc.property(fc.stringMatching(/^[0-9]{8,12}$/), (barsyId) => {
        expect(newTableToken()).not.toContain(barsyId)
      }),
    )
  })
})
