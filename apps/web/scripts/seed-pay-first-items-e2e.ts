// Fixtures for the item payment-mode end-to-end test (#218). Run by the test itself, after
// `seed-paying-e2e.ts` made the Paying Club venue:
//
//   seed   a small menu on that venue (one section, four drinks with Bulgarian and English names)
//          and a clean slate: no item has a payment mode of its own. Idempotent.
//
// Written the way the service paths write it: the document through `apply()`, the clean slate as the
// database owner (the app role deletes no rows). Like `db:seed:dev` this refuses to run unless
// NODE_ENV is development and the database is on this machine.
import { type ChangeSet, type NodeId, newId } from '@restro/core'
import { apply, provisionMenu } from '@restro/core/apply'
import { nodes, withTenant } from '@restro/db'
import { inArray } from 'drizzle-orm'
import pg from 'pg'

import { getPool } from '../src/server/db'
import { assertDevEnvironment } from './lib/guard'

/** Fixed node ids, so running the seed again finds the same document. */
const nodeId = (name: string) => `nd_${name.padEnd(22, '0')}` as NodeId
const SECTION = { id: nodeId('E2ePfiCocktails'), bg: 'Коктейли', en: 'Cocktails' } as const
const ITEMS = [
  { id: nodeId('E2ePfiNegroni'), bg: 'Негрони', en: 'Negroni', price: 1250 },
  { id: nodeId('E2ePfiMojito'), bg: 'Мохито', en: 'Mojito', price: 900 },
  { id: nodeId('E2ePfiSpritz'), bg: 'Шприц', en: 'Spritz', price: 1000 },
  { id: nodeId('E2ePfiCola'), bg: 'Кола', en: 'Cola', price: 400 },
] as const

const eur = (amountMinor: number) => ({ amount_minor: amountMinor, currency: 'EUR' })
const manual = (node: string, fieldKey: string, value: unknown) => ({
  op: 'setField',
  node: { id: node },
  fieldKey,
  layer: 'manual',
  scope: 'master',
  value,
})

async function seed(): Promise<void> {
  const ownerUrl = process.env.DATABASE_URL_OWNER
  if (!ownerUrl) throw new Error('seed-pay-first-items-e2e needs DATABASE_URL_OWNER.')
  assertDevEnvironment({ ...process.env, DATABASE_URL: ownerUrl })
  const owner = new pg.Pool({ connectionString: ownerUrl, max: 1 })
  const pool = getPool()
  try {
    const { rows } = await owner.query<{ tenant_id: string; id: string }>(
      `select tenant_id, id from restro.venues where slug = 'paying-club'`,
    )
    const venue = rows[0]
    if (!venue) throw new Error('Run scripts/seed-paying-e2e.ts first: there is no Paying Club.')
    const menu = await provisionMenu(pool, venue.tenant_id, venue.id)

    const known = new Set(
      (
        await withTenant(pool, venue.tenant_id, (tx) =>
          tx
            .select({ id: nodes.id })
            .from(nodes)
            .where(inArray(nodes.id, [SECTION.id, ...ITEMS.map((item) => item.id)])),
        )
      ).map((row) => row.id),
    )
    const create = (id: NodeId, nodeType: 'section' | 'item', parent: NodeId | null) =>
      known.has(id)
        ? []
        : [
            {
              op: 'createNode',
              id,
              nodeType,
              parent: parent === null ? null : { id: parent },
              status: 'active',
              ...(nodeType === 'section' ? { sortKey: 'end' } : {}),
            },
          ]
    const result = await apply(pool, venue.tenant_id, {
      id: newId('cs'),
      source: 'manual',
      jobId: newId('jb'),
      actor: 'system',
      observedAt: new Date().toISOString(),
      ops: [
        ...create(SECTION.id, 'section', menu.id),
        manual(SECTION.id, 'title', { bg_BG: SECTION.bg, en_US: SECTION.en }),
        ...ITEMS.flatMap((item) => [
          ...create(item.id, 'item', null),
          manual(item.id, 'name', { bg_BG: item.bg, en_US: item.en }),
          manual(item.id, 'price', eur(item.price)),
          manual(item.id, 'allergens', []),
          ...(known.has(item.id)
            ? []
            : [
                {
                  op: 'setPlacement',
                  item: { id: item.id },
                  section: { id: SECTION.id },
                  sortKey: 'end',
                },
              ]),
        ]),
      ],
    } as ChangeSet)
    if (result.rejected.length > 0) throw new Error('the pay-first item fixtures were refused')

    // A clean slate: no item has a payment mode of its own.
    await owner.query(
      `delete from restro.field_values where field_key = 'payment_mode' and node_id = any($1)`,
      [ITEMS.map((item) => item.id)],
    )
  } finally {
    await owner.end()
  }
}

const [step] = process.argv.slice(2)
if (step !== 'seed') {
  console.error(`seed-pay-first-items-e2e: unknown step "${step}" (seed)`)
  process.exit(1)
}
seed()
  .then(async () => {
    await getPool().end()
    process.exit(0)
  })
  .catch((error: unknown) => {
    console.error(
      `seed-pay-first-items-e2e ${step} failed: ${error instanceof Error ? error.message : String(error)}`,
    )
    process.exit(1)
  })
