// Fixtures for the item sheet's end-to-end test (brief S2-06b): in the demo venue's menu, one
// barsy-linked item ("Негрони (e2e)") with a venue-scoped price, allergens and a portion, placed
// in a section. Run after `pnpm db:seed:dev` (the e2e global setup runs both); idempotent, and it
// puts the item back to a clean state each time (no hand-made values, no history), so the test
// always starts from "everything comes from barsy".
//
// The data goes in through `apply()` like any other (a barsy change set). The only exceptions are
// the integration row and its source record: no writer for them exists until the sync jobs of
// S2-03 do, so they are inserted with the database owner, which this script uses nowhere else.
// Like db:seed:dev it refuses to run unless NODE_ENV is development and the database is local.
import { createHash } from 'node:crypto'

import { type ChangeSetOp, newId } from '@restro/core'
import { apply, provisionMenu } from '@restro/core/apply'
import { authOrganization, venues, withTenant } from '@restro/db'
import { eq } from 'drizzle-orm'
import pg from 'pg'

import { getAuthDb, getPool } from '../src/server/db'
import { assertDevEnvironment } from './lib/guard'

const HOST = 'e2e.item-sheet.test'
const ARTICLE = 'e2e-negroni'
const CATEGORY = 'e2e-cocktails'
const ITEM_NAME = 'Негрони (e2e)'

async function main(): Promise<void> {
  assertDevEnvironment(process.env)
  const ownerUrl = process.env.DATABASE_URL_OWNER
  if (!ownerUrl) throw new Error('seed-item-sheet needs DATABASE_URL_OWNER (see .env.example).')
  assertDevEnvironment({ ...process.env, DATABASE_URL: ownerUrl })

  const pool = getPool()
  const [organization] = await getAuthDb()
    .select({ id: authOrganization.id })
    .from(authOrganization)
    .where(eq(authOrganization.slug, 'demo-club'))
    .limit(1)
  if (!organization) throw new Error('Run `pnpm db:seed:dev` first: there is no demo organisation.')
  const tenantId = organization.id
  const [venue] = await withTenant(pool, tenantId, (tx) =>
    tx.select({ id: venues.id }).from(venues).where(eq(venues.slug, 'demo-club')).limit(1),
  )
  if (!venue) throw new Error('Run `pnpm db:seed:dev` first: there is no demo venue.')
  const menu = await provisionMenu(pool, tenantId, venue.id)

  const owner = new pg.Pool({ connectionString: ownerUrl, max: 1 })
  try {
    // The integration and its source record (see the header: no writer exists yet).
    const found = await owner.query<{ id: string }>(
      `select id from restro.integrations where tenant_id = $1 and host = $2`,
      [tenantId, HOST],
    )
    const integration = found.rows[0]?.id ?? newId('in')
    if (!found.rows[0]) {
      await owner.query(
        `insert into restro.integrations (id, tenant_id, kind, host) values ($1, $2, 'barsy', $3)`,
        [integration, tenantId, HOST],
      )
    }
    const recordRows = await owner.query<{ id: string }>(
      `select id from restro.source_records where integration_id = $1 and external_id = $2`,
      [integration, ARTICLE],
    )
    const record = recordRows.rows[0]?.id ?? newId('sr')
    if (!recordRows.rows[0]) {
      await owner.query(
        `insert into restro.source_records
           (id, tenant_id, integration_id, external_type, external_id, scope, content_hash, raw, payload)
         values ($1, $2, $3, 'article', $4, 'master', $5, '{}', '{}'::jsonb)`,
        [
          record,
          tenantId,
          integration,
          ARTICLE,
          createHash('sha256').update(ARTICLE).digest('hex'),
        ],
      )
    }

    // The item and its section, as a pull would write them. A createNode whose link exists
    // already collapses onto the linked node, so running this again changes nothing.
    const article = { integration, externalType: 'article', externalId: ARTICLE }
    const category = { integration, externalType: 'category', externalId: CATEGORY }
    const field = (fieldKey: string, value: unknown, scope = 'master'): ChangeSetOp =>
      ({
        op: 'setField',
        node: { link: article },
        fieldKey,
        layer: 'barsy',
        scope,
        value,
        sourceRecordId: record,
        mappingVersion: 1,
      }) as ChangeSetOp
    const section = newId('nd')
    const item = newId('nd')
    await apply(pool, tenantId, {
      id: newId('cs'),
      source: `barsy:${integration}`,
      jobId: newId('jb'),
      actor: `integration:${integration}`,
      observedAt: new Date().toISOString(),
      ops: [
        {
          op: 'createNode',
          id: section,
          nodeType: 'section',
          parent: { id: menu.id },
          status: 'active',
          sortKey: 'end',
        },
        { op: 'linkSource', node: { id: section }, link: category },
        {
          op: 'setField',
          node: { link: category },
          fieldKey: 'title',
          layer: 'barsy',
          scope: 'master',
          value: { bg_BG: 'Коктейли (e2e)', en_US: 'Cocktails (e2e)' },
          sourceRecordId: record,
          mappingVersion: 1,
        },
        { op: 'createNode', id: item, nodeType: 'item', parent: null, status: 'active' },
        { op: 'linkSource', node: { id: item }, link: article },
        field('name', { bg_BG: ITEM_NAME }),
        field('price', { amount_minor: 1250, currency: 'EUR' }, `venue:${venue.id}`),
        field('for_sale', true, `venue:${venue.id}`),
        field('visible', true),
        field('allergens', ['sulphites']),
        field('portion', { value: 80, unit: 'ml' }),
        {
          op: 'setPlacement',
          item: { link: article },
          section: { link: category },
          sortKey: 'end',
        },
      ] as ChangeSetOp[],
    })

    // A clean slate for the test: remove whatever a previous run wrote by hand, and its history.
    const [node] = (
      await owner.query<{ node_id: string }>(
        `select node_id from restro.source_links
          where integration_id = $1 and external_type = 'article' and external_id = $2`,
        [integration, ARTICLE],
      )
    ).rows
    if (node) {
      await owner.query(
        `delete from restro.field_values where node_id = $1 and layer in ('manual', 'override')`,
        [node.node_id],
      )
      await owner.query(`delete from restro.events where node_id = $1 and source = 'manual'`, [
        node.node_id,
      ])
    }
    console.log(
      JSON.stringify({
        level: 'info',
        event: 'seed_item_sheet_done',
        itemName: ITEM_NAME,
        venueId: venue.id,
      }),
    )
  } finally {
    await owner.end()
  }
}

main()
  .then(async () => {
    await getPool().end()
    process.exit(0)
  })
  .catch((error: unknown) => {
    console.error(
      `seed-item-sheet failed: ${error instanceof Error ? error.message : String(error)}`,
    )
    process.exit(1)
  })
