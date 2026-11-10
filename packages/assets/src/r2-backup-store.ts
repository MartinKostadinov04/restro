// The backup store of staging and production: a private Cloudflare R2 bucket of its own
// (`R2_BACKUP_BUCKET`), spoken to through its S3-compatible API. Nothing in it is public. Loaded
// only when `BACKUP_STORE=r2` (create-backup-store.ts).
import {
  DeleteObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3'

import { BACKUP_PREFIX, parseBackupKey } from './backup-paths'
import { assertBackupKey, type BackupObject, type BackupStore } from './backup-store'
import type { R2Settings } from './r2-store'

export class R2BackupStore implements BackupStore {
  /** `client` is injectable so tests can hand in an S3 client whose `send` is replaced. */
  constructor(
    private readonly client: S3Client,
    private readonly bucket: string,
  ) {}

  static fromSettings(settings: R2Settings): R2BackupStore {
    const client = new S3Client({
      // R2 has one region, called "auto".
      region: 'auto',
      endpoint: settings.endpoint,
      credentials: {
        accessKeyId: settings.accessKeyId,
        secretAccessKey: settings.secretAccessKey,
      },
      requestChecksumCalculation: 'WHEN_REQUIRED',
      responseChecksumValidation: 'WHEN_REQUIRED',
    })
    return new R2BackupStore(client, settings.bucket)
  }

  async put(key: string, bytes: Uint8Array): Promise<void> {
    assertBackupKey(key)
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: bytes,
        ContentType: 'application/octet-stream',
        CacheControl: 'private, no-store',
      }),
    )
  }

  async get(key: string): Promise<Uint8Array | null> {
    assertBackupKey(key)
    try {
      const response = await this.client.send(
        new GetObjectCommand({ Bucket: this.bucket, Key: key }),
      )
      return (await response.Body?.transformToByteArray()) ?? null
    } catch (error) {
      if ((error as { name?: string }).name === 'NoSuchKey') return null
      throw error
    }
  }

  async list(): Promise<BackupObject[]> {
    const found: BackupObject[] = []
    let token: string | undefined
    do {
      const page = await this.client.send(
        new ListObjectsV2Command({
          Bucket: this.bucket,
          Prefix: BACKUP_PREFIX,
          ...(token === undefined ? {} : { ContinuationToken: token }),
        }),
      )
      for (const object of page.Contents ?? []) {
        // Only keys of the backup shape: whatever else sits under the prefix is not ours to count.
        if (object.Key !== undefined && parseBackupKey(object.Key) !== null) {
          found.push({ key: object.Key, bytes: object.Size ?? 0 })
        }
      }
      token = page.IsTruncated === true ? page.NextContinuationToken : undefined
    } while (token !== undefined)
    return found
  }

  async delete(key: string): Promise<void> {
    assertBackupKey(key)
    // S3 answers success for a key that is not there, so a repeated delete is a no-op.
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }))
  }
}
