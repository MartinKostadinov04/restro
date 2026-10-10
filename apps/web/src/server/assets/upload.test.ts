// The upload path end to end on a real Postgres, as the restro_app role: validation, the stored
// bytes, the assets row written through core, tenant isolation and the route's guards.

import { type AssetStore, parseAssetKey } from '@restro/assets'
import { MAX_IMAGE_BYTES, newId } from '@restro/core'
import { provisionTenant } from '@restro/core/apply'
import { assets, createPool, type DbPool, withTenant } from '@restro/db'
import { eq } from 'drizzle-orm'
import type pg from 'pg'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { jpegHeader, makePng, pngHeader } from '../../../../../packages/assets/src/test-images'
import { appDatabaseUrl, hasDatabase, openOwnerPool } from '../test-database'
import { checksumOf, storeImage, UploadError } from './upload'
import { handleUpload, isSameOrigin, readBodyLimited } from './upload-handler'

class MemoryStore implements AssetStore {
  readonly objects = new Map<string, { bytes: Uint8Array; contentType: string }>()
  async put(key: string, bytes: Uint8Array, contentType: string) {
    this.objects.set(key, { bytes, contentType })
  }
  async getUrl(key: string) {
    return `memory://${key}`
  }
  async get(key: string) {
    return this.objects.get(key)?.bytes ?? null
  }
}

const ORIGIN = 'http://localhost:3000'

function uploadRequest(
  file: Uint8Array | null,
  options: { origin?: string | null; name?: string; type?: string; field?: string } = {},
): Request {
  const form = new FormData()
  if (file !== null) {
    form.set(
      options.field ?? 'file',
      new File([file as BlobPart], options.name ?? 'photo.png', {
        type: options.type ?? 'image/png',
      }),
    )
  }
  const headers: Record<string, string> = { host: 'localhost:3000' }
  if (options.origin !== null) headers.origin = options.origin ?? ORIGIN
  return new Request(`${ORIGIN}/api/assets`, { method: 'POST', body: form, headers })
}

describe('same-origin check', () => {
  const request = (headers: Record<string, string>) =>
    new Request(`${ORIGIN}/api/assets`, { method: 'POST', headers })

  it('accepts only an Origin that is this server', () => {
    expect(isSameOrigin(request({ origin: ORIGIN, host: 'localhost:3000' }))).toBe(true)
    expect(isSameOrigin(request({ origin: 'https://evil.example', host: 'localhost:3000' }))).toBe(
      false,
    )
    expect(isSameOrigin(request({ host: 'localhost:3000' }))).toBe(false)
    expect(isSameOrigin(request({ origin: 'not a url', host: 'localhost:3000' }))).toBe(false)
    // Behind a proxy the public host is in x-forwarded-host.
    expect(
      isSameOrigin(
        request({
          origin: 'https://admin.restro.example',
          host: 'internal:8080',
          'x-forwarded-host': 'admin.restro.example',
        }),
      ),
    ).toBe(true)
  })
})

describe('readBodyLimited', () => {
  it('returns the body, or null once it passes the limit', async () => {
    const make = (bytes: number) =>
      new Request(ORIGIN, { method: 'POST', body: new Uint8Array(bytes) })
    expect((await readBodyLimited(make(100), 100))?.length).toBe(100)
    expect(await readBodyLimited(make(101), 100)).toBeNull()
    expect((await readBodyLimited(new Request(ORIGIN, { method: 'POST' }), 10))?.length).toBe(0)
  })
})

