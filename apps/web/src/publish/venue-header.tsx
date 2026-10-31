// The venue page's header (D96, D97): the venue's name and guest address (the page's), the
// Publish bar top right, the answer to the last press, and the warnings that need action, the
// same on every tab. The bar and the warnings read the page's one publish state, which builds
// every menu's draft: they stream in under Suspense boundaries of their own, so the name, the
// address and the tabs never wait for them, and are drawn once.
import { type ReactNode, Suspense } from 'react'

import { Skeleton } from '@/components/ui/skeleton'
import { venuePublishState } from '@/server/publish/summary'
import type { PublishBarView } from '@/server/publish/view'

import { PublishBar } from './publish-bar'
import { PublisherProvider, PublisherStateSync, PublishOutcome } from './publisher-context'
import { VenueWarnings } from './venue-warnings'

/** The bar, with the publish state the header's publisher follows (a server component). */
async function HeaderBar({
  tenantId,
  venueId,
  guestPath,
  canPublish,
  onlyWhatWorks = false,
}: {
  tenantId: string
  venueId: string
  guestPath: string | null
  canPublish: boolean
  onlyWhatWorks?: boolean
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
  // A person's publish of any menu waiting for the worker, else files being written after a return.
  const busy =
    state.menus.find((menu) => menu.busy === 'publish')?.busy ??
    state.menus.find((menu) => menu.busy !== null)?.busy ??
    null
  return (
    <>
      <PublisherStateSync state={{ lastRun: state.lastRun, busy }} />
      <PublishBar view={view} onlyWhatWorks={onlyWhatWorks} />
    </>
  )
}

/** The bar's place while the publish state is read. */
function BarSkeleton() {
  return (
    <div className="flex gap-2" aria-hidden data-testid="publish-bar-skeleton">
      <Skeleton className="h-9 w-40" />
      <Skeleton className="h-9 w-28" />
    </div>
  )
}

/**
 * Publish on Tonight (RR-80): the night's work comes first, so for someone who may publish the bar
 * and its warnings come after it, with only what can be pressed now, and for anyone else not at all.
 * With nothing to show the section isn't there.
 */
export function TonightPublish({
  tenantId,
  venueId,
  guestPath,
}: {
  tenantId: string
  venueId: string
  guestPath: string | null
}) {
  return (
    <PublisherProvider venueId={venueId}>
      <section className="grid gap-4 border-t pt-6 empty:hidden" data-testid="tonight-publish">
        <Suspense fallback={null}>
          <HeaderBar
            tenantId={tenantId}
            venueId={venueId}
            guestPath={guestPath}
            canPublish
            onlyWhatWorks
          />
        </Suspense>
        <PublishOutcome />
        <Suspense fallback={null}>
          <VenueWarnings tenantId={tenantId} venueId={venueId} canPublish />
        </Suspense>
      </section>
    </PublisherProvider>
  )
}

export function VenueHeader({
  tenantId,
  venueId,
  guestPath,
  canPublish,
  offerPublish = true,
  title,
}: {
  tenantId: string
  venueId: string
  /** The guest address `/m/<organisation>/<venue>` (D84), or null. */
  guestPath: string | null
  /** Owner or admin. */
  canPublish: boolean
  /**
   * False on a shared device (RR-83) and on Tonight (RR-80): no bar and no publish warnings, only
   * the name and address.
   */
  offerPublish?: boolean
  /** The venue's name and address, drawn by the page. */
  title: ReactNode
}) {
  return (
    <PublisherProvider venueId={venueId}>
      <div className="grid gap-4">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">{title}</div>
          {offerPublish ? (
            <Suspense fallback={<BarSkeleton />}>
              <HeaderBar
                tenantId={tenantId}
                venueId={venueId}
                guestPath={guestPath}
                canPublish={canPublish}
              />
            </Suspense>
          ) : null}
        </div>
        <PublishOutcome />
        {offerPublish ? (
          <Suspense fallback={null}>
            <VenueWarnings tenantId={tenantId} venueId={venueId} canPublish={canPublish} />
          </Suspense>
        ) : null}
      </div>
    </PublisherProvider>
  )
}
