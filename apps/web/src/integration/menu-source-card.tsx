'use client'

// The Menu source card of a venue's Settings tab (adjustments I2, B2; D82, D87): where a POS
// venue's menu comes from. Two parts:
//
//   common     for every POS venue: the instance it reads from and the venue's name in that system
//              (read-only: a venue's source is fixed when it is created, D87), "Sync this venue",
//              when it was last synced, the held-sync warning, and the venue's own history,
//              collapsed;
//   connector  supplied by the venue's connector and shown only for its venues (barsy: the price
//              shown, B2), from the connector registry.
//
// A venue made by hand has no source: it shows neither part, and the card draws nothing at all.
// A system's own numbers are only handed back to the server actions; they are never drawn. Owners
// and admins change things; everyone else sees what is set.
import { AlertTriangleIcon, RefreshCwIcon } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useState, useTransition } from 'react'

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { FormSection } from '@/components/ui/form-section'
import { connectorUi } from '@/connectors/ui'
import { syncNowAction } from '@/server/integration/actions'
import type {
  IntegrationErrorCode,
  LinkedMenuSource,
  MenuSourceView,
} from '@/server/integration/view'

import { ErrorNote, Notice } from './error-note'
import { LiveRefresh } from './live-refresh'
import { RunHistory } from './run-history'
import { useClearWhenIdle } from './use-clear-when-idle'
import { useMoment } from './use-moment'

/** The last sync, the held warning and "Sync this venue". */
function SyncBlock({ venueId, view }: { venueId: string; view: LinkedMenuSource }) {
  const t = useTranslations('menuSource.sync')
  const moment = useMoment(view.timeZone)
  const [error, setError] = useState<IntegrationErrorCode | null>(null)
  const [queued, setQueued] = useState(false)
  const [pending, startTransition] = useTransition()
  useClearWhenIdle(view.activeJob, () => setQueued(false))
  const { gate, heldSync: held, source } = view
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
    <div className="grid gap-3">
      {held ? (
        <Alert
          className="border-warning/40 [&>svg]:text-warning"
          data-testid="sync-held"
          data-reason={held.reason}
        >
          <AlertTriangleIcon aria-hidden />
          <AlertTitle>{t('held.title')}</AlertTitle>
          <AlertDescription>
            {t(`held.${held.reason}`, { wouldHide: held.wouldHide, active: held.active, source })}
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
            {t(`blocked.${gate.reason}`, { source })}
          </p>
        ) : null}
      </div>
      <p className="text-sm text-muted-foreground" data-testid="sync-last">
        {lastSynced ? t('lastSynced', { when: lastSynced }) : t('neverSynced')}
      </p>
      {queued ? <Notice>{t('queued')}</Notice> : null}
      <ErrorNote code={error} source={source} />
    </div>
  )
}

function Linked({ venueId, view }: { venueId: string; view: LinkedMenuSource }) {
  const t = useTranslations('menuSource')
  const history = useTranslations('integration.history')
  const Part = connectorUi(view.connector.kind)?.VenueSourcePart ?? null
  return (
    <div className="grid gap-6">
      <LiveRefresh active={view.activeJob !== null} />
      <dl className="grid gap-4 sm:grid-cols-2">
        <div className="grid gap-0.5">
          <dt className="text-sm font-medium">{t('instance.label')}</dt>
          <dd className="text-sm text-muted-foreground" data-testid="menu-source-instance">
            {view.instanceName}
          </dd>
        </div>
        <div className="grid gap-0.5">
          <dt className="text-sm font-medium">{t('venue.label', { source: view.source })}</dt>
          <dd className="text-sm text-muted-foreground" data-testid="menu-source-venue">
            {view.tillVenueName}
          </dd>
        </div>
      </dl>
      {Part ? <Part venueId={venueId} canManage={view.canManage} data={view.connector} /> : null}
      <SyncBlock venueId={venueId} view={view} />
      <div className="grid gap-2">
        <h4 className="text-sm font-medium">{history('venueTitle')}</h4>
        <RunHistory
          runs={view.runs}
          timeZone={view.timeZone}
          connector={view.connector.kind}
          source={view.source}
          showVenue={false}
        />
      </div>
    </div>
  )
}

export function MenuSourceCard({ venueId, view }: { venueId: string; view: MenuSourceView }) {
  if (view.state === 'none') return null
  return <Source venueId={venueId} view={view} />
}

function Source({ venueId, view }: { venueId: string; view: LinkedMenuSource }) {
  const t = useTranslations('menuSource')
  return (
    <div id="menu-source" data-testid="menu-source">
      <FormSection title={t('title')} description={t('description', { source: view.source })}>
        {view.canManage ? null : (
          <p
            className="rounded-md border bg-muted/40 p-3 text-sm text-muted-foreground"
            data-testid="read-only"
          >
            {t('readOnly')}
          </p>
        )}
        <Linked venueId={venueId} view={view} />
      </FormSection>
    </div>
  )
}
