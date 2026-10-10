import { Skeleton } from '@/components/ui/skeleton'

/** The composer's shape while its data loads (the tab opens before the menu is read). */
export function ComposerSkeleton() {
  return (
    <div
      className="grid gap-6 lg:grid-cols-[20rem_minmax(0,1fr)]"
      aria-hidden
      data-testid="composer-skeleton"
    >
      <div className="grid content-start gap-2">
        {['a', 'b', 'c', 'd', 'e'].map((key) => (
          <Skeleton key={key} className="h-9 w-full" />
        ))}
      </div>
      <div className="grid content-start gap-3">
        <Skeleton className="h-8 w-56" />
        {['a', 'b', 'c', 'd', 'e', 'f'].map((key) => (
          <Skeleton key={key} className="h-14 w-full" />
        ))}
      </div>
    </div>
  )
}
