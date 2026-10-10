import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { LocalAssetStore, signAssetLink } from '@restro/assets'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { serveLocalAsset } from './serve-local'

const SECRET = 'a-test-secret-that-is-long-enough-0123456789'
const TENANT = 'tn_0123456789ABCDEFGHIJKL'
const OTHER_TENANT = 'tn_ZYXWVUTSRQPONMLKJIHGFE'
const ASSET = 'as_0123456789ABCDEFGHIJKL'
const KEY = `tenants/${TENANT}/assets/${ASSET}/original.png`
const BYTES = Uint8Array.from([1, 2, 3, 4, 5])

describe('serveLocalAsset', () => {
  let root: string
  let store: LocalAssetStore

  beforeEach(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), 'restro-assets-'))
    store = new LocalAssetStore({ rootDir: root, signingSecret: SECRET })
  })
  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  const now = 1_800_000_000_000
  async function link() {
    await store.put(KEY, BYTES, 'image/png')
    const { exp, sig } = signAssetLink(SECRET, KEY, 600, now)
    return { key: KEY, exp: String(exp), sig }
  }

  it('serves the file to a signed-in person of its tenant, with safe headers', async () => {
    const response = await serveLocalAsset({ ...(await link()), tenantId: TENANT }, store, now)
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('image/png')
    expect(response.headers.get('x-content-type-options')).toBe('nosniff')
    expect(response.headers.get('content-security-policy')).toContain("default-src 'none'")
    expect(response.headers.get('cache-control')).toBe('private, max-age=600')
    expect(Array.from(new Uint8Array(await response.arrayBuffer()))).toEqual(Array.from(BYTES))
  })

  it('needs a signed-in person', async () => {
    const response = await serveLocalAsset({ ...(await link()), tenantId: null }, store, now)
    expect(response.status).toBe(401)
  })

  it('shows another tenant a 404, exactly as for a file that does not exist', async () => {
    const other = await serveLocalAsset({ ...(await link()), tenantId: OTHER_TENANT }, store, now)
    expect(other.status).toBe(404)
    const missingKey = `tenants/${TENANT}/assets/as_ZZZZZZZZZZZZZZZZZZZZZZ/original.png`
    const { exp, sig } = signAssetLink(SECRET, missingKey, 60, now)
    const missing = await serveLocalAsset(
      { key: missingKey, exp: String(exp), sig, tenantId: TENANT },
      store,
      now,
    )
    expect(missing.status).toBe(404)
  })

  it('refuses a tampered, expired or unsigned link', async () => {
    const good = await link()
    for (const bad of [
      { ...good, sig: '0'.repeat(64) },
      { ...good, exp: String(Number(good.exp) + 1) },
      { ...good, exp: null },
      { ...good, sig: null },
    ]) {
      expect((await serveLocalAsset({ ...bad, tenantId: TENANT }, store, now)).status).toBe(403)
    }
    const expired = await serveLocalAsset({ ...good, tenantId: TENANT }, store, now + 601_000)
    expect(expired.status).toBe(403)
  })

  it('does not serve keys that this naming never builds', async () => {
    await store.put('plain/file.png', BYTES, 'image/png')
    const { exp, sig } = signAssetLink(SECRET, 'plain/file.png', 60, now)
    const response = await serveLocalAsset(
      { key: 'plain/file.png', exp: String(exp), sig, tenantId: TENANT },
      store,
      now,
    )
    expect(response.status).toBe(404)
  })
})
