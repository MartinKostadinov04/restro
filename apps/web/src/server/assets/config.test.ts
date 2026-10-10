import path from 'node:path'
import {
  AssetStoreConfigError,
  assetStoreConfig,
  createAssetStore,
  LocalAssetStore,
} from '@restro/assets'
import { describe, expect, it } from 'vitest'

const R2 = {
  ASSET_STORE: 'r2',
  R2_ACCOUNT_ID: '0123456789abcdef0123456789abcdef',
  R2_ACCESS_KEY_ID: 'AKIAFAKEFAKEFAKE',
  R2_SECRET_ACCESS_KEY: 'not-a-real-secret-key',
  R2_BUCKET: 'restro-assets',
}

describe('assetStoreConfig', () => {
  it('is local with the repository folder by default outside production', () => {
    const config = assetStoreConfig({}, import.meta.dirname)
    expect(config.kind).toBe('local')
    if (config.kind !== 'local') return
    expect(config.dir.endsWith(path.join('.local', 'assets'))).toBe(true)
    // The folder is under the folder with pnpm-workspace.yaml, not under apps/web.
    expect(config.dir.includes(path.join('apps', 'web'))).toBe(false)
  })

  it('honours LOCAL_ASSET_DIR and an explicit local choice', () => {
    const config = assetStoreConfig({ ASSET_STORE: 'local', LOCAL_ASSET_DIR: 'some/where' })
    expect(config).toEqual({ kind: 'local', dir: path.resolve('some/where') })
  })

  it('refuses to guess in production', () => {
    expect(() => assetStoreConfig({ NODE_ENV: 'production' })).toThrow(AssetStoreConfigError)
    expect(assetStoreConfig({ NODE_ENV: 'production', ASSET_STORE: 'local' }).kind).toBe('local')
  })

  it('refuses an unknown store', () => {
    expect(() => assetStoreConfig({ ASSET_STORE: 's3' })).toThrow(/"local" or "r2"/)
  })

  it('reads the R2 settings and derives the endpoint from the account id', () => {
    expect(assetStoreConfig(R2)).toEqual({
      kind: 'r2',
      accessKeyId: 'AKIAFAKEFAKEFAKE',
      secretAccessKey: 'not-a-real-secret-key',
      bucket: 'restro-assets',
      endpoint: 'https://0123456789abcdef0123456789abcdef.r2.cloudflarestorage.com',
    })
  })

  it('takes an explicit endpoint (EU jurisdiction)', () => {
    const config = assetStoreConfig({
      ...R2,
      R2_ENDPOINT: 'https://0123456789abcdef0123456789abcdef.eu.r2.cloudflarestorage.com',
    })
    expect(config).toMatchObject({
      endpoint: 'https://0123456789abcdef0123456789abcdef.eu.r2.cloudflarestorage.com',
    })
  })

  it('names the missing or malformed variables and never shows a value', () => {
    let message = ''
    try {
      assetStoreConfig({ ASSET_STORE: 'r2', R2_BUCKET: 'Bad Bucket', R2_SECRET_ACCESS_KEY: 'xy' })
    } catch (error) {
      message = (error as Error).message
    }
    for (const name of ['R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET']) {
      expect(message).toContain(name)
    }
    expect(message).not.toContain('Bad Bucket')
    expect(() => assetStoreConfig({ ...R2, R2_ENDPOINT: 'http://insecure.example' })).toThrow(
      /R2_ENDPOINT/,
    )
  })
})

describe('createAssetStore', () => {
  it('builds the local store, and the R2 store only when it is chosen', async () => {
    const local = await createAssetStore(assetStoreConfig({ ASSET_STORE: 'local' }), 'secret')
    expect(local).toBeInstanceOf(LocalAssetStore)
    const r2 = await createAssetStore(assetStoreConfig(R2), 'secret')
    expect(r2).not.toBeInstanceOf(LocalAssetStore)
    expect(typeof r2.put).toBe('function')
    expect(typeof r2.getUrl).toBe('function')
  })
})
