import type { Metadata } from 'next'
import { cookies } from 'next/headers'
import type { ReactNode } from 'react'

import { AppSidebar } from '@/components/admin/app-sidebar'
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar'
import { canManageIntegration } from '@/server/roles'
import { requireTenant } from '@/server/session'
import { onSharedDevice } from '@/server/staff/shared-device'
import { listVenues } from '@/server/venues'

// Staff install the panel like an app from here (D120, RR-86). Set on this layout, never on the
// root's or through `app/manifest.ts`, which would link it from the guest's pages too.
export const metadata: Metadata = {
  manifest: '/manifest.webmanifest',
  icons: { apple: '/icons/icon-180.png' },
}

// The frame of every signed-in admin page. Pages still check the session themselves: a layout
// does not re-render when the person moves between its pages, so this is not the guard.
export default async function AdminLayout({ children }: { children: ReactNode }) {
  const { user, organization, organizations, sessionId } = await requireTenant()
  const [venues, device] = await Promise.all([
    listVenues(organization.id),
    onSharedDevice({ tenantId: organization.id, sessionId }),
  ])
  // The sidebar keeps its open/collapsed state in a cookie (see components/ui/sidebar.tsx).
  const defaultOpen = (await cookies()).get('sidebar_state')?.value !== 'false'

  return (
    <SidebarProvider defaultOpen={defaultOpen}>
      <AppSidebar
        venues={venues.map(({ id, name }) => ({ id, name }))}
        organizations={organizations.map(({ id, name }) => ({ id, name }))}
        activeOrganizationId={organization.id}
        // Owners and admins add venues (the action checks the role again), on their own sign-in;
        // a shared device has neither that nor the organisation's Settings to offer (RR-85).
        canCreateVenue={canManageIntegration(organization.role) && !device}
        offerSettings={!device}
        user={{ name: user.name, email: user.email }}
      />
      <SidebarInset>{children}</SidebarInset>
    </SidebarProvider>
  )
}
