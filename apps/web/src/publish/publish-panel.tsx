'use client'

// The Publish tab's cards in the order a manager reads them: the answer to a press, the banners that
// need a decision (a held publish, a paused sync), what guests see now, what is waiting, the
// history, and the venue's publishing rules. Plain data in (see server/publish/view.ts); every button goes through one `Publisher`
// so they agree on what is busy. The page keeps itself fresh while a publish is queued or running.
import { useTranslations } from 'next-intl'

import { LiveRefresh } from '@/integration/live-refresh'
import type { PublishView } from '@/server/publish/view'
import { ChangesCard } from './changes-card'
import { HeldBanner } from './held-banner'
import { HistoryCard } from './history-card'
import { LiveCard } from './live-card'
import { OutcomeNote } from './outcome-note'
import { PausedBanner } from './paused-banner'
import { RulesCard } from './rules-card'
import { usePublisher } from './use-publisher'

export function PublishPanel({ view }: { view: PublishView }) {
  const t = useTranslations('publish')
  const publisher = usePublisher(view.venueId, view)

  if (view.menu === 'none') {
    return (
      <div className="grid gap-8 pt-2">
        <div className="grid gap-1" data-testid="publish-no-menu">
          <p className="font-medium">{t('noMenu.title')}</p>
          <p className="text-sm text-muted-foreground">{t('noMenu.description')}</p>
        </div>
        <RulesCard venueId={view.venueId} canPublish={view.canPublish} rules={view.rules} />
      </div>
    )
  }

  return (
    <div className="grid gap-8 pt-2" data-testid="publish-panel">
      <LiveRefresh active={publisher.busy} />
      {view.canPublish ? null : (
        <p
          className="rounded-md border bg-muted/40 p-3 text-sm text-muted-foreground"
          data-testid="read-only"
        >
          {t('readOnly')}
        </p>
      )}
      <OutcomeNote
        outcome={publisher.outcome}
        slow={publisher.slow}
        onDismiss={publisher.dismiss}
      />
      {view.busy === 'files' ? (
        <p role="status" className="text-sm text-muted-foreground" data-testid="publish-files">
          {t('updatingFiles')}
        </p>
      ) : null}
      {view.held !== null ? (
        <HeldBanner
          held={view.held}
          view={view}
          busy={publisher.busy}
          onApprove={publisher.approve}
          onReject={publisher.reject}
          onPublish={publisher.publish}
        />
      ) : null}
      {view.paused ? <PausedBanner /> : null}
      <LiveCard view={view} busy={publisher.busy} onPublish={publisher.publish} />
      <ChangesCard view={view} busy={publisher.busy} onPublish={publisher.publish} />
      <HistoryCard view={view} busy={publisher.busy} returnTo={publisher.returnTo} />
      <RulesCard venueId={view.venueId} canPublish={view.canPublish} rules={view.rules} />
    </div>
  )
}
