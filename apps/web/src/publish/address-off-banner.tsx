'use client'

// A venue that was unpublished (D86), or deleted and restored (D76), has a published menu but no
// guest address: the worker took the venue index out, and only a publish puts it back. The banner
// says guests see "not available" and what ends it: Publish, which stays on even when the menu is
// the same as the live one.
import { WifiOffIcon } from 'lucide-react'
import { useTranslations } from 'next-intl'

export function AddressOffBanner() {
  const t = useTranslations('publish.addressOff')
  return (
    <section
      aria-labelledby="address-off-title"
      className="flex items-start gap-3 rounded-lg border border-warning/40 bg-warning/10 p-4"
      data-testid="address-off-banner"
    >
      <WifiOffIcon aria-hidden className="mt-0.5 size-5 shrink-0 text-warning" />
      <div className="grid gap-1">
        <h3 id="address-off-title" className="font-medium">
          {t('title')}
        </h3>
        <p className="text-sm text-muted-foreground">{t('text')}</p>
      </div>
    </section>
  )
}
