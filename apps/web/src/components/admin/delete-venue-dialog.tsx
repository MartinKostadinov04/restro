'use client'

// "Delete venue" (brief CF-18, D76): the dialog an owner confirms by typing the venue's name. It
// says in plain words what happens (the venue leaves the admin, its guest page and QR codes stop
// working, its till link is released, nothing is erased, it can be restored from Settings >
// Deleted venues). The dialog only collects and shows; the rules are the server action's
// (`deleteVenueAction`, which checks the owner and the typed name again). On success it opens the
// venue list, and the toast carries a link to the list a venue is restored from.
import { useRouter } from 'next/navigation'
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
import { deleteVenueAction } from '@/server/venues-actions'
import type { DeleteVenueError } from '@/server/venues-result'

const VENUES_PATH = '/venues'
const DELETED_VENUES_PATH = '/settings/deleted-venues'

interface DeleteVenueDialogProps {
  readonly open: boolean
  readonly onOpenChange: (open: boolean) => void
  readonly venueId: string
  readonly venueName: string
}

export function DeleteVenueDialog(props: DeleteVenueDialogProps) {
  // The form is remounted on every opening so the typed name starts empty.
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      {props.open ? <DeleteVenueForm {...props} /> : null}
    </Dialog>
  )
}

function DeleteVenueForm({ onOpenChange, venueId, venueName }: DeleteVenueDialogProps) {
  const t = useTranslations('workspace.settings.danger.dialog')
  const router = useRouter()
  const formId = useId()
  const [pending, startTransition] = useTransition()
  const [typed, setTyped] = useState('')
  const [error, setError] = useState<DeleteVenueError | null>(null)

  // The server compares the trimmed text with the venue's name; the button waits for the same.
  const matches = typed.trim() === venueName

  function submit(event: FormEvent) {
    event.preventDefault()
    if (!matches || pending) return
    setError(null)
    startTransition(async () => {
      const result = await deleteVenueAction({ venueId, confirmName: typed }).catch(
        () => ({ ok: false, error: 'failed' }) as const,
      )
      if (!result.ok) {
        setError(result.error)
        return
      }
      onOpenChange(false)
      const action = {
        label: t('seeDeleted'),
        onClick: () => router.push(DELETED_VENUES_PATH),
      }
      if (result.filesQueued) toast.success(t('deleted', { name: venueName }), { action })
      else toast.warning(t('deletedLate', { name: venueName }), { action })
      router.push(VENUES_PATH)
    })
  }

  return (
    <DialogContent data-testid="delete-venue-dialog">
      <form onSubmit={submit} className="grid gap-4" noValidate>
        <DialogHeader>
          <DialogTitle>{t('title', { name: venueName })}</DialogTitle>
          <DialogDescription>{t('description')}</DialogDescription>
        </DialogHeader>

        <ul className="grid list-disc gap-1.5 pl-5 text-sm" data-testid="delete-venue-effects">
          <li>{t('effects.admin')}</li>
          <li>{t('effects.guests')}</li>
          <li>{t('effects.till')}</li>
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
            data-testid="delete-venue-confirm-input"
          />
        </div>

        {error !== null ? (
          <p className="text-sm text-destructive" role="alert" data-testid="delete-venue-error">
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
            data-testid="delete-venue-confirm"
          >
            {pending ? t('deleting') : t('confirm')}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  )
}
