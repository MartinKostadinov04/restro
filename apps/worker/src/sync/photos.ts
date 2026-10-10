// Fetching one barsy photo into the asset store (brief S2-03b, `asset-fetch`).
//
// The URL comes from barsy's `picture_url` through the mapping, so it is data from outside: it is
// followed only when it points at the integration's own host (SSRF guard: same scheme, host and
// port, on every redirect too), with a timeout of 20 s, and the bytes must be a JPEG, PNG or WebP
// by their first bytes (`inspectImage`), at most 10 MB. Credentials are sent only to that host,
// and only if it asks for them (a 401 or 403 on the first, anonymous request).
//
// The same bytes are stored once: an existing barsy asset with the same SHA-256 is reused. The
// item then gets the asset in its `image` field in the BARSY layer, through apply(); a photo the
// manager added (manual layer) still wins by the field's combinator, which this never touches.

import { createHash } from 'node:crypto'

import { assetStorageKey, inspectImage } from '@restro/assets'
import { BARSY_MAPPING_VERSION, readArticlePicture } from '@restro/barsy'
import { type AssetFetchJob, type AssetImageType, MAX_IMAGE_BYTES, newId } from '@restro/core'
import { type ApplyRejection, apply, createAsset } from '@restro/core/apply'
import { assets, sourceLinks, sourceRecords, withTenant } from '@restro/db'
import { and, eq } from 'drizzle-orm'

import type { IntegrationSession, SyncEnvironment } from './context'

/** How long one download may take. */
export const PHOTO_TIMEOUT_MS = 20_000
const MAX_REDIRECTS = 3

/** A photo that will not be stored, and why. Retrying does not help. */
export type PhotoRefusal =
  | 'foreign_origin'
  | 'not_an_image'
  | 'too_large'
  | 'bad_status'
  | 'too_many_redirects'

export class PhotoRefused extends Error {
  override name = 'PhotoRefused'
  readonly reason: PhotoRefusal

  constructor(reason: PhotoRefusal, message: string) {
    super(message)
    this.reason = reason
  }
}

/** Why a photo job has nothing left to do. */
export type ObsoleteReason =
  /** The article is not linked (any more), or its link has no current record. */
  | 'unlinked'
  /** The article's current record has no picture. */
  | 'picture_removed'
  /** The article's current record names another picture, or another address, than the job. */
  | 'picture_changed'

export type PhotoResult =
  /** The job no longer describes the article's picture: nothing was written. */
  | {
      readonly status: 'obsolete'
      readonly reason: ObsoleteReason
      /** `none` when it was caught before the download; else what the download left in the store. */
      readonly asset: 'created' | 'reused' | 'none'
      /** The `as_` id of the asset the download left in the store; absent when `asset` is `none`. */
      readonly assetId?: string
    }
  | {
      readonly status: 'stored'
      /** `reused` when identical bytes were already stored. */
      readonly asset: 'created' | 'reused'
      readonly assetId: string
      readonly rejected: readonly ApplyRejection[]
      /** False when the item no longer exists or is no longer linked (the apply refused). */
      readonly applied: boolean
    }

const sameOrigin = (a: URL, b: URL) => a.origin === b.origin

/** Drops a response's body without waiting for the connection to wind down. */
function discard(response: Response): void {
  void response.body?.cancel().catch(() => undefined)
}

/** Reads at most `MAX_IMAGE_BYTES`; a longer body is refused, not truncated. */
async function readCapped(response: Response): Promise<Uint8Array> {
  const declared = Number(response.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > MAX_IMAGE_BYTES) {
    discard(response)
    throw new PhotoRefused('too_large', 'The picture is larger than 10 MB.')
  }
  const reader = response.body?.getReader()
  if (!reader) return new Uint8Array()
  const parts: Uint8Array[] = []
  let size = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > MAX_IMAGE_BYTES) {
      void reader.cancel().catch(() => undefined)
      throw new PhotoRefused('too_large', 'The picture is larger than 10 MB.')
    }
    parts.push(value)
  }
  const bytes = new Uint8Array(size)
  let offset = 0
  for (const part of parts) {
    bytes.set(part, offset)
    offset += part.byteLength
  }
  return bytes
}

