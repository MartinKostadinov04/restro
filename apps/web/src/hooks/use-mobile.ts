import * as React from 'react'

const MOBILE_BREAKPOINT = 768
const MOBILE_QUERY = `(max-width: ${MOBILE_BREAKPOINT - 1}px)`

function subscribe(onChange: () => void) {
  const mql = window.matchMedia(MOBILE_QUERY)
  mql.addEventListener('change', onChange)
  return () => mql.removeEventListener('change', onChange)
}

/** Whether the screen is phone-width right now; for event handlers, which need no re-render. */
export function isMobileNow(): boolean {
  return window.matchMedia(MOBILE_QUERY).matches
}

/**
 * Whether the screen is phone-width. The server and hydration see `false`; the component that
 * calls this re-renders on its own once the browser says otherwise. Keep the answer in the
 * component that reads it, never in a context above the page: a context that changes right after
 * hydration makes React drop the page's still-streaming Suspense boundaries and draw them on the
 * client, and the streamed copy then stays in the page, hidden (lane 6, the 390 px duplicates).
 */
export function useIsMobile(): boolean {
  return React.useSyncExternalStore(subscribe, isMobileNow, () => false)
}
