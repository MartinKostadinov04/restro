// The demo venue's menu in the database, for the dev seed and the tests that check what the
// composer would show. Goes through core/apply only; see ./demo-menu.ts for what is in it.

import { type NodeId, newId } from '@restro/core'
import { apply, provisionIntegration, provisionMenu, recordSource } from '@restro/core/apply'
import type { DbPool } from '@restro/db'
import { fieldValues, sourceLinks, withTenant } from '@restro/db'
import { and, eq, sql } from 'drizzle-orm'

import {
  DEMO_BARSY_HOST,
  DEMO_OWNED_ITEM,
  demoManualChangeSet,
  demoOwnedItemChangeSet,
  demoPullChangeSet,
  demoSourceRecords,
} from './demo-menu'

/**
 * The demo venue's menu: its (empty) menu, a made-up barsy integration with a tier-1 record for
 * every category and article, then a pull of the demo catalogue through apply(), the descriptions
 * written here, and one item made here. Safe to repeat: identity comes from the links, and the
 * hand-made item is looked up by its name before it is created. Moving things around in the
 * composer is never undone (placements are only added at the end of a section).
 */
export async function seedDemoMenu(
  pool: DbPool,
  tenantId: string,
  venueId: string,
  userId: string,
): Promise<{ sections: number; articles: number; created: number }> {
  const menu = await provisionMenu(pool, tenantId, venueId)
  const integration = await provisionIntegration(pool, tenantId, {
    kind: 'barsy',
    host: DEMO_BARSY_HOST,
  })

  const categoryRecords = new Map<string, string>()
  const articleRecords = new Map<string, string>()
  for (const record of demoSourceRecords()) {
    const stored = await recordSource(pool, tenantId, {
      integrationId: integration.id,
      externalType: record.externalType,
      externalId: record.externalId,
      scope: 'master',
      raw: record.raw,
      payload: record.payload,
    })
    ;(record.externalType === 'category' ? categoryRecords : articleRecords).set(
      record.externalId,
      stored.id,
    )
  }

  const pull = await apply(
    pool,
    tenantId,
    demoPullChangeSet({
      integrationId: integration.id,
      venueId,
      menuId: menu.id,
      categoryRecords,
      articleRecords,
    }),
  )
  if (pull.rejected.length > 0) {
    throw new Error(
      `the demo menu was refused: ${pull.rejected.map((rejection) => rejection.code).join(', ')}`,
    )
  }

  // The items the pull created or found, by their (made-up) article id.
  const links = await withTenant(pool, tenantId, (tx) =>
    tx
      .select({ externalId: sourceLinks.externalId, nodeId: sourceLinks.nodeId })
      .from(sourceLinks)
      .where(
        and(eq(sourceLinks.integrationId, integration.id), eq(sourceLinks.externalType, 'article')),
      ),
  )
  const manual = demoManualChangeSet({
    userId,
    nodeIdByArticle: new Map(links.map((link) => [link.externalId, link.nodeId as NodeId])),
  })
  if (manual) {
    const written = await apply(pool, tenantId, manual)
    if (written.rejected.length > 0) throw new Error('the demo descriptions were refused')
  }

  const [existing] = await withTenant(pool, tenantId, (tx) =>
    tx
      .select({ nodeId: fieldValues.nodeId })
      .from(fieldValues)
      .where(
        and(
          eq(fieldValues.fieldKey, 'name'),
          eq(fieldValues.layer, 'manual'),
          sql`${fieldValues.value}->>'bg_BG' = ${DEMO_OWNED_ITEM.name.bg_BG}`,
        ),
      )
      .limit(1),
  )
  let created = pull.createdNodeIds.length
  if (!existing) {
    const owned = await apply(
      pool,
      tenantId,
      demoOwnedItemChangeSet({ userId, itemId: newId('nd') }),
    )
    if (owned.rejected.length > 0) throw new Error('the hand-made demo item was refused')
    created += owned.createdNodeIds.length
  }
  return { sections: categoryRecords.size, articles: articleRecords.size, created }
}
