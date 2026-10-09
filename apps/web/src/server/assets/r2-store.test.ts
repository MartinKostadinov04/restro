// The R2 store against a mocked S3 client: no network and no real keys. Presigning is local
// (it signs with the credentials), so a real client with made-up credentials proves the URL.
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3'
import { describe, expect, it, vi } from 'vitest'

import { R2AssetStore } from './r2-store'

const BUCKET = 'restro-assets'
const ENDPOINT = 'https://0123456789abcdef.r2.cloudflarestorage.com'
const KEY = 'tenants/tn_0123456789ABCDEFGHIJKL/assets/as_0123456789ABCDEFGHIJKL/original.webp'

function makeStore() {
  const client = new S3Client({
    region: 'auto',
    endpoint: ENDPOINT,
    credentials: { accessKeyId: 'AKIAFAKEFAKEFAKE', secretAccessKey: 'not-a-real-secret-key' },
  })
  const send = vi.spyOn(client, 'send').mockImplementation(async () => ({}) as never)
  return { store: new R2AssetStore(client, BUCKET), send }
}

describe('R2AssetStore', () => {
  it('puts the bytes in the bucket with their key and content type', async () => {
    const { store, send } = makeStore()
    const bytes = Uint8Array.from([1, 2, 3])
    await store.put(KEY, bytes, 'image/webp')
    expect(send).toHaveBeenCalledTimes(1)
    const command = send.mock.calls[0]?.[0] as PutObjectCommand
    expect(command).toBeInstanceOf(PutObjectCommand)
    expect(command.input).toMatchObject({
      Bucket: BUCKET,
      Key: KEY,
      Body: bytes,
      ContentType: 'image/webp',
    })
  })

  it('lets a failure of the bucket through, so the upload fails', async () => {
    const { store, send } = makeStore()
    send.mockRejectedValueOnce(new Error('AccessDenied'))
    await expect(store.put(KEY, Uint8Array.of(1), 'image/webp')).rejects.toThrow('AccessDenied')
  })

  it('returns a presigned GET URL of the private bucket that expires', async () => {
    const { store, send } = makeStore()
    const url = new URL(await store.getUrl(KEY, 900))
    expect(send).not.toHaveBeenCalled()
    expect(url.origin + url.pathname).toMatch(
      /^https:\/\/(restro-assets\.0123456789abcdef\.r2\.cloudflarestorage\.com|0123456789abcdef\.r2\.cloudflarestorage\.com\/restro-assets)\/tenants\/tn_0123456789ABCDEFGHIJKL\/assets\/as_0123456789ABCDEFGHIJKL\/original\.webp$/,
    )
    expect(url.searchParams.get('X-Amz-Expires')).toBe('900')
    expect(url.searchParams.get('X-Amz-Algorithm')).toBe('AWS4-HMAC-SHA256')
    expect(url.searchParams.get('X-Amz-Signature')).toMatch(/^[0-9a-f]{64}$/)
    expect(url.searchParams.get('X-Amz-Credential')).toContain('AKIAFAKEFAKEFAKE')
    // The secret key is never in the URL.
    expect(url.toString()).not.toContain('not-a-real-secret-key')
  })

  it('keeps the lifetime within what the store accepts', async () => {
    const { store } = makeStore()
    const longest = new URL(await store.getUrl(KEY, 365 * 24 * 60 * 60))
    expect(longest.searchParams.get('X-Amz-Expires')).toBe(String(7 * 24 * 60 * 60))
    const shortest = new URL(await store.getUrl(KEY, 0))
    expect(shortest.searchParams.get('X-Amz-Expires')).toBe('1')
  })

  it('is built from settings with the R2 region and endpoint', async () => {
    const store = R2AssetStore.fromSettings({
      accessKeyId: 'AKIAFAKEFAKEFAKE',
      secretAccessKey: 'not-a-real-secret-key',
      bucket: BUCKET,
      endpoint: ENDPOINT,
    })
    const url = new URL(await store.getUrl(KEY, 60))
    expect(url.hostname).toContain('0123456789abcdef.r2.cloudflarestorage.com')
    expect(url.searchParams.get('X-Amz-Credential')).toContain('/auto/s3/aws4_request')
  })
})
