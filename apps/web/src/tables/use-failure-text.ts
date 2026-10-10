'use client'

// The sentence for an action that did not work (brief S3-07): a refused address says what is wrong
// with it (`problems.*`), anything else says why in general (`errors.*`).
import { QR_TOKEN_PLACEHOLDER } from '@restro/core'
import { useTranslations } from 'next-intl'
import { useCallback } from 'react'

import type { TablesActionResult } from '@/server/tables/view'

type Failure = Extract<TablesActionResult, { ok: false }>

export function useFailureText(): (failure: Failure) => string {
  const t = useTranslations('tables')
  return useCallback(
    (failure) =>
      failure.problem === undefined
        ? t(`errors.${failure.error}`)
        : t(`problems.${failure.problem}`, { placeholder: QR_TOKEN_PLACEHOLDER }),
    [t],
  )
}
