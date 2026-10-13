'use client'

// "Delete permanently" on a venue in Settings › Deleted venues (brief S3, D83): the dialog an owner
// confirms by typing the venue's name. It says in plain words what goes: the venue's menus, tables
// and codes and every version are erased now instead of on the day the bin would do it; its
// address name is freed; its codes never come back. The dialog only collects and shows; the rules
// are the server action's (`purgeVenueAction`, which checks the owner, that the venue is in the
// bin and the typed name again, and queues the worker's purge job: the web app erases nothing).
// Ported from `delete-venue-dialog.tsx` (the same typed-name pattern). On success the row leaves
// the list at once; "not queued" is a warning, because the daily purge erases the venue anyway.
import { useTranslations } from 'next-intl'
import { type FormEvent, useId, useState, useTransition } from 'react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { purgeVenueAction } from '@/server/venues-actions'
import type { PurgeVenueError } from '@/server/venues-result'

interface PurgeVenueDialogProps {
  readonly open: boolean
  readonly onOpenChange: (open: boolean) => void
  readonly venueId: string
  readonly venueName: string
  /** The day the bin would erase the venue by itself, already formatted for the person. */
  readonly erasedOn: string
  /** Called once the erase is on its way: the row leaves the list. */
  readonly onPurged: () => void
}

export function PurgeVenueDialog(props: PurgeVenueDialogProps) {
  // The form is remounted on every opening so the typed name starts empty.
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      {props.open ? <PurgeVenueForm {...props} /> : null}
    </Dialog>
  )
}

function PurgeVenueForm({
  onOpenChange,
  venueId,
  venueName,
  erasedOn,
  onPurged,
}: PurgeVenueDialogProps) {
  const t = useTranslations('settings.deletedVenues.purgeDialog')
  const formId = useId()
  const [pending, startTransition] = useTransition()
  const [typed, setTyped] = useState('')
  const [error, setError] = useState<PurgeVenueError | null>(null)

  // The server compares the trimmed text with the venue's name; the button waits for the same.
  const matches = typed.trim() === venueName

  function submit(event: FormEvent) {
    event.preventDefault()
    if (!matches || pending) return
    setError(null)
    startTransition(async () => {
      const result = await purgeVenueAction({ venueId, confirmName: typed }).catch(
        () => ({ ok: false, error: 'failed' }) as const,
      )
      if (!result.ok) {
        setError(result.error)
        return
      }
      onOpenChange(false)
      onPurged()
      if (result.queued) toast.success(t('deleted', { name: result.name }))
      else toast.warning(t('deletedLate', { name: result.name, erasedOn }))
    })
  }

  return (
    <DialogContent data-testid="purge-venue-dialog">
      <form onSubmit={submit} className="grid gap-4" noValidate>
        <DialogHeader>
          <DialogTitle>{t('title', { name: venueName })}</DialogTitle>
          <DialogDescription>{t('description', { name: venueName, erasedOn })}</DialogDescription>
        </DialogHeader>

        <ul className="grid list-disc gap-1.5 pl-5 text-sm" data-testid="purge-venue-effects">
          <li>{t('effects.menus')}</li>
          <li>{t('effects.tables')}</li>
          <li>{t('effects.address')}</li>
          <li>{t('effects.kept')}</li>
        </ul>

        <div className="grid gap-1.5">
          <Label htmlFor={`${formId}-confirm`}>{t('confirmLabel', { name: venueName })}</Label>
          <Input
            id={`${formId}-confirm`}
            value={typed}
            onChange={(event) => {
              setTyped(event.target.value)
              setError(null)
            }}
            autoComplete="off"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            autoFocus
            data-testid="purge-venue-confirm-input"
          />
        </div>

        {error !== null ? (
          <p className="text-sm text-destructive" role="alert" data-testid="purge-venue-error">
            {t(`errors.${error}`)}
          </p>
        ) : null}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {t('cancel')}
          </Button>
          <Button
            type="submit"
            variant="destructive"
            disabled={!matches || pending}
            data-testid="purge-venue-confirm"
          >
            {pending ? t('deleting') : t('confirm')}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  )
}
