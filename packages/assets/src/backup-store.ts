// The backup store: where the worker's database dumps are kept. Its own small interface, separate
// from the asset store (photos) and the publish store (public menus), because a backup needs what
// neither has (listing and removing, for the 30-day retention) and must never share a place with
// public files. Two implementations, chosen by `BACKUP_STORE` (./backup-config.ts): a folder on
// disk for development and tests (`LocalBackupStore`), and a private Cloudflare R2 bucket for
// staging and production (`R2BackupStore`).
//
// Keys are the shape of ./backup-paths.ts only; anything else is refused.
import { randomBytes } from 'node:crypto'
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { BACKUP_PREFIX, parseBackupKey } from './backup-paths'

/** A key that is not the key of a database dump. */
export class InvalidBackupKeyError extends Error {
  override name = 'InvalidBackupKeyError'
  constructor(key: string) {
    super(`not a backup key: ${JSON.stringify(key.slice(0, 80))}`)
  }
}

/** One stored dump: its key (which carries the time it was taken) and its size. */
export interface BackupObject {
  readonly key: string
  readonly bytes: number
}

export interface BackupStore {
  /** Stores `bytes` under `key`, replacing anything there. Throws for a key that is not a backup's. */
  put(key: string, bytes: Uint8Array): Promise<void>
  /** The bytes under `key`, or null when there are none. */
  get(key: string): Promise<Uint8Array | null>
  /** Every dump in the store (keys of the backup shape only), in no particular order. */
  list(): Promise<BackupObject[]>
  /** Removes the dump under `key`. Removing one that is not there is not an error. */
  delete(key: string): Promise<void>
}

export function assertBackupKey(key: string): void {
  if (parseBackupKey(key) === null) throw new InvalidBackupKeyError(key)
}

export interface LocalBackupStoreOptions {
  /** The folder dumps are written under; created on first use. */
  readonly rootDir: string
}

/** The development backup store: files on disk. */
export class LocalBackupStore implements BackupStore {
  private readonly root: string

  constructor(options: LocalBackupStoreOptions) {
    this.root = path.resolve(options.rootDir)
  }

  private fileOf(key: string): string {
    assertBackupKey(key)
    return path.join(this.root, ...key.split('/'))
  }

  async put(key: string, bytes: Uint8Array): Promise<void> {
    const file = this.fileOf(key)
    await mkdir(path.dirname(file), { recursive: true })
    // Write beside the target and rename, so a reader never sees half a dump.
    const temporary = `${file}.${randomBytes(6).toString('hex')}.tmp`
    try {
      await writeFile(temporary, bytes)
      await rename(temporary, file)
    } catch (error) {
      await rm(temporary, { force: true })
      throw error
    }
  }

  async get(key: string): Promise<Uint8Array | null> {
    try {
      return await readFile(this.fileOf(key))
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
      throw error
    }
  }

  async list(): Promise<BackupObject[]> {
    let names: string[]
    try {
      names = await readdir(path.join(this.root, BACKUP_PREFIX))
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
      throw error
    }
    const found: BackupObject[] = []
    for (const name of names) {
      const key = `${BACKUP_PREFIX}${name}`
      if (parseBackupKey(key) === null) continue
      try {
        found.push({ key, bytes: (await stat(this.fileOf(key))).size })
      } catch (error) {
        // Gone between the listing and the look: nothing to list.
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      }
    }
    return found
  }

  async delete(key: string): Promise<void> {
    // `force` makes a missing file a no-op.
    await rm(this.fileOf(key), { force: true })
  }
}
