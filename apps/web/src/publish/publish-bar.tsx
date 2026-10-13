'use client'

// The Publish bar, top right of the venue page on every tab (D96, D97). One menu: a Publish
// button with the number of changes, greyed with the reason when there is nothing to publish or
// the person may not. Several menus: the button opens a list with one row per menu, its name, the
// areas it is routed to in brackets (the live menu says "venue address") and its change count;
// a row that cannot be published is greyed with the reason. Either way a confirmation lists the
// changes before anything is published. "Open the guest page" stands beside it, off while the
// address is switched off.
import { ChevronDownIcon, ExternalLinkIcon, RocketIcon } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useId, useState } from 'react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import type { PublishBarMenu, PublishBarView, PublishBlock } from '@/server/publish/view'

import { publishBlock, targetOf, useBlockReason } from './publish-button'
import { PublishConfirm } from './publish-confirm'
import { usePublisherContext } from './publisher-context'

/** A menu row with whether, and why not, it can be published now. */
interface Row {
  readonly menu: PublishBarMenu
  readonly block: PublishBlock | null
}

/** The change count a row shows: what differs, or everything for a first publish. */
const countOf = (menu: PublishBarMenu): number => menu.changes ?? 0

export function PublishBar({ view }: { view: PublishBarView }) {
  const t = useTranslations('publish.bar')
  const reasonOf = useBlockReason()
  const publisher = usePublisherContext()
  const reasonId = useId()
  const [asking, setAsking] = useState<PublishBarMenu | null>(null)

  const busy = publisher.busy
  const rows: Row[] = view.menus.map((menu) => ({
    menu,
    block: publishBlock(targetOf(menu, view), busy || menu.busy !== null),
  }))
  const several = rows.length > 1
  const open = rows.filter((row) => row.block === null)
  const single = rows[0]
  // The button itself: off for the role, while something is busy, or when no menu has anything.
  const block: PublishBlock | null = !view.canPublish
    ? 'role'
    : busy
      ? 'busy'
      : open.length > 0
        ? null
        : (single?.block ?? 'up_to_date')
  const total = open.reduce((sum, row) => sum + countOf(row.menu), 0)

  const reason = ((): string => {
    if (single === undefined) return t('reason.noMenu')
    if (block === 'role' || block === 'busy') return reasonOf(block, null)
    if (block !== null) {
      return several ? t('reason.allUpToDate') : reasonOf(block, single.menu.blocked)
    }
    if (!several && !single.menu.published) return t('firstPublish')
    if (!several && single.menu.identical) {
      return view.addressServed ? t('pausedSame') : t('addressOffSame')
    }
    return total > 0 ? t('waiting', { count: total }) : t('minor')
  })()

  const confirm = (menu: PublishBarMenu) => {
    setAsking(null)
    publisher.publish(menu.live ? undefined : menu.menuId)
  }

  const label = busy ? t('publishing') : t('publish')
  const icon = <RocketIcon aria-hidden className={busy ? 'animate-pulse' : undefined} />
  const count =
    block === null && total > 0 ? (
      <Badge variant="secondary" className="ml-0.5 px-1.5" data-testid="publish-count">
        {total}
      </Badge>
    ) : null

  const liveMenu = rows.find((row) => row.menu.live)?.menu
  const guestOff = view.guestPath === null || !view.addressServed || liveMenu?.published !== true
  const guestHint =
    view.guestPath === null
      ? null
      : !view.addressServed
        ? t('guestOff')
        : liveMenu?.published !== true
          ? t('guestNothing')
          : null

  return (
    <div className="grid justify-items-start gap-1.5 sm:justify-items-end" data-testid="publish-bar">
      <div className="flex flex-wrap items-center gap-2">
        {guestOff ? (
          <Button
            type="button"
            variant="outline"
            disabled
            aria-describedby={guestHint === null ? undefined : `${reasonId}-guest`}
            data-testid="guest-link"
          >
            <ExternalLinkIcon aria-hidden />
            {t('openGuest')}
          </Button>
        ) : (
          <Button asChild variant="outline">
            <a
              href={view.guestPath ?? undefined}
              target="_blank"
              rel="noopener noreferrer"
              data-testid="guest-link"
            >
              <ExternalLinkIcon aria-hidden />
              {t('openGuest')}
            </a>
          </Button>
        )}
        {several ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild disabled={block !== null}>
              <Button type="button" aria-describedby={reasonId} data-testid="publish-button">
                {icon}
                {label}
                {count}
                <ChevronDownIcon aria-hidden />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-72">
              <DropdownMenuLabel>{t('choose')}</DropdownMenuLabel>
              {rows.map(({ menu, block: rowBlock }) => {
                const where = [...(menu.live ? [t('venueAddress')] : []), ...menu.areas]
                return (
                  <DropdownMenuItem
                    key={menu.menuId}
                    disabled={rowBlock !== null}
                    onSelect={() => setAsking(menu)}
                    className="flex items-start justify-between gap-3"
                    data-testid="publish-menu-row"
                    data-menu={menu.menuId}
                  >
                    <span className="grid gap-0.5">
                      <span className="font-medium">
                        {menu.name}
                        {where.length > 0 ? (
                          <span className="font-normal text-muted-foreground">
                            {' '}
                            ({where.join(', ')})
                          </span>
                        ) : null}
                      </span>
                      {rowBlock !== null ? (
                        <span className="text-xs text-muted-foreground">
                          {reasonOf(rowBlock, menu.blocked)}
                        </span>
                      ) : !menu.published ? (
                        <span className="text-xs text-muted-foreground">{t('firstPublish')}</span>
                      ) : null}
                    </span>
                    {rowBlock === null && countOf(menu) > 0 ? (
                      <Badge variant="secondary">{t('count', { count: countOf(menu) })}</Badge>
                    ) : null}
                  </DropdownMenuItem>
                )
              })}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : (
          <Button
            type="button"
            disabled={block !== null || single === undefined}
            onClick={() => (single === undefined ? null : setAsking(single.menu))}
            aria-describedby={reasonId}
            data-testid="publish-button"
          >
            {icon}
            {label}
            {count}
          </Button>
        )}
      </div>
      <p
        id={reasonId}
        className="text-xs text-muted-foreground"
        data-testid="publish-block-reason"
        data-block={block ?? 'none'}
      >
        {reason}
      </p>
      {guestHint !== null ? (
        <p
          id={`${reasonId}-guest`}
          className="text-xs text-muted-foreground"
          data-testid="guest-link-hint"
        >
          {guestHint}
        </p>
      ) : null}
      <PublishConfirm
        venueId={view.venueId}
        menu={asking}
        several={several}
        paused={view.paused}
        addressServed={view.addressServed}
        busy={busy}
        onConfirm={confirm}
        onClose={() => setAsking(null)}
      />
    </div>
  )
}
