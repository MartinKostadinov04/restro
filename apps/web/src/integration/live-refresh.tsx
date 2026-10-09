'use client'

import { useRouter } from 'next/navigation'
import { useEffect, useRef, useTransition } from 'react'

/** How often the tab asks the server for fresh data while a job is queued or running. */
export const REFRESH_INTERVAL_MS = 3000

/**
 * Refreshes the page's server data about every 3 seconds while `active` (a connection check or a
 * full pull is queued or running), and stops by itself when the server says it is not any more:
 * the page re-renders with `active` false, which clears the timer. Draws nothing.
 */
export function LiveRefresh({ active }: { active: boolean }) {
  const router = useRouter()
  const [, startTransition] = useTransition()
  // The router object is not guaranteed to keep its identity; the timer must not restart on it.
  const refresh = useRef(router.refresh)
  refresh.current = router.refresh

  useEffect(() => {
    if (!active) return
    const timer = setInterval(() => {
      startTransition(() => refresh.current())
    }, REFRESH_INTERVAL_MS)
    return () => clearInterval(timer)
  }, [active])

  return null
}
