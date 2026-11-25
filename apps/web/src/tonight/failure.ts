'use client'

// The sentence for a write that did not work: `tonight.errors.<code>`, else the general one that
// names the fix (copy-rules: an error says what to do next). Two payment refusals carry what
// happened beside their code: someone answered first (their answer is named, `m_err_answered`) and
// the payment moved on (`m_err_moved`).
import { useTranslations } from 'next-intl'
import { useCallback } from 'react'

import { PAYMENT_ANSWER_WORDS } from './payment-state-words'

export function useFailureText() {
  const t = useTranslations('tonight')
  return useCallback(
    (error: string, retryAfterSeconds?: number, details?: Readonly<Record<string, unknown>>) => {
      const key = `errors.${error}`
      if (error === 'device_waiting') return t(key, { seconds: retryAfterSeconds ?? 60 })
      if (error === 'payment_answered') {
        const code = details?.answer
        const word = typeof code === 'string' ? PAYMENT_ANSWER_WORDS[code] : undefined
        return word === undefined ? t('errors.failed') : t('m_err_answered', { answer: t(word) })
      }
      if (error === 'payment_not_unconfirmed') return t('m_err_moved')
      // The storno was answered first (#222): the second answer is refused, in the same words.
      if (error === 'storno_answered') return t('m_err_answered', { answer: t('st_ok') })
      return t.has(key) ? t(key) : t('errors.failed')
    },
    [t],
  )
}
