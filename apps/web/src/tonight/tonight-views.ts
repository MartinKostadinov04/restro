// The views of Tonight (#85, #86), apart from the tab bar so the server can name them too: a
// 'use client' module cannot be called from a server component.

/** Every view of Tonight, in the order of the tab bar; the first is where Tonight opens. */
export const TONIGHT_VIEW_NAMES = ['actions', 'sent', 'log', 'night'] as const

/** One view of Tonight. */
export type TonightViewName = (typeof TONIGHT_VIEW_NAMES)[number]

export function isTonightView(value: unknown): value is TonightViewName {
  return typeof value === 'string' && (TONIGHT_VIEW_NAMES as readonly string[]).includes(value)
}
