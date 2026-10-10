'use client'

// The Publish button, wherever it stands (the "nothing published yet" card, the changes card, the
// pause banner, the held banner). One place decides when it is off, so they agree.
import { RocketIcon } from 'lucide-react'
import { useTranslations } from 'next-intl'

import { Button } from '@/components/ui/button'
import type { PublishView } from '@/server/publish/view'

/** Why the button is off, or null when it may be pressed. */
export function publishBlock(
  view: PublishView,
  busy: boolean,
): 'role' | 'busy' | 'draft' | 'up_to_date' | null {
  if (!view.canPublish) return 'role'
  if (busy) return 'busy'
  if (view.draft.state !== 'ready') return 'draft'
  // Up to date and nothing paused: publishing would find nothing new. (A pause is lifted by a
  // publish even when the menu is the same, so then the button stays on.)
  if (view.live !== null && view.draft.changes.identical && !view.paused) return 'up_to_date'
  return null
}

export function PublishButton({
  view,
  busy,
  onPublish,
  variant = 'default',
  label,
}: {
  view: PublishView
  busy: boolean
  onPublish: () => void
  variant?: 'default' | 'outline'
  /** Words for the button when they should not be "Publish" (the held banner's). */
  label?: string
}) {
  const t = useTranslations('publish')
  const block = publishBlock(view, busy)
  const text = busy
    ? t('publishing')
    : (label ?? (block === 'up_to_date' ? t('nothingToPublish') : t('publish')))
  return (
    <Button
      type="button"
      variant={variant}
      disabled={block !== null}
      onClick={onPublish}
      data-testid="publish-button"
    >
      <RocketIcon aria-hidden className={busy ? 'animate-pulse' : undefined} />
      {text}
    </Button>
  )
}
