import { describe, expect, it } from 'vitest'

import { safeNextPath } from './safe-next'

describe('safeNextPath (where to go after signing in)', () => {
  it.each(['/venues', '/venues/vn_x?tab=settings', '/'])('keeps the local path %s', (path) => {
    expect(safeNextPath(path)).toBe(path)
  })

  it.each([
    'https://evil.example/venues',
    '//evil.example',
    '/\\evil.example',
    'venues',
    'javascript:alert(1)',
    '/venues\nSet-Cookie: x=1',
    '',
    undefined,
    null,
  ])('falls back to /venues for %j (no open redirect)', (value) => {
    expect(safeNextPath(value)).toBe('/venues')
  })

  it('takes the first value of a repeated parameter and refuses very long ones', () => {
    expect(safeNextPath(['/venues', 'https://evil.example'])).toBe('/venues')
    expect(safeNextPath(`/${'a'.repeat(600)}`)).toBe('/venues')
  })
})
