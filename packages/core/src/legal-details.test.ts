import { describe, expect, it } from 'vitest'

import {
  isEik,
  isHttpsLink,
  LegalDetailsSchema,
  legalProblems,
  readLegalDetails,
} from './legal-details'

const FULL = {
  name: 'Club Nights EOOD',
  eik: '123456789',
  address: 'Sofia, 1 Example Street',
  privacyUrl: 'https://club.example/privacy',
}

describe('the venue legal details (#198)', () => {
  it('takes an ЕИК of 9 or 13 digits and nothing else (length only: no cited check-digit rule)', () => {
    expect(isEik('123456789')).toBe(true)
    expect(isEik('1234567890123')).toBe(true)
    for (const bad of ['', '12345678', '1234567890', '12345678901234', '12345678a', ' 123456789']) {
      expect(isEik(bad)).toBe(false)
    }
  })

  it('takes a full https link', () => {
    expect(isHttpsLink('https://club.example/privacy')).toBe(true)
    expect(isHttpsLink('http://club.example')).toBe(false)
    expect(isHttpsLink('https://')).toBe(false)
    expect(isHttpsLink('https://localhost')).toBe(false)
    expect(isHttpsLink('club.example/privacy')).toBe(false)
  })

  it('reads the details only when all four are there and valid', () => {
    expect(readLegalDetails({ legalDetails: FULL })).toEqual(FULL)
    expect(readLegalDetails({})).toBeNull()
    expect(readLegalDetails({ legalDetails: { ...FULL, eik: '1' } })).toBeNull()
    expect(readLegalDetails({ legalDetails: { name: FULL.name } })).toBeNull()
    expect(LegalDetailsSchema.safeParse({ ...FULL, extra: 1 }).success).toBe(false)
  })

  it('says which field is empty and which is malformed', () => {
    expect(legalProblems(FULL)).toEqual({})
    expect(legalProblems({ name: '', eik: '', address: ' ', privacyUrl: '' })).toEqual({
      name: 'required',
      eik: 'required',
      address: 'required',
      privacyUrl: 'required',
    })
    expect(legalProblems({ ...FULL, eik: '12', privacyUrl: 'http://x.example' })).toEqual({
      eik: 'bad',
      privacyUrl: 'bad',
    })
  })
})
