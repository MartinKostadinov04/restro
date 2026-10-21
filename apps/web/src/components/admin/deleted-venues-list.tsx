'use client'

// The list of Settings > Deleted venues (brief CF-18 and S3, D76, D83): each deleted venue with the
// day it was deleted and the day the bin erases it (in the venue's country time, Europe/Sofia),
// a Restore button and a "Delete permanently" button that erases it now after its name is typed
// (`purge-venue-dialog.tsx`). Owners only; the page draws it for an owner and the actions check
// the role again. After a restore the toast says what is left to do: link its till again in
// Integrations if it had one, then publish.
import { VENUE_BIN_DAYS } from '@restro/core'
import { useFormatter, useTranslations } from 'next-intl'
import { useState, useTransition } from 'react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { restoreVenueAction } from '@/server/venues-actions'
import type { RestoreVenueError, RestoreVenueResult } from '@/server/venues-result'

import { PurgeVenueDialog } from './purge-venue-dialog'

/** The time zone the deletion date is shown in: the one every venue is created with. */
const DISPLAY_TIME_ZONE = 'Europe/Sofia'

const DAY_MS = 24 * 60 * 60 * 1000

export interface DeletedVenueRow {
  readonly id: string
  readonly name: string
  /** When it was deleted, ISO 8601. */
  readonly deletedAt: string
}

export function DeletedVenuesList({ venues }: { readonly venues: readonly DeletedVenueRow[] }) {
  const t = useTranslations('settings.deletedVenues')
  // Venues restored or erased here leave the list at once, before the page has been read again
  // (an erased one is still a row until the worker's purge job has run).
  const [gone, setGone] = useState<ReadonlySet<string>>(new Set())
  const shown = venues.filter((venue) => !gone.has(venue.id))

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
            onGone={() => setGone((previous) => new Set(previous).add(venue.id))}
          />
        </li>
      ))}
    </ul>
  )
}

function DeletedVenueItem({
  venue,
  onGone,
}: {
  readonly venue: DeletedVenueRow
  /** The venue was restored or is being erased: the row leaves the list. */
  readonly onGone: () => void
}) {
  const t = useTranslations('settings.deletedVenues')
  const format = useFormatter()
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<{
    readonly error: RestoreVenueError
    readonly holder?: string
  } | null>(null)

  const [purgeOpen, setPurgeOpen] = useState(false)

  const deletedAt = new Date(venue.deletedAt)
  const when = format.dateTime(deletedAt, {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: DISPLAY_TIME_ZONE,
  })
  // The day the daily purge erases it (it runs once a day, so within that day).
  const erasedOn = format.dateTime(new Date(deletedAt.getTime() + VENUE_BIN_DAYS * DAY_MS), {
    dateStyle: 'medium',
    timeZone: DISPLAY_TIME_ZONE,
  })

  function restore() {
    if (pending) return
    setError(null)
    startTransition(async () => {
      const result: RestoreVenueResult = await restoreVenueAction({ venueId: venue.id }).catch(
        () => ({ ok: false, error: 'failed' }) as const,
      )
      if (!result.ok) {
        setError({ error: result.error, holder: result.holder })
        return
      }
      onGone()
      toast.success(t(result.relinked ? 'restoredLinked' : 'restored', { name: result.name }))
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
            {t('dates', { when, erasedOn })}
          </span>
          {error !== null ? (
            <span className="text-sm text-destructive" role="alert" data-testid="restore-error">
              {t(`errors.${error.error}`, { holder: error.holder ?? '' })}
            </span>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="outline"
            disabled={pending}
            onClick={restore}
            data-testid="restore-venue"
          >
            {pending ? t('restoring') : t('restore')}
          </Button>
          <Button
            type="button"
            variant="outline"
            className="text-destructive hover:text-destructive"
            disabled={pending}
            onClick={() => setPurgeOpen(true)}
            data-testid="purge-venue-open"
          >
            {t('purge')}
          </Button>
        </div>
      </CardContent>
      <PurgeVenueDialog
        open={purgeOpen}
        onOpenChange={setPurgeOpen}
        venueId={venue.id}
        venueName={venue.name}
        erasedOn={erasedOn}
        onPurged={onGone}
      />
    </Card>
  )
}
