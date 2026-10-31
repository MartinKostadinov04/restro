'use client'

import { useTimedRefresh } from '@/hooks/use-timed-refresh'

/** How often the tab asks the server for fresh data while a job is queued or running. */
export const REFRESH_INTERVAL_MS = 3000

/**
 * Refreshes the page's server data about every 3 seconds while `active` (a connection check or a
 * full pull is queued or running), and stops by itself when the server says it is not any more:
 * the page re-renders with `active` false, which clears the timer. Draws nothing.
 */
export function LiveRefresh({ active }: { active: boolean }) {
  // Offline it does not refresh (RR-88): the page would be replaced by the browser's own.
  useTimedRefresh({ every: REFRESH_INTERVAL_MS, enabled: active })
  return null
}
