'use client'

// V11: an automatic publish that would hide more than 30% of the visible items waits here for a
// person, under the venue header on every tab (D97). The banner says how many (and which), and
// offers Approve and Reject. When the menu has changed since the hold, approving would be refused,
// so it says so up front and offers to publish the menu as it is now instead. With several menus
// it names the menu the hold is about.
import { ShieldAlertIcon } from 'lucide-react'
import { useTranslations } from 'next-intl'

import { Button } from '@/components/ui/button'
import type { HeldView } from '@/server/publish/view'

import { menuName, useAdminLocale } from './names'
import { usePublisherContext } from './publisher-context'

/** How many of the hidden items' names the banner lists before "and N more". */
export const HELD_NAMES_SHOWN = 8

export function HeldBanner({
  held,
  menuId,
  menu,
  canPublish,
  canPublishNow,
}: {
  held: HeldView
  /** The menu the hold is about. */
  menuId: string
  /** Its name when the venue has several menus; null otherwise. */
  menu: string | null
  /** Owner or admin. */
  canPublish: boolean
  /** "Publish the menu as it is now" would do something (its draft can be published). */
  canPublishNow: boolean
}) {
  const t = useTranslations('publish.held')
  const publisher = usePublisherContext()
  const locale = useAdminLocale()
  const unnamed = useTranslations('publish.changes')('unnamed')
  // By name in the interface language (the view lists them by id, which means nothing to a person).
  const names = held.items
    .map((item) => menuName(item.name, locale, unnamed))
    .sort((a, b) => a.localeCompare(b, locale, { numeric: true }))
  const shown = names.slice(0, HELD_NAMES_SHOWN)
  // The count is the whole of what would be hidden, even when fewer names are known.
  const more = held.hidden - shown.length
  const can = canPublish && !publisher.busy

  return (
    <section
      aria-labelledby={`held-title-${held.snapshotId}`}
      className="grid gap-3 rounded-lg border border-warning/40 bg-warning/10 p-4"
      data-testid="held-banner"
      data-menu={menuId}
    >
      <div className="flex items-start gap-3">
        <ShieldAlertIcon aria-hidden className="mt-0.5 size-5 shrink-0 text-warning" />
        <div className="grid gap-1">
          <h3 id={`held-title-${held.snapshotId}`} className="font-medium">
            {menu === null ? null : <span className="block text-sm">{menu}</span>}
            {t('title', {
              hidden: held.hidden,
              total: held.previouslyVisible,
              percent: held.percent,
            })}
          </h3>
          <p className="text-sm text-muted-foreground">
            {held.outdated ? t('outdatedText') : t('text')}
          </p>
        </div>
      </div>
      {shown.length > 0 ? (
        <div className="text-sm" data-testid="held-items">
          <p className="font-medium">{t('names')}</p>
          <p className="text-muted-foreground">
            {shown.join(', ')}
            {more > 0 ? ` ${t('more', { count: more })}` : ''}
          </p>
        </div>
      ) : null}
      {canPublish ? (
        <div className="flex flex-wrap gap-3">
          {held.outdated ? (
            <Button
              type="button"
              disabled={!can || !canPublishNow}
              onClick={() => publisher.publish(menuId)}
              data-testid="held-publish-now"
            >
              {t('publishNow')}
            </Button>
          ) : (
            <Button
              type="button"
              disabled={!can}
              onClick={() => publisher.approve(held.snapshotId)}
              data-testid="held-approve"
            >
              {t('approve')}
            </Button>
          )}
          <Button
            type="button"
            variant="outline"
            disabled={!can}
            onClick={() => publisher.reject(held.snapshotId)}
            data-testid="held-reject"
          >
            {t('reject')}
          </Button>
        </div>
      ) : null}
    </section>
  )
}
