import { cookies } from 'next/headers'
import type { ReactNode } from 'react'

import { AppSidebar } from '@/components/admin/app-sidebar'
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar'
import { requireTenant } from '@/server/session'
import { listVenues } from '@/server/venues'

// The frame of every signed-in admin page. Pages still check the session themselves: a layout
// does not re-render when the person moves between its pages, so this is not the guard.
export default async function AdminLayout({ children }: { children: ReactNode }) {
  const { user, organization, organizations } = await requireTenant()
  const venues = await listVenues(organization.id)
  // The sidebar keeps its open/collapsed state in a cookie (see components/ui/sidebar.tsx).
  const defaultOpen = (await cookies()).get('sidebar_state')?.value !== 'false'

  return (
    <SidebarProvider defaultOpen={defaultOpen}>
      <AppSidebar
        venues={venues.map(({ id, name }) => ({ id, name }))}
        organizations={organizations.map(({ id, name }) => ({ id, name }))}
        activeOrganizationId={organization.id}
        user={{ name: user.name, email: user.email }}
      />
      <SidebarInset>{children}</SidebarInset>
    </SidebarProvider>
  )
}
