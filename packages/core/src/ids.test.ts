import { describe, expect, it } from 'vitest'

import { ID_KINDS, type IdKind, idFromBytes, idSchema, isId, newId } from './ids'

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

  it('knows the Stage 2 kinds: job run, integration, user, source record', () => {
    for (const kind of ['jb', 'in', 'us', 'sr'] as const) {
      expect(ID_KINDS).toContain(kind)
      expect(isId(kind, newId(kind))).toBe(true)
    }
    expect(new Set(ID_KINDS).size).toBe(ID_KINDS.length)
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

describe('idFromBytes (#74)', () => {
  it('makes a valid id of the kind from the first 16 bytes, the same each time', () => {
    const bytes = Uint8Array.from({ length: 32 }, (_, i) => i * 7)
    const id = idFromBytes('rd', bytes)
    expect(isId('rd', id)).toBe(true)
    expect(idFromBytes('rd', bytes)).toBe(id)
    expect(idFromBytes('bn', bytes).slice(3)).toBe(id.slice(3))
    const tail = Uint8Array.from(bytes)
    tail[20] = 255
    expect(idFromBytes('rd', tail)).toBe(id)
  })

  it('refuses fewer than 16 bytes and an unknown kind', () => {
    expect(() => idFromBytes('rd', new Uint8Array(15))).toThrow(TypeError)
    expect(() => idFromBytes('xx' as IdKind, new Uint8Array(16))).toThrow(TypeError)
  })
})
