// The R2 publish store against a mocked S3 client: no network and no real keys.
import {
  DeleteObjectCommand,
  type GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3'
import { newId } from '@restro/core'
import { describe, expect, it, vi } from 'vitest'

import {
  currentPath,
  InvalidPublishPathError,
  publishPutOptions,
  snapshotPath,
  tableTokenPath,
} from './publish-paths'
import { R2PublishStore } from './r2-publish-store'

const BUCKET = 'restro-public-staging'
const ENDPOINT = 'https://0123456789abcdef.r2.cloudflarestorage.com'
const nd = newId('nd')
const vn = newId('vn')
const sn = newId('sn')

function makeStore() {
  const client = new S3Client({
    region: 'auto',
    endpoint: ENDPOINT,
    credentials: { accessKeyId: 'AKIAFAKEFAKEFAKE', secretAccessKey: 'not-a-real-secret-key' },
  })
  const send = vi.spyOn(client, 'send').mockImplementation(async () => ({}) as never)
  return { store: new R2PublishStore(client, BUCKET), send }
}

describe('R2PublishStore', () => {
  it('puts with the cache rule and content type of the path', async () => {
    const { store, send } = makeStore()
    const bytes = Uint8Array.from([1, 2, 3])
    const file = currentPath(nd, vn)
    await store.put(file, bytes, publishPutOptions(file))
    const snap = snapshotPath(sn)
    await store.put(snap, bytes, publishPutOptions(snap))
    const [current, snapshot] = send.mock.calls.map((call) => call[0] as PutObjectCommand)
    expect(current).toBeInstanceOf(PutObjectCommand)
    expect(current?.input).toMatchObject({
      Bucket: BUCKET,
      Key: file,
      Body: bytes,
      ContentType: 'application/json',
      CacheControl: 'public, max-age=30',
    })
    expect(snapshot?.input).toMatchObject({
      Key: snap,
      CacheControl: 'public, max-age=31536000, immutable',
    })
  })

  it('refuses a path outside the four shapes before talking to the bucket', async () => {
    const { store, send } = makeStore()
    const options = { contentType: 'image/png', cacheControl: 'public' }
    await expect(store.put('tenants/x/original.png', Uint8Array.of(1), options)).rejects.toThrow(
      InvalidPublishPathError,
    )
    await expect(store.get('../x')).rejects.toThrow(InvalidPublishPathError)
    expect(send).not.toHaveBeenCalled()
  })

  it('deletes the key of a path, and refuses a path outside the shapes', async () => {
    const { store, send } = makeStore()
    const file = tableTokenPath('Ab3dEfGh1jKlMnOpQrStUv')
    await store.delete(file)
    const command = send.mock.calls[0]?.[0] as DeleteObjectCommand
    expect(command).toBeInstanceOf(DeleteObjectCommand)
    expect(command.input).toMatchObject({ Bucket: BUCKET, Key: file })
    await expect(store.delete('tenants/x/original.png')).rejects.toThrow(InvalidPublishPathError)
    expect(send).toHaveBeenCalledTimes(1)
  })

  it('reads the bytes, null for a missing key, and lets other failures through', async () => {
    const { store, send } = makeStore()
    send.mockImplementationOnce(
      async () => ({ Body: { transformToByteArray: async () => Uint8Array.of(7, 8) } }) as never,
    )
    expect(Array.from((await store.get(snapshotPath(sn))) ?? [])).toEqual([7, 8])
    const command = send.mock.calls[0]?.[0] as GetObjectCommand
    expect(command.input).toMatchObject({ Bucket: BUCKET, Key: snapshotPath(sn) })

    send.mockRejectedValueOnce(Object.assign(new Error('gone'), { name: 'NoSuchKey' }))
    expect(await store.get(snapshotPath(sn))).toBeNull()
    send.mockRejectedValueOnce(new Error('AccessDenied'))
    await expect(store.get(snapshotPath(sn))).rejects.toThrow('AccessDenied')
  })
})
