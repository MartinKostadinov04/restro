'use client'

// The list of Settings > Deleted venues (brief CF-18, D76): each deleted venue with the day it was
// deleted (in the venue's country time, Europe/Sofia) and a Restore button. Owners only; the page
// draws it for an owner and the action checks the role again. After a restore the toast says what
// is left to do: link its till again in Integrations if it had one, then publish.
import { useFormatter, useTranslations } from 'next-intl'
import { useState, useTransition } from 'react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { restoreVenueAction } from '@/server/venues-actions'
import type { RestoreVenueError } from '@/server/venues-result'

/** The time zone the deletion date is shown in: the one every venue is created with. */
const DISPLAY_TIME_ZONE = 'Europe/Sofia'

export interface DeletedVenueRow {
  readonly id: string
  readonly name: string
  /** When it was deleted, ISO 8601. */
  readonly deletedAt: string
}

export function DeletedVenuesList({ venues }: { readonly venues: readonly DeletedVenueRow[] }) {
  const t = useTranslations('settings.deletedVenues')
  // Venues restored here leave the list at once, before the page has been read again.
  const [restored, setRestored] = useState<ReadonlySet<string>>(new Set())
  const shown = venues.filter((venue) => !restored.has(venue.id))

  if (shown.length === 0) {
    return (
      <p className="text-sm text-muted-foreground" data-testid="deleted-venues-empty">
        {t('empty.title')}
      </p>
    )
  }

  return (
    <ul className="grid gap-3" aria-label={t('listLabel')} data-testid="deleted-venues-list">
      {shown.map((venue) => (
        <li key={venue.id}>
          <DeletedVenueItem
            venue={venue}
            onRestored={() => setRestored((previous) => new Set(previous).add(venue.id))}
          />
        </li>
      ))}
    </ul>
  )
}

function DeletedVenueItem({
  venue,
  onRestored,
}: {
  readonly venue: DeletedVenueRow
  readonly onRestored: () => void
}) {
  const t = useTranslations('settings.deletedVenues')
  const format = useFormatter()
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<RestoreVenueError | null>(null)

  const when = format.dateTime(new Date(venue.deletedAt), {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: DISPLAY_TIME_ZONE,
  })

  function restore() {
    if (pending) return
    setError(null)
    startTransition(async () => {
      const result = await restoreVenueAction({ venueId: venue.id }).catch(
        () => ({ ok: false, error: 'failed' }) as const,
      )
      if (!result.ok) {
        setError(result.error)
        return
      }
      onRestored()
      const message = t(result.filesQueued ? 'restored' : 'restoredLate', { name: result.name })
      if (result.filesQueued) toast.success(message)
      else toast.warning(message)
    })
  }

  return (
    <Card data-testid="deleted-venue" data-venue-id={venue.id}>
      <CardContent className="flex flex-wrap items-center justify-between gap-3">
        <div className="grid gap-0.5">
          <span className="font-medium" data-testid="deleted-venue-name">
            {venue.name}
          </span>
          <span className="text-sm text-muted-foreground" data-testid="deleted-venue-date">
            {t('deletedOn', { when })}
          </span>
          {error !== null ? (
            <span className="text-sm text-destructive" role="alert" data-testid="restore-error">
              {t(`errors.${error}`)}
            </span>
          ) : null}
        </div>
        <Button
          type="button"
          variant="outline"
          disabled={pending}
          onClick={restore}
          data-testid="restore-venue"
        >
          {pending ? t('restoring') : t('restore')}
        </Button>
      </CardContent>
    </Card>
  )
}
