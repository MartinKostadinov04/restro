'use client'

// A timed `router.refresh()` that never turns a lost connection into the browser's offline page
// (RR-88). Offline, Next's refresh fails and falls back to a full browser navigation, which replaces
// the screen with the browser's own error page. So before each refresh the hook asks the server
// whether it can be reached at all, with one small same-origin request; if not, it does not refresh
// and says so (`offline`), and the screen stays as it was.
//
// The probe is `/api/health` (liveness only, no database, no session): the sign-in gate
// (`proxy.ts`) leaves `/api/` alone, so a signed-out person is never sent anywhere by the probe, and
// any answer at all counts as reachable (even an error status, or a redirect: only a request that
// gets no answer is "offline"). A signed-out session still reaches the refresh, which sends it to the
// sign-in page as it always did.
//
// What stays open: the connection can drop in the few milliseconds between the probe's answer and the
// refresh that follows it. The probe is one small request on the same connection, so that window is
// one round trip; a refresh that fails in it falls back to the browser's page as before. Nothing in
// the page can catch that failure (Next does the navigation inside the refresh itself).
import { useRouter } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'

/** The endpoint the probe asks: liveness only, outside the sign-in gate. */
export const REACH_URL = '/api/health'
/** How long the probe waits for an answer before the server counts as out of reach. */
export const REACH_TIMEOUT_MS = 4000

/** Whether the server answers at all. Any HTTP answer counts, a redirect and an error included. */
export async function serverReachable(timeoutMs = REACH_TIMEOUT_MS): Promise<boolean> {
  try {
    await fetch(REACH_URL, {
      cache: 'no-store',
      // A redirect (a sign-in gate, a captive portal) is an answer, never a lost connection.
      redirect: 'manual',
      signal: AbortSignal.timeout(timeoutMs),
    })
    return true
  } catch {
    return false
  }
}

/**
 * A one-off refresh for a change that needs no answer from the server first (closing a sheet): it
 * waits for the same probe, so a closed sheet with no connection leaves the screen as it is.
 */
export async function refreshIfReachable(refresh: () => void): Promise<void> {
  if (await serverReachable()) refresh()
}

/**
 * Refreshes the page's server data every `every` ms while `enabled`, skipping a tick when the server
 * cannot be reached. `visibleOnly` also skips ticks while the tab is hidden. Returns `offline`: true
 * from the first failed probe until the next one that gets an answer (which also refreshes at once).
 */
export function useTimedRefresh({
  every,
  enabled = true,
  visibleOnly = false,
}: {
  every: number
  enabled?: boolean
  visibleOnly?: boolean
}): { offline: boolean } {
  const router = useRouter()
  // The router object is not guaranteed to keep its identity; the timer must not restart on it.
  const refresh = useRef(router.refresh)
  refresh.current = router.refresh
  const [offline, setOffline] = useState(false)

  useEffect(() => {
    if (!enabled) return
    let live = true
    let checking = false
    async function tick() {
      if (checking) return
      if (visibleOnly && document.visibilityState !== 'visible') return
      checking = true
      const reachable = await serverReachable()
      checking = false
      if (!live) return
      setOffline(!reachable)
      if (reachable) refresh.current()
    }
    const timer = window.setInterval(() => void tick(), every)
    // The connection coming back is noticed at once, not at the next tick.
    const back = () => void tick()
    window.addEventListener('online', back)
    return () => {
      live = false
      window.clearInterval(timer)
      window.removeEventListener('online', back)
    }
  }, [every, enabled, visibleOnly])

  return { offline }
}
