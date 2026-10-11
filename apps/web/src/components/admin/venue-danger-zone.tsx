'use client'

// The danger zone at the end of a venue's Settings tab (brief CF-18, D76): "Delete venue", for
// owners only. The page draws it only for an owner; the action checks the role again.
import { TriangleAlertIcon } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useState } from 'react'

import { Button } from '@/components/ui/button'

import { DeleteVenueDialog } from './delete-venue-dialog'

interface VenueDangerZoneProps {
  readonly venueId: string
  readonly venueName: string
}

export function VenueDangerZone({ venueId, venueName }: VenueDangerZoneProps) {
  const t = useTranslations('workspace.settings.danger')
  const [open, setOpen] = useState(false)

  return (
    <section
      aria-labelledby="venue-danger-heading"
      className="flex flex-col gap-4 rounded-lg border border-destructive/40 p-4 sm:flex-row sm:items-center sm:justify-between"
      data-testid="venue-danger-zone"
    >
      <div className="grid gap-1">
        <h3
          id="venue-danger-heading"
          className="flex items-center gap-2 text-lg font-medium text-destructive"
        >
          <TriangleAlertIcon aria-hidden className="size-4" />
          {t('title')}
        </h3>
        <p className="text-sm text-muted-foreground">{t('description')}</p>
      </div>
      <Button
        type="button"
        variant="destructive"
        onClick={() => setOpen(true)}
        data-testid="delete-venue-open"
      >
        {t('button')}
      </Button>
      <DeleteVenueDialog
        open={open}
        onOpenChange={setOpen}
        venueId={venueId}
        venueName={venueName}
      />
    </section>
  )
}
