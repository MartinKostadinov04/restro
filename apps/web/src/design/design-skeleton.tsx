import { Skeleton } from '@/components/ui/skeleton'

/** The Design tab while it loads. */
export function DesignSkeleton() {
  return (
    <div
      className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]"
      aria-hidden
      data-testid="design-skeleton"
    >
      <div className="space-y-6">
        <Skeleton className="h-72 w-full" />
        <Skeleton className="h-96 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
      <Skeleton className="h-[34rem] w-full max-w-[22.5rem]" />
    </div>
  )
}
