// The template catalogue (brief SH-05a): what server code may read about a template. The registry
// is built from it, so the two never disagree, and it never imports a face's components (that is
// what keeps it usable in a server module: see the file's header).
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

import { CATALOG, DEFAULT_FACE_ID, visibleCatalog } from './catalog'
import { FACES, visibleFaces } from './registry'

describe('the catalogue', () => {
  it('is what the registry is built from: the same entries, each with a loader added', () => {
    expect(FACES.map(({ load: _load, ...entry }) => entry)).toEqual(CATALOG)
    expect(FACES.every((entry) => typeof entry.load === 'function')).toBe(true)
  })

  it('offers the same visible templates as the registry, the default first', () => {
    expect(visibleCatalog().map((entry) => entry.id)).toEqual(
      visibleFaces().map((entry) => entry.id),
    )
    expect(visibleCatalog()[0]?.id).toBe(DEFAULT_FACE_ID)
    expect(visibleCatalog().some((entry) => entry.id === 'qr-phone')).toBe(false)
  })

  it('imports no face components and no React, so a server module can read it', () => {
    const source = readFileSync(new URL('./catalog.ts', import.meta.url), 'utf8')
    const code = source
      .split('\n')
      .filter((line) => !line.trim().startsWith('//'))
      .join('\n')
    expect(code).not.toMatch(/\bimport\s*\(/)
    expect(code).not.toMatch(/from 'react'/)
    // The only face imports are the manifests, which pull in nothing else.
    const faceImports = [...code.matchAll(/from '(@restro\/[a-z-]+[^']*)'/g)].map(
      (match) => match[1],
    )
    expect(faceImports.sort()).toEqual([
      '@restro/editorial-market/manifest',
      '@restro/qr-phone/manifest',
      '@restro/shell',
    ])
  })
})
