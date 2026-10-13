// The venue page's header (D96, D97), a server component: the venue's name and guest address
// (the page's), the Publish bar top right, the answer to the last press, and the warnings that
// need action, the same on every tab. It reads the page's one publish state, which builds every
// menu's draft; the page streams it in under a Suspense boundary (`VenueHeaderSkeleton` until
// then), so the tabs do not wait for it.
import { getTranslations } from 'next-intl/server'
import type { ReactNode } from 'react'

import { Skeleton } from '@/components/ui/skeleton'
import { venuePublishState } from '@/server/publish/summary'
import type { PublishBarView } from '@/server/publish/view'

import { PublishBar } from './publish-bar'
import { PublishOutcome, PublisherProvider } from './publisher-context'
import { VenueWarnings } from './venue-warnings'

/** The header row: the name and address on the left, the bar (or its place) on the right. */
function HeaderRow({ title, bar }: { title: ReactNode; bar: ReactNode }) {
  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0">{title}</div>
      {bar}
    </div>
  )
}

export async function VenueHeader({
  tenantId,
  venueId,
  guestPath,
  canPublish,
  title,
}: {
  tenantId: string
  venueId: string
  /** The guest address `/m/<organisation>/<venue>` (D84), or null. */
  guestPath: string | null
  /** Owner or admin. */
  canPublish: boolean
  /** The venue's name and address, drawn by the page. */
  title: ReactNode
}) {
  const state = await venuePublishState(tenantId, venueId)
  const view: PublishBarView = {
    venueId,
    canPublish,
    addressServed: state.addressServed,
    paused: state.paused,
    guestPath,
    lastRun: state.lastRun,
    menus: state.menus.map(({ held: _held, ...menu }) => menu),
  }
  // The newest job of any menu says whether something is waiting for the worker.
  const busy =
    state.menus.find((menu) => menu.busy === 'publish')?.busy ??
    state.menus.find((menu) => menu.busy !== null)?.busy ??
    null
  return (
    <PublisherProvider venueId={venueId} state={{ lastRun: state.lastRun, busy }}>
      <div className="grid gap-4">
        <HeaderRow title={title} bar={<PublishBar view={view} />} />
        <PublishOutcome />
        {busy === 'files' ? <FilesNote /> : null}
        <VenueWarnings tenantId={tenantId} venueId={venueId} canPublish={canPublish} />
      </div>
    </PublisherProvider>
  )
}

/** A return to an earlier version is done; its files are still being written. */
async function FilesNote() {
  const t = await getTranslations('publish')
  return (
    <p role="status" className="text-sm text-muted-foreground" data-testid="publish-files">
      {t('updatingFiles')}
    </p>
  )
}

/** The header while the publish state is read: the title at once, the bar's place held. */
export function VenueHeaderSkeleton({ title }: { title: ReactNode }) {
  return (
    <HeaderRow
      title={title}
      bar={
        <div className="flex gap-2" aria-hidden data-testid="publish-bar-skeleton">
          <Skeleton className="h-9 w-40" />
          <Skeleton className="h-9 w-28" />
        </div>
      }
    />
  )
}