/**
 * Downloads `url` if it is on the integration's own origin. Throws `PhotoRefused` for what will
 * never work, and an ordinary error (retried by the queue) for a timeout or a server error.
 */
export async function downloadPhoto(
  env: SyncEnvironment,
  session: IntegrationSession,
  url: string,
): Promise<Uint8Array> {
  const own = new URL(`https://${session.host}`)
  let current: URL
  try {
    current = new URL(url)
  } catch {
    throw new PhotoRefused('foreign_origin', 'The picture address is not a URL.')
  }
  let withCredentials = false
  const signal = AbortSignal.timeout(PHOTO_TIMEOUT_MS)
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    // Checked on every hop: a redirect must not lead the request, or the credentials, elsewhere.
    if (!sameOrigin(current, own)) {
      throw new PhotoRefused('foreign_origin', 'The picture is not on the integration’s own host.')
    }
    const response = await env.fetch(current, {
      method: 'GET',
      redirect: 'manual',
      signal,
      headers: withCredentials ? { Authorization: session.authorization() } : {},
    })
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location')
      discard(response)
      if (!location) throw new PhotoRefused('bad_status', 'A redirect without a target.')
      current = new URL(location, current)
      continue
    }
    if ((response.status === 401 || response.status === 403) && !withCredentials) {
      discard(response)
      withCredentials = true
      hop -= 1 // asking again with credentials is not a redirect
      continue
    }
    if (response.status >= 500) {
      discard(response)
      throw new Error(`the picture server answered HTTP ${response.status}`)
    }
    if (response.status !== 200) {
      discard(response)
      throw new PhotoRefused('bad_status', `The picture server answered HTTP ${response.status}.`)
    }
    return readCapped(response)
  }
  throw new PhotoRefused('too_many_redirects', 'Too many redirects.')
}

/** `picture` and `picture_url` of a stored article record's payload (jsonb: anything may be in it). */
function pictureFieldsOf(payload: unknown) {
  const object =
    typeof payload === 'object' && payload !== null ? (payload as Record<string, unknown>) : {}
  const text = (value: unknown) => (typeof value === 'string' || value === null ? value : undefined)
  return { picture: text(object.picture), picture_url: text(object.picture_url) }
}

/**
 * Whether this job still describes the article's picture, judged on the article's CURRENT source
 * record: the one its link last saw (`source_links.last_hash` → the record with that hash), never
 * "the newest by fetch time" (an article that returns to an earlier content has the old record
 * again, and the link is what says which one is current: the S2-02 decision). The job is current
 * when that record still names `request.pictureName` and its address, built the way the mapper
 * builds it, is `request.url`. Unlinked, no record, no picture, another picture or another address:
 * the job is obsolete and must neither download nor write.
 */
async function currentRecord(
  env: SyncEnvironment,
  tenantId: string,
  integrationId: string,
  request: AssetFetchJob,
): Promise<{ readonly recordId: string } | { readonly obsolete: ObsoleteReason }> {
  const articleId = request.articleExternalId
  return withTenant(env.pool, tenantId, async (tx) => {
    const [link] = await tx
      .select({ hash: sourceLinks.lastHash })
      .from(sourceLinks)
      .where(
        and(
          eq(sourceLinks.integrationId, integrationId),
          eq(sourceLinks.externalType, 'article'),
          eq(sourceLinks.externalId, articleId),
        ),
      )
    if (!link?.hash) return { obsolete: 'unlinked' } as const
    const [record] = await tx
      .select({ id: sourceRecords.id, payload: sourceRecords.payload })
      .from(sourceRecords)
      .where(
        and(
          eq(sourceRecords.integrationId, integrationId),
          eq(sourceRecords.externalType, 'article'),
          eq(sourceRecords.externalId, articleId),
          eq(sourceRecords.contentHash, link.hash),
        ),
      )
      .limit(1)
    if (!record) return { obsolete: 'unlinked' } as const
    const picture = readArticlePicture(pictureFieldsOf(record.payload))
    if (picture.kind === 'absent' || picture.kind === 'none') {
      return { obsolete: 'picture_removed' } as const
    }
    if (
      picture.kind === 'invalid' ||
      picture.pictureName !== request.pictureName ||
      picture.url !== request.url
    ) {
      return { obsolete: 'picture_changed' } as const
    }
    return { recordId: record.id }
  })
}

