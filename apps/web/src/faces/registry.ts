// The template registry (D69, D128): the one face the app draws, the renderer. A venue's look is the
// snapshot's design block, which the renderer reads; no snapshot picks a face.
//
// An entry carries everything that is cheap to know without drawing the face: its manifest (so the
// host can ask for the right photo sizes), its names, and where its picture is. The face's
// components are NOT imported here: `load()` imports them when they are first needed. The manifest
// is imported through the face's `./manifest` entry, which pulls in the manifest and nothing else.
//
// What is known about a template without loading it lives in `manifests.ts`; this file adds `load()`.
// Only client code may import this file (see manifests.ts for why): server code reads
// manifests.ts.

import type { FaceHostProps } from '@restro/shell'
import type { ComponentType } from 'react'

import { DEFAULT_FACE_ID, MANIFESTS, type ManifestEntry } from './manifests'

export { DEFAULT_FACE_ID, type FaceText } from './manifests'

/** One template the app can draw. */
export interface FaceEntry extends ManifestEntry {
  /** Imports the face's components (once; the browser keeps the result). */
  readonly load: () => Promise<ComponentType<FaceHostProps>>
}

/** How each template's components are imported, by the template's name. */
const LOADERS: Readonly<Record<string, FaceEntry['load']>> = {
  'editorial-market': async () => (await import('@restro/editorial-market')).EditorialMarketFace,
}

export const FACES: readonly FaceEntry[] = MANIFESTS.map((entry) => {
  const load = LOADERS[entry.id]
  if (load === undefined)
    throw new Error(`the template "${entry.id}" has no loader in the registry`)
  return { ...entry, load }
})

const byId = new Map(FACES.map((entry) => [entry.id, entry]))

/** Ids already reported as unknown, so a page that asks every few seconds says it once. */
const reported = new Set<string>()

/**
 * The entry for a template name. A name that is not in the registry (a template that was removed,
 * a hand-edited snapshot) gives the default template and is logged once, as a structured line with
 * the name only; a venue that never chose gives the default silently, that is the normal case.
 */
export function faceEntry(id: string | null | undefined): FaceEntry {
  const fallback = byId.get(DEFAULT_FACE_ID)
  if (fallback === undefined)
    throw new Error(`the default face "${DEFAULT_FACE_ID}" is not in the registry`)
  if (id === null || id === undefined) return fallback
  const found = byId.get(id)
  if (found !== undefined) return found
  if (!reported.has(id)) {
    reported.add(id)
    console.warn(JSON.stringify({ level: 'warn', event: 'unknown_face', face: id.slice(0, 64) }))
  }
  return fallback
}

/** The templates a venue can choose from, the default first. */
export function visibleFaces(): readonly FaceEntry[] {
  return FACES.filter((entry) => !entry.hidden)
}
