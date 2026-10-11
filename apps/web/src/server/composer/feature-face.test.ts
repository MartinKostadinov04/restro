// The server's manifests for the guest features (feature-face.ts) name the registry's faces: every
// face the guest page can draw is read here with the same manifest, and the default face is the
// registry's. A face added to the registry without this list fails here.
import { describe, expect, it } from 'vitest'

import { DEFAULT_FACE_ID, FACES } from '@/faces/registry'

import { featureManifestOf } from './feature-face'

describe("the face a venue's guest features are read against", () => {
  it('reads every face of the registry with its own manifest', () => {
    for (const entry of FACES) {
      expect(featureManifestOf(entry.id)).toEqual(entry.manifest)
    }
  })

  it('reads the default face for a venue that chose none, or a name that is not a face', () => {
    expect(featureManifestOf(undefined).face).toBe(DEFAULT_FACE_ID)
    expect(featureManifestOf(null).face).toBe(DEFAULT_FACE_ID)
    expect(featureManifestOf('no-such-face').face).toBe(DEFAULT_FACE_ID)
    expect(featureManifestOf('constructor').face).toBe(DEFAULT_FACE_ID)
  })
})
