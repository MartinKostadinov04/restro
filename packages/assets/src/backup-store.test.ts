// The backup store: key shapes, the folder store, the settings, and the R2 store against a mocked
// S3 client (no network, no real keys).

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {
  DeleteObjectCommand,
  type GetObjectCommand,
  type ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { backupStoreConfig } from './backup-config'
import { BACKUP_PREFIX, backupKey, parseBackupKey } from './backup-paths'
import { InvalidBackupKeyError, LocalBackupStore } from './backup-store'
import { createBackupStore } from './create-backup-store'
import { R2BackupStore } from './r2-backup-store'

const TAKEN = new Date('2026-11-08T14:00:00Z')
const KEY = 'db/restro-20261108T140000Z.dump'
const BYTES = Uint8Array.from([80, 71, 68, 77, 80])

describe('backup keys', () => {
  it('name the minute of the dump in UTC under one prefix', () => {
    expect(backupKey(TAKEN)).toBe(KEY)
    expect(backupKey(new Date('2026-11-08T14:00:07.912Z'))).toBe('db/restro-20261108T140007Z.dump')
    expect(KEY.startsWith(BACKUP_PREFIX)).toBe(true)
  })

  it('read back to the time they were built from', () => {
    expect(parseBackupKey(KEY)?.toISOString()).toBe('2026-11-08T14:00:00.000Z')
    const odd = new Date('2027-02-28T23:59:59Z')
    expect(parseBackupKey(backupKey(odd))?.getTime()).toBe(odd.getTime())
  })

  it('refuse every other shape, and times that do not exist', () => {
    for (const other of [
      'db/restro-20261108T140000Z.dump.tmp',
      'db/restro-20261308T140000Z.dump',
      'db/restro-20261108T250000Z.dump',
      'db/other.dump',
      'db/../restro-20261108T140000Z.dump',
      'restro-20261108T140000Z.dump',
      'tenants/tn_x/assets/as_x/original.png',
      '',
    ]) {
      expect(parseBackupKey(other)).toBeNull()
    }
  })
})

describe('LocalBackupStore', () => {
  let root: string
  let store: LocalBackupStore

  beforeEach(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), 'restro-backups-'))
    store = new LocalBackupStore({ rootDir: root })
  })
  afterEach(() => rm(root, { recursive: true, force: true }))

  it('puts, gets, lists and deletes a dump', async () => {
    expect(await store.list()).toEqual([])
    expect(await store.get(KEY)).toBeNull()
    await store.put(KEY, BYTES)
    expect(Array.from((await store.get(KEY)) ?? [])).toEqual(Array.from(BYTES))
    expect(await store.list()).toEqual([{ key: KEY, bytes: BYTES.byteLength }])
    await store.delete(KEY)
    expect(await store.get(KEY)).toBeNull()
    // A repeated delete is not an error.
    await store.delete(KEY)
    expect(await store.list()).toEqual([])
  })

  it('replaces a dump under the same key and leaves no temporary file', async () => {
    await store.put(KEY, BYTES)
    await store.put(KEY, Uint8Array.from([1, 2]))
    expect(await store.list()).toEqual([{ key: KEY, bytes: 2 }])
  })

  it('refuses keys that are not a dump’s, and lists nothing that is not one', async () => {
    await expect(store.put('db/anything.txt', BYTES)).rejects.toBeInstanceOf(InvalidBackupKeyError)
    await expect(store.get('../outside.dump')).rejects.toBeInstanceOf(InvalidBackupKeyError)
    await expect(store.delete('db/../x')).rejects.toBeInstanceOf(InvalidBackupKeyError)
    await mkdir(path.join(root, 'db'), { recursive: true })
    await writeFile(path.join(root, 'db', 'notes.txt'), 'by hand')
    expect(await store.list()).toEqual([])
  })
})

describe('createBackupStore', () => {
  const R2_ENV = {
    BACKUP_STORE: 'r2',
    R2_ACCOUNT_ID: '0123456789abcdef',
    R2_BACKUP_ACCESS_KEY_ID: 'AKIAFAKEFAKEFAKE',
    R2_BACKUP_SECRET_ACCESS_KEY: 'not-a-real-secret-key',
    R2_BACKUP_BUCKET: 'restro-backups-staging',
  }

  it('builds the store it describes', async () => {
    expect(await createBackupStore({ kind: 'local', dir: os.tmpdir() })).toBeInstanceOf(
      LocalBackupStore,
    )
    expect(await createBackupStore(backupStoreConfig(R2_ENV))).toBeInstanceOf(R2BackupStore)
  })
})

describe('R2BackupStore', () => {
  const BUCKET = 'restro-backups-staging'

  function makeStore(respond: (command: unknown) => unknown = () => ({})) {
    const client = new S3Client({
      region: 'auto',
      endpoint: 'https://0123456789abcdef.r2.cloudflarestorage.com',
      credentials: { accessKeyId: 'AKIAFAKEFAKEFAKE', secretAccessKey: 'not-a-real-secret-key' },
    })
    const send = vi
      .spyOn(client, 'send')
      .mockImplementation(async (command: unknown) => respond(command) as never)
    return { store: new R2BackupStore(client, BUCKET), send }
  }

  it('puts a dump privately into its own bucket', async () => {
    const { store, send } = makeStore()
    await store.put(KEY, BYTES)
    const command = send.mock.calls[0]?.[0] as PutObjectCommand
    expect(command).toBeInstanceOf(PutObjectCommand)
    expect(command.input).toMatchObject({ Bucket: BUCKET, Key: KEY, Body: BYTES })
    expect(command.input.CacheControl).toBe('private, no-store')
  })

  it('refuses a key that is not a dump’s before it asks R2', async () => {
    const { store, send } = makeStore()
    await expect(store.put('db/x.txt', BYTES)).rejects.toBeInstanceOf(InvalidBackupKeyError)
    await expect(store.delete('anything')).rejects.toBeInstanceOf(InvalidBackupKeyError)
    expect(send).not.toHaveBeenCalled()
  })

  it('lists every page of the prefix and keeps only dumps', async () => {
    const pages = [
      {
        Contents: [
          { Key: KEY, Size: 10 },
          { Key: 'db/readme.txt', Size: 1 },
        ],
        IsTruncated: true,
        NextContinuationToken: 'next',
      },
      { Contents: [{ Key: 'db/restro-20261107T140000Z.dump', Size: 20 }], IsTruncated: false },
    ]
    const { store, send } = makeStore(() => pages.shift())
    expect(await store.list()).toEqual([
      { key: KEY, bytes: 10 },
      { key: 'db/restro-20261107T140000Z.dump', bytes: 20 },
    ])
    const [first, second] = send.mock.calls.map((call) => call[0] as ListObjectsV2Command)
    expect(first?.input).toMatchObject({ Bucket: BUCKET, Prefix: BACKUP_PREFIX })
    expect(second?.input.ContinuationToken).toBe('next')
  })

  it('deletes by key, and answers null for a dump that is not there', async () => {
    const { store, send } = makeStore((command) => {
      if ((command as GetObjectCommand).constructor.name === 'GetObjectCommand') {
        throw Object.assign(new Error('missing'), { name: 'NoSuchKey' })
      }
      return {}
    })
    await store.delete(KEY)
    const command = send.mock.calls[0]?.[0] as DeleteObjectCommand
    expect(command).toBeInstanceOf(DeleteObjectCommand)
    expect(command.input).toMatchObject({ Bucket: BUCKET, Key: KEY })
    expect(await store.get(KEY)).toBeNull()
  })
})
