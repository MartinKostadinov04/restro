import { mkdtemp, readdir, rm, stat } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { InvalidAssetKeyError, LOCAL_ASSET_ROUTE, LocalAssetStore } from './local-store'
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
    expect(await store.get(KEY)).toBeNull()
  })

  it('gives the bytes back through the AssetStore contract (get)', async () => {
    await store.put(KEY, BYTES, 'image/png')
    expect(Array.from((await store.get(KEY)) ?? [])).toEqual(Array.from(BYTES))
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
})
