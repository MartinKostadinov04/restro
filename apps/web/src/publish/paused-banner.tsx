'use client'

// After a return to an older version, automatic publishing is paused (the next sync would publish
// the draft and undo the return). The banner says so and what ends it: a manual publish.
import { PauseCircleIcon } from 'lucide-react'
import { useTranslations } from 'next-intl'

export function PausedBanner() {
  const t = useTranslations('publish.paused')
  return (
    <section
      aria-labelledby="paused-title"
      className="flex items-start gap-3 rounded-lg border border-warning/40 bg-warning/10 p-4"
      data-testid="paused-banner"
    >
      <PauseCircleIcon aria-hidden className="mt-0.5 size-5 shrink-0 text-warning" />
      <div className="grid gap-1">
        <h3 id="paused-title" className="font-medium">
          {t('title')}
        </h3>
        <p className="text-sm text-muted-foreground">{t('text')}</p>
      </div>
    </section>
  )
}
