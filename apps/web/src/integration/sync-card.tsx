'use client'

// The "Sync everything" card of one instance (D82): an action, not a setting. "Sync everything
// now" queues a full pull of every venue that uses this instance and that its system can read.
// The button is off, with the reason written next to it, until the instance is connected and a
// venue uses it, and while a connection check or a pull is queued or running. The server checks
// the same rule again; this only explains it. The pulls then run one after the other (one pull at
// a time per installation). Automatic syncing is each venue's own setting (D82).
import { RefreshCwIcon } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useState, useTransition } from 'react'

import { Button } from '@/components/ui/button'
import { FormSection } from '@/components/ui/form-section'
import { syncAllAction } from '@/server/integration/actions'
import type { InstanceView, IntegrationErrorCode } from '@/server/integration/view'

import { ErrorNote, Notice } from './error-note'
import { useClearWhenIdle } from './use-clear-when-idle'

export function SyncCard({ instance }: { instance: InstanceView }) {
  const t = useTranslations('integration.sync')
  const [error, setError] = useState<IntegrationErrorCode | null>(null)
  const [queued, setQueued] = useState<number | null>(null)
  const [pending, startTransition] = useTransition()
  useClearWhenIdle(instance.activeJob, () => setQueued(null))
  const { gate, source } = instance

  function press() {
    setError(null)
    setQueued(null)
    startTransition(async () => {
      const result = await syncAllAction({ integrationId: instance.id })
      if (result.ok) setQueued(result.pulls ?? 0)
      else setError(result.error)
    })
  }

  return (
    <FormSection title={t('title')} description={t('description', { source })}>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" onClick={press} disabled={!gate.enabled || pending}>
          <RefreshCwIcon aria-hidden className={pending ? 'animate-spin' : undefined} />
          {pending ? t('starting') : t('button')}
        </Button>
        {!gate.enabled ? (
          <p className="text-sm text-muted-foreground" data-testid="sync-blocked">
            {t(`blocked.${gate.reason}`, { source })}
          </p>
        ) : null}
      </div>
      {queued !== null ? <Notice>{t('queued', { count: queued })}</Notice> : null}
      <ErrorNote code={error} source={source} />
    </FormSection>
  )
}
