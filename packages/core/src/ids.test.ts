import { describe, expect, it } from 'vitest'

import { ID_KINDS, type IdKind, idSchema, isId, newId } from './ids'

describe('newId', () => {
  it('makes kind_ + 22 base62 characters for every kind', () => {
    for (const kind of ID_KINDS) {
      const id = newId(kind)
      expect(id).toMatch(new RegExp(`^${kind}_[0-9A-Za-z]{22}$`))
      expect(isId(kind, id)).toBe(true)
    }
  })

  it('does not repeat', () => {
    const ids = new Set(Array.from({ length: 10_000 }, () => newId('nd')))
    expect(ids.size).toBe(10_000)
  })

  it('uses the whole alphabet (random, not sequential)', () => {
    // The first body character only reaches 0-7 (2^128 < 8 · 62^21), so look at the other 21.
    const chars = new Set(Array.from({ length: 2000 }, () => newId('nd').slice(4)).join(''))
    expect(chars.size).toBe(62)
  })

  it('refuses an unknown kind', () => {
    expect(() => newId('xx' as IdKind)).toThrow(TypeError)
  })
})

describe('isId', () => {
  it('checks the kind, the separator and the body', () => {
    const id = newId('vn')
    expect(isId('vn', id)).toBe(true)
    expect(isId('nd', id)).toBe(false)
    expect(isId('vn', id.slice(0, -1))).toBe(false)
    expect(isId('vn', `${id}x`)).toBe(false)
    expect(isId('vn', id.replace('_', '-'))).toBe(false)
    expect(isId('vn', 'vn_beach')).toBe(false)
    expect(isId('vn', 'vn_!!!!!!!!!!!!!!!!!!!!!!')).toBe(false)
    expect(isId('vn', 42)).toBe(false)
  })

  it('backs a Zod schema', () => {
    const schema = idSchema('as')
    expect(schema.safeParse(newId('as')).success).toBe(true)
    expect(schema.safeParse(newId('nd')).success).toBe(false)
  })
})
