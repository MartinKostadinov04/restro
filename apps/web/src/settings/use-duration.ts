'use client'

// "45 min", "2 h", "1 h 30 min" in the admin's language (the Hours and Ordering screens, #87).
import { useTranslations } from 'next-intl'

import { durationParts } from './hours'

export function useDuration(): (minutes: number) => string {
  const t = useTranslations('ownerSettings')
  return (minutes) => {
    const { hours, minutes: rest } = durationParts(minutes)
    if (hours === 0) return t('st_min', { n: rest })
    if (rest === 0) return t('st_h', { n: hours })
    return t('st_h_min', { h: hours, m: rest })
  }
}
