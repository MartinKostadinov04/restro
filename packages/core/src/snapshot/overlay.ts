// The live overlay (doc "Files on the CDN": `live.json`): sold-out marks between publishes, so
// bar staff can mark an item sold out ten times a night without ten snapshots. Pure.

import type { NodeId } from '../ids'
import type { ResolvedMenu } from '../resolve/types'
import type { LiveOverlay, MenuSnapshot } from './schema'

/**
 * `{version, items: {nd_x: {sold_out: true}}}` for the items of the current snapshot that the
 * resolution with today's service edition has off sale (`for_sale` false), and nothing else: the
 * overlay can only mark items sold out, never show, hide, re-price or put anything back on
 * sale. `version` is the current snapshot's version, so a shell can tell which snapshot the
 * overlay was made for.
 */
export function buildLiveOverlay(
  resolvedWithServiceEdition: ResolvedMenu,
  current: MenuSnapshot,
): LiveOverlay {
  const items: Record<NodeId, { sold_out: true }> = {}
  for (const id of Object.keys(current.items).sort() as NodeId[]) {
    const item = Object.hasOwn(resolvedWithServiceEdition.items, id)
      ? resolvedWithServiceEdition.items[id]
      : undefined
    if (item?.fields.for_sale?.value === false) items[id] = { sold_out: true }
  }
  return { version: current.snapshot.version, items }
}
