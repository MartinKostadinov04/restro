import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {
  currentPath,
  LocalPublishStore,
  livePath,
  publishPutOptions,
  snapshotPath,
  variantPath,
} from '@restro/assets'
import { newId } from '@restro/core'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { serveCdn } from './cdn'

const sn = newId('sn')
const nd = newId('nd')
const vn = newId('vn')
const as = newId('as')

describe('serveCdn (the local publish store at /cdn)', () => {
  let root: string
  let store: LocalPublishStore

  beforeEach(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), 'restro-cdn-'))
    store = new LocalPublishStore({ rootDir: root })
  })
  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  async function put(file: string, bytes: Uint8Array) {
    await store.put(file, bytes, publishPutOptions(file))
  }
  const json = (value: unknown) => new TextEncoder().encode(JSON.stringify(value))

  it('serves a snapshot as json, immutable for a year', async () => {
    await put(snapshotPath(sn), json({ schema: 'menu-snapshot/1' }))
    const response = await serveCdn(snapshotPath(sn), store)
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('application/json')
    expect(response.headers.get('cache-control')).toBe('public, max-age=31536000, immutable')
    expect(response.headers.get('x-content-type-options')).toBe('nosniff')
    expect(await response.json()).toEqual({ schema: 'menu-snapshot/1' })
  })

  it('serves the pointer for 30 seconds and the live overlay for 15', async () => {
    await put(currentPath(nd, vn), json({ snapshot_id: sn, version: 3, hash: 'x' }))
    await put(livePath(nd, vn), json({ version: 3, items: {} }))
    const pointer = await serveCdn(currentPath(nd, vn), store)
    expect(pointer.headers.get('cache-control')).toBe('public, max-age=30')
    expect(pointer.headers.get('content-type')).toBe('application/json')
    const overlay = await serveCdn(livePath(nd, vn), store)
    expect(overlay.headers.get('cache-control')).toBe('public, max-age=15')
  })

  it('serves a photo variant as webp, immutable, with its exact bytes', async () => {
    const bytes = Uint8Array.from([82, 73, 70, 70, 1, 2, 3])
    await put(variantPath(as, 640), bytes)
    const response = await serveCdn(variantPath(as, 640), store)
    expect(response.headers.get('content-type')).toBe('image/webp')
    expect(response.headers.get('cache-control')).toBe('public, max-age=31536000, immutable')
    expect(response.headers.get('content-length')).toBe(String(bytes.length))
    expect(Array.from(new Uint8Array(await response.arrayBuffer()))).toEqual(Array.from(bytes))
  })

  it('answers 404, uncached, for a file that is not there', async () => {
    for (const file of [snapshotPath(sn), currentPath(nd, vn), variantPath(as, 320)]) {
      const response = await serveCdn(file, store)
      expect(response.status, file).toBe(404)
      expect(response.headers.get('cache-control')).toBe('no-store')
    }
  })

  it.each([
    '../secret.json',
    `snap/../../${sn}.json`,
    `m/${nd}/${vn}/../../x.json`,
    '/etc/passwd',
    'C:\\Windows\\win.ini',
    '',
    `snap/${sn}.json/extra`,
    `tenants/tn_0123456789ABCDEFGHIJKL/assets/${as}/original.png`,
    `a/${as}/original.png`,
    `snap/${sn}.json\u0000.png`,
  ])('answers 404 for the path %j, even if a file were there', async (requested) => {
    const response = await serveCdn(requested, store)
    expect(response.status).toBe(404)
  })

  it('answers 404 when this process publishes elsewhere (no local store)', async () => {
    expect((await serveCdn(snapshotPath(sn), null)).status).toBe(404)
  })
})

describe('GET /cdn/[...path] (the route, with no session)', () => {
  let root: string

  beforeEach(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), 'restro-cdn-route-'))
    vi.resetModules()
    vi.stubEnv('PUBLISH_STORE', 'local')
    vi.stubEnv('LOCAL_PUBLISH_DIR', root)
    delete (globalThis as { __restroLocalPublishStore?: unknown }).__restroLocalPublishStore
  })
  afterEach(async () => {
    vi.unstubAllEnvs()
    delete (globalThis as { __restroLocalPublishStore?: unknown }).__restroLocalPublishStore
    await rm(root, { recursive: true, force: true })
  })

  it('serves what the store holds and 404s the rest, reading no session or database', async () => {
    const file = currentPath(nd, vn)
    await new LocalPublishStore({ rootDir: root }).put(
      file,
      new TextEncoder().encode('{"snapshot_id":"x"}'),
      publishPutOptions(file),
    )
    const { GET } = await import('../../../app/cdn/[...path]/route')
    const found = await GET(new Request(`http://localhost/cdn/${file}`), {
      params: Promise.resolve({ path: file.split('/') }),
    })
    expect(found.status).toBe(200)
    expect(found.headers.get('cache-control')).toBe('public, max-age=30')
    expect(await found.json()).toEqual({ snapshot_id: 'x' })

    const missing = await GET(new Request(`http://localhost/cdn/snap/${sn}.json`), {
      params: Promise.resolve({ path: ['snap', `${sn}.json`] }),
    })
    expect(missing.status).toBe(404)
    const traversal = await GET(new Request('http://localhost/cdn/snap/..%2F..%2Fx'), {
      params: Promise.resolve({ path: ['snap', '../../x'] }),
    })
    expect(traversal.status).toBe(404)
  })

  it('answers 404 for everything when the process publishes to R2', async () => {
    vi.stubEnv('PUBLISH_STORE', 'r2')
    vi.stubEnv('R2_ACCOUNT_ID', '0123456789abcdef')
    vi.stubEnv('R2_ACCESS_KEY_ID', 'AKIAFAKEFAKEFAKE')
    vi.stubEnv('R2_SECRET_ACCESS_KEY', 'not-a-real-secret-key')
    vi.stubEnv('R2_PUBLIC_BUCKET', 'restro-public-staging')
    const { GET } = await import('../../../app/cdn/[...path]/route')
    const file = currentPath(nd, vn)
    const response = await GET(new Request(`http://localhost/cdn/${file}`), {
      params: Promise.resolve({ path: file.split('/') }),
    })
    expect(response.status).toBe(404)
  })

  it('answers 404 instead of an error page when the settings are unusable', async () => {
    vi.stubEnv('PUBLISH_STORE', 'carrier-pigeon')
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const { GET } = await import('../../../app/cdn/[...path]/route')
    const file = currentPath(nd, vn)
    const response = await GET(new Request(`http://localhost/cdn/${file}`), {
      params: Promise.resolve({ path: file.split('/') }),
    })
    expect(response.status).toBe(404)
    expect(logged).toHaveBeenCalled()
    logged.mockRestore()
  })
})
