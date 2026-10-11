'use client'

// The Synchronisation card: "Sync now" queues a full pull of this venue (the sync settings form is
// below it). The button is off, with the reason written next
// to it, until the integration is connected and both pickers are set, and while a pull is
// queued or running (the queue is exclusive per integration, so a second press would do
// nothing). The server checks the same rule again; this only explains it. When the latest
// complete full pull was held back (it found nothing, or far fewer items than the menu has, and
// hid nothing), a warning on top says so and what to check; there is no button to release it yet.
import { AlertTriangleIcon, RefreshCwIcon } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useState, useTransition } from 'react'

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { FormSection } from '@/components/ui/form-section'
import { syncNowAction } from '@/server/integration/actions'
import type { IntegrationErrorCode, IntegrationView } from '@/server/integration/view'

import { ErrorNote, Notice } from './error-note'
import { SyncSettingsForm } from './sync-settings-form'
import { useClearWhenIdle } from './use-clear-when-idle'
import { useMoment } from './use-moment'

export function SyncCard({ venueId, view }: { venueId: string; view: IntegrationView }) {
  const t = useTranslations('integration.sync')
  const moment = useMoment(view.timeZone)
  const [error, setError] = useState<IntegrationErrorCode | null>(null)
  const [queued, setQueued] = useState(false)
  const [pending, startTransition] = useTransition()
  useClearWhenIdle(view.activeJob, () => setQueued(false))
  const { gate, heldSync: held } = view
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
      {held ? (
        <Alert
          className="border-warning/40 [&>svg]:text-warning"
          data-testid="sync-held"
          data-reason={held.reason}
        >
          <AlertTriangleIcon aria-hidden />
          <AlertTitle>{t('held.title')}</AlertTitle>
          <AlertDescription>
            {t(`held.${held.reason}`, { wouldHide: held.wouldHide, active: held.active })}
          </AlertDescription>
        </Alert>
      ) : null}
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
      <SyncSettingsForm venueId={venueId} view={view} />
    </FormSection>
  )
}
