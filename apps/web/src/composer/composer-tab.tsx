// The Composer tab, a server component (U4), with its two subtabs (D92, brief S6):
//
// - Structure: the menu the URL names (`?menu=`, else the live one; one of the venue's several,
//   D88), with the menu switcher and its layout on top. It reads the menu document and the items
//   that sit in no section (core/apply, read side), resolves it for this venue and hands the client
//   component a plain view.
// - Design: the venue's Design tab as it was (template, look, logo; S7 restyles it), and the Guest
//   features card that used to open from Structure.
//
// Only the open subtab reads its data; the other shows its skeleton until it is chosen. Nothing here
// writes: the writes are the server actions in ./actions.ts, `@/server/menus-actions` and the Design
// tab's own.
import {
  CurrencySchema,
  type Locale,
  liveEditions,
  menuSettingsOf,
  mergeDocumentParts,
  type NodeId,
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
  type MenuSummary,
} from '@restro/core/apply'
import { type Venue, withTenant } from '@restro/db'
import { resolveOptions } from '@restro/shell'
import { getLocale } from 'next-intl/server'
import { Suspense } from 'react'
import { readNameFallbackNodeIds } from '@/connectors/sync-reads'
import { DesignSkeleton } from '@/design/design-skeleton'
import { DesignTab } from '@/design/design-tab'
import { manifestOf } from '@/faces/manifests'
import { isAdminLocale, toDataLocale } from '@/i18n/locales'
import { composerMenusOf } from '@/server/composer/menu'
import { getPool } from '@/server/db'
import { canManageIntegration, canMarkSoldOut } from '@/server/roles'
import { loadTillLabels, tillLabelOf } from '@/server/till-label'
import { venueHasTill } from '@/server/venues'

import { Composer } from './composer'
import { ComposerSkeleton } from './composer-skeleton'
import { ComposerSubtabs } from './composer-subtabs'
import {
  type FeatureOptionDeclaration,
  GuestFeaturesCard,
  type TemplateFeatureOptions,
} from './guest-features-panel'
import { MenuBar } from './menu-bar'
import { NoMenu } from './no-menu'
import { type ComposerSubtab, composerSubtabOf } from './subtabs'
import { buildComposerView } from './view-model'

interface ComposerTabProps {
  readonly tenantId: string
  /** The person's role in the organisation: who may change what. */
  readonly role: string | null | undefined
  readonly venue: Venue
  /** `?menu=`: the menu to open (else the live one). */
  readonly menu?: unknown
  /** `?sub=`: the subtab to open (else Structure). */
  readonly sub?: unknown
}

export function ComposerTab({ tenantId, role, venue, menu, sub }: ComposerTabProps) {
  const open: ComposerSubtab = composerSubtabOf(sub)
  return (
    <ComposerSubtabs
      contents={{
        structure:
          open === 'structure' ? (
            <Suspense fallback={<ComposerSkeleton />}>
              <StructureSubtab tenantId={tenantId} role={role} venue={venue} menu={menu} />
            </Suspense>
          ) : (
            <ComposerSkeleton />
          ),
        design:
          open === 'design' ? (
            <Suspense fallback={<DesignSkeleton />}>
              <DesignSubtab tenantId={tenantId} role={role} venue={venue} />
            </Suspense>
          ) : (
            <DesignSkeleton />
          ),
      }}
    />
  )
}

/** Structure: the menu switcher and layout, then the section tree and the items. */
async function StructureSubtab({
  tenantId,
  role,
  venue,
  menu: requested,
}: Omit<ComposerTabProps, 'sub'>) {
  const { menus, current } = await composerMenusOf(tenantId, venue.id, requested)
  if (current === null) {
    return <NoMenu venueId={venue.id} canCreate={canManageIntegration(role)} />
  }
  const menuId = current.id as NodeId

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
  const manager = canManageIntegration(role)

  return (
    <div className="grid gap-4">
      <MenuBar
        // A new menu starts from its own saved settings.
        key={`bar:${menuId}`}
        venueId={venue.id}
        venueName={venue.name}
        menus={menus.map(menuChoice)}
        currentId={menuId}
        settings={menuSettingsOf(current.settings)}
        canEdit={manager}
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
        canMarkSoldOut={canMarkSoldOut(role)}
        canCreateItem={manager}
        hasTill={hasTill}
        canDelete={manager}
      />
    </div>
  )
}

function menuChoice(menu: MenuSummary) {
  return { id: menu.id, name: menu.name, live: menu.live }
}

/** Design: the venue's Design tab and the Guest features card (D92). */
async function DesignSubtab({ tenantId, role, venue }: Omit<ComposerTabProps, 'menu' | 'sub'>) {
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
  return (
    <div className="grid gap-6">
      <DesignTab tenantId={tenantId} role={role} venue={venue} />
      <GuestFeaturesCard
        venueId={venue.id}
        features={guestFeatures}
        options={featureOptions}
        canEdit={canManageIntegration(role)}
      />
    </div>
  )
}
