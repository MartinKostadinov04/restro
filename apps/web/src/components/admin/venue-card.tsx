import type { Venue } from '@restro/db'
import { ArrowRightIcon } from 'lucide-react'
import Link from 'next/link'
import { getTranslations } from 'next-intl/server'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'

/** `bg_BG` → `BG`: the short chip for a document language. */
function languageChip(locale: string): string {
  return (locale.split('_')[0] ?? locale).toUpperCase()
}

/**
 * One venue in the grid. Ported from the Platform's schema cards (Sku/Index.jsx 91-125): name,
 * a mono chip with the identifier, a body line, and one button. Restro's cards show the slug,
 * the languages of the venue, and "Open".
 */
export async function VenueCard({ venue }: { venue: Venue }) {
  const t = await getTranslations('venues')
  return (
    <Card data-testid="venue-card" className="transition-shadow hover:shadow-md">
      <CardHeader>
        <CardTitle className="text-base">{venue.name}</CardTitle>
        <code className="w-fit rounded-md bg-muted px-2 py-1 font-mono text-xs text-muted-foreground ring-1 ring-border">
          #{venue.slug}
        </code>
      </CardHeader>
      <CardContent className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
        <span>{t('languages')}</span>
        {venue.enabledLocales.map((locale) => (
          <Badge key={locale} variant={locale === venue.defaultLocale ? 'default' : 'secondary'}>
            {languageChip(locale)}
          </Badge>
        ))}
      </CardContent>
      <CardFooter>
        <Button asChild variant="outline">
          <Link href={`/venues/${venue.id}`}>
            {t('open')}
            <ArrowRightIcon aria-hidden />
          </Link>
        </Button>
      </CardFooter>
    </Card>
  )
}
