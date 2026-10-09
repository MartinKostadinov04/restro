// asset-fetch: one barsy photo into the asset store, against the in-memory installation. The
// SSRF guard (same origin only), the image checks (magic bytes, 10 MB), the checksum dedupe, the
// barsy-layer `image` field and the rule that a manual photo still wins. The store is an
// in-memory fake (the R2 implementation is mocked in its own package's tests).
import {
  type ChangeSet,
  JOB_NAMES,
  type NodeId,
  newId,
  resolve,
  VENUE_MENU_TEMPLATE,
} from '@restro/core'
import { apply, createAsset, loadMenuDocument } from '@restro/core/apply'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'

// Test-only reach into the asset package's sample images.
import { makePng } from '../../../packages/assets/src/test-images.ts'
import { createTestDatabase, hasDatabase, type TestDatabase } from './database'
import { createFakeBarsy, type FakeBarsy } from './fake-barsy'
import { createWorld, type World } from './world'

describe.skipIf(!hasDatabase)('asset-fetch', () => {
  const fake = createFakeBarsy()
  // A second article of the demo that has a picture and a category (article 11 is the first).
  const OTHER = Number(
    fake.articles.find(
      (a) =>
        a.article_id !== 11 &&
        a.picture &&
        a.picture_url &&
        (a.categories as string[]).length > 0 &&
        !a.is_service,
    )?.article_id,
  )
  let db: TestDatabase
  let world: World

  beforeAll(async () => {
    db = await createTestDatabase()
    fake.listen()
  })
  afterAll(async () => {
    fake.close()
    await db.drop()
  })
  beforeEach(async () => {
    fake.reset()
    world = await createWorld(fake, { database: db })
    await world.run(JOB_NAMES.barsyFullPull, {
      tenantId: world.tenantId,
      integrationId: world.integrationId,
      venueId: world.venueId,
    })
    world.enqueued.length = 0
  })
  afterEach(async () => {
    await world.close()
  })

  const picturePath = (articleId: number) => {
    const article = fake.articles.find((a) => a.article_id === articleId)
    const url = new URL(String(article?.picture_url))
    return {
      url: String(article?.picture_url),
      key: `${url.pathname}${url.search}`,
      name: String(article?.picture),
    }
  }
  const serve = (articleId: number, bytes: Uint8Array, status = 200) => {
    const picture = picturePath(articleId)
    fake.photos.set(picture.key, { status, body: bytes })
    return picture
  }
  const fetchJob = (articleId: number, overrides: Record<string, unknown> = {}) => {
    const picture = picturePath(articleId)
    return world.run(JOB_NAMES.assetFetch, {
      tenantId: world.tenantId,
      integrationId: world.integrationId,
      articleExternalId: String(articleId),
      pictureName: picture.name,
      url: picture.url,
      ...overrides,
    })
  }
  const lastRun = async () => {
    const rows = await world.query<{
      status: string
      counters: Record<string, number>
      error_summary: string | null
    }>(
      `select status, counters, error_summary from restro.job_runs
       where integration_id = $1 and kind = 'asset_fetch' order by created_at`,
      [world.integrationId],
    )
    const row = rows.at(-1)
    if (!row) throw new Error('no asset_fetch run')
    return row
  }
  const assetRows = () =>
    world.query<{
      id: string
      origin: string
      origin_ref: string
      checksum: string
      content_type: string
      width: number
      height: number
      storage_key: string
      status: string
    }>('select * from restro.assets where tenant_id = $1 order by created_at', [world.tenantId])
  const imageOf = async (articleId: string, layer = 'barsy') =>
    (
      await world.query<{ value: { asset_id: string; alt: unknown; focal: unknown } }>(
        `select fv.value from restro.field_values fv
         join restro.source_links sl on sl.node_id = fv.node_id
         where sl.integration_id = $1 and sl.external_type = 'article' and sl.external_id = $2
           and fv.field_key = 'image' and fv.layer = $3`,
        [world.integrationId, articleId, layer],
      )
    )[0]?.value

  it('downloads a same-origin picture, stores it, and sets the item’s image in the barsy layer', async () => {
    const png = makePng(8, 6)
    serve(11, png)
    await fetchJob(11)

    const run = await lastRun()
    expect(run).toMatchObject({ status: 'completed', error_summary: null })
    expect(run.counters).toMatchObject({ assets_created: 1, assets_reused: 0, image_set: 1 })

    const [asset] = await assetRows()
    expect(asset).toMatchObject({
      origin: 'barsy',
      content_type: 'image/png',
      width: 8,
      height: 6,
      status: 'stored',
    })
    expect(asset?.origin_ref).toBe('article:11:1.png')
    expect(asset?.storage_key).toBe(`tenants/${world.tenantId}/assets/${asset?.id}/original.png`)
    expect(world.stored.get(asset?.storage_key ?? '')).toEqual(png)

    expect(await imageOf('11')).toEqual({ asset_id: asset?.id, alt: {}, focal: null })
    // The field was written by this run, with its provenance.
    const [row] = await world.query<{ source: string; job_id: string; mapping_version: number }>(
      `select fv.source, fv.job_id, fv.mapping_version from restro.field_values fv
       join restro.source_links sl on sl.node_id = fv.node_id
       where sl.integration_id = $1 and sl.external_id = '11' and fv.field_key = 'image'`,
      [world.integrationId],
    )
    expect(row?.source).toBe(`barsy:${world.integrationId}`)
    expect(row?.job_id).toMatch(/^jb_/)
    expect(row?.mapping_version).toBe(1)
  })

  it('sends no credentials unless the host asks for them, and then only to its own origin', async () => {
    serve(11, makePng(4, 4))
    await fetchJob(11)
    expect(fake.photoRequests.map((request) => request.authorization)).toEqual([null])

    // A host that wants credentials: the first, anonymous request is refused (401), the second
    // carries Basic auth, to that host only.
    fake.photoRequests.length = 0
    fake.photosNeedAuth = true
    await fetchJob(11)
    expect(fake.photoRequests.map((request) => request.authorization)).toEqual([null, fake.basic()])
  })

  it('refuses a picture on another host: nothing is requested, nothing stored', async () => {
    for (const url of [
      'https://evil.example.com/x.png',
      'https://demo.barsyonline.com.evil.example.com/x.png',
      'https://demo.barsyonline.com@evil.example.com/x.png',
      'https://demo.barsyonline.com:8443/endpoints/res/files_get?file=1.png',
    ]) {
      // MSW fails the test on any request to a host it does not know (onUnhandledRequest: error).
      await fetchJob(11, { url })
      const run = await lastRun()
      expect(run.status, url).toBe('failed')
      expect(run.error_summary, url).toContain('picture refused: foreign_origin')
    }
    expect(await assetRows()).toEqual([])
    expect(world.stored.size).toBe(0)
    expect(fake.photoRequests).toEqual([])
  })

  it('refuses a redirect that leads elsewhere, follows one that stays', async () => {
    const picture = picturePath(11)
    fake.photos.set(picture.key, {
      status: 302,
      body: new Uint8Array(),
      headers: { location: 'https://evil.example.com/steal.png' },
    })
    await fetchJob(11)
    expect((await lastRun()).error_summary).toContain('foreign_origin')
    expect(await assetRows()).toEqual([])

    const target = '/endpoints/res/files_get?moved=1'
    fake.photos.set(picture.key, {
      status: 302,
      body: new Uint8Array(),
      headers: { location: target },
    })
    fake.photos.set(target, { status: 200, body: makePng(3, 3) })
    await fetchJob(11)
    expect((await lastRun()).status).toBe('completed')
    expect(await assetRows()).toHaveLength(1)
  })

  it('refuses what is not a JPEG, PNG or WebP by its first bytes, whatever the server calls it', async () => {
    const cases: [string, Uint8Array][] = [
      ['text', new TextEncoder().encode('<html>not a picture</html>')],
      ['gif', new TextEncoder().encode('GIF89a\u0001\u0000\u0001\u0000')],
      ['svg', new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"/>')],
      ['empty', new Uint8Array()],
    ]
    for (const [name, bytes] of cases) {
      serve(11, bytes)
      await fetchJob(11)
      const run = await lastRun()
      expect(run.status, name).toBe('failed')
      expect(run.error_summary, name).toContain('picture refused: not_an_image')
    }
    expect(await assetRows()).toEqual([])
    expect(world.stored.size).toBe(0)
  })

  it('refuses a picture over 10 MB, announced or not', async () => {
    const big = new Uint8Array(10 * 1024 * 1024 + 1)
    big.set(makePng(2, 2))
    serve(11, big)
    await fetchJob(11)
    expect((await lastRun()).error_summary).toContain('picture refused: too_large')

    // Announced in Content-Length: refused before the body is read.
    const picture = picturePath(11)
    fake.photos.set(picture.key, {
      status: 200,
      body: makePng(2, 2),
      headers: { 'content-length': String(20 * 1024 * 1024) },
    })
    await fetchJob(11)
    expect(await assetRows()).toEqual([])
  })

  it('stores identical bytes once: the second article reuses the asset', async () => {
    const png = makePng(5, 5)
    serve(11, png)
    serve(OTHER, png)
    await fetchJob(11)
    await fetchJob(OTHER)

    const assets = await assetRows()
    expect(assets).toHaveLength(1)
    expect(world.stored.size).toBe(1)
    const run = await lastRun()
    expect(run.counters).toMatchObject({ assets_created: 0, assets_reused: 1, image_set: 1 })
    expect((await imageOf('11'))?.asset_id).toBe(assets[0]?.id)
    expect((await imageOf(String(OTHER)))?.asset_id).toBe(assets[0]?.id)
  })

  it('fetching the same picture again changes nothing', async () => {
    serve(11, makePng(4, 4))
    await fetchJob(11)
    const events = Number(
      (
        await world.query<{ n: string }>(
          'select count(*) as n from restro.events where tenant_id = $1',
          [world.tenantId],
        )
      )[0]?.n,
    )
    await fetchJob(11)
    expect(await assetRows()).toHaveLength(1)
    expect(
      Number(
        (
          await world.query<{ n: string }>(
            'select count(*) as n from restro.events where tenant_id = $1',
            [world.tenantId],
          )
        )[0]?.n,
      ),
    ).toBe(events)
  })

  it('an article that is no longer linked: nothing is downloaded', async () => {
    await fetchJob(11, { articleExternalId: '99999' })
    const run = await lastRun()
    expect(run.status).toBe('completed')
    expect(run.error_summary).toContain('no longer linked')
    expect(fake.photoRequests).toEqual([])
    expect(await assetRows()).toEqual([])
  })

  it('a server error is thrown, so the queue retries it; a 404 is refused for good', async () => {
    const picture = picturePath(11)
    fake.photos.set(picture.key, { status: 503, body: new Uint8Array() })
    await expect(fetchJob(11)).rejects.toThrow()
    expect((await lastRun()).status).toBe('failed')

    fake.photos.set(picture.key, { status: 404, body: new Uint8Array() })
    await fetchJob(11)
    expect((await lastRun()).error_summary).toContain('picture refused: bad_status')
  })

  it('a manual photo still wins by the field’s combinator', async () => {
    serve(OTHER, makePng(4, 4))
    await fetchJob(OTHER)
    const barsyAsset = (await imageOf(String(OTHER)))?.asset_id as string

    // The manager uploads their own photo for the same item.
    const manualAsset = newId('as')
    await createAsset(world.pool, world.tenantId, {
      id: manualAsset,
      origin: 'upload',
      contentType: 'image/png',
      checksum: 'b'.repeat(64),
      width: 9,
      height: 9,
      storageKey: `tenants/${world.tenantId}/assets/${manualAsset}/original.png`,
    })
    const [link] = await world.query<{ node_id: string }>(
      `select node_id from restro.source_links where integration_id = $1 and external_id = '${OTHER}'
       and external_type = 'article'`,
      [world.integrationId],
    )
    const change: ChangeSet = {
      id: newId('cs'),
      source: 'manual',
      jobId: newId('jb'),
      actor: 'system',
      observedAt: new Date().toISOString(),
      ops: [
        {
          op: 'setField',
          node: { id: link?.node_id as NodeId },
          fieldKey: 'image',
          layer: 'manual',
          scope: 'master',
          value: { asset_id: manualAsset, alt: {}, focal: null },
        },
      ],
    }
    expect((await apply(world.pool, world.tenantId, change)).rejected).toEqual([])

    // A later sync of the barsy photo does not displace it.
    await fetchJob(OTHER)
    const doc = await loadMenuDocument(world.pool, world.tenantId, world.menuId as NodeId)
    const resolved = resolve(VENUE_MENU_TEMPLATE, doc, {
      venueScope: `venue:${world.venueId}`,
      locales: ['bg_BG', 'en_US'],
      now: world.clock.toISOString(),
    })
    const image = resolved.items[link?.node_id as NodeId]?.fields.image
    expect(image?.layer).toBe('manual')
    expect((image?.value as { asset_id: string } | null)?.asset_id).toBe(manualAsset)
    expect((await imageOf(String(OTHER)))?.asset_id).toBe(barsyAsset)
  })

  describe('which pictures a pull queues', () => {
    const photoJobs = () => world.enqueued.filter((job) => job.name === JOB_NAMES.assetFetch)
    const pull = () =>
      world.run(JOB_NAMES.barsyFullPull, {
        tenantId: world.tenantId,
        integrationId: world.integrationId,
        venueId: world.venueId,
      })

    it('an unchanged article with its photo is left alone; one without a photo is queued again', async () => {
      serve(11, makePng(4, 4))
      await fetchJob(11)
      world.enqueued.length = 0
      await pull()
      const ids = photoJobs().map((job) => job.data.articleExternalId)
      expect(ids).not.toContain('11')
      expect(ids.length).toBeGreaterThan(40)
    })

    it('a changed picture is queued again', async () => {
      serve(11, makePng(4, 4))
      await fetchJob(11)
      const article = fake.articles.find((a) => a.article_id === 11)
      if (!article) throw new Error('no article 11')
      article.picture = '2.png'
      article.picture_url = String(article.picture_url).replace('1.png', '2.png')
      world.enqueued.length = 0
      await pull()
      const queued = photoJobs().find((job) => job.data.articleExternalId === '11')
      expect(queued?.data).toMatchObject({ pictureName: '2.png' })
    })

    it('a changed price on an article with an unchanged picture does not queue it', async () => {
      serve(11, makePng(4, 4))
      await fetchJob(11)
      const article = fake.articles.find((a) => a.article_id === 11)
      if (!article) throw new Error('no article 11')
      article.actual_price = 1.5
      world.enqueued.length = 0
      await pull()
      expect(photoJobs().map((job) => job.data.articleExternalId)).not.toContain('11')
    })
  })
})

export type { FakeBarsy }
