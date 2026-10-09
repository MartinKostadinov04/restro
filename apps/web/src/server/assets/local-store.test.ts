import { mkdtemp, readdir, rm, stat } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { InvalidAssetKeyError, LOCAL_ASSET_ROUTE, LocalAssetStore } from './local-store'
import { serveLocalAsset } from './serve-local'
import { signAssetLink, verifyAssetLink } from './signing'

const SECRET = 'a-test-secret-that-is-long-enough-0123456789'
const TENANT = 'tn_0123456789ABCDEFGHIJKL'
const OTHER_TENANT = 'tn_ZYXWVUTSRQPONMLKJIHGFE'
const ASSET = 'as_0123456789ABCDEFGHIJKL'
const KEY = `tenants/${TENANT}/assets/${ASSET}/original.png`
const BYTES = Uint8Array.from([1, 2, 3, 4, 5])

describe('signed links', () => {
  const now = 1_800_000_000_000

  it('verify for the key and expiry they were made for, until they expire', () => {
    const { exp, sig } = signAssetLink(SECRET, KEY, 60, now)
    expect(exp).toBe(1_800_000_060)
    expect(verifyAssetLink(SECRET, KEY, String(exp), sig, now)).toBe(true)
    expect(verifyAssetLink(SECRET, KEY, String(exp), sig, now + 59_000)).toBe(true)
    expect(verifyAssetLink(SECRET, KEY, String(exp), sig, now + 61_000)).toBe(false)
  })

  it('refuse another key, a longer expiry, another secret and malformed values', () => {
    const { exp, sig } = signAssetLink(SECRET, KEY, 60, now)
    const otherKey = `tenants/${OTHER_TENANT}/assets/${ASSET}/original.png`
    expect(verifyAssetLink(SECRET, otherKey, String(exp), sig, now)).toBe(false)
    expect(verifyAssetLink(SECRET, KEY, String(exp + 1000), sig, now)).toBe(false)
    expect(
      verifyAssetLink('another-secret-0123456789012345678901', KEY, String(exp), sig, now),
    ).toBe(false)
    for (const [badExp, badSig] of [
      [null, sig],
      [String(exp), null],
      [String(exp), 'zz'],
      [String(exp), sig.toUpperCase()],
      ['-5', sig],
      ['1e12', sig],
      ['', ''],
    ] as const) {
      expect(verifyAssetLink(SECRET, KEY, badExp, badSig, now)).toBe(false)
    }
  })
})

describe('LocalAssetStore', () => {
  let root: string
  let store: LocalAssetStore

  beforeEach(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), 'restro-assets-'))
    store = new LocalAssetStore({ rootDir: root, signingSecret: SECRET })
  })
  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  it('puts bytes under their key and reads them back', async () => {
    await store.put(KEY, BYTES, 'image/png')
    expect(Array.from((await store.read(KEY)) ?? [])).toEqual(Array.from(BYTES))
    expect((await stat(path.join(root, ...KEY.split('/')))).size).toBe(5)
    // Replacing a key replaces the bytes, and leaves no temporary file behind.
    await store.put(KEY, Uint8Array.from([9]), 'image/png')
    expect(Array.from((await store.read(KEY)) ?? [])).toEqual([9])
    const folder = path.dirname(path.join(root, ...KEY.split('/')))
    expect(await readdir(folder)).toEqual(['original.png'])
  })

  it('reads null for a key that holds nothing', async () => {
    expect(await store.read(KEY)).toBeNull()
  })

  it('returns a signed link to the serving route', async () => {
    const url = await store.getUrl(KEY, 600)
    const parsed = new URL(url, 'http://localhost')
    expect(parsed.pathname).toBe(`${LOCAL_ASSET_ROUTE}/${KEY}`)
    expect(
      verifyAssetLink(SECRET, KEY, parsed.searchParams.get('exp'), parsed.searchParams.get('sig')),
    ).toBe(true)
  })

  it.each([
    '../outside.png',
    'tenants/../../outside.png',
    '/etc/passwd',
    'C:\\Windows\\win.ini',
    'tenants\\a.png',
    'tenants//a.png',
    'tenants/./a.png',
    '',
    'a/b/',
    'with space.png',
    'tenants/a.png\u0000.jpg',
    '.hidden',
  ])('refuses the key %j everywhere', async (key) => {
    await expect(store.put(key, BYTES, 'image/png')).rejects.toBeInstanceOf(InvalidAssetKeyError)
    await expect(store.read(key)).rejects.toBeInstanceOf(InvalidAssetKeyError)
    await expect(store.getUrl(key, 60)).rejects.toBeInstanceOf(InvalidAssetKeyError)
  })

  describe('serveLocalAsset', () => {
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
})
