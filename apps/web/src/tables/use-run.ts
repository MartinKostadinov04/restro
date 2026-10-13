'use client'

// Runs one of the tab's server actions the same way everywhere (briefs S3-07, S5): the control is
// disabled while it works, a refusal shows its sentence, a success shows `done` (when there is
// one), and a change that is saved but whose public file could not be queued says so.
import { useTranslations } from 'next-intl'
import { useCallback, useTransition } from 'react'
import { toast } from 'sonner'

import type { TablesActionResult } from '@/server/tables/view'

import { useFailureText } from './use-failure-text'

export function useRun() {
  const t = useTranslations('tables')
  const failureText = useFailureText()
  const [pending, startTransition] = useTransition()
  const run = useCallback(
    (
      action: () => Promise<TablesActionResult>,
      done: string | null,
      after?: (ok: boolean) => void,
    ) => {
      startTransition(async () => {
        const result = await action()
        after?.(result.ok)
        if (!result.ok) {
          toast.error(failureText(result))
          return
        }
        if (done !== null) toast.success(done)
        if (!result.queued) toast.warning(t('queuedLate'))
      })
    },
    [failureText, t],
  )
  return { pending, run }
}
