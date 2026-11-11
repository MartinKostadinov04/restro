'use client'

// The "Done" form of the simulated provider's stand-in page (#398). A press tells the worker the
// owner finished and the action sends the browser back to the Paying settings; if it could not, the
// form says why, in the owner's language.
import { useTranslations } from 'next-intl'
import { useActionState } from 'react'
import { Button } from '@/components/ui/button'
import { finishSimPayFormAction } from './onboarding-actions'

const WORDED = ['not_connecting', 'not_simulated', 'account_mismatch', 'payments_off'] as const

export function SimPayOnboardingForm({
  accountRef,
  venueId,
  returnUrl,
  refreshUrl,
}: {
  accountRef: string
  venueId: string
  returnUrl: string
  refreshUrl: string
}) {
  const t = useTranslations('simPayOnboarding')
  const [answer, act, pending] = useActionState(finishSimPayFormAction, null)
  const problem = answer === null ? null : answer.error
  const worded = (WORDED as readonly string[]).includes(problem ?? '') ? problem : 'failed'

  return (
    <form action={act} className="flex flex-col gap-3">
      <input type="hidden" name="ref" value={accountRef} />
      <input type="hidden" name="venue" value={venueId} />
      <input type="hidden" name="return" value={returnUrl} />
      <input type="hidden" name="refresh" value={refreshUrl} />
      {problem !== null && (
        <p
          role="alert"
          data-testid="sim-pay-problem"
          className="rounded-md border border-destructive/40 p-3 text-sm text-destructive"
        >
          {t(`problems.${worded as 'failed'}`)}
        </p>
      )}
      <Button type="submit" disabled={pending} data-testid="sim-pay-done" className="w-fit">
        {t('done')}
      </Button>
    </form>
  )
}
