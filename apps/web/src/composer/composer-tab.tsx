// The Studio tab, a server component (U4), with its two subtabs (D92, D129):
//
// - Structure: the menu the URL names (`?menu=`, else the live one; one of the venue's several,
//   D88), with the menu switcher on top and the Guest functions card under the menu. It reads the
//   menu document and the items that sit in no section (core/apply, read side), resolves it for this
//   venue and hands the client component a plain view.
// - Design: a page of its own (`/venues/<id>/design`), which reads its own data; the subtab only
//   leads there.
//
// Nothing here writes: the writes are the server actions in ./actions.ts, `@/server/menus-actions`
// and the guest functions' own.
import {
  CurrencySchema,
  type Locale,
  liveEditions,
  mergeDocumentParts,
  type NodeId,
  readGuestFeatures,
  resolve,
  serviceDate,
  VENUE_MENU_TEMPLATE,
} from '@restro/core'
import {
  listTags,
  loadHeldNewItemIds,
  loadMenuDocument,
  loadUnplacedItems,
  type MenuSummary,
} from '@restro/core/apply'
import { type Venue, withTenant } from '@restro/db'
import { getLocale } from 'next-intl/server'
import { Suspense } from 'react'
import { readNameFallbackNodeIds } from '@/connectors/sync-reads'
import { isAdminLocale, toDataLocale } from '@/i18n/locales'
import { composerMenusOf } from '@/server/composer/menu'
import { readItemPayFirstDefault } from '@/server/composer/pay-first'
import { getPool } from '@/server/db'
import { canManageIntegration, canMarkSoldOut } from '@/server/roles'
import { loadTillLabels, tillLabelOf } from '@/server/till-label'
import { venueHasTill } from '@/server/venues'

import { Composer } from './composer'
import { ComposerSkeleton } from './composer-skeleton'
import { ComposerSubtabs } from './composer-subtabs'
import { GuestFeaturesCard } from './guest-features-panel'
import { MenuBar } from './menu-bar'
import { NoMenu } from './no-menu'
import { buildComposerView } from './view-model'

interface ComposerTabProps {
  readonly tenantId: string
  /** The person's role in the organisation: who may change what. */
  readonly role: string | null | undefined
  readonly venue: Venue
  /** `?menu=`: the menu to open (else the live one). */
  readonly menu?: unknown
}

export function ComposerTab({ tenantId, role, venue, menu }: ComposerTabProps) {
  return (
    <ComposerSubtabs
      venueId={venue.id}
      structure={
        <Suspense fallback={<ComposerSkeleton />}>
          <StructureSubtab tenantId={tenantId} role={role} venue={venue} menu={menu} />
        </Suspense>
      }
    />
  )
}

/** Structure: the menu switcher, then the section tree and the items, then the Guest functions. */
async function StructureSubtab({ tenantId, role, venue, menu: requested }: ComposerTabProps) {
  const { menus, current } = await composerMenusOf(tenantId, venue.id, requested)
  const manager = canManageIntegration(role)
  const guestFeatures = (
    <GuestFeaturesCard
      venueId={venue.id}
      features={readGuestFeatures(venue.settings)}
      canEdit={manager}
    />
  )
  if (current === null) {
    return (
      <div className="grid gap-4">
        <NoMenu venueId={venue.id} canCreate={manager} />
        {guestFeatures}
      </div>
    )
  }
  const menuId = current.id as NodeId

  const pool = getPool()
  const [
    document,
    unplaced,
    heldNewIds,
    tags,
    hasTill,
    tillLabels,
    nameFallbackIds,
    payFirstDefault,
  ] = await Promise.all([
    loadMenuDocument(pool, tenantId, menuId),
    loadUnplacedItems(pool, tenantId, menuId),
    // New items the sync hid for review (publish.new_items = hold): they get a badge.
    loadHeldNewItemIds(pool, tenantId),
    // The venue's tags in order, archived ones too (the Tags panel lists them to restore).
    listTags(pool, tenantId, venue.id, { includeArchived: true }),
    // A venue with a till gets its items from the till only (D66): no "New item" there.
    venueHasTill(tenantId, venue.id),
    // The name of the till, for "From {source}" and the like (brief CF-03).
    loadTillLabels(pool, tenantId),
    // Names that are the till's own, standing in for a missing public one: they get a warning (D75).
    withTenant(pool, tenantId, (tx) => readNameFallbackNodeIds(tx)),
    // Where pay first can take effect, an item's payment mode is set here (D122 §8, #218).
    readItemPayFirstDefault(pool, tenantId, venue),
  ])
  const merged = mergeDocumentParts(document, unplaced)

  const defaultLocale = venue.defaultLocale as Locale
  // Euro is the only currency there is (D10); a venue row with another one is not shown a wrong label.
  const parsedCurrency = CurrencySchema.safeParse(venue.currency)
  const currency = parsedCurrency.success ? parsedCurrency.data : 'EUR'
  const enabledLocales = venue.enabledLocales as Locale[]
  const now = new Date()
  const resolved = resolve(VENUE_MENU_TEMPLATE, merged, {
    venueScope: `venue:${venue.id}`,
    // Tonight's sold-out marks count, and no earlier evening's (D46): the editions of the live menu.
    edition: liveEditions(venue.id, serviceDate(now, venue.timezone, venue.serviceDayEndsAt)),
    // The first language is the default one (check V3).
    locales: [defaultLocale, ...enabledLocales.filter((locale) => locale !== defaultLocale)],
    now: now.toISOString(),
  })

  const uiLocale = await getLocale()
  // One read gives the view, its badges and the "Overrides to review" of each item (V12).
  const view = buildComposerView({
    doc: merged,
    resolved,
    displayLocale: toDataLocale(isAdminLocale(uiLocale) ? uiLocale : 'bg'),
    heldNewIds,
    tags,
    tillLabel: tillLabelOf(merged.links, tillLabels),
    nameFallbackIds,
  })

  return (
    <div className="grid gap-4">
      <MenuBar
        key={`bar:${menuId}`}
        venueId={venue.id}
        venueName={venue.name}
        menus={menus.map(menuChoice)}
        currentId={menuId}
      />
      <Composer
        // Another menu is another document: nothing of the last one's screen state carries over.
        key={`composer:${menuId}`}
        venueId={venue.id}
        menuId={menuId}
        view={view}
        defaultLocale={defaultLocale}
        enabledLocales={enabledLocales}
        currency={currency}
        // On a POS venue the POS says what ran out: no sold-out switch here (D124 §6, #80).
        canMarkSoldOut={canMarkSoldOut(role) && !hasTill}
        canCreateItem={manager}
        hasTill={hasTill}
        canDelete={manager}
        payFirstDefault={payFirstDefault}
      />
      {guestFeatures}
    </div>
  )
}

function menuChoice(menu: MenuSummary) {
  return { id: menu.id, name: menu.name, live: menu.live }
}
