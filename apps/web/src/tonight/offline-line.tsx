'use client'

// The one calm line a Tonight screen shows while the connection is down (RR-88): the screen stays
// as it was, and says when that was. It goes by itself when the next check gets an answer.
import { useTranslations } from 'next-intl'

/** `HH:mm` of an instant in the venue's own time zone, whatever the device's zone is. */
export function clockAt(iso: string, timezone: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZone: timezone,
  }).format(new Date(iso))
}

/** "No connection. This is how things stood at {time}. It refreshes by itself." Nothing while online. */
export function OfflineLine({
  offline,
  stoodAt,
  timezone,
}: {
  offline: boolean
  /** When the data on screen was read (ISO). */
  stoodAt: string
  timezone: string
}) {
  const t = useTranslations('tonight')
  if (!offline) return null
  return (
    <p
      role="status"
      className="rounded-lg border bg-muted p-3 text-sm text-muted-foreground [overflow-wrap:anywhere]"
      data-testid="offline-line"
    >
      {t('offline', { time: clockAt(stoodAt, timezone) })}
    </p>
  )
}
