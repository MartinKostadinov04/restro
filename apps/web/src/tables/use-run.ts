'use client'

// Runs one of the tab's server actions the same way everywhere (briefs S3-07, S5): the control is
// disabled while it works, a refusal shows its sentence, a success shows `done` (when there is
// one), and a change that is saved but whose public file could not be queued says so. A code
// change after 15 minutes asks for the password, then runs again (D122 §7): render `dialog`.
import { useTranslations } from 'next-intl'
import { useCallback, useTransition } from 'react'
import { toast } from 'sonner'

import type { TablesActionResult } from '@/server/tables/view'
import { useSignInAgain } from '@/settings/use-settings-run'

import { useFailureText } from './use-failure-text'

export function useRun() {
  const t = useTranslations('tables')
  const failureText = useFailureText()
  const [pending, startTransition] = useTransition()
  const { ask, dialog } = useSignInAgain()
  const run = useCallback(
    function go(
      action: () => Promise<TablesActionResult>,
      done: string | null,
      after?: (ok: boolean) => void,
    ) {
      startTransition(async () => {
        const result = await action()
        after?.(result.ok)
        if (!result.ok) {
          if (result.error === 'sign_in_again') {
            ask(() => go(action, done, after))
            return
          }
          toast.error(failureText(result))
          return
        }
        if (done !== null) toast.success(done)
        if (!result.queued) toast.warning(t('queuedLate'))
      })
    },
    [failureText, t, ask],
  )
  return { pending, run, dialog }
}
