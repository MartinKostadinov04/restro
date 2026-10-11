// What is known about every template WITHOUT loading it (D69): its manifest, its names, its picture
// and whether venues are offered it. The one list of templates that server code may read. The
// registry (registry.ts) is built from it and adds the one thing that is not safe everywhere,
// `load()`, which imports the face's components.
//
// Why two files: a server module that imports the registry makes the bundler follow `load()`'s
// dynamic import into the faces' components (client code with hooks, and no `'use client'` of its
// own), and the build fails. Server code (the Design tab's actions, which must check that a
// template is real, visible and what its options are; the composer's guest-features panel, which
// reads the options of the venue's template) therefore reads this file; the guest page and the
// previews read the registry. A template added here is in the registry, and a template that the
// registry has no loader for fails at once (registry.ts), so the two cannot drift.
//
// This file imports only each face's `./manifest` entry, which pulls in the manifest and nothing
// else, and types.
import { EDITORIAL_MARKET_MANIFEST } from '@restro/editorial-market/manifest'
import { QR_PHONE_MANIFEST } from '@restro/qr-phone/manifest'
import type { FaceManifest } from '@restro/shell'

/** A text in the two languages of the interface. */
export interface FaceText {
  readonly bg: string
  readonly en: string
}

/** What is known about one template without drawing it. */
export interface ManifestEntry {
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

export const MANIFESTS: readonly ManifestEntry[] = [
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

const byId: ReadonlyMap<string, ManifestEntry> = new Map(
  MANIFESTS.map((entry) => [entry.id, entry]),
)

/** The templates a venue can choose from, the default first. */
export function visibleManifests(): readonly ManifestEntry[] {
  return MANIFESTS.filter((entry) => !entry.hidden)
}

/** The entry with this name, or undefined: no fallback (a name from a request is not trusted). */
export function manifestEntry(id: string): ManifestEntry | undefined {
  return byId.get(id)
}

/**
 * The manifest a venue's template is read with: the venue's own face, or the default face for a
 * venue that chose none or a name this list does not have, as the guest page draws it.
 */
export function manifestOf(face: string | null | undefined): FaceManifest {
  const found = face === null || face === undefined ? undefined : byId.get(face)
  const fallback = byId.get(DEFAULT_FACE_ID)
  if (fallback === undefined) {
    throw new Error(`the default face "${DEFAULT_FACE_ID}" is not in the list of manifests`)
  }
  return (found ?? fallback).manifest
}
