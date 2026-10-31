// /venues/<id>/design: the Design page (D129), a page of its own outside the admin frame (no
// sidebar): the panel and the preview take the whole window. It is behind the sign-in like the rest
// of the admin: the proxy sends a visitor without a session to /login, and this page checks the
// session and the venue itself. A shared device has no Studio and is sent to Tonight (D122). Any
// other member of the organisation may look; owners and admins may change it.
import { notFound, redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'

import { DesignPage } from '@/design/design-page'
import { getAssetStore } from '@/server/assets'
import { composerMenusOf } from '@/server/composer/menu'
import { getPool } from '@/server/db'
import { loadDesign } from '@/server/design/service'
import { requireTenant } from '@/server/session'
import { onSharedDevice } from '@/server/staff/shared-device'
import { getVenue } from '@/server/venues'

export async function generateMetadata({ params }: PageProps<'/venues/[venueId]/design'>) {
  const { organization } = await requireTenant()
  const venue = await getVenue(organization.id, (await params).venueId)
  const t = await getTranslations('design')
  return { title: venue ? `${t('title')} · ${venue.name}` : t('title') }
}

export default async function VenueDesignPage({
  params,
  searchParams,
}: PageProps<'/venues/[venueId]/design'>) {
  const { organization, sessionId } = await requireTenant()
  // Another tenant's venue and a made-up id both come back as null (row-level security).
  const venue = await getVenue(organization.id, (await params).venueId)
  if (!venue) notFound()
  if (await onSharedDevice({ tenantId: organization.id, sessionId })) {
    redirect(`/venues/${venue.id}?tab=tonight`)
  }
  const query = await searchParams
  const [initial, { current }] = await Promise.all([
    loadDesign(getPool(), organization.id, venue, getAssetStore, organization.role),
    composerMenusOf(organization.id, venue.id, query.menu),
  ])
  return (
    <DesignPage
      venueId={venue.id}
      venueName={venue.name}
      initial={initial}
      menuId={current?.id ?? null}
    />
  )
}
