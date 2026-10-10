import { Skeleton } from '@/components/ui/skeleton'

/** What the Publish tab shows while the server reads it (and while another tab is open). */
export function PublishSkeleton() {
  return (
    <div className="grid gap-8 pt-2" aria-hidden data-testid="publish-skeleton">
      {[0, 1, 2].map((block) => (
        <div key={block} className="md:grid md:grid-cols-3 md:gap-6">
          <div className="grid gap-2 md:col-span-1">
            <Skeleton className="h-6 w-40" />
            <Skeleton className="h-4 w-56 max-w-full" />
          </div>
          <Skeleton className="mt-5 h-40 md:col-span-2 md:mt-0" />
        </div>
      ))}
    </div>
  )
}
