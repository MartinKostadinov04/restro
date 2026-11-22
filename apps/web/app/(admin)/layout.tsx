import type { Metadata } from 'next'
import { cookies } from 'next/headers'
import type { ReactNode } from 'react'

import { AdminFrameProvider } from '@/components/admin/admin-frame'
import { AppSidebar } from '@/components/admin/app-sidebar'
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar'
import { reservationsOffered } from '@/server/reservations/load'
import { canManageIntegration } from '@/server/roles'
import { requireTenant } from '@/server/session'
import { sharedDeviceOf } from '@/server/staff/shared-device'
import { staffLandingVenue } from '@/server/tonight/landing'
import { listVenues } from '@/server/venues'

// Staff install the panel like an app from here (D120, RR-86). Set on this layout, never on the
// root's or through `app/manifest.ts`, which would link it from the guest's pages too.
export const metadata: Metadata = {
  manifest: '/manifest.webmanifest',
  icons: { apple: '/icons/icon-180.png' },
}

// The frame of every signed-in admin page. Pages still check the session themselves: a layout
// does not re-render when the person moves between its pages, so this is not the guard, and what
// it reads for the sidebar (who works which venue's reservations) is a convenience the page asks
// again. The venue's sidebar is drawn here, not by a venue layout, because this is where the
// sidebar is; a change of rights shows after a reload.
export default async function AdminLayout({ children }: { children: ReactNode }) {
  const { user, organization, organizations, sessionId } = await requireTenant()
  const device = await sharedDeviceOf(organization.id, sessionId)
  // The sidebar keeps its open/collapsed state in a cookie (see components/ui/sidebar.tsx). The
  // page's frame is min-w-0: a wide row inside (a long label) scrolls in its own box instead of
  // widening the page past the screen (WCAG 1.4.10, lane 5 S3, N1).
  const defaultOpen = (await cookies()).get('sidebar_state')?.value !== 'false'

  // A shared device works its venue's night and nothing else (D122 §7): no sidebar, so no venue
  // list, no organisation switcher and no organisation Settings (lane 6 step 0, S1, S3, C2). Its
  // top bar carries its name, which opens the language, theme and sign-out (D154).
  if (device !== null) {
    return (
      <AdminFrameProvider value={{ device: { name: device.name }, staffOnly: true }}>
        <SidebarProvider defaultOpen={false}>
          <SidebarInset className="min-w-0">{children}</SidebarInset>
        </SidebarProvider>
      </AdminFrameProvider>
    )
  }

  const scope = { tenantId: organization.id, userId: user.id, sessionId }
  const [venues, landing] = await Promise.all([
    listVenues(organization.id).then((all) =>
      Promise.all(
        all.map(async ({ id, name }) => ({
          id,
          name,
          reservations: await reservationsOffered({ ...scope, venueId: id }),
        })),
      ),
    ),
    staffLandingVenue({ ...scope, role: organization.role }),
  ])
  const staffOnly = landing !== null

  return (
    <AdminFrameProvider value={{ device: null, staffOnly }}>
      <SidebarProvider defaultOpen={defaultOpen}>
        <AppSidebar
          venues={venues}
          organizations={organizations.map(({ id, name }) => ({ id, name }))}
          activeOrganizationId={organization.id}
          // Owners and admins add venues (the action checks the role again).
          canCreateVenue={canManageIntegration(organization.role)}
          staffOnly={staffOnly}
          user={{ name: user.name, email: user.email }}
        />
        <SidebarInset className="min-w-0">{children}</SidebarInset>
      </SidebarProvider>
    </AdminFrameProvider>
  )
}
