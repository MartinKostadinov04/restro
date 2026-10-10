// The publish store of staging and production: the public Cloudflare R2 bucket behind the CDN
// (`R2_PUBLIC_BUCKET`), spoken to through its S3-compatible API. Every object is put with the
// `Cache-Control` and `Content-Type` of its path (./publish-paths.ts), which R2 and the CDN then
// serve as they are. Loaded only when `PUBLISH_STORE=r2` (create-publish-store.ts).
import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3'

import { assertPublishPath, type PublishPutOptions } from './publish-paths'
import type { PublishStore } from './publish-store'
import type { R2Settings } from './r2-store'

export class R2PublishStore implements PublishStore {
  /** `client` is injectable so tests can hand in an S3 client whose `send` is replaced. */
  constructor(
    private readonly client: S3Client,
    private readonly bucket: string,
  ) {}

  static fromSettings(settings: R2Settings): R2PublishStore {
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
    return new R2PublishStore(client, settings.bucket)
  }

  async put(path: string, bytes: Uint8Array, options: PublishPutOptions): Promise<void> {
    assertPublishPath(path)
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: path,
        Body: bytes,
        ContentType: options.contentType,
        CacheControl: options.cacheControl,
      }),
    )
  }

  async get(path: string): Promise<Uint8Array | null> {
    assertPublishPath(path)
    try {
      const response = await this.client.send(
        new GetObjectCommand({ Bucket: this.bucket, Key: path }),
      )
      return (await response.Body?.transformToByteArray()) ?? null
    } catch (error) {
      if ((error as { name?: string }).name === 'NoSuchKey') return null
      throw error
    }
  }
}
