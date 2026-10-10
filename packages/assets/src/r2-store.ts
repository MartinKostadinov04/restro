// The asset store of staging and production: a private Cloudflare R2 bucket, spoken to through its
// S3-compatible API. Nothing is public: the admin sees images through presigned GET URLs that
// expire (`getUrl`), and the guest app will get stable CDN URLs with variants in Stage 3 (the
// Platform handed out 24-hour presigned downloads; platform-reference pitfall 8).
import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'

import type { AssetStore } from './types'

/** Longest presigned URL S3-compatible stores accept: seven days. */
const MAX_TTL_SECONDS = 7 * 24 * 60 * 60

export interface R2Settings {
  readonly accessKeyId: string
  readonly secretAccessKey: string
  readonly bucket: string
  /** `https://<account id>.r2.cloudflarestorage.com`, or the `.eu.` form for EU jurisdiction. */
  readonly endpoint: string
}

export class R2AssetStore implements AssetStore {
  /**
   * `client` is injectable so tests can hand in an S3 client whose `send` is replaced; presigning
   * a URL needs no network (it signs locally with the credentials).
   */
  constructor(
    private readonly client: S3Client,
    private readonly bucket: string,
  ) {}

  static fromSettings(settings: R2Settings): R2AssetStore {
    const client = new S3Client({
      // R2 has one region, called "auto".
      region: 'auto',
      endpoint: settings.endpoint,
      credentials: {
        accessKeyId: settings.accessKeyId,
        secretAccessKey: settings.secretAccessKey,
      },
      // Newer SDK versions add a CRC32 checksum header that R2 does not take on every call.
      requestChecksumCalculation: 'WHEN_REQUIRED',
      responseChecksumValidation: 'WHEN_REQUIRED',
    })
    return new R2AssetStore(client, settings.bucket)
  }

  async put(key: string, bytes: Uint8Array, contentType: string): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: bytes,
        ContentType: contentType,
        // The bytes never change under a key, so a browser may keep them.
        CacheControl: 'private, max-age=31536000, immutable',
      }),
    )
  }

  async getUrl(key: string, ttlSeconds: number): Promise<string> {
    const expiresIn = Math.min(MAX_TTL_SECONDS, Math.max(1, Math.floor(ttlSeconds)))
    return getSignedUrl(this.client, new GetObjectCommand({ Bucket: this.bucket, Key: key }), {
      expiresIn,
    })
  }
}
