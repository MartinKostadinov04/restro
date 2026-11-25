import { useTranslations } from 'next-intl'

import { Skeleton } from '@/components/ui/skeleton'

/**
 * Tonight while it loads (plan §5): two grey blocks, rows and tiles, `aria-busy`, and a "Loading…"
 * line for a screen reader. No spinner and no text over it; the pulse is off under reduced motion.
 */
export function TonightSkeleton() {
  const t = useTranslations('tonight')
  return (
    <div
      className="grid gap-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]"
      aria-busy="true"
      data-testid="tonight-skeleton"
    >
      <p className="sr-only">{t('loading')}</p>
      <Skeleton aria-hidden className="h-64 w-full motion-reduce:animate-none" />
      <Skeleton aria-hidden className="h-64 w-full motion-reduce:animate-none" />
    </div>
  )
}
