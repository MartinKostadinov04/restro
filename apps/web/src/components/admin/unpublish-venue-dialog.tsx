'use client'

// "Unpublish" (D86): takes a venue off guests' phones. The button sits on the venue's card (owners
// and admins, live venues only); the dialog says in plain words what guests will see and what
// stays, then asks once. The dialog only collects and shows; the rules are the server action's
// (`unpublishVenueAction`, which checks the role and the venue again). On success the venue is a
// Draft: the action revalidates the admin, so the card shows it.
import { useTranslations } from 'next-intl'
import { useState, useTransition } from 'react'
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
import { unpublishVenueAction } from '@/server/venues-actions'
import type { UnpublishVenueError } from '@/server/venues-result'

interface UnpublishVenueProps {
  readonly venueId: string
  readonly venueName: string
}

/** The "Unpublish…" button with its confirmation. */
export function UnpublishVenueButton({ venueId, venueName }: UnpublishVenueProps) {
  const t = useTranslations('venues.unpublish')
  const [open, setOpen] = useState(false)
  return (
    <>
      <Button
        type="button"
        variant="outline"
        onClick={() => setOpen(true)}
        data-testid="unpublish-venue-open"
      >
        {t('button')}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        {open ? (
          <UnpublishVenueForm
            venueId={venueId}
            venueName={venueName}
            onClose={() => setOpen(false)}
          />
        ) : null}
      </Dialog>
    </>
  )
}

function UnpublishVenueForm({
  venueId,
  venueName,
  onClose,
}: UnpublishVenueProps & { readonly onClose: () => void }) {
  const t = useTranslations('venues.unpublish.dialog')
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<UnpublishVenueError | null>(null)

  function confirm() {
    if (pending) return
    setError(null)
    startTransition(async () => {
      const result = await unpublishVenueAction({ venueId }).catch(
        () => ({ ok: false, error: 'failed' }) as const,
      )
      if (!result.ok) {
        setError(result.error)
        return
      }
      onClose()
      if (result.filesQueued) toast.success(t('done', { name: result.name }))
      else toast.warning(t('doneLate', { name: result.name }))
    })
  }

  return (
    <DialogContent data-testid="unpublish-venue-dialog">
      <DialogHeader>
        <DialogTitle>{t('title', { name: venueName })}</DialogTitle>
        <DialogDescription>{t('description')}</DialogDescription>
      </DialogHeader>

      <ul className="grid list-disc gap-1.5 pl-5 text-sm" data-testid="unpublish-venue-effects">
        <li>{t('effects.guests')}</li>
        <li>{t('effects.draft')}</li>
        <li>{t('effects.again')}</li>
      </ul>

      {error !== null ? (
        <p className="text-sm text-destructive" role="alert" data-testid="unpublish-venue-error">
          {t(`errors.${error}`)}
        </p>
      ) : null}

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose} disabled={pending}>
          {t('cancel')}
        </Button>
        <Button
          type="button"
          variant="destructive"
          onClick={confirm}
          disabled={pending}
          data-testid="unpublish-venue-confirm"
        >
          {pending ? t('working') : t('confirm')}
        </Button>
      </DialogFooter>
    </DialogContent>
  )
}
