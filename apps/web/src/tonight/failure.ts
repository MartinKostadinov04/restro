'use client'

// The sentence for a write that did not work: `tonight.errors.<code>`, else the general one that
// names the fix (copy-rules: an error says what to do next).
import { useTranslations } from 'next-intl'
import { useCallback } from 'react'

export function useFailureText() {
  const t = useTranslations('tonight')
  return useCallback(
    (error: string, retryAfterSeconds?: number) => {
      const key = `errors.${error}`
      if (error === 'device_waiting') return t(key, { seconds: retryAfterSeconds ?? 60 })
      return t.has(key) ? t(key) : t('errors.failed')
    },
    [t],
  )
}
