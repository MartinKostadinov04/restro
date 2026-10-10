import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { createPublishStore } from './create-publish-store'
import { PublishStoreConfigError, publishStoreConfig } from './publish-config'
import { LocalPublishStore, type PublishStore } from './publish-store'

const R2_ENV = {
  PUBLISH_STORE: 'r2',
  R2_ACCOUNT_ID: '0123456789abcdef',
  R2_ACCESS_KEY_ID: 'AKIAFAKEFAKEFAKE',
  R2_SECRET_ACCESS_KEY: 'not-a-real-secret-key',
  R2_PUBLIC_BUCKET: 'restro-public-staging',
}

describe('publishStoreConfig', () => {
  it('is local when unset outside production, with .local/cdn in the repository by default', () => {
    const config = publishStoreConfig({}, process.cwd())
    expect(config.kind).toBe('local')
    if (config.kind === 'local') {
      expect(config.dir.endsWith(path.join('.local', 'cdn'))).toBe(true)
    }
    expect(publishStoreConfig({ PUBLISH_STORE: 'local', NODE_ENV: 'development' }).kind).toBe(
      'local',
    )
  })

  it('takes LOCAL_PUBLISH_DIR', () => {
    expect(publishStoreConfig({ LOCAL_PUBLISH_DIR: 'some/folder' })).toEqual({
      kind: 'local',
      dir: path.resolve('some/folder'),
    })
  })

  it('refuses an unset store in production, and an unknown store', () => {
    expect(() => publishStoreConfig({ NODE_ENV: 'production' })).toThrow(PublishStoreConfigError)
    expect(() => publishStoreConfig({ PUBLISH_STORE: 's3' })).toThrow(/"local" or "r2"/)
  })

  it('reads the R2 settings, with the account endpoint by default', () => {
    expect(publishStoreConfig(R2_ENV)).toEqual({
      kind: 'r2',
      accessKeyId: 'AKIAFAKEFAKEFAKE',
      secretAccessKey: 'not-a-real-secret-key',
      bucket: 'restro-public-staging',
      endpoint: 'https://0123456789abcdef.r2.cloudflarestorage.com',
    })
    expect(
      publishStoreConfig({
        ...R2_ENV,
        R2_ENDPOINT: 'https://0123456789abcdef.eu.r2.cloudflarestorage.com',
      }),
    ).toMatchObject({ endpoint: 'https://0123456789abcdef.eu.r2.cloudflarestorage.com' })
  })

  it('names the missing R2 variables, never their values', () => {
    let message = ''
    try {
      publishStoreConfig({ ...R2_ENV, R2_PUBLIC_BUCKET: '', R2_SECRET_ACCESS_KEY: 'x' })
    } catch (error) {
      message = (error as Error).message
    }
    expect(message).toContain('R2_PUBLIC_BUCKET')
    expect(message).toContain('R2_SECRET_ACCESS_KEY')
    expect(message).not.toContain('AKIAFAKEFAKEFAKE')
  })

  it('creates the store a configuration describes (R2 loaded only when chosen)', async () => {
    const local: PublishStore = await createPublishStore({ kind: 'local', dir: path.resolve('x') })
    expect(local).toBeInstanceOf(LocalPublishStore)
    const config = publishStoreConfig(R2_ENV)
    const r2 = await createPublishStore(config)
    expect(r2.constructor.name).toBe('R2PublishStore')
  })
})
