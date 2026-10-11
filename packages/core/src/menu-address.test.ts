import { describe, expect, it } from 'vitest'

import { menuPath, parseMenuParam } from './menu-address'
import { newPublicId } from './public-id'

const CODE = 'k3x9p2m7qa1z'

describe('menuPath', () => {
  it('is /m/<slug>-<code>', () => {
    expect(menuPath({ slug: 'demo-club', publicId: CODE })).toBe(`/m/demo-club-${CODE}`)
    expect(menuPath({ slug: 'a', publicId: CODE })).toBe(`/m/a-${CODE}`)
  })

  it('takes a whole venue row (extra fields are ignored)', () => {
    const venue = { id: 'vn_x', name: 'Demo Club', slug: 'demo-club', publicId: CODE }
    expect(menuPath(venue)).toBe(`/m/demo-club-${CODE}`)
  })

  it('names the code and nothing else when the slug is not a slug', () => {
    expect(menuPath({ slug: '', publicId: CODE })).toBe(`/m/${CODE}`)
    expect(menuPath({ slug: 'Demo Club', publicId: CODE })).toBe(`/m/${CODE}`)
  })

  it('refuses something that is not a public code', () => {
    expect(() => menuPath({ slug: 'demo-club', publicId: '' })).toThrow(TypeError)
    expect(() => menuPath({ slug: 'demo-club', publicId: 'K3X9P2M7QA1Z' })).toThrow(TypeError)
    expect(() => menuPath({ slug: 'demo-club', publicId: 'vn_4a1' })).toThrow(TypeError)
  })

  it('is read back by parseMenuParam, whatever the slug', () => {
    for (let i = 0; i < 100; i++) {
      const publicId = newPublicId()
      for (const slug of ['demo-club', 'a', 'x-1-y-2', 'club-123456789012']) {
        const path = menuPath({ slug, publicId })
        expect(parseMenuParam(path.slice('/m/'.length))).toBe(publicId)
      }
    }
  })
})

describe('parseMenuParam', () => {
  it('finds the code behind a slug', () => {
    expect(parseMenuParam(`demo-club-${CODE}`)).toBe(CODE)
    expect(parseMenuParam(`a-${CODE}`)).toBe(CODE)
    expect(parseMenuParam(`one-more-club-name-${CODE}`)).toBe(CODE)
  })

  it('finds a bare code', () => {
    expect(parseMenuParam(CODE)).toBe(CODE)
    expect(parseMenuParam('000000000000')).toBe('000000000000')
  })

  it('never reads the slug: a stale, odd or missing one finds the same venue', () => {
    expect(parseMenuParam(`renamed-${CODE}`)).toBe(CODE)
    expect(parseMenuParam(`Demo Club-${CODE}`)).toBe(CODE)
    expect(parseMenuParam(`-${CODE}`)).toBe(CODE)
    // A slug that itself ends in 12 code-like characters: only the last 12 are the code.
    expect(parseMenuParam(`club-aaaaaaaaaaaa-${CODE}`)).toBe(CODE)
  })

  it('knows a slug alone is no venue', () => {
    expect(parseMenuParam('demo-club')).toBeNull()
    expect(parseMenuParam('demo-club-')).toBeNull()
    expect(parseMenuParam('')).toBeNull()
  })

  it('refuses upper case (a code is lower-case)', () => {
    expect(parseMenuParam('demo-k3x9p2m7qa1Z')).toBeNull()
    expect(parseMenuParam('K3X9P2M7QA1Z')).toBeNull()
  })

  it('refuses a code that is too short or too long, or not set off by a hyphen', () => {
    expect(parseMenuParam('demo-k3x9p2m7qa1')).toBeNull()
    expect(parseMenuParam('demo-k3x9p2m7qa1zz')).toBeNull()
    expect(parseMenuParam('k3x9p2m7qa1zz')).toBeNull()
    expect(parseMenuParam('demok3x9p2m7qa1z')).toBeNull()
    expect(parseMenuParam('demo_k3x9p2m7qa1z')).toBeNull()
  })

  it('refuses whitespace, separators and other characters around the code', () => {
    expect(parseMenuParam(`demo-${CODE} `)).toBeNull()
    expect(parseMenuParam(`demo-${CODE}\n`)).toBeNull()
    expect(parseMenuParam(`demo-${CODE}/`)).toBeNull()
    expect(parseMenuParam(`demo-${CODE}.json`)).toBeNull()
    expect(parseMenuParam(`demo-k3x9p2m7qa1_`)).toBeNull()
  })

  it('refuses an internal id', () => {
    // Rule 3: a `vn_` id is no address. It has an underscore and 22 characters.
    expect(parseMenuParam('vn_4aXYZ12345678901234567')).toBeNull()
  })
})
