// Settings › Publish and Settings › Versioning (D97), server components (U4): each reads what its
// card shows in one go and hands it plain data. Nothing here writes; the writes are the server
// actions in server/publish/actions.ts. Who may act is decided from the role here for what to draw
// and again in every action for what to allow.
import type { Venue } from '@restro/db'

import { Skeleton } from '@/components/ui/skeleton'
import { getPool } from '@/server/db'
import { loadVersioningView, readAutomation } from '@/server/publish/load'
import { canManageIntegration, canPublishMenu } from '@/server/roles'

import { AutomationSettings } from './automation-settings'
import { VersioningCard } from './versioning-card'

/** Settings › Publish: the Automation settings of a venue with a till (D96). */
export async function PublishSettingsSection({
  tenantId,
  role,
  venue,
}: {
  tenantId: string
  role: string
  venue: Venue
}) {
  const view = await readAutomation(getPool(), tenantId, {
    id: venue.id,
    timezone: venue.timezone,
  })
  if (view === null) return null
  return (
    <div className="grid gap-8" data-testid="settings-publish">
      <AutomationSettings venueId={venue.id} canManage={canManageIntegration(role)} view={view} />
    </div>
  )
}

/** Settings › Versioning: every menu's live version and the ones it can return to (D96). */
export async function VersioningSection({
  tenantId,
  role,
  venue,
}: {
  tenantId: string
  role: string
  venue: Venue
}) {
  const view = await loadVersioningView({
    pool: getPool(),
    tenantId,
    venue: { id: venue.id, slug: venue.slug, publicId: venue.publicId, timezone: venue.timezone },
    venueName: venue.name,
    canPublish: canPublishMenu(role),
  })
  return (
    <div className="grid gap-8" data-testid="settings-versioning">
      <VersioningCard view={view} />
    </div>
  )
}

/** What a settings section shows while the server reads it (and while another one is open). */
export function SettingsSectionSkeleton() {
  return (
    <div className="grid gap-8 pt-2" aria-hidden data-testid="settings-skeleton">
      {[0, 1].map((block) => (
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
