// The open item lives in the URL: `?item=<nd_ id>`. The composer mounts <ItemSheet itemId=… />
// while the parameter is there, and the sheet takes it out of the URL when it closes. (A plain
// `history.replaceState`: Next.js keeps `useSearchParams` in step with it, and no page request is
// made.) The open section is `?section=<nd_ id | unsorted>`, kept the same way.
import { isId, type NodeId } from '@restro/core'

export const ITEM_PARAM = 'item'
export const SECTION_PARAM = 'section'

/** Sets (a string) or removes (`null`) query parameters of the current page, without navigating. */
export function replaceSearchParams(updates: Readonly<Record<string, string | null>>): void {
  const url = new URL(window.location.href)
  for (const [name, value] of Object.entries(updates)) {
    if (value === null) url.searchParams.delete(name)
    else url.searchParams.set(name, value)
  }
  window.history.replaceState(null, '', url)
}

/** Closes the item sheet: removes `?item=` from the URL. */
export function clearOpenItem(): void {
  replaceSearchParams({ [ITEM_PARAM]: null })
}

/** The item id in a query parameter value, if it is one. */
export function itemIdFromParam(value: string | null): NodeId | null {
  return isId('nd', value) ? value : null
}
