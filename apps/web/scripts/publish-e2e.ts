// Publishes the demo venue's menu the real way, for the tags test (brief S3-06): `publishMenu`
// (core/apply), then the worker's own `writePublishFiles`, into the e2e publish folder. Prints one
// JSON line with the ids the test needs to read the files back from `/cdn`. Like the seeds it
// refuses to run unless NODE_ENV is development and the database is local.
import { createPublishStore, publishStoreConfig } from '@restro/assets'
import { publishMenu } from '@restro/core/apply'
import { authOrganization, menus, venues, withTenant } from '@restro/db'
import { eq } from 'drizzle-orm'

import { writeLiveOverlay, writePublishFiles } from '../../worker/src/publish/files'
import { writeOrganizationIndex } from '../../worker/src/publish/organization-index'
import { getAuthDb, getPool } from '../src/server/db'
import { assertDevEnvironment } from './lib/guard'

async function main(): Promise<void> {
  assertDevEnvironment(process.env)
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
  const [menu] = await withTenant(pool, tenantId, (tx) =>
    tx.select({ id: menus.id }).from(menus).where(eq(menus.venueId, venue.id)).limit(1),
  )
  if (!menu) throw new Error('The demo venue has no menu: run the seeds first.')

  const config = publishStoreConfig(process.env)
  if (config.kind !== 'local') throw new Error('the e2e publish store must be local')
  const store = await createPublishStore(config)

  const published = await publishMenu(pool, tenantId, {
    menuId: menu.id as never,
    venueId: venue.id as never,
    reason: 'manual',
    actor: 'system',
  })
  const deps = { pool, store, now: () => new Date() }
  const scope = { tenantId, menuId: menu.id as never, venueId: venue.id as never }
  await writePublishFiles(deps, scope)
  await writeLiveOverlay(deps, scope)
  // The organisation's index (D84), as the publish job writes it after the files.
  await writeOrganizationIndex(deps, tenantId)
  console.log(
    JSON.stringify({
      status: published.status,
      menuId: menu.id,
      venueId: venue.id,
      snapshotId: published.snapshot.id,
    }),
  )
}

main()
  .then(async () => {
    await getPool().end()
    process.exit(0)
  })
  .catch((error: unknown) => {
    console.error(`publish-e2e failed: ${error instanceof Error ? error.stack : String(error)}`)
    process.exit(1)
  })
