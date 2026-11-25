// Demo Bar in the database, for the dev seed and the tests (#71; test-POS design §6): a venue on a
// `sim` instance, linked to its till venue, with the menu the scenario file describes written
// through `apply()` with POS provenance. Its bars, tables and payment tables are NOT written here:
// they come from the simulator through the worker's floor reading (`floor-read`), like any POS
// venue's. The venue's floor source only names which of the POS's tables are payment tables, so
// they are marked when the floor first appears (D122 §8).
//
// Safe to repeat: the instance, the venue and the link are found, the menu's nodes are found by
// their links.

import {
  appendSourceRecords,
  apply,
  createIntegration,
  mapBarsyVenue,
  provisionMenu,
  provisionVenue,
  setFloorSource,
  updateIntegration,
  upsertBarsyVenues,
} from '@restro/core/apply'
import { type DbPool, venues, withTenant } from '@restro/db'
import { eq } from 'drizzle-orm'

import {
  DEMO_BAR_BID,
  DEMO_BAR_HOST,
  DEMO_BAR_INSTANCE_NAME,
  DEMO_BAR_SCENARIO,
  DEMO_BAR_VENUE,
  demoBarPullChangeSet,
  demoBarSourceRecords,
  loadDemoBarScenario,
  recordKey,
} from './demo-bar'

export interface SeededDemoBar {
  readonly venueId: string
  readonly integrationId: string
  readonly sections: number
  readonly articles: number
  readonly created: number
}

/** Seeds Demo Bar into the tenant; the caller decides whether to (`SEED_DEMO_MENU=0` skips it). */
export async function seedDemoBar(pool: DbPool, tenantId: string): Promise<SeededDemoBar> {
  const scenario = loadDemoBarScenario()

  const [found] = await withTenant(pool, tenantId, (tx) =>
    tx.select({ id: venues.id }).from(venues).where(eq(venues.slug, DEMO_BAR_VENUE.slug)).limit(1),
  )
  const venueId = found?.id ?? (await provisionVenue(pool, tenantId, DEMO_BAR_VENUE)).id
  const menu = await provisionMenu(pool, tenantId, venueId)

  // The instance: a simulated POS on this machine. The worker reads its switches from the scenario
  // the instance names, and refuses the kind in production.
  const integration = await createIntegration(pool, tenantId, {
    kind: 'sim',
    name: DEMO_BAR_INSTANCE_NAME,
    host: DEMO_BAR_HOST,
  })
  await updateIntegration(pool, tenantId, integration.id, {
    config: { sim_scenario: DEMO_BAR_SCENARIO },
    status: 'connected',
  })

  // The till venue Demo Bar serves, and the venue's floor source: the whole floor, with the POS's
  // payment tables named so they are marked when they first appear.
  await upsertBarsyVenues(pool, tenantId, integration.id, [
    { bid: DEMO_BAR_BID, name: DEMO_BAR_VENUE.name },
  ])
  const mapped = await mapBarsyVenue(pool, tenantId, integration.id, DEMO_BAR_BID, venueId)
  if (!mapped.ok) throw new Error(`Demo Bar could not be linked to its till venue: ${mapped.error}`)
  await setFloorSource(pool, tenantId, {
    venueId,
    source: { halls: null, bars: null, paymentTables: [...scenario.paymentTableNames] },
  })

  // The menu: tier-1 records, then one change set through apply() under the instance's till source.
  const records = new Map<string, string>()
  for (const record of demoBarSourceRecords(scenario)) {
    const [stored] = await appendSourceRecords(pool, tenantId, integration.id, [
      {
        externalType: record.externalType,
        externalId: record.externalId,
        scope: 'master',
        raw: record.raw,
        payload: record.payload,
      },
    ])
    if (!stored) throw new Error('a source record was not stored')
    records.set(recordKey(record.externalType, record.externalId), stored.id)
  }
  const pull = await apply(
    pool,
    tenantId,
    demoBarPullChangeSet({
      scenario,
      integrationId: integration.id,
      venueId,
      menuId: menu.id,
      records,
    }),
  )
  if (pull.rejected.length > 0) {
    throw new Error(
      `the Demo Bar menu was refused: ${pull.rejected.map((rejection) => rejection.code).join(', ')}`,
    )
  }
  return {
    venueId,
    integrationId: integration.id,
    sections: scenario.sections.length,
    articles: scenario.sections.reduce((sum, section) => sum + section.items.length, 0),
    created: pull.createdNodeIds.length,
  }
}
