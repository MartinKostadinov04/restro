// The template registry (D69): every face the app can draw, in one place. A venue's snapshot names
// its template (`presentation.face`); the guest page and the previews look it up here.
//
// An entry carries everything that is cheap to know without drawing the face: its manifest (so the
// host can ask for the right photo sizes), its names, and where its picture is. The face's
// components are NOT imported here: `load()` imports them when they are first needed, so a guest
// downloads the one template its venue chose, not all of them. The manifests are imported through
// each face's `./manifest` entry, which pulls in the manifest and nothing else.

import { EDITORIAL_MARKET_MANIFEST } from '@restro/editorial-market/manifest'
import { QR_PHONE_MANIFEST } from '@restro/qr-phone/manifest'
import type { FaceHostProps, FaceManifest } from '@restro/shell'
import type { ComponentType } from 'react'

/** A text in the two languages of the interface. */
export interface FaceText {
  readonly bg: string
  readonly en: string
}

/** One template the app can draw. */
export interface FaceEntry {
  /** The template's name in a snapshot's `presentation.face`; equals `manifest.face`. */
  readonly id: string
  readonly manifest: FaceManifest
  /** Imports the face's components (once; the browser keeps the result). */
  readonly load: () => Promise<ComponentType<FaceHostProps>>
  /** A hidden template is never offered to a venue (D69); one that already uses it still gets it. */
  readonly hidden: boolean
  readonly name: FaceText
  readonly description: FaceText
  /** A phone-width picture of the template, served by this app. */
  readonly thumbnail: string
}

/** The template a venue gets until it chooses one (D69). */
export const DEFAULT_FACE_ID = 'editorial-market'

export const FACES: readonly FaceEntry[] = [
  {
    id: EDITORIAL_MARKET_MANIFEST.face,
    manifest: EDITORIAL_MARKET_MANIFEST,
    load: async () => (await import('@restro/editorial-market')).EditorialMarketFace,
    hidden: false,
    name: { bg: 'Редакционен пазар', en: 'Editorial Market' },
    description: {
      bg: 'Меню, водено от снимките, с лента с категории и три подредби.',
      en: 'A photo-led, editorial menu with a category rail and three layouts.',
    },
    thumbnail: `/faces/${EDITORIAL_MARKET_MANIFEST.face}.png`,
  },
  {
    // The reference face of the first stages. It stays in the registry so that the contract test
    // keeps proving the host works with more than one face, and so a venue that already uses it
    // keeps its menu; no venue is offered it.
    id: QR_PHONE_MANIFEST.face,
    manifest: QR_PHONE_MANIFEST,
    load: async () => (await import('@restro/qr-phone')).QrPhoneFace,
    hidden: true,
    name: { bg: 'Просто (тестов еталон)', en: 'Simple (test reference)' },
    description: {
      bg: 'Тестовият еталон: един екран с превъртане, без украса.',
      en: 'The test reference: one scrolling page, no frills.',
    },
    thumbnail: `/faces/${QR_PHONE_MANIFEST.face}.png`,
  },
]

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