describe.skipIf(!hasDatabase)('uploading an image (as the restro_app role)', () => {
  const tenant = newId('tn')
  const otherTenant = newId('tn')
  let app: DbPool
  let owner: pg.Pool
  let store: MemoryStore

  const rowsOf = (tenantId: string, assetId: string) =>
    withTenant(app, tenantId, (tx) => tx.select().from(assets).where(eq(assets.id, assetId)))
  const deps = (tenantId: string | null) => ({
    tenantId: async () => tenantId,
    pool: app,
    store: async () => store as AssetStore,
  })

  beforeAll(async () => {
    owner = openOwnerPool()
    app = createPool(appDatabaseUrl(), { applicationName: 'restro-web-upload-tests' })
    await provisionTenant(app, { tenantId: tenant, name: 'Upload test club' })
    await provisionTenant(app, { tenantId: otherTenant, name: 'Another club' })
  })

  afterAll(async () => {
    await app?.end()
    if (owner) {
      await owner.query('delete from restro.assets where tenant_id = any($1)', [
        [tenant, otherTenant],
      ])
      await owner.query('delete from restro.tenants where id = any($1)', [[tenant, otherTenant]])
      await owner.end()
    }
  })

  it('stores a PNG under a tenant-prefixed key and records the asset', async () => {
    store = new MemoryStore()
    const bytes = makePng(40, 30)
    const stored = await storeImage({ pool: app, tenantId: tenant, store, bytes })
    expect(stored).toMatchObject({ contentType: 'image/png', width: 40, height: 30 })
    expect(stored.checksum).toBe(checksumOf(bytes))

    const [row] = await rowsOf(tenant, stored.assetId)
    expect(row).toMatchObject({
      origin: 'upload',
      contentType: 'image/png',
      width: 40,
      height: 30,
      checksum: stored.checksum,
      status: 'stored',
    })
    expect(parseAssetKey(row?.storageKey ?? '')).toEqual({
      tenantId: tenant,
      assetId: stored.assetId,
      contentType: 'image/png',
    })
    expect(store.objects.get(row?.storageKey ?? '')?.bytes).toEqual(bytes)
    expect(store.objects.get(row?.storageKey ?? '')?.contentType).toBe('image/png')
    expect(await rowsOf(otherTenant, stored.assetId)).toHaveLength(0)
  })

  it('refuses a file before anything is stored', async () => {
    store = new MemoryStore()
    const refuse = (bytes: Uint8Array) =>
      storeImage({ pool: app, tenantId: tenant, store, bytes }).catch((error: unknown) => error)
    expect(await refuse(new Uint8Array())).toMatchObject({ code: 'empty' })
    expect(await refuse(new TextEncoder().encode('<svg/>'))).toMatchObject({
      code: 'unsupported_type',
    })
    expect(await refuse(pngHeader(0, 5))).toMatchObject({ code: 'dimensions' })
    expect(await refuse(new Uint8Array(MAX_IMAGE_BYTES + 1))).toBeInstanceOf(UploadError)
    expect(store.objects.size).toBe(0)
  })

  describe('the route logic', () => {
    it('queues the photo variants of a new upload, and a queue failure does not fail the upload', async () => {
      store = new MemoryStore()
      const queued: [string, string][] = []
      const request = () =>
        uploadRequest(jpegHeader(200, 100), { name: 'x.jpg', type: 'image/jpeg' })
      const ok = await handleUpload(request(), {
        ...deps(tenant),
        queueVariants: async (tenantId, assetId) => {
          queued.push([tenantId, assetId])
        },
      })
      expect(ok.status).toBe(201)
      const body = (await ok.json()) as { assetId: string }
      expect(queued).toEqual([[tenant, body.assetId]])

      const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined)
      const down = await handleUpload(request(), {
        ...deps(tenant),
        queueVariants: async () => {
          throw new Error('queue down')
        },
      })
      expect(down.status).toBe(201)
      expect(logged).toHaveBeenCalled()
      logged.mockRestore()

      // A refused file queues nothing.
      queued.length = 0
      const refused = await handleUpload(uploadRequest(new Uint8Array([1, 2, 3])), {
        ...deps(tenant),
        queueVariants: async (tenantId, assetId) => {
          queued.push([tenantId, assetId])
        },
      })
      expect(refused.status).toBeGreaterThanOrEqual(400)
      expect(queued).toEqual([])
    })

    it('answers 201 with the new asset for a signed-in person', async () => {
      store = new MemoryStore()
      const response = await handleUpload(
        uploadRequest(jpegHeader(200, 100), { name: 'x.jpg', type: 'image/jpeg' }),
        deps(tenant),
      )
      expect(response.status).toBe(201)
      const body = (await response.json()) as {
        assetId: string
        width: number
        contentType: string
      }
      expect(body).toMatchObject({ width: 200, contentType: 'image/jpeg' })
      expect(await rowsOf(tenant, body.assetId)).toHaveLength(1)
    })

    it('takes the type from the bytes: a PNG called photo.jpg is stored as a PNG', async () => {
      store = new MemoryStore()
      const response = await handleUpload(
        uploadRequest(makePng(8, 8), { name: 'photo.jpg', type: 'image/jpeg' }),
        deps(tenant),
      )
      expect(response.status).toBe(201)
      expect(await response.json()).toMatchObject({ contentType: 'image/png' })
      expect([...store.objects.keys()][0]).toMatch(/original\.png$/)
    })

    it.each([
      ['nobody is signed in', null, {}, 401, 'unauthorized'],
      [
        'the Origin is another site',
        'tenant',
        { origin: 'https://evil.example' },
        403,
        'bad_origin',
      ],
      ['there is no Origin', 'tenant', { origin: null }, 403, 'bad_origin'],
      ['the form has no file', 'tenant', { field: 'other' }, 400, 'no_file'],
    ] as const)('refuses when %s', async (_label, who, options, status, error) => {
      store = new MemoryStore()
      const response = await handleUpload(
        uploadRequest(makePng(8, 8), options),
        deps(who === null ? null : tenant),
      )
      expect(response.status).toBe(status)
      expect(await response.json()).toEqual({ error })
      expect(store.objects.size).toBe(0)
    })

    it('refuses an SVG with 415, a file over 10 MB with 413 and a broken one with 422', async () => {
      store = new MemoryStore()
      const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"></svg>')
      const refused = await handleUpload(
        uploadRequest(svg, { name: 'a.svg', type: 'image/svg+xml' }),
        deps(tenant),
      )
      expect(refused.status).toBe(415)
      const big = new Uint8Array(MAX_IMAGE_BYTES + 1)
      big.set(pngHeader(10, 10))
      expect((await handleUpload(uploadRequest(big), deps(tenant))).status).toBe(413)
      const broken = await handleUpload(uploadRequest(pngHeader(10, 10).slice(0, 18)), deps(tenant))
      expect(broken.status).toBe(422)
      expect(store.objects.size).toBe(0)
    })

    it('refuses a body that is not a multipart form', async () => {
      const request = new Request(`${ORIGIN}/api/assets`, {
        method: 'POST',
        body: JSON.stringify({ file: 'x' }),
        headers: { origin: ORIGIN, host: 'localhost:3000', 'content-type': 'application/json' },
      })
      expect((await handleUpload(request, deps(tenant))).status).toBe(400)
    })
  })
})
