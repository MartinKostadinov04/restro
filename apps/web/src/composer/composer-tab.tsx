// The Composer tab, a server component (U4): it reads the menu document and the items that sit in
// no section (core/apply, read side), resolves it for this venue and hands the client component a
// plain view. Nothing here writes: the writes are the server actions in ./actions.ts.
import {
  CurrencySchema,
  type Locale,
  liveEditions,
  mergeDocumentParts,
  readGuestFeatures,
  readPresentation,
  resolve,
  serviceDate,
  VENUE_MENU_TEMPLATE,
} from '@restro/core'
import {
  listTags,
  loadHeldNewItemIds,
  loadMenuDocument,
  loadUnplacedItems,
} from '@restro/core/apply'
import { type Venue, withTenant } from '@restro/db'
import { resolveOptions } from '@restro/shell'
import { getLocale } from 'next-intl/server'
import { readNameFallbackNodeIds } from '@/connectors/sync-reads'
import { manifestOf } from '@/faces/manifests'
import { isAdminLocale, toDataLocale } from '@/i18n/locales'
import { getPool } from '@/server/db'
import { getVenueMenuId } from '@/server/menus'
import { canManageIntegration, canMarkSoldOut } from '@/server/roles'
import { requireTenant } from '@/server/session'
import { loadTillLabels, tillLabelOf } from '@/server/till-label'
import { venueHasTill } from '@/server/venues'

import { Composer } from './composer'
import type { FeatureOptionDeclaration, TemplateFeatureOptions } from './guest-features-panel'
import { NoMenu } from './no-menu'
import { buildComposerView } from './view-model'

export async function ComposerTab({ tenantId, venue }: { tenantId: string; venue: Venue }) {
  const menuId = await getVenueMenuId(tenantId, venue.id)
  if (!menuId) {
    const { organization } = await requireTenant()
    return <NoMenu venueId={venue.id} canCreate={canManageIntegration(organization.role)} />
  }

  const pool = getPool()
  const [document, unplaced, heldNewIds, tags, hasTill, tillLabels, nameFallbackIds] =
    await Promise.all([
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
  // The page is only reached signed in; the role decides who sees the sold-out controls (D46).
  const { organization } = await requireTenant()

  // The guest services the venue switched on, and the template's own feature switches (SH-05b):
  // the template is the venue's, or the registry default; its options are the stored values or the
  // face's defaults, for the options the face declares with group `feature` only.
  const guestFeatures = readGuestFeatures(venue.settings)
  const presentation = readPresentation(venue.settings)
  const manifest = manifestOf(presentation?.face)
  const featureValues = resolveOptions(manifest, presentation?.options)
  const declared = Object.entries(manifest.options).flatMap(([key, option]) => {
    if (option.group !== 'feature') return []
    const base = { key, default: option.default, label: option.label }
    const declaration: FeatureOptionDeclaration =
      option.type === 'enum'
        ? { ...base, type: 'enum', values: option.values }
        : { ...base, type: 'boolean' }
    return [declaration]
  })
  const featureOptions: TemplateFeatureOptions = {
    declared,
    values: Object.fromEntries(
      declared.map((option) => [option.key, featureValues[option.key] ?? option.default] as const),
    ),
  }

  const uiLocale = await getLocale()
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
    <Composer
      venueId={venue.id}
      view={view}
      defaultLocale={defaultLocale}
      enabledLocales={enabledLocales}
      currency={currency}
      canMarkSoldOut={canMarkSoldOut(organization.role)}
      canCreateItem={canManageIntegration(organization.role)}
      hasTill={hasTill}
      guestFeatures={guestFeatures}
      featureOptions={featureOptions}
      canEditFeatures={canManageIntegration(organization.role)}
    />
  )
}
