// The open part of the Design panel lives in the address: `?part=<id>` (D159). Opening a part from
// the list pushes one history step, so the browser's Back and a phone's back gesture return to the
// list, not out of the Design page; moving from one part to another, or the level switch, replaces
// that step. A plain `history.pushState` / `replaceState`: Next.js keeps `useSearchParams` in step
// with it, and no page request is made. The frames of the page keep their own steps inside them
// (`keepHistoryInside`), so the two never meet.

export const PART_PARAM = 'part'

/** Marks a history step this page pushed for an open part: the step before it is the list. */
const PUSHED = 'restroDesignPart'

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

/** True when the step the page is on is one it pushed for an open part. */
export function pushedHere(): boolean {
  const state: unknown = window.history.state
  return (
    typeof state === 'object' &&
    state !== null &&
    (state as Record<string, unknown>)[PUSHED] === true
  )
}

/** Opens a part from the list: a new step. */
export function pushPart(part: string): void {
  window.history.pushState({ [PUSHED]: true }, '', addressWith(part))
}

/** Names another part, or none, on the step the page is on. */
export function replacePart(part: string | null): void {
  window.history.replaceState({ [PUSHED]: part !== null && pushedHere() }, '', addressWith(part))
}

/**
 * Back to the list: one step back when the page pushed the step it is on, else the part is taken
 * off the address on this step (a reload or a link opened the part). True when it stepped back: the
 * step lands a moment later, with a popstate.
 */
export function leavePart(): boolean {
  if (!pushedHere()) {
    replacePart(null)
    return false
  }
  window.history.back()
  return true
}
