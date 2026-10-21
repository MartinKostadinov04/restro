import { ArrowRightIcon, ExternalLinkIcon } from 'lucide-react'
import Link from 'next/link'
import { useTranslations } from 'next-intl'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import type { VenueCard as VenueCardData } from '@/server/venues-result'

import { UnpublishVenueButton } from './unpublish-venue-dialog'

/**
 * One venue in the All venues grid (D86). Ported from the Platform's schema cards
 * (Sku/Index.jsx 91-125: name, a mono chip with the identifier, a body line, buttons) and its
 * status badge (`ui/badge.jsx`: one variant per state, here Restro's `success` and `secondary`).
 * It shows the venue's name and state (Draft or Live), its guest address, where its menu comes
 * from (the POS instance, or "By hand") and its name in that POS, and the buttons: "Open" (the
 * admin), "Preview menu" (the guest address in a new tab; off, with the reason, for a Draft) and,
 * for a live venue, "Unpublish…" to owners and admins.
 */
export function VenueCard({
  venue,
  canManage,
}: {
  readonly venue: VenueCardData
  /** Owners and admins may unpublish a venue (the action checks the role again). */
  readonly canManage: boolean
}) {
  const t = useTranslations('venues')
  const live = venue.state === 'live'
  const previewPath = live ? venue.guestPath : null
  const source = venue.instanceName
  return (
    <Card
      data-testid="venue-card"
      data-state={venue.state}
      className="transition-shadow hover:shadow-md"
    >
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <CardTitle className="text-base">{venue.name}</CardTitle>
          <Badge variant={live ? 'success' : 'secondary'} data-testid="venue-card-state">
            {t(`state.${venue.state}`)}
          </Badge>
        </div>
        {venue.guestPath === null ? null : (
          <code
            className="w-fit max-w-full break-all rounded-md bg-muted px-2 py-1 font-mono text-xs text-muted-foreground ring-1 ring-border"
            data-testid="venue-card-address"
          >
            {venue.guestPath}
          </code>
        )}
      </CardHeader>
      <CardContent>
        <dl className="grid gap-1 text-sm">
          <div className="flex flex-wrap gap-x-2">
            <dt className="text-muted-foreground">{t('source')}</dt>
            <dd data-testid="venue-card-source">{source ?? t('byHand')}</dd>
          </div>
          {source !== null && venue.tillVenueName !== null ? (
            <div className="flex flex-wrap gap-x-2">
              <dt className="text-muted-foreground">{t('venueIn', { source })}</dt>
              <dd data-testid="venue-card-till-venue">{venue.tillVenueName}</dd>
            </div>
          ) : null}
        </dl>
      </CardContent>
      <CardFooter className="flex flex-wrap items-center gap-2">
        <Button asChild variant="outline">
          <Link href={`/venues/${venue.id}`}>
            {t('open')}
            <ArrowRightIcon aria-hidden />
          </Link>
        </Button>
        {previewPath === null ? (
          <Button
            type="button"
            variant="outline"
            disabled
            aria-describedby={`${venue.id}-preview-hint`}
            data-testid="venue-card-preview"
          >
            {t('preview')}
            <ExternalLinkIcon aria-hidden />
          </Button>
        ) : (
          <Button asChild variant="outline">
            <a
              href={previewPath}
              target="_blank"
              rel="noopener noreferrer"
              data-testid="venue-card-preview"
            >
              {t('preview')}
              <ExternalLinkIcon aria-hidden />
            </a>
          </Button>
        )}
        {canManage && live ? (
          <UnpublishVenueButton venueId={venue.id} venueName={venue.name} />
        ) : null}
        {previewPath === null ? (
          <p
            id={`${venue.id}-preview-hint`}
            className="basis-full text-xs text-muted-foreground"
            data-testid="venue-card-preview-hint"
          >
            {t('previewDraft')}
          </p>
        ) : null}
      </CardFooter>
    </Card>
  )
}
