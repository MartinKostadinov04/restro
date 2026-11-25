// The backup store's settings: local by default, and for r2 a key and an endpoint of its own.

import path from 'node:path'
import { describe, expect, it } from 'vitest'

import { BackupStoreConfigError, backupStoreConfig } from './backup-config'

describe('backupStoreConfig', () => {
  const R2_ENV = {
    BACKUP_STORE: 'r2',
    R2_ACCOUNT_ID: '0123456789abcdef',
    R2_BACKUP_ACCESS_KEY_ID: 'AKIAFAKEFAKEFAKE',
    R2_BACKUP_SECRET_ACCESS_KEY: 'not-a-real-secret-key',
    R2_BACKUP_BUCKET: 'restro-backups-staging',
  }

  it('is local when unset outside production, with .local/backups by default', () => {
    const config = backupStoreConfig({}, process.cwd())
    expect(config.kind).toBe('local')
    if (config.kind === 'local') {
      expect(config.dir.endsWith(path.join('.local', 'backups'))).toBe(true)
    }
    expect(backupStoreConfig({ LOCAL_BACKUP_DIR: 'some/folder' })).toEqual({
      kind: 'local',
      dir: path.resolve('some/folder'),
    })
  })

  it('refuses an unset store in production, and an unknown store', () => {
    expect(() => backupStoreConfig({ NODE_ENV: 'production' })).toThrow(BackupStoreConfigError)
    expect(() => backupStoreConfig({ BACKUP_STORE: 's3' })).toThrow(/"local" or "r2"/)
  })

  it('reads the R2 settings from a bucket and a key of its own', () => {
    expect(backupStoreConfig(R2_ENV)).toEqual({
      kind: 'r2',
      accessKeyId: 'AKIAFAKEFAKEFAKE',
      secretAccessKey: 'not-a-real-secret-key',
      bucket: 'restro-backups-staging',
      endpoint: 'https://0123456789abcdef.eu.r2.cloudflarestorage.com',
    })
    // The asset and the public bucket are not the backup bucket.
    expect(() =>
      backupStoreConfig({ ...R2_ENV, R2_BACKUP_BUCKET: undefined, R2_BUCKET: 'restro-assets' }),
    ).toThrow(/R2_BACKUP_BUCKET/)
  })

  it('defaults the endpoint to the EU jurisdiction of the account', () => {
    const config = backupStoreConfig(R2_ENV)
    expect(config.kind === 'r2' && config.endpoint).toContain('.eu.r2.cloudflarestorage.com')
  })

  it('lets an explicit R2_BACKUP_ENDPOINT win over the default', () => {
    const config = backupStoreConfig({
      ...R2_ENV,
      R2_BACKUP_ENDPOINT: 'https://example.invalid',
      R2_ENDPOINT: 'https://asset-store.invalid',
    })
    expect(config.kind === 'r2' && config.endpoint).toBe('https://example.invalid')
  })

  it('never falls back to the asset store’s key or endpoint', () => {
    // The asset store's variables are set; the backup's key is not. The error names the backup
    // variables, and the asset store's key is not used in their place.
    const assetStore = {
      R2_ACCESS_KEY_ID: 'AKIAASSETSTORE0',
      R2_SECRET_ACCESS_KEY: 'asset-store-secret-key',
      R2_ENDPOINT: 'https://asset-store.invalid',
    }
    let message = ''
    try {
      backupStoreConfig({
        ...R2_ENV,
        ...assetStore,
        R2_BACKUP_ACCESS_KEY_ID: undefined,
        R2_BACKUP_SECRET_ACCESS_KEY: undefined,
      })
    } catch (error) {
      message = (error as Error).message
    }
    expect(message).toContain('R2_BACKUP_ACCESS_KEY_ID')
    expect(message).toContain('R2_BACKUP_SECRET_ACCESS_KEY')
    expect(message).not.toMatch(/R2_ACCESS_KEY_ID|R2_SECRET_ACCESS_KEY/)
    // With the backup key set, the asset store's endpoint is ignored too.
    const config = backupStoreConfig({ ...R2_ENV, ...assetStore })
    expect(config.kind === 'r2' && config.accessKeyId).toBe('AKIAFAKEFAKEFAKE')
    expect(config.kind === 'r2' && config.endpoint).toContain('.eu.r2.')
  })

  it('names the settings that are wrong, never their values', () => {
    let message = ''
    try {
      backupStoreConfig({
        ...R2_ENV,
        R2_BACKUP_ACCESS_KEY_ID: 'short',
        R2_BACKUP_SECRET_ACCESS_KEY: 'tiny',
      })
    } catch (error) {
      message = (error as Error).message
    }
    expect(message).toContain('R2_BACKUP_ACCESS_KEY_ID')
    expect(message).toContain('R2_BACKUP_SECRET_ACCESS_KEY')
    expect(message).not.toContain('tiny')
  })
})
