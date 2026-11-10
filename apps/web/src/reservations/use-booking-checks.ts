'use client'

// The booking form's advice, read while it is typed (#328). Debounced, and only the newest answer
// is believed: a slow answer for what she typed a moment ago never replaces the one for what she
// has now. A read that fails leaves the last advice on screen — the warnings never block a save,
// so losing them is quiet, and the write path decides again whatever they said.
import { useEffect, useRef, useState } from 'react'

import { bookingChecksAction } from '@/server/reservations/actions'
import type { RvChecksView } from '@/server/reservations/view'

const WAIT_MS = 350
const HOUR = /^([01]\d|2[0-3]):[0-5]\d$/

/** What the advice is asked about. */
export interface BookingChecksQuery {
  readonly venueId: string
  readonly day: string
  readonly time: string
  readonly until: string
  readonly partySize: number | null
  readonly name: string
  readonly phone: string
  readonly spotIds: readonly string[]
  /** The booking being changed: never in the way of itself, never a duplicate of itself. */
  readonly reservationId?: string
}

export function useBookingChecks(query: BookingChecksQuery, enabled = true): RvChecksView | null {
  const [checks, setChecks] = useState<RvChecksView | null>(null)
  const generation = useRef(0)
  const { venueId, day, time, until, partySize, name, phone, reservationId } = query
  const spotKey = query.spotIds.join(',')

  useEffect(() => {
    if (!enabled || !HOUR.test(time) || (until !== '' && !HOUR.test(until))) return
    const mine = ++generation.current
    const timer = window.setTimeout(() => {
      void bookingChecksAction({
        venueId,
        day,
        time,
        until: until === '' ? null : until,
        partySize,
        name: name.trim() === '' ? null : name.trim(),
        phone: phone.trim() === '' ? null : phone.trim(),
        spotIds: spotKey === '' ? [] : spotKey.split(','),
        ...(reservationId === undefined ? {} : { reservationId }),
      })
        .then((answer) => {
          if (mine === generation.current && answer.ok) setChecks(answer.checks)
        })
        .catch(() => {
          // Advice that did not come is advice not given: Save still works.
        })
    }, WAIT_MS)
    return () => window.clearTimeout(timer)
  }, [enabled, venueId, day, time, until, partySize, name, phone, spotKey, reservationId])

  return checks
}
