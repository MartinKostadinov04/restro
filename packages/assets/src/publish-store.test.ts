import { mkdtemp, readdir, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { newId } from '@restro/core'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  assertPublishPath,
  currentPath,
  InvalidPublishPathError,
  livePath,
  parsePublishPath,
  publishCacheControl,
  publishContentType,
  publishPutOptions,
  snapshotPath,
  variantPath,
} from './publish-paths'
import { LocalPublishStore } from './publish-store'

const sn = newId('sn')
const nd = newId('nd')
const vn = newId('vn')
const as = newId('as')
const BYTES = Uint8Array.from([1, 2, 3])

describe('publish paths', () => {
  it('knows the four shapes and nothing else', () => {
    expect(parsePublishPath(snapshotPath(sn))).toEqual({ kind: 'snapshot', snapshotId: sn })
    expect(parsePublishPath(currentPath(nd, vn))).toEqual({
      kind: 'current',
      menuId: nd,
      venueId: vn,
    })
    expect(parsePublishPath(livePath(nd, vn))).toEqual({ kind: 'live', menuId: nd, venueId: vn })
    expect(parsePublishPath(variantPath(as, 640))).toEqual({
      kind: 'variant',
      assetId: as,
      width: 640,
    })
  })

  it.each([
    '',
    '/snap/x.json',
    `snap/${sn}.json/`,
    `snap/${sn}.JSON`,
    `snap/${sn}.json.tmp`,
    `snap/${nd}.json`,
    'snap/sn_short.json',
    `snap/../snap/${sn}.json`,
    `m/${nd}/${vn}/other.json`,
    `m/${vn}/${nd}/current.json`,
    `m/${nd}/${vn}/../${vn}/current.json`,
    `a/${as}/original.png`,
    `a/${as}/w0.webp`,
    `a/${as}/w99999.webp`,
    `a/${as}/w640.png`,
    `a/${as}/w640.webp/extra`,
    `tenants/tn_0123456789ABCDEFGHIJKL/assets/${as}/original.png`,
    '../outside.json',
    'C:\\Windows\\win.ini',
    `snap\\${sn}.json`,
    `snap/${sn}.json\u0000.png`,
  ])('refuses %j', (value) => {
    expect(parsePublishPath(value)).toBeNull()
    expect(() => assertPublishPath(value)).toThrow(InvalidPublishPathError)
  })

  it('has one cache rule per kind of file (doc "Files on the CDN")', () => {
    const immutable = 'public, max-age=31536000, immutable'
    expect(publishCacheControl(snapshotPath(sn))).toBe(immutable)
    expect(publishCacheControl(variantPath(as, 320))).toBe(immutable)
    expect(publishCacheControl(currentPath(nd, vn))).toBe('public, max-age=30')
    expect(publishCacheControl(livePath(nd, vn))).toBe('public, max-age=15')
    expect(() => publishCacheControl('anything/else.json')).toThrow(InvalidPublishPathError)
  })

  it('has a content type per kind of file, and put options from both rules', () => {
    expect(publishContentType(snapshotPath(sn))).toBe('application/json')
    expect(publishContentType(currentPath(nd, vn))).toBe('application/json')
    expect(publishContentType(livePath(nd, vn))).toBe('application/json')
    expect(publishContentType(variantPath(as, 320))).toBe('image/webp')
    expect(publishPutOptions(livePath(nd, vn))).toEqual({
      contentType: 'application/json',
      cacheControl: 'public, max-age=15',
    })
  })
})

describe('LocalPublishStore', () => {
  let root: string
  let store: LocalPublishStore

  beforeEach(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), 'restro-publish-'))
    store = new LocalPublishStore({ rootDir: root })
  })
  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  it('puts bytes at their path and reads them back, replacing without leftovers', async () => {
    const file = currentPath(nd, vn)
    await store.put(file, BYTES, publishPutOptions(file))
    expect(Array.from((await store.get(file)) ?? [])).toEqual([1, 2, 3])
    await store.put(file, Uint8Array.from([9]), publishPutOptions(file))
    expect(Array.from((await store.get(file)) ?? [])).toEqual([9])
    expect(await readdir(path.join(root, 'm', nd, vn))).toEqual(['current.json'])
  })

  it('reads null for a path that holds nothing', async () => {
    expect(await store.get(snapshotPath(sn))).toBeNull()
    expect(await store.get(variantPath(as, 320))).toBeNull()
  })

  it.each([
    '../outside.json',
    `snap/../../outside/${sn}.json`,
    '/etc/passwd',
    `tenants/tn_0123456789ABCDEFGHIJKL/assets/${as}/original.jpg`,
    'C:\\Windows\\win.ini',
    '',
    `a/${as}/w320.webp\u0000.json`,
  ])('refuses the path %j everywhere', async (value) => {
    const options = { contentType: 'application/json', cacheControl: 'public, max-age=30' }
    await expect(store.put(value, BYTES, options)).rejects.toBeInstanceOf(InvalidPublishPathError)
    await expect(store.get(value)).rejects.toBeInstanceOf(InvalidPublishPathError)
  })
})
