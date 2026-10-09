'use client'

import { useEffect, useRef } from 'react'

import type { ActiveJob } from '@/server/integration/view'

/**
 * Calls `clear` when a job that was queued or running has finished (`activeJob` went from a job to
 * null): the "…is queued" notice under a button is about that job and goes away with it.
 */
export function useClearWhenIdle(activeJob: ActiveJob, clear: () => void): void {
  const seenActive = useRef(false)
  const latest = useRef(clear)
  latest.current = clear
  useEffect(() => {
    if (activeJob !== null) {
      seenActive.current = true
    } else if (seenActive.current) {
      seenActive.current = false
      latest.current()
    }
  }, [activeJob])
}
