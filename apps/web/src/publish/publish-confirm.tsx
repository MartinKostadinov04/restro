'use client'

// The confirmation before a publish (D96): which menu, what guests will see change (the counts and
// the named lists, as the old "Changes waiting" card listed them), and for a menu that is not the
// live one where guests see it. "Preview" opens the draft in a phone frame; "Publish" queues it.
import { EyeIcon, RocketIcon } from 'lucide-react'
import { useTranslations } from 'next-intl'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import type { PublishBarMenu } from '@/server/publish/view'

import { ChangeLists, ChangeSummary } from './change-lists'
import { PreviewDialog } from './preview-dialog'

/** What the dialog says the publish changes. */
function WhatChanges({
  menu,
  paused,
  addressServed,
}: {
  menu: PublishBarMenu
  paused: boolean
  addressServed: boolean
}) {
  const t = useTranslations('publish.changes')
  const tc = useTranslations('publish.publishConfirm')
  const changes = menu.list
  if (changes === null) return null
  if (!menu.published) {
    return (
      <p className="font-medium" data-testid="changes-all-new">
        {t('allNew', { count: changes.added.length })}
      </p>
    )
  }
  if (changes.identical) {
    return (
      <p className="text-sm" data-testid="changes-same">
        {menu.live && !addressServed
          ? tc('sameAddressOff')
          : menu.live && paused
            ? tc('samePaused')
            : tc('same')}
      </p>
    )
  }
  if (changes.total === 0) {
    return (
      <div className="grid gap-1" data-testid="changes-minor">
        <p className="font-medium">{t('minor')}</p>
        <p className="text-sm text-muted-foreground">{t('minorText')}</p>
      </div>
    )
  }
  return (
    <div className="grid gap-3">
      <p className="font-medium" data-testid="changes-count">
        {t('waiting', { count: changes.total })}
      </p>
      <ChangeSummary changes={changes} />
      <ChangeLists changes={changes} />
    </div>
  )
}

export function PublishConfirm({
  venueId,
  menu,
  several,
  paused,
  addressServed,
  busy,
  onConfirm,
  onClose,
}: {
  venueId: string
  /** The menu to publish; the dialog is open while it is set. */
  menu: PublishBarMenu | null
  /** The venue has several menus: the dialog names the menu. */
  several: boolean
  paused: boolean
  addressServed: boolean
  busy: boolean
  onConfirm: (menu: PublishBarMenu) => void
  onClose: () => void
}) {
  const t = useTranslations('publish.publishConfirm')
  const tBar = useTranslations('publish.bar')
  return (
    <Dialog open={menu !== null} onOpenChange={(open) => (open ? null : onClose())}>
      <DialogContent className="sm:max-w-lg" data-testid="publish-confirm-dialog">
        {menu === null ? null : (
          <>
            <DialogHeader>
              <DialogTitle>
                {several ? t('titleMenu', { name: menu.name }) : t('title')}
              </DialogTitle>
              <DialogDescription>
                {menu.live
                  ? t('description')
                  : menu.areas.length > 0
                    ? t('notLive', { name: menu.name, areas: menu.areas.join(', ') })
                    : t('notLiveUnrouted', { name: menu.name })}
              </DialogDescription>
            </DialogHeader>
            <div className="grid max-h-[50vh] gap-3 overflow-y-auto">
              <WhatChanges menu={menu} paused={paused} addressServed={addressServed} />
            </div>
            <DialogFooter className="gap-2 sm:justify-between">
              <PreviewDialog venueId={venueId} menuId={menu.menuId}>
                <Button type="button" variant="outline" data-testid="publish-confirm-preview">
                  <EyeIcon aria-hidden />
                  {t('preview')}
                </Button>
              </PreviewDialog>
              <div className="flex flex-col-reverse gap-2 sm:flex-row">
                <Button type="button" variant="outline" onClick={onClose}>
                  {t('cancel')}
                </Button>
                <Button
                  type="button"
                  disabled={busy}
                  onClick={() => onConfirm(menu)}
                  data-testid="publish-confirm"
                >
                  <RocketIcon aria-hidden />
                  {tBar('publish')}
                </Button>
              </div>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