/**
 * The whole job: check the job is current, download, check the bytes, dedupe by checksum, store,
 * check again, write the item's `image` field in the barsy layer. `runId` is the job run (it goes
 * into the change set).
 *
 * The job is checked against the article's current record twice: before the download (so an
 * obsolete job asks the picture server for nothing) and again just before the write (the
 * download takes a while, and the pull may have changed or removed the picture meanwhile). In the
 * second case the stored asset stays; unused assets are cleaned up later (tracker T53).
 */
export async function fetchPhoto(
  env: SyncEnvironment,
  session: IntegrationSession,
  request: AssetFetchJob,
  runId: string,
): Promise<PhotoResult> {
  const tenantId = session.tenantId
  const integrationId = session.integration.id
  const before = await currentRecord(env, tenantId, integrationId, request)
  if ('obsolete' in before) return { status: 'obsolete', reason: before.obsolete, asset: 'none' }
  // The picture server is the installation: its two-requests-at-a-time limit covers it too.
  const bytes = await env.limiters
    .forHost(session.host)
    .run(() => downloadPhoto(env, session, request.url))
  const inspected = inspectImage(bytes)
  if (!inspected.ok) {
    throw new PhotoRefused(
      inspected.reason === 'too_large' ? 'too_large' : 'not_an_image',
      'The picture is not a usable JPEG, PNG or WebP image.',
    )
  }
  const checksum = createHash('sha256').update(bytes).digest('hex')

  // The same bytes are stored once.
  const [existing] = await withTenant(env.pool, tenantId, (tx) =>
    tx
      .select({ id: assets.id })
      .from(assets)
      .where(
        and(eq(assets.checksum, checksum), eq(assets.origin, 'barsy'), eq(assets.status, 'stored')),
      )
      .limit(1),
  )
  let assetId = existing?.id
  let reused = true
  if (assetId === undefined) {
    reused = false
    const id = newId('as')
    const contentType: AssetImageType = inspected.contentType
    const storageKey = assetStorageKey(tenantId, id, contentType)
    await env.store.put(storageKey, bytes, contentType)
    const created = await createAsset(env.pool, tenantId, {
      id,
      origin: 'barsy',
      originRef: `article:${request.articleExternalId}:${request.pictureName}`.slice(0, 512),
      contentType,
      checksum,
      width: inspected.width,
      height: inspected.height,
      storageKey,
    })
    assetId = created.id
  }
  const asset = reused ? 'reused' : 'created'

  // The picture may have changed or been removed while this one was downloading.
  const now = await currentRecord(env, tenantId, integrationId, request)
  if ('obsolete' in now) {
    return { status: 'obsolete', reason: now.obsolete, asset, assetId }
  }

  const result = await apply(env.pool, tenantId, {
    id: newId('cs'),
    source: `barsy:${integrationId}`,
    jobId: runId,
    actor: `integration:${integrationId}`,
    observedAt: env.now().toISOString(),
    ops: [
      {
        op: 'setField',
        node: {
          link: {
            integration: integrationId,
            externalType: 'article',
            externalId: request.articleExternalId,
          },
        },
        fieldKey: 'image',
        layer: 'barsy',
        scope: 'master',
        value: { asset_id: assetId, alt: {}, focal: null },
        sourceRecordId: now.recordId,
        mappingVersion: BARSY_MAPPING_VERSION,
      },
    ],
  })
  return {
    status: 'stored',
    asset,
    assetId,
    rejected: result.rejected,
    applied: result.rejected.length === 0,
  }
}
