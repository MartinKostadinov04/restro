import { Skeleton } from '@/components/ui/skeleton'

/** The Design tab while it loads: the chooser's line, the four cards, and the phone beside them. */
export function DesignSkeleton() {
  return (
    <div
      className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]"
      aria-hidden
      data-testid="design-skeleton"
    >
      <div className="space-y-6">
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-60 w-full" />
        <Skeleton className="h-80 w-full" />
        <Skeleton className="h-64 w-full" />
        <Skeleton className="h-96 w-full" />
      </div>
      <Skeleton className="h-[34rem] w-full max-w-[22.5rem]" />
    </div>
  )
}
