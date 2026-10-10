// The publish store (brief S3-01b): where the files a guest page reads live. Two implementations
// behind one small interface, chosen by `PUBLISH_STORE` (./publish-config.ts): a folder on disk
// for local development, which the web app serves at `/cdn/...` (`LocalPublishStore`), and the
// public R2 bucket behind the CDN for staging and production (`R2PublishStore`).
//
// Everything in it is public by design: snapshots, pointers, the live overlay and webp variants.
// Paths are the four shapes of ./publish-paths.ts only, so an original photo or anything private
// cannot be put here by mistake: such a path is refused.
import { randomBytes } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { assertPublishPath, InvalidPublishPathError, type PublishPutOptions } from './publish-paths'

/** Where published files are kept. */
export interface PublishStore {
  /**
   * Stores `bytes` at `path`, replacing anything there. `options` come from `publishPutOptions`:
   * the store keeps them with the file (R2) or derives the same from the path when serving (local).
   * Throws `InvalidPublishPathError` for a path that is not one of the four shapes.
   */
  put(path: string, bytes: Uint8Array, options: PublishPutOptions): Promise<void>
  /** The bytes at `path`, or null when there is none. */
  get(path: string): Promise<Uint8Array | null>
}

export interface LocalPublishStoreOptions {
  /** The folder files are written under; created on first use. */
  readonly rootDir: string
}

/** The development publish store: files on disk. */
export class LocalPublishStore implements PublishStore {
  private readonly root: string

  constructor(options: LocalPublishStoreOptions) {
    this.root = path.resolve(options.rootDir)
  }

  /** The file a path lives in; the four shapes only, and never outside the root folder. */
  private fileOf(publishPath: string): string {
    assertPublishPath(publishPath)
    const file = path.resolve(this.root, ...publishPath.split('/'))
    // Unreachable for the allowlisted shapes; kept as a second line of defence.
    if (!file.startsWith(this.root + path.sep)) throw new InvalidPublishPathError(publishPath)
    return file
  }

  async put(publishPath: string, bytes: Uint8Array, _options: PublishPutOptions): Promise<void> {
    const file = this.fileOf(publishPath)
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

  async get(publishPath: string): Promise<Uint8Array | null> {
    const file = this.fileOf(publishPath)
    try {
      return await readFile(file)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
      throw error
    }
  }
}
