'use client'

import { ConstructionIcon } from 'lucide-react'
import { useTranslations } from 'next-intl'

/**
 * The Editor of a field type whose editing arrives in Stage 2 (date, datetime, range, image, file,
 * availability, reference): a disabled notice. Their Display already works. It never changes the
 * value, so the sheet can open and be cancelled safely.
 */
export function ComingSoonEditor() {
  const t = useTranslations('fields.comingSoon')
  return (
    <div
      className="flex items-start gap-3 rounded-lg border border-dashed bg-muted/40 p-4 text-sm"
      aria-disabled="true"
      data-testid="editor-coming-soon"
    >
      <ConstructionIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
      <div className="grid gap-1">
        <p className="font-medium text-foreground">{t('title')}</p>
        <p className="text-muted-foreground">{t('description')}</p>
      </div>
    </div>
  )
}
