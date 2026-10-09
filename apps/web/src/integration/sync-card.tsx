'use client'

// "Sync now": queues a full pull of this venue. The button is off, with the reason written next
// to it, until the integration is connected and both pickers are set, and while a pull is
// queued or running (the queue is exclusive per integration, so a second press would do
// nothing). The server checks the same rule again; this only explains it.
import { RefreshCwIcon } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useState, useTransition } from 'react'

import { Button } from '@/components/ui/button'
import { FormSection } from '@/components/ui/form-section'
import { syncNowAction } from '@/server/integration/actions'
import type { IntegrationErrorCode, IntegrationView } from '@/server/integration/view'

import { ErrorNote, Notice } from './error-note'
import { useMoment } from './use-moment'

export function SyncCard({ venueId, view }: { venueId: string; view: IntegrationView }) {
  const t = useTranslations('integration.sync')
  const moment = useMoment(view.timeZone)
  const [error, setError] = useState<IntegrationErrorCode | null>(null)
  const [queued, setQueued] = useState(false)
  const [pending, startTransition] = useTransition()
  const { gate } = view
  const lastSynced = moment(view.lastSyncedAt)

  function press() {
    setError(null)
    setQueued(false)
    startTransition(async () => {
      const result = await syncNowAction({ venueId })
      if (result.ok) setQueued(true)
      else setError(result.error)
    })
  }

  return (
    <FormSection title={t('title')} description={t('description')}>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" onClick={press} disabled={!gate.enabled || pending}>
          <RefreshCwIcon aria-hidden className={pending ? 'animate-spin' : undefined} />
          {pending ? t('starting') : t('button')}
        </Button>
        {!gate.enabled ? (
          <p className="text-sm text-muted-foreground" data-testid="sync-blocked">
            {t(`blocked.${gate.reason}`)}
          </p>
        ) : null}
      </div>
      <p className="text-sm text-muted-foreground" data-testid="sync-last">
        {lastSynced ? t('lastSynced', { when: lastSynced }) : t('neverSynced')}
      </p>
      {queued ? <Notice>{t('queued')}</Notice> : null}
      <ErrorNote code={error} />
    </FormSection>
  )
}
