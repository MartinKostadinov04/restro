// The development asset store: files on disk under one folder (`.local/assets` in the repository
// by default, which git ignores). `getUrl` returns a signed link to our own route,
// `/api/assets/file/<key>`, which also requires a signed-in person of the file's tenant
// (app/api/assets/file/[...key]/route.ts). Not for production: the bucket is R2 there.
import { randomBytes } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { signAssetLink } from './signing'
import type { AssetStore } from './types'

/** The public path of the route that serves the local store's files. */
export const LOCAL_ASSET_ROUTE = '/api/assets/file'

/** Keys the store accepts: safe path segments, no `..`, no empty segment, no leading slash. */
const KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*(?:\/[A-Za-z0-9][A-Za-z0-9._-]*)*$/

/** Thrown for a key that is not a plain relative path of safe segments. */
export class InvalidAssetKeyError extends Error {
  override name = 'InvalidAssetKeyError'
  constructor(key: string) {
    super(`not a valid asset key: ${JSON.stringify(key.slice(0, 80))}`)
  }
}

export interface LocalAssetStoreOptions {
  /** The folder files are written under; created on first use. */
  readonly rootDir: string
  /** The secret that signs links (the route verifies with the same one). */
  readonly signingSecret: string
}

export class LocalAssetStore implements AssetStore {
  private readonly root: string
  private readonly secret: string

  constructor(options: LocalAssetStoreOptions) {
    this.root = path.resolve(options.rootDir)
    this.secret = options.signingSecret
  }

  /** The file a key lives in; refuses anything that would leave the root folder. */
  private pathOf(key: string): string {
    if (!KEY_PATTERN.test(key) || key.length > 512) throw new InvalidAssetKeyError(key)
    const file = path.resolve(this.root, ...key.split('/'))
    if (!file.startsWith(this.root + path.sep)) throw new InvalidAssetKeyError(key)
    return file
  }

  async put(key: string, bytes: Uint8Array, _contentType: string): Promise<void> {
    const file = this.pathOf(key)
    await mkdir(path.dirname(file), { recursive: true })
    // Write beside the target and rename, so a reader never sees half a file.
    const temporary = `${file}.${randomBytes(6).toString('hex')}.tmp`
    try {
      await writeFile(temporary, bytes)
      await rename(temporary, file)
    } catch (error) {
      await rm(temporary, { force: true })
      throw error
    }
  }

  async getUrl(key: string, ttlSeconds: number): Promise<string> {
    this.pathOf(key)
    const { exp, sig } = signAssetLink(this.secret, key, ttlSeconds)
    return `${LOCAL_ASSET_ROUTE}/${key}?exp=${exp}&sig=${sig}`
  }

  /** The bytes of a stored file, or null when there is none (the `AssetStore` contract). */
  get(key: string): Promise<Uint8Array | null> {
    return this.read(key)
  }

  /** The bytes of a stored file, or null when there is none (for the serving route). */
  async read(key: string): Promise<Uint8Array | null> {
    const file = this.pathOf(key)
    try {
      return await readFile(file)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
      throw error
    }
  }

  /** The secret links are signed with, for the route that verifies them. */
  get linkSecret(): string {
    return this.secret
  }
}
