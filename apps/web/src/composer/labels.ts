// Display text of a node with a fallback for the nameless. Pure; the caller passes the translated
// fallbacks so this file needs no hook.

import type { NodeId } from '@restro/core'

import type { ComposerView } from './view-model'

/** A section's title, or `fallback` when it has none. */
export function sectionTitle(view: ComposerView, id: NodeId, fallback: string): string {
  const title = view.sections[id]?.title ?? ''
  return title === '' ? fallback : title
}

/** An item's name, or `fallback` when it has none. */
export function itemName(view: ComposerView, id: NodeId, fallback: string): string {
  const name = view.items[id]?.name ?? ''
  return name === '' ? fallback : name
}
