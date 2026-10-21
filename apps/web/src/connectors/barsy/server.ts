// The server side of the barsy connector for the platform's Integrations service (adjustments I1,
// I2, B2, B6, D81, D82): its address rules, how its credentials are sealed, its queue jobs, when a
// venue can be pulled, and the two things that are barsy's alone in the admin: the allergen
// characteristic and the language of untagged text (an instance's system settings, B6) and the
// price a venue shows (the barsy part of its Menu source, B2).
//
// Everything here reads and writes only our own database and queue; the web app never calls
// barsy (the worker does). Passwords are sealed here and go no further.
import { type IntegrationId, isLocale, JOB_NAMES, type TenantId, type VenueId } from '@restro/core'
import {
  clearBarsyVenueChoices,
  readSyncState,
  setVenuePriceSource,
  updateIntegration,
} from '@restro/core/apply'
import { sealBarsyCredentials } from '@restro/core/seal'
import { type Integration, type ReadTx, sourceRecords, withTenant } from '@restro/db'
import { and, desc, eq } from 'drizzle-orm'
import { z } from 'zod'

import type { BarsyInstanceSettings, BarsyPriceSource, BarsyVenueSource } from '../data'
import type { ConnectorServer } from '../server-types'
import { readHeldSyncs } from '../sync-reads'
import { detectAllergenOption, readDetailOptions } from './allergens'
import { parseBarsyHost } from './host'

/** The language of text that carries no language tag, until the manager says otherwise (D77). */
const DEFAULT_LOCALE = 'bg_BG'

/** The settings card's input: the characteristic holding allergens (null = detect) and the language. */
const InstanceSettingsInput = z.strictObject({
  allergenKey: z.string().min(1).max(128).nullable(),
  defaultLocale: z.string().min(1).max(16),
})

/** The venue part's input: which price the menu shows. */
const VenueSourceInput = z.strictObject({ priceSource: z.enum(['actual_price', 'current_price']) })

function priceSourceOf(value: unknown): BarsyPriceSource {
  return value === 'current_price' ? 'current_price' : 'actual_price'
}

/** The characteristics barsy listed, from the latest stored record of the details tree. */
async function readAllergenOptions(tx: ReadTx, integrationId: string) {
  const [details] = await tx
    .select({ payload: sourceRecords.payload })
    .from(sourceRecords)
    .where(
      and(
        eq(sourceRecords.integrationId, integrationId),
        eq(sourceRecords.externalType, 'article_details'),
        eq(sourceRecords.externalId, 'tree'),
      ),
    )
    .orderBy(desc(sourceRecords.fetchedAt))
    .limit(1)
  return readDetailOptions(details?.payload ?? null)
}

export const barsyServer: ConnectorServer = {
  kind: 'barsy',
  jobNames: { connect: JOB_NAMES.barsyConnect, pull: JOB_NAMES.barsyFullPull },
  // The cached trees, the sync state and the "Not used" marks belong to one installation.
  installationConfigKeys: ['catalogue_trees', 'sync', 'not_used'],

  parseHost: parseBarsyHost,

  seal(credentials, binding) {
    return sealBarsyCredentials(credentials, binding)
  },

  async queueConnect(enqueue, ids) {
    await enqueue(JOB_NAMES.barsyConnect, {
      tenantId: ids.tenantId as TenantId,
      integrationId: ids.integrationId as IntegrationId,
    })
  },

  queuePull(enqueue, ids) {
    return enqueue(JOB_NAMES.barsyFullPull, {
      tenantId: ids.tenantId as TenantId,
      integrationId: ids.integrationId as IntegrationId,
      venueId: ids.venueId as VenueId,
    })
  },

  async forgetInstallation(pool, tenantId, integrationId) {
    await clearBarsyVenueChoices(pool, tenantId, integrationId)
  },

  // A pull needs the menu roots barsy designates for the venue (D88), or the old picker's choice
  // for a venue mapped before the roots were read.
  canPull: (link) =>
    link.publicCatId !== null || link.treeCatId !== null || link.catalogueRootCatId !== null,

  lastSyncedAt(integration, link) {
    const sync = readSyncState(integration.config, link.bid)
    const moments = [sync.last_full_pull_at, sync.last_incremental_at].filter(
      (moment): moment is string => moment !== undefined,
    )
    return moments.sort().at(-1) ?? null
  },

  readHeldSyncs,

  async loadInstanceSettings(tx, integration): Promise<BarsyInstanceSettings> {
    const config = integration.config
    const options = await readAllergenOptions(tx, integration.id)
    return {
      kind: 'barsy',
      allergenKey:
        typeof config.allergen_detail_key === 'string' ? config.allergen_detail_key : null,
      allergenDetected: detectAllergenOption(options),
      allergenOptions: options,
      defaultLocale: isLocale(config.default_locale) ? config.default_locale : DEFAULT_LOCALE,
    }
  },

  async saveInstanceSettings({ pool, tenantId, integration }, input) {
    const parsed = InstanceSettingsInput.safeParse(input)
    if (!parsed.success || !isLocale(parsed.data.defaultLocale)) return 'invalid'
    const { allergenKey, defaultLocale } = parsed.data
    if (allergenKey !== null) {
      const options = await withTenant(pool, tenantId, (tx) =>
        readAllergenOptions(tx, integration.id),
      )
      if (!options.some((option) => option.key === allergenKey)) return 'invalid'
    }
    const updated = await updateIntegration(pool, tenantId, integration.id, {
      // null removes the key: the sync detects the characteristic by its name again.
      config: { allergen_detail_key: allergenKey, default_locale: defaultLocale },
    })
    return updated ? 'saved' : 'not_found'
  },

  loadVenueSource(integration: Integration, link): BarsyVenueSource {
    // The price is per venue (D73, CF-16): the venue's own setting, else the instance's old default.
    return {
      kind: 'barsy',
      priceSource: priceSourceOf(link.priceSource ?? integration.config.price_source),
    }
  },

  async saveVenueSource({ pool, tenantId, integration, link }, input) {
    const parsed = VenueSourceInput.safeParse(input)
    if (!parsed.success) return 'invalid'
    const stored = await setVenuePriceSource(
      pool,
      tenantId,
      integration.id,
      link.bid,
      parsed.data.priceSource,
    )
    return stored ? 'saved' : 'not_found'
  },
}
