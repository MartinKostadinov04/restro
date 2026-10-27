'use client'

// Who did a step, worded (Log plan §5 "Who did it"): a person's name, Restro, or a guest's phone,
// with " · via Telegram" when the answer came from Telegram.
import { useTranslations } from 'next-intl'

import type { WhoView } from '@/server/tonight/night-view'

export function useWho() {
  const t = useTranslations('tonight')
  return (by: WhoView): string => {
    const name =
      by.who.kind === 'person'
        ? by.who.name
        : by.who.kind === 'guest'
          ? t('lg_guest')
          : t('lg_restro')
    return by.telegram ? t('lg_via_tg', { who: name }) : name
  }
}
