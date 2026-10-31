import { Skeleton } from '@/components/ui/skeleton'

/** The Design page while it loads: the panel and the preview beside it (under it on a phone). */
export function DesignSkeleton() {
  return (
    <div
      className="grid min-h-svh gap-4 p-4 md:grid-cols-[22rem_minmax(0,1fr)] lg:grid-cols-[26rem_minmax(0,1fr)]"
      aria-hidden
      data-testid="design-skeleton"
    >
      <div className="space-y-6">
        <Skeleton className="h-44 w-full" />
        <Skeleton className="h-80 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
      <Skeleton className="h-[85svh] w-full md:h-full" />
    </div>
  )
}
