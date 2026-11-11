// Fixtures for the guest page's end-to-end test (brief S3-03): the demo venue's menu gets three
// photos, a few dietary labels, a brand colour and a logo, a table code is written, and the menu is
// PUBLISHED into the e2e publish folder (`LOCAL_PUBLISH_DIR`), so the demo venue's menu address
// (`/m/demo-club-<its public code>`, D68) and `/t/<token>` have something to show. A second,
// hand-made menu with tags (the shell's `tags-dietary` fixture) is written under the fixed code
// `TAG_PUBLIC_ID` (address `/m/tag-fixture-<code>`), because tags can only be assigned in the
// composer from S3-06 on and the tag filter needs some. The demo venue's code is random and made
// by the database seed; the specs read it from the database (e2e/menu-path.ts), and this script
// prints the addresses when it is done. A third menu (`LOOK_PUBLIC_ID`, `/m/look-fixture-<code>`) is the
// same fixture with a forced dark scheme and another font (SH-04).
//
// The publish goes the real way: `publishMenu` (core/apply), then the worker's own
// `writePublishFiles` (snapshot, pointer, venue index) and `runAssetVariants` (webp photo variants
// with sharp). Run after `pnpm db:seed:dev` and `seed-item-sheet` (the e2e global setup does).
// Idempotent; refuses to run unless NODE_ENV is development and the database is local.
import { createHash } from 'node:crypto'
import { rm } from 'node:fs/promises'
import { createRequire } from 'node:module'
import path from 'node:path'

import {
  assetStorageKey,
  assetStoreConfig,
  createAssetStore,
  createPublishStore,
  currentPath,
  livePath,
  publishPutOptions,
  publishStoreConfig,
  snapshotPath,
  venueIndexBytes,
  venueIndexPath,
  writeTableTokenFile,
} from '@restro/assets'
import {
  type ChangeSet,
  DEFAULT_DESIGN,
  hashTableCode,
  menuPath,
  type NodeId,
  newId,
  readDesign,
  type SnapshotId,
  type VenueId,
} from '@restro/core'
import { apply, createAsset, provisionMenu, publishMenu } from '@restro/core/apply'
import { authOrganization, sourceLinks, venues, withTenant } from '@restro/db'
import { fixture } from '@restro/shell/testing'
import { and, eq, inArray } from 'drizzle-orm'
import { writeLiveOverlay, writePublishFiles } from '../../worker/src/publish/files'
import { writeOrganizationIndex } from '../../worker/src/publish/organization-index'
import { runAssetVariants } from '../../worker/src/publish/variants'
import {
  GUEST_BRAND,
  GUEST_SLUG,
  GUEST_TABLE_LABEL,
  GUEST_TABLE_TOKEN,
  LOOK_PUBLIC_ID,
  LOOK_SLUG,
  TAG_PUBLIC_ID,
  TAG_SLUG,
} from '../e2e/support'
import { getAuthDb, getPool } from '../src/server/db'
import { assertDevEnvironment } from './lib/guard'

// sharp belongs to the worker (it makes the photo variants); this script borrows its copy.
const sharp = createRequire(new URL('../../worker/package.json', import.meta.url))('sharp') as (
  input: Buffer,
) => { png(): { toBuffer(): Promise<Buffer> } }

/** Fixed asset ids, so running the seed again finds the same assets instead of making more. */
const asId = (name: string) => `as_${name.padEnd(22, '0')}` as `as_${string}`
const PHOTOS = [
  { id: asId('E2eGuestPhotoNegroni'), article: '55001', colours: ['#f97316', '#be123c'] },
  { id: asId('E2eGuestPhotoSpritz'), article: '55002', colours: ['#fbbf24', '#ea580c'] },
  { id: asId('E2eGuestPhotoBeer'), article: '55008', colours: ['#fcd34d', '#92400e'] },
] as const
const LOGO = { id: asId('E2eGuestLogo'), colours: ['#2563eb', '#1e3a8a'] } as const
/** Dietary labels written by hand on a few items, by article. */
const DIETARY = {
  '55001': ['vegan', 'gluten_free'],
  '55007': ['vegetarian'],
  '55020': ['vegan', 'vegetarian'],
} as const

