// The Composer tab, a server component (U4): it reads the menu document and the items that sit in
// no section (core/apply, read side), resolves it for this venue and hands the client component a
// plain view. Nothing here writes: the writes are the server actions in ./actions.ts.
import { type Locale, mergeDocumentParts, resolve, VENUE_MENU_TEMPLATE } from '@restro/core'
import { loadMenuDocument, loadUnplacedItems } from '@restro/core/apply'
import type { Venue } from '@restro/db'
import { getLocale } from 'next-intl/server'

import { isAdminLocale, toDataLocale } from '@/i18n/locales'
import { getPool } from '@/server/db'
import { getVenueMenuId } from '@/server/menus'

import { Composer } from './composer'
import { NoMenu } from './no-menu'
import { buildComposerView } from './view-model'

export async function ComposerTab({ tenantId, venue }: { tenantId: string; venue: Venue }) {
  const menuId = await getVenueMenuId(tenantId, venue.id)
  if (!menuId) return <NoMenu venueId={venue.id} />

  const pool = getPool()
  const [document, unplaced] = await Promise.all([
    loadMenuDocument(pool, tenantId, menuId),
    loadUnplacedItems(pool, tenantId, menuId),
  ])
  const merged = mergeDocumentParts(document, unplaced)

  const defaultLocale = venue.defaultLocale as Locale
  const enabledLocales = venue.enabledLocales as Locale[]
  const resolved = resolve(VENUE_MENU_TEMPLATE, merged, {
    venueScope: `venue:${venue.id}`,
    // The first language is the default one (check V3).
    locales: [defaultLocale, ...enabledLocales.filter((locale) => locale !== defaultLocale)],
    now: new Date().toISOString(),
  })

  const uiLocale = await getLocale()
  const view = buildComposerView({
    doc: merged,
    resolved,
    displayLocale: toDataLocale(isAdminLocale(uiLocale) ? uiLocale : 'bg'),
  })

  return (
    <Composer
      venueId={venue.id}
      view={view}
      defaultLocale={defaultLocale}
      enabledLocales={enabledLocales}
    />
  )
}
