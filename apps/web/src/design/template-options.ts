// What a template's options are and who owns them (brief SH-05a). Pure: the server action and the
// Design tab's preview both use it, so what the preview shows is what a save would store.
//
// A face's manifest declares each option with a `group`: `look` options are how the menu is laid
// out and dressed (this tab's form), `feature` options are switches for something the guest can
// use (the composer's "Guest features" panel, SH-05b). Each panel saves only its own group and
// leaves the other group's saved values as they are.
import type { Presentation } from '@restro/core'
import { type FaceManifest, resolveOptions } from '@restro/shell'

import { type CatalogEntry, visibleCatalog } from '@/faces/catalog'

/** The values of a template's options. */
export type OptionValues = Readonly<Record<string, string | boolean>>

/** The keys of a manifest's options that belong to one group. */
export function optionKeys(manifest: FaceManifest, group: 'look' | 'feature'): string[] {
  return Object.entries(manifest.options)
    .filter(([, option]) => option.group === group)
    .map(([key]) => key)
}

/** The look options of a template with their defaults: what the form shows. */
export function lookOptionsOf(manifest: FaceManifest, raw: unknown): OptionValues {
  const resolved = resolveOptions(manifest, raw)
  const look: Record<string, string | boolean> = {}
  for (const key of optionKeys(manifest, 'look')) look[key] = resolved[key] as string | boolean
  return look
}

/**
 * The options a venue's presentation carries after it chose this template with these look
 * options.
 *   - The look options are the form's, run through the template's `resolveOptions`: a value the
 *     manifest does not list becomes the default, and a look key the form left out is the default.
 *   - The feature options (`group: 'feature'`) are the composer panel's: the ones already saved
 *     stay, if the template declares them as features, and are checked the same way. A template
 *     that does not declare a key drops it. No default is written for a feature the venue never
 *     set, so a later change of a default still reaches it.
 */
export function mergeOptions(
  manifest: FaceManifest,
  saved: Presentation | null,
  lookOptions: unknown,
): Presentation['options'] {
  const given =
    typeof lookOptions === 'object' && lookOptions !== null && !Array.isArray(lookOptions)
      ? (lookOptions as Record<string, unknown>)
      : {}
  const savedOptions: Record<string, unknown> = saved?.options ?? {}
  const lookKeys = optionKeys(manifest, 'look')
  const featureKeys = optionKeys(manifest, 'feature')
  const raw: Record<string, unknown> = {}
  for (const key of featureKeys) {
    if (Object.hasOwn(savedOptions, key)) raw[key] = savedOptions[key]
  }
  for (const key of lookKeys) {
    if (Object.hasOwn(given, key)) raw[key] = given[key]
  }
  const resolved = resolveOptions(manifest, raw)
  const options: Record<string, string | boolean> = {}
  for (const key of lookKeys) options[key] = resolved[key] as string | boolean
  for (const key of featureKeys) {
    if (Object.hasOwn(raw, key)) options[key] = resolved[key] as string | boolean
  }
  return options
}

/** The visible template with this name, or undefined (an unknown or hidden one is refused). */
export function chooseableFace(face: string): CatalogEntry | undefined {
  return visibleCatalog().find((entry) => entry.id === face)
}
