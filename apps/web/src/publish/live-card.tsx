'use client'

// "On guests' phones now": the version guests see, when and by whom it was published, and the link
// to the guest page. Before the first publish it says so and offers the Publish button.
import { ExternalLinkIcon } from 'lucide-react'
import { useTranslations } from 'next-intl'

import { Badge } from '@/components/ui/badge'
import { FormSection } from '@/components/ui/form-section'
import { useMoment } from '@/integration/use-moment'
import type { PublishView } from '@/server/publish/view'
import { useActorLabel } from './names'
import { PublishButton } from './publish-button'

export function LiveCard({
  view,
  busy,
  onPublish,
}: {
  view: PublishView
  busy: boolean
  onPublish: () => void
}) {
  const t = useTranslations('publish.live')
  const moment = useMoment(view.timeZone)
  const actorLabel = useActorLabel()
  const { live } = view
  const ready = view.draft.state === 'ready' ? view.draft.changes.added.length : null

  if (live === null) {
    return (
      <FormSection title={t('title')} description={t('description')}>
        <div className="grid gap-3" data-testid="live-nothing">
          <p className="text-lg font-medium">{t('nothingTitle')}</p>
          <p className="text-sm text-muted-foreground">
            {ready === null ? t('nothingTextPlain') : t('nothingText', { count: ready })}
          </p>
          <div>
            <PublishButton view={view} busy={busy} onPublish={onPublish} />
          </div>
        </div>
      </FormSection>
    )
  }

  const published = moment(live.publishedAt) ?? ''
  const returned = live.returned === null ? null : moment(live.returned.at)
  return (
    <FormSection title={t('title')} description={t('description')}>
      <div className="grid gap-2" data-testid="live-version">
        <div className="flex flex-wrap items-center gap-3">
          <p className="text-2xl font-semibold" data-testid="live-version-number">
            {t('version', { version: live.version })}
          </p>
          <Badge variant="success">{t('badge')}</Badge>
        </div>
        <p className="text-sm text-muted-foreground" data-testid="live-meta">
          {t('meta', {
            reason: t(`reason.${live.reason}`),
            when: published,
            who: actorLabel(live.actor),
          })}
        </p>
        {live.returned !== null && returned !== null ? (
          <p className="text-sm text-muted-foreground" data-testid="live-returned">
            {t('returned', { when: returned, who: actorLabel(live.returned.actor) })}
          </p>
        ) : null}
      </div>
      <div>
        <a
          href={`/m/${view.venueSlug}`}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 text-sm font-medium text-primary underline-offset-4 hover:underline"
          data-testid="guest-link"
        >
          {t('open')}
          <ExternalLinkIcon aria-hidden className="size-3.5" />
        </a>
      </div>
    </FormSection>
  )
}
