'use client'

import { useFormatter } from 'next-intl'

/**
 * Formats an instant (ISO text) in the venue's time zone, in the interface language: always the
 * venue's clock, whatever the browser's (CLAUDE.md: time is the venue's time zone). 24-hour.
 */
export function useMoment(timeZone: string): (iso: string | null) => string | null {
  const format = useFormatter()
  return (iso) => {
    if (iso === null) return null
    const date = new Date(iso)
    if (Number.isNaN(date.getTime())) return null
    return format.dateTime(date, {
      dateStyle: 'medium',
      timeStyle: 'short',
      hourCycle: 'h23',
      timeZone,
    })
  }
}
