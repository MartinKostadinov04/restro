'use client'

// When a Publish button is off, and why in words. The rule is one pure function shared by the
// server's summary and every button (view.ts `publishBlock`), so they agree; this file words it.
import { useTranslations } from 'next-intl'

import type { PublishBlock, RefusalCode } from '@/server/publish/view'

export { publishBlock, targetOf } from '@/server/publish/view'

/** The words for why a button is off: the role, the draft's refusal, or nothing new. */
export function useBlockReason(): (block: PublishBlock, refusal: RefusalCode | null) => string {
  const t = useTranslations('publish.bar.reason')
  return (block, refusal) => {
    if (block === 'role') return t('role')
    if (block === 'busy') return t('busy')
    if (block === 'up_to_date') return t('up_to_date')
    return t(refusal ?? 'other')
  }
}