function artwork(width: number, height: number, [from, to]: readonly [string, string]) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
    <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${from}"/><stop offset="1" stop-color="${to}"/></linearGradient></defs>
    <rect width="${width}" height="${height}" fill="url(#g)"/>
    <circle cx="${width * 0.68}" cy="${height * 0.42}" r="${height * 0.22}" fill="#ffffff" fill-opacity="0.28"/>
    <circle cx="${width * 0.34}" cy="${height * 0.66}" r="${height * 0.15}" fill="#000000" fill-opacity="0.18"/>
  </svg>`
  return sharp(Buffer.from(svg)).png().toBuffer() as Promise<Uint8Array>
}

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
    tx
      .select({ id: venues.id, publicId: venues.publicId, settings: venues.settings })
      .from(venues)
      .where(eq(venues.slug, GUEST_SLUG))
      .limit(1),
  )
  if (!venue) throw new Error('Run `pnpm db:seed:dev` first: there is no demo venue.')
  const menu = await provisionMenu(pool, tenantId, venue.id)

  const assetStore = await createAssetStore(
    assetStoreConfig(process.env),
    process.env.BETTER_AUTH_SECRET ?? 'e2e-only-secret-not-used-anywhere-else-0123456789',
  )
  const publishStore = await createPublishStore(publishStoreConfig(process.env))
  const publishDir = publishStoreConfig(process.env)
  if (publishDir.kind !== 'local') throw new Error('the e2e publish store must be local')
  // A database that was reset makes new venue ids and codes: drop the old venue indexes and table
  // codes. (The photo variants stay: `assets.variants` says they exist.)
  for (const folder of ['v', 't']) {
    await rm(path.join(publishDir.dir, folder), { recursive: true, force: true })
  }

  // --- photos and the logo: stored originals, then their webp variants -----------------------
  const artworks = [
    ...PHOTOS.map((photo) => ({
      id: photo.id,
      colours: photo.colours,
      size: [1600, 1200] as const,
    })),
    { id: LOGO.id, colours: LOGO.colours, size: [640, 200] as const },
  ]
  for (const { id, colours, size } of artworks) {
    const bytes = await artwork(size[0], size[1], colours)
    const storageKey = assetStorageKey(tenantId, id, 'image/png')
    await assetStore.put(storageKey, bytes, 'image/png')
    await createAsset(pool, tenantId, {
      id,
      origin: 'upload',
      contentType: 'image/png',
      checksum: createHash('sha256').update(bytes).digest('hex'),
      width: size[0],
      height: size[1],
      storageKey,
    })
    await runAssetVariants(
      { pool, assets: assetStore, store: publishStore },
      { tenantId, assetId: id },
    )
  }

  // --- the items: photos and dietary labels, by hand (manual layer) --------------------------
  const articles = [...PHOTOS.map((photo) => photo.article), ...Object.keys(DIETARY)]
  const links = await withTenant(pool, tenantId, (tx) =>
    tx
      .select({ externalId: sourceLinks.externalId, nodeId: sourceLinks.nodeId })
      .from(sourceLinks)
      .where(
        and(eq(sourceLinks.externalType, 'article'), inArray(sourceLinks.externalId, articles)),
      ),
  )
  const nodeOf = (article: string) => {
    const found = links.find((link) => link.externalId === article)
    if (!found) throw new Error(`the demo menu has no article ${article}: run db:seed:dev first`)
    return found.nodeId
  }
  const manual = (node: string, fieldKey: string, value: unknown) => ({
    op: 'setField',
    node: { id: node },
    fieldKey,
    layer: 'manual',
    scope: 'master',
    value,
  })
  const result = await apply(pool, tenantId, {
    id: newId('cs'),
    source: 'manual',
    jobId: newId('jb'),
    actor: 'user:us_e2e',
    observedAt: new Date().toISOString(),
    ops: [
      manual(menu.id, 'title', { bg_BG: 'Демо клуб', en_US: 'Demo Club' }),
      manual(menu.id, 'intro', {
        bg_BG: 'Добре дошли! Менюто се обновява през нощта.',
        en_US: 'Welcome! The menu is updated through the night.',
      }),
      ...PHOTOS.map((photo) =>
        manual(nodeOf(photo.article), 'image', {
          asset_id: photo.id,
          alt: { bg_BG: 'Снимка на напитка', en_US: 'Photo of the drink' },
          focal: null,
        }),
      ),
      ...Object.entries(DIETARY).map(([article, labels]) =>
        manual(nodeOf(article), 'dietary', [...labels]),
      ),
    ],
  } as ChangeSet)
  if (result.rejected.length > 0) throw new Error('the guest e2e fixtures were refused')

  // --- the look, a table code, and the publish ---------------------------------------------
  const look = await apply(pool, tenantId, {
    id: newId('cs'),
    source: 'manual',
    jobId: newId('jb'),
    actor: 'system',
    observedAt: new Date().toISOString(),
    ops: [
      {
        op: 'setDesign',
        venueId: venue.id as never,
        expectedRevision: readDesign(venue.settings).revision,
        design: { ...DEFAULT_DESIGN, brand: GUEST_BRAND, logo_asset_id: LOGO.id },
      },
    ],
  })
  if (look.rejected.length > 0) throw new Error('the guest e2e look was refused')
  const published = await publishMenu(pool, tenantId, {
    menuId: menu.id,
    venueId: venue.id as never,
    reason: 'manual',
    actor: 'system',
  })
  const deps = { pool, store: publishStore, now: () => new Date() }
  const scope = { tenantId, menuId: menu.id, venueId: venue.id as never }
  const files = await writePublishFiles(deps, scope)
  await writeLiveOverlay(deps, scope)
  // The organisation's index (D84), as the publish job writes it after the files.
  await writeOrganizationIndex(deps, tenantId)
  // The file is named after the code's hash (#70).
  await writeTableTokenFile(publishStore, await hashTableCode(GUEST_TABLE_TOKEN), {
    venue_public_id: venue.publicId,
    venue_slug: GUEST_SLUG,
    // The demo organisation's slug (D84): `/t/<token>` leads to `/m/demo-club/<venue>`.
    organization_slug: 'demo-club',
    table_label: GUEST_TABLE_LABEL,
  })

  // --- a second menu with tags, published straight from the shell's fixture -----------------
  const tagged = fixture('tags-dietary').snapshot
  const put = (file: string, value: unknown) =>
    publishStore.put(file, new TextEncoder().encode(JSON.stringify(value)), publishPutOptions(file))
  const menu_id = tagged.snapshot.menu_id as NodeId
  const venue_id = tagged.snapshot.venue_id as VenueId
  await put(snapshotPath(tagged.snapshot.id as SnapshotId), tagged)
  await put(currentPath(menu_id, venue_id), {
    snapshot_id: tagged.snapshot.id,
    version: tagged.snapshot.version,
    hash: tagged.snapshot.hash,
  })
  await put(livePath(menu_id, venue_id), { version: tagged.snapshot.version, items: {} })
  await publishStore.put(
    venueIndexPath(TAG_PUBLIC_ID),
    venueIndexBytes({ venue_id, menu_id, slug: TAG_SLUG }),
    publishPutOptions(venueIndexPath(TAG_PUBLIC_ID)),
  )

  // --- a third menu: another template, a forced scheme and a font of its own (SH-04) -------------
  // The same fixture, with ids of its own (all fixtures share theirs, and files are keyed by id).
  // Its venue chose the reference template, forces the dark scheme and asks for Playfair Display,
  // which is how the guest page, the template registry and the self-hosted fonts are checked on a
  // production build without touching the demo venue's look.
  const lookIds = {
    snapshot: `sn_${'E2eLookSnapshot'.padEnd(22, '0')}`,
    menu: `nd_${'E2eLookMenu'.padEnd(22, '0')}`,
    venue: `vn_${'E2eLookVenue'.padEnd(22, '0')}`,
  }
  const looked = {
    ...tagged,
    snapshot: {
      ...tagged.snapshot,
      id: lookIds.snapshot,
      menu_id: lookIds.menu,
      venue_id: lookIds.venue,
    },
    menu: { ...tagged.menu, id: lookIds.menu },
    theme: { ...tagged.theme, font: 'Playfair Display', scheme: 'dark' as const },
  }
  const lookMenu = lookIds.menu as NodeId
  const lookVenue = lookIds.venue as VenueId
  await put(snapshotPath(lookIds.snapshot as SnapshotId), looked)
  await put(currentPath(lookMenu, lookVenue), {
    snapshot_id: lookIds.snapshot,
    version: looked.snapshot.version,
    hash: looked.snapshot.hash,
  })
  await put(livePath(lookMenu, lookVenue), { version: looked.snapshot.version, items: {} })
  await publishStore.put(
    venueIndexPath(LOOK_PUBLIC_ID),
    venueIndexBytes({ venue_id: lookVenue, menu_id: lookMenu, slug: LOOK_SLUG }),
    publishPutOptions(venueIndexPath(LOOK_PUBLIC_ID)),
  )

  console.log(
    JSON.stringify({
      level: 'info',
      event: 'seed_guest_e2e_done',
      published: published.status,
      venueIndex: files.status === 'checked' ? files.venueIndex : files.status,
      guestPath: menuPath({ slug: GUEST_SLUG, publicId: venue.publicId }),
      tagPath: menuPath({ slug: TAG_SLUG, publicId: TAG_PUBLIC_ID }),
      lookPath: menuPath({ slug: LOOK_SLUG, publicId: LOOK_PUBLIC_ID }),
      publishDir: publishDir.dir,
    }),
  )
}

main()
  .then(async () => {
    await getPool().end()
    process.exit(0)
  })
  .catch((error: unknown) => {
    console.error(`seed-guest-e2e failed: ${error instanceof Error ? error.stack : String(error)}`)
    process.exit(1)
  })
