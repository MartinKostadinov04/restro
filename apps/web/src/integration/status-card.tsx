'use client'

// The Status card of one instance: whether Restro can reach the system with the saved credentials,
// when it last looked (in the instance's time zone), and whether a connection check or a pull is
// waiting or running right now. "Check again" queues the connection check. Under it the warnings:
// the till's currency, and each venue whose last full sync was held back (T62, CF-02), by name.
import { AlertTriangleIcon, CheckCircle2Icon, CircleDashedIcon, Loader2Icon } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useState, useTransition } from 'react'

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { FormSection } from '@/components/ui/form-section'
import { checkConnectionAction } from '@/server/integration/actions'
import type {
  InstanceView,
  IntegrationErrorCode,
  IntegrationStatus,
} from '@/server/integration/view'

import { ErrorNote, Notice } from './error-note'
import { useClearWhenIdle } from './use-clear-when-idle'
import { useMoment } from './use-moment'

/**
 * The status codes the worker writes into `status_detail` (apps/worker/src/sync/run.ts). Most are
 * problems of a failed connection. `currency_not_eur` is a warning on a connection that works.
 */
const STATUS_DETAIL_CODES = [
  'wrong_credentials',
  'host_refused',
  'credentials_unreadable',
  'currency_not_eur',
] as const
type StatusDetailCode = (typeof STATUS_DETAIL_CODES)[number]

function isStatusDetailCode(value: string): value is StatusDetailCode {
  return (STATUS_DETAIL_CODES as readonly string[]).includes(value)
}

export const STATUS_BADGE: Record<
  IntegrationStatus,
  { variant: 'secondary' | 'success' | 'danger'; icon: typeof CheckCircle2Icon }
> = {
  new: { variant: 'secondary', icon: CircleDashedIcon },
  connected: { variant: 'success', icon: CheckCircle2Icon },
  error: { variant: 'danger', icon: AlertTriangleIcon },
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1 sm:grid-cols-3 sm:gap-4">
      <dt className="text-sm font-medium text-foreground">{label}</dt>
      <dd className="text-sm text-muted-foreground sm:col-span-2">{children}</dd>
    </div>
  )
}

export function StatusCard({
  instance,
  canManage,
}: {
  instance: InstanceView
  canManage: boolean
}) {
  const t = useTranslations('integration')
  const moment = useMoment(instance.timeZone)
  const [error, setError] = useState<IntegrationErrorCode | null>(null)
  const [queued, setQueued] = useState(false)
  const [pending, startTransition] = useTransition()
  const source = instance.source
  useClearWhenIdle(instance.activeJob, () => setQueued(false))

  function checkAgain() {
    setError(null)
    setQueued(false)
    startTransition(async () => {
      const result = await checkConnectionAction({ integrationId: instance.id })
      if (result.ok) setQueued(true)
      else setError(result.error)
    })
  }

  const badge = STATUS_BADGE[instance.status]
  const Icon = badge.icon
  const detail =
    instance.statusDetail && isStatusDetailCode(instance.statusDetail)
      ? t(`statusDetail.${instance.statusDetail}`, { source })
      : instance.statusDetail

  const warning = instance.statusDetail === 'currency_not_eur'

  return (
    <FormSection title={t('status.title')} description={t('status.description', { source })}>
      <dl className="grid gap-4" data-testid="status-details">
        <Row label={t('status.title')}>
          <span className="flex flex-wrap items-center gap-2">
            <Badge variant={badge.variant} data-testid="status-badge" data-status={instance.status}>
              <Icon aria-hidden />
              {t(`status.state.${instance.status}`)}
            </Badge>
            {instance.activeJob ? (
              <span
                className="inline-flex items-center gap-1.5 text-foreground"
                data-testid="status-active"
              >
                <Loader2Icon aria-hidden className="size-4 animate-spin" />
                {instance.activeJob === 'connect'
                  ? t('status.activeConnect')
                  : t('status.activePull')}
              </span>
            ) : null}
          </span>
          {detail ? (
            <span
              className="mt-1 flex items-start gap-1.5 text-foreground"
              data-testid="status-detail"
              data-level={warning ? 'warning' : 'problem'}
            >
              {warning ? (
                <AlertTriangleIcon aria-hidden className="mt-0.5 size-4 shrink-0 text-warning" />
              ) : null}
              {detail}
            </span>
          ) : null}
        </Row>
        <Row label={t('status.address')}>{instance.host}</Row>
        <Row label={t('status.lastChecked')}>
          {moment(instance.lastCheckedAt) ?? t('status.never')}
        </Row>
      </dl>
      {canManage && instance.hasCredentials && !instance.activeJob ? (
        <div className="flex flex-wrap items-center gap-3">
          <Button type="button" variant="outline" onClick={checkAgain} disabled={pending}>
            {t('status.checkAgain')}
          </Button>
          {queued ? <Notice>{t('status.checkQueued')}</Notice> : null}
        </div>
      ) : null}
      {instance.heldSyncs.map((held) => (
        <Alert
          key={held.venue?.id ?? 'unknown'}
          className="border-warning/40 [&>svg]:text-warning"
          data-testid="sync-held"
          data-reason={held.reason}
        >
          <AlertTriangleIcon aria-hidden />
          <AlertTitle>
            {held.venue
              ? t('status.held.title', { venue: held.venue.name })
              : t('status.held.titleNoVenue')}
          </AlertTitle>
          <AlertDescription>
            {t(`status.held.${held.reason}`, {
              wouldHide: held.wouldHide,
              active: held.active,
              source,
            })}
          </AlertDescription>
        </Alert>
      ))}
      <ErrorNote code={error} source={source} />
    </FormSection>
  )
}
