// The one list of templates that server code may read (manifests.ts). The registry is built from
// it, so the two never disagree: every face the guest page can draw is read on the server with the
// same manifest (the intent of SH-05b's feature-face test, now for this list), and the file never
// imports a face's components, which is what keeps it usable in a server module.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

import {
  DEFAULT_FACE_ID,
  MANIFESTS,
  manifestEntry,
  manifestOf,
  visibleManifests,
} from './manifests'
import { FACES, visibleFaces } from './registry'

describe('the list of manifests', () => {
  it('is what the registry is built from: the same entries, each with a loader added', () => {
    expect(FACES.map(({ load: _load, ...entry }) => entry)).toEqual(MANIFESTS)
    expect(FACES.every((entry) => typeof entry.load === 'function')).toBe(true)
  })

  it('names every face of the registry, each with its own manifest', () => {
    for (const entry of FACES) {
      expect(manifestOf(entry.id)).toEqual(entry.manifest)
      expect(manifestEntry(entry.id)?.manifest).toBe(entry.manifest)
    }
  })

  it('offers the same visible templates as the registry, the default first', () => {
    expect(visibleManifests().map((entry) => entry.id)).toEqual(
      visibleFaces().map((entry) => entry.id),
    )
    expect(visibleManifests()[0]?.id).toBe(DEFAULT_FACE_ID)
  })

  it('reads the default face for a venue that chose none, or a name that is not a face', () => {
    expect(manifestOf(undefined).face).toBe(DEFAULT_FACE_ID)
    expect(manifestOf(null).face).toBe(DEFAULT_FACE_ID)
    expect(manifestOf('no-such-face').face).toBe(DEFAULT_FACE_ID)
    expect(manifestOf('constructor').face).toBe(DEFAULT_FACE_ID)
  })

  it('does not give a fallback to a name taken from a request', () => {
    expect(manifestEntry('no-such-face')).toBeUndefined()
    expect(manifestEntry('constructor')).toBeUndefined()
    expect(manifestEntry('')).toBeUndefined()
  })

  it('imports no face components and no React, so a server module can read it', () => {
    const source = readFileSync(new URL('./manifests.ts', import.meta.url), 'utf8')
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
    expect(faceImports.sort()).toEqual(['@restro/editorial-market/manifest', '@restro/shell'])
  })
})
