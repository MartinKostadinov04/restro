import { useTranslations } from 'next-intl'

import { Skeleton } from '@/components/ui/skeleton'

/**
 * Reservations while it loads: a grey toolbar and grey rows, `aria-busy`, and a "Loading…" line
 * for a screen reader. No spinner and no text over it; the pulse is off under reduced motion.
 */
export function ReservationsSkeleton() {
  const t = useTranslations('reservations')
  return (
    <div className="space-y-4" aria-busy="true" data-testid="reservations-skeleton">
      <p className="sr-only">{t('loading')}</p>
      <Skeleton aria-hidden className="h-11 w-full motion-reduce:animate-none" />
      <div className="space-y-2">
        {Array.from({ length: 5 }, (_, index) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: identical placeholders
          <Skeleton key={index} aria-hidden className="h-16 w-full motion-reduce:animate-none" />
        ))}
      </div>
    </div>
  )
}
