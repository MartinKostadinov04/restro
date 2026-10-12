'use client'

// The tab of one chosen system (adjustments I1, D81): its named instances, one panel each, and
// "Add {source}", which opens the form for another connection. A system with no instance yet shows
// the form at once, since adding the first one is the only thing to do.
import { PlugZapIcon, PlusIcon } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useState } from 'react'

import { Button } from '@/components/ui/button'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import type { InstanceView, SystemOption } from '@/server/integration/view'

import { AddInstanceCard } from './add-instance-card'
import { InstancePanel } from './instance-panel'

export function SystemTab({
  system,
  instances,
  canManage,
  sealReady,
}: {
  system: SystemOption
  instances: readonly InstanceView[]
  canManage: boolean
  sealReady: boolean
}) {
  const t = useTranslations('integration.system')
  const [adding, setAdding] = useState(false)
  const source = system.label
  const none = instances.length === 0

  return (
    <div className="grid gap-10" data-testid="system-tab" data-kind={system.kind}>
      {none && !canManage ? (
        <Empty className="min-h-40" data-testid="system-empty">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <PlugZapIcon aria-hidden />
            </EmptyMedia>
            <EmptyTitle>{t('empty.title', { source })}</EmptyTitle>
            <EmptyDescription>{t('empty.readOnly')}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : null}

      {canManage && !none && !adding ? (
        <div className="flex justify-end">
          <Button type="button" variant="outline" onClick={() => setAdding(true)}>
            <PlusIcon aria-hidden />
            {t('add', { source })}
          </Button>
        </div>
      ) : null}
      {canManage && (none || adding) ? (
        <AddInstanceCard
          system={system}
          sealReady={sealReady}
          {...(none ? {} : { onClose: () => setAdding(false) })}
        />
      ) : null}

      {instances.map((instance) => (
        <InstancePanel
          key={instance.id}
          instance={instance}
          canManage={canManage}
          sealReady={sealReady}
        />
      ))}
    </div>
  )
}
