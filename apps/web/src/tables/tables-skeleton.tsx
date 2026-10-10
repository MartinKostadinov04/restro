import { Skeleton } from '@/components/ui/skeleton'

/** The Tables & QR tab while it loads. */
export function TablesSkeleton() {
  return (
    <div className="space-y-6" aria-hidden data-testid="tables-skeleton">
      <Skeleton className="h-16 w-full max-w-2xl" />
      <Skeleton className="h-64 w-full" />
      <Skeleton className="h-48 w-full" />
    </div>
  )
}
