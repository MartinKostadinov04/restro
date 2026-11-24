// The open part of the Design panel lives in the address: `?part=<id>` (D159). Opening a part from
// the list pushes one history step, so the browser's Back and a phone's back gesture return to the
// list, not out of the Design page. Moving from one part to another replaces that step; ‹ Back, and
// a level switch to a level without the open part, step back to the list (`history.back()`). A plain
// `history.pushState` / `replaceState`: Next.js keeps `useSearchParams` in step with it, and no page
// request is made. The frames of the page keep their own steps inside them (`keepHistoryInside`), so
// the two never meet.
//
// Which step this document pushed is kept in memory, never in `history.state`: Next.js rewrites the
// state on its own navigations (a save's refresh drops any key of ours), and a key that survives a
// reload would send Back into the document before it (a full page load).

export const PART_PARAM = 'part'

/**
 * Where the page stands among the steps this document pushed for an open part.
 * - 'on': on the step it pushed, with the list it was opened from right under it.
 * - 'under': on that list, with the step it pushed forward of it.
 * - null: neither (a step a link, a reload or Next.js made).
 */
let pushed: 'on' | 'under' | null = null

/** The part the address names, or null. */
export function partInAddress(): string | null {
  return new URL(window.location.href).searchParams.get(PART_PARAM)
}

function addressWith(part: string | null): URL {
  const url = new URL(window.location.href)
  if (part === null) url.searchParams.delete(PART_PARAM)
  else url.searchParams.set(PART_PARAM, part)
  return url
}

/** True when this document loaded by a reload or the browser's Back or Forward, not a link. */
function cameBack(): boolean {
  const entry = performance.getEntriesByType?.('navigation')[0] as
    | PerformanceNavigationTiming
    | undefined
  return entry?.type === 'reload' || entry?.type === 'back_forward'
}

/**
 * The page is drawn: the steps of an earlier visit are forgotten. A part a link opened gets the list
 * under it as a step of its own, so the browser's Back returns to the list; after a reload (or Back
 * from another site) the step under it is the list already, of the document before, and none is
 * added. An address naming no part the page has is cleared.
 */
export function settleAddress(opened: string | null): void {
  pushed = null
  if (opened === null) {
    if (partInAddress() !== null) replacePart(null)
    return
  }
  if (cameBack()) return
  replacePart(null)
  pushPart(opened)
}

/** Opens a part from the list: a new step. */
export function pushPart(part: string): void {
  window.history.pushState({}, '', addressWith(part))
  pushed = 'on'
}

/** Names another part, or none, on the step the page is on. */
export function replacePart(part: string | null): void {
  window.history.replaceState({}, '', addressWith(part))
}

/**
 * Back to the list: one step back when this document pushed the step it is on, else the part is
 * taken off the address on this step, and the page stays. True when it stepped back: the step lands
 * a moment later, with a popstate.
 */
export function leavePart(): boolean {
  if (pushed !== 'on') {
    replacePart(null)
    return false
  }
  pushed = 'under'
  window.history.back()
  return true
}

/** The browser moved between steps: back from the step this document pushed, or forward to it. */
export function notePop(): void {
  const onPart = partInAddress() !== null
  if (pushed === 'on' && !onPart) pushed = 'under'
  else if (pushed === 'under' && onPart) pushed = 'on'
}
