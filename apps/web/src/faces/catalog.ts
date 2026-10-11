// The template catalogue (D69): what is known about every template WITHOUT loading it - its
// manifest, its names, its picture and whether venues are offered it. The registry (registry.ts)
// adds the one thing that is not safe everywhere, `load()`, which imports the face's components.
//
// Why two files: a server module that imports the registry makes the bundler follow `load()`'s
// dynamic import into the faces' components (client code with hooks, and no `'use client'` of its
// own), and the build fails. Server code (the Design tab's actions, which must check that a
// template is real, visible and what its options are) therefore reads this file; the guest page
// and the previews read the registry. Both give the same entries: the registry is built from this
// catalogue.
import { EDITORIAL_MARKET_MANIFEST } from '@restro/editorial-market/manifest'
import { QR_PHONE_MANIFEST } from '@restro/qr-phone/manifest'
import type { FaceManifest } from '@restro/shell'

/** A text in the two languages of the interface. */
export interface FaceText {
  readonly bg: string
  readonly en: string
}

/** What is known about one template without drawing it. */
export interface CatalogEntry {
  /** The template's name in a snapshot's `presentation.face`; equals `manifest.face`. */
  readonly id: string
  readonly manifest: FaceManifest
  /** A hidden template is never offered to a venue (D69); one that already uses it still gets it. */
  readonly hidden: boolean
  readonly name: FaceText
  readonly description: FaceText
  /** A phone-width picture of the template, served by this app. */
  readonly thumbnail: string
}

/** The template a venue gets until it chooses one (D69). */
export const DEFAULT_FACE_ID = 'editorial-market'

export const CATALOG: readonly CatalogEntry[] = [
  {
    id: EDITORIAL_MARKET_MANIFEST.face,
    manifest: EDITORIAL_MARKET_MANIFEST,
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
    hidden: true,
    name: { bg: 'Просто (тестов еталон)', en: 'Simple (test reference)' },
    description: {
      bg: 'Тестовият еталон: един екран с превъртане, без украса.',
      en: 'The test reference: one scrolling page, no frills.',
    },
    thumbnail: `/faces/${QR_PHONE_MANIFEST.face}.png`,
  },
]

/** The templates a venue can choose from, the default first. */
export function visibleCatalog(): readonly CatalogEntry[] {
  return CATALOG.filter((entry) => !entry.hidden)
}
