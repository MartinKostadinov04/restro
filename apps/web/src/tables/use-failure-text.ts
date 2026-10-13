'use client'

// The sentence for an action that did not work (briefs S3-07, S5): `errors.*`, with the till's name
// where the sentence names it (`{source}`).
import { useTranslations } from 'next-intl'
import { useCallback } from 'react'

import { useTillLabel } from '@/fields/till-label'
import type { TablesActionResult } from '@/server/tables/view'

type Failure = Extract<TablesActionResult, { ok: false }>

export function useFailureText(): (failure: Failure) => string {
  const t = useTranslations('tables')
  const source = useTillLabel()
  return useCallback((failure) => t(`errors.${failure.error}`, { source }), [t, source])
}
