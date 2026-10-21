'use client'

// One named instance of a system, in its tab (adjustments I1, I2, D81, D82): "barsy – Sofia" with
// its connection card (name, address, API user, password), its status, the system settings card
// the connector supplies (barsy: the allergen characteristic and the language of untagged text),
// "Sync everything now", and the run history, collapsed. Under the name: which venues use it, and
// "Remove", which is refused while any does. Nothing here names a system: what is its own comes
// from the connector registry (`connectors/ui.tsx`) by the instance's kind.
import { Trash2Icon } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useId, useState, useTransition } from 'react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { FormSection } from '@/components/ui/form-section'
import { connectorUi } from '@/connectors/ui'
import { removeInstanceAction } from '@/server/integration/actions'
import type { InstanceView, IntegrationErrorCode } from '@/server/integration/view'

import { ConnectCard } from './connect-card'
import { ErrorNote } from './error-note'
import { RunHistory } from './run-history'
import { STATUS_BADGE, StatusCard } from './status-card'
import { SyncCard } from './sync-card'

/** "Remove": a confirmation, then the instance leaves the screen (its data is kept, D81). */
function RemoveButton({ instance }: { instance: InstanceView }) {
  const t = useTranslations('integration.instance.remove')
  const [open, setOpen] = useState(false)
  const [error, setError] = useState<IntegrationErrorCode | null>(null)
  const [pending, startTransition] = useTransition()

  function close() {
    if (pending) return
    setOpen(false)
    setError(null)
  }

  function confirm() {
    setError(null)
    startTransition(async () => {
      const result = await removeInstanceAction({ integrationId: instance.id })
      if (!result.ok) {
        setError(result.error)
        return
      }
      setOpen(false)
    })
  }

  return (
    <>
      <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)}>
        <Trash2Icon aria-hidden />
        {t('button')}
      </Button>
      <Dialog open={open} onOpenChange={(next) => !next && close()}>
        {open ? (
          <DialogContent data-testid="remove-dialog">
            <DialogHeader>
              <DialogTitle>{t('title', { name: instance.name })}</DialogTitle>
              <DialogDescription>{t('description', { source: instance.source })}</DialogDescription>
            </DialogHeader>
            <ErrorNote code={error} source={instance.source} />
            <DialogFooter>
              <Button type="button" variant="outline" disabled={pending} onClick={close}>
                {t('cancel')}
              </Button>
              <Button type="button" variant="destructive" disabled={pending} onClick={confirm}>
                {pending ? t('removing') : t('confirm')}
              </Button>
            </DialogFooter>
          </DialogContent>
        ) : null}
      </Dialog>
    </>
  )
}

export function InstancePanel({
  instance,
  canManage,
  sealReady,
}: {
  instance: InstanceView
  canManage: boolean
  sealReady: boolean
}) {
  const t = useTranslations('integration')
  const headingId = useId()
  const ui = connectorUi(instance.kind)
  const SettingsCard = ui?.InstanceSettingsCard ?? null
  const badge = STATUS_BADGE[instance.status]
  const Icon = badge.icon

  return (
    <section
      aria-labelledby={headingId}
      className="grid gap-6"
      data-testid="instance"
      data-instance-id={instance.id}
    >
      <header className="flex flex-wrap items-start justify-between gap-3 border-b pb-3">
        <div className="grid gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 id={headingId} className="text-lg font-semibold tracking-tight">
              {instance.name}
            </h3>
            <Badge
              variant={badge.variant}
              data-testid="instance-status"
              data-status={instance.status}
            >
              <Icon aria-hidden />
              {t(`status.state.${instance.status}`)}
            </Badge>
          </div>
          <p className="text-sm text-muted-foreground" data-testid="instance-venues">
            {instance.venues.length === 0
              ? t('instance.venues.none')
              : t('instance.venues.used', {
                  venues: instance.venues.map((venue) => venue.name).join(', '),
                  count: instance.venues.length,
                })}
          </p>
        </div>
        {canManage ? <RemoveButton instance={instance} /> : null}
      </header>

      <ConnectCard instance={instance} canManage={canManage} sealReady={sealReady} />
      <StatusCard instance={instance} canManage={canManage} />
      {SettingsCard ? (
        <SettingsCard integrationId={instance.id} canManage={canManage} data={instance.settings} />
      ) : null}
      <SyncCard instance={instance} />
      <FormSection
        title={t('history.title')}
        description={t('history.description', { source: instance.source })}
      >
        <RunHistory
          runs={instance.runs}
          timeZone={instance.timeZone}
          connector={instance.kind}
          source={instance.source}
          showVenue
        />
      </FormSection>
    </section>
  )
}
