'use client'

// The Automatic sync card (D73): when the till is read by itself (the settings form below) and
// "Sync everything now", which queues a full pull of every linked venue that has a menu category.
// The button is off, with the reason written next to it, until the integration is connected and a
// linked venue has its menu category, and while a connection check or a pull is queued or running.
// The server checks the same rule again; this only explains it. The pulls then run one after the
// other (one pull at a time per installation).
import { RefreshCwIcon } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useState, useTransition } from 'react'

import { Button } from '@/components/ui/button'
import { FormSection } from '@/components/ui/form-section'
import { syncAllAction } from '@/server/integration/actions'
import type { IntegrationErrorCode, IntegrationView } from '@/server/integration/view'

import { ErrorNote, Notice } from './error-note'
import { SyncSettingsForm } from './sync-settings-form'
import { useClearWhenIdle } from './use-clear-when-idle'

export function SyncCard({ view }: { view: IntegrationView }) {
  const t = useTranslations('integration.sync')
  const [error, setError] = useState<IntegrationErrorCode | null>(null)
  const [queued, setQueued] = useState<number | null>(null)
  const [pending, startTransition] = useTransition()
  useClearWhenIdle(view.activeJob, () => setQueued(null))
  const { gate } = view

  function press() {
    setError(null)
    setQueued(null)
    startTransition(async () => {
      const result = await syncAllAction()
      if (result.ok) setQueued(result.pulls ?? 0)
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
      {queued !== null ? <Notice>{t('queued', { count: queued })}</Notice> : null}
      <ErrorNote code={error} />
      <SyncSettingsForm view={view} />
    </FormSection>
  )
}
