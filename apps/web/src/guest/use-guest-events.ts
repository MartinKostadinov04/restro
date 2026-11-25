'use client'

// Binds the events client (./events-client.ts) to the guest page: one reporter per table code, which
// sends what is queued when the page hides or goes away. A page with no confirmed table reports
// nothing — an event belongs to a table, and a menu opened from a link is nobody's seat.

import { useCallback, useEffect, useMemo } from 'react'

import { createEventsReporter, type GuestEventFact } from './events-client'

export type ReportGuestEvent = (fact: GuestEventFact) => void

export function useGuestEvents(code: string | null): ReportGuestEvent {
  const reporter = useMemo(
    () =>
      code === null
        ? null
        : createEventsReporter({
            code,
            fetch: (url, init) => fetch(url, init),
            now: () => Date.now(),
          }),
    [code],
  )

  useEffect(() => {
    if (reporter === null) return
    const onHidden = () => {
      if (document.visibilityState === 'hidden') void reporter.flush()
    }
    const onLeaving = () => void reporter.flush()
    document.addEventListener('visibilitychange', onHidden)
    window.addEventListener('pagehide', onLeaving)
    return () => {
      document.removeEventListener('visibilitychange', onHidden)
      window.removeEventListener('pagehide', onLeaving)
      reporter.stop()
      void reporter.flush()
    }
  }, [reporter])

  return useCallback(
    (fact: GuestEventFact) => {
      reporter?.report(fact)
    },
    [reporter],
  )
}
