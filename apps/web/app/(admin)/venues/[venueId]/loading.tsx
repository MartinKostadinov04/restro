import { Skeleton } from '@/components/ui/skeleton'

// The venue page's frame while a screen loads: a tap in the sidebar opens another address of this
// page (D154), and this answers it at once, where the tab bar used to (lane 6 critique, K18). The
// sidebar marks the tapped entry meanwhile (venue-nav.tsx).
export default function VenueLoading() {
  return (
    <>
      <div className="flex min-h-14 shrink-0 items-center gap-2 border-b px-4" aria-hidden>
        <Skeleton className="size-7" />
        <Skeleton className="h-4 w-40" />
      </div>
      <div
        className="mx-auto w-full max-w-7xl flex-1 space-y-6 px-4 py-6 sm:px-6 lg:px-8"
        aria-busy
        data-testid="venue-loading"
      >
        <div className="grid gap-2">
          <Skeleton className="h-8 w-56 max-w-full" />
          <Skeleton className="h-5 w-72 max-w-full" />
        </div>
        <Skeleton className="h-9 w-full max-w-md" />
        <div className="grid gap-4">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
      </div>
    </>
  )
}
