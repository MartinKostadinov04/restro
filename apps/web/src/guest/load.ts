// The guest page's loader: it follows the published files and nothing else (rule 4).
//
//   v/<slug>.json                       -> {venue_id, menu_id}
//   m/<menu>/<venue>/current.json       -> {snapshot_id, version, hash}
//   snap/<snapshot>.json                -> the snapshot (immutable, cached for a year)
//   m/<menu>/<venue>/live.json          -> the sold-out marks
//   t/<token>.json                      -> {venue_slug, table_label}
//
// Every file is checked with the same schema the publisher wrote it with. Pure apart from the
// `fetch` it is given, so the chain is tested without a browser.

import {
  type CurrentPointer,
  CurrentPointerSchema,
  isVenueSlug,
  type LiveOverlay,
  LiveOverlaySchema,
  type MenuSnapshot,
  MenuSnapshotSchema,
  TABLE_TOKEN_PATTERN,
  TableTokenFileSchema,
  type VenueIndex,
  VenueIndexSchema,
} from '@restro/core'
import type { z } from 'zod'

/** The `fetch` the loader uses; tests pass their own. */
export type FetchLike = (url: string) => Promise<Response>

/** What a loader needs: where the files are and how to get them. */
export interface LoadDeps {
  readonly fetch: FetchLike
  readonly base: string
}

/** Why a menu could not be shown. */
export type LoadFailure =
  /** No venue answers to this address. */
  | 'unknown_venue'
  /** The venue exists but has nothing published yet. */
  | 'not_published'
  /** The network or a file failed; trying again may help. */
  | 'failed'

/** Thrown by the loaders; `reason` says what to tell the guest. */
export class GuestLoadError extends Error {
  override name = 'GuestLoadError'
  constructor(readonly reason: LoadFailure) {
    super(`the menu could not be loaded: ${reason}`)
  }
}

const join = (base: string, path: string) => `${base.replace(/\/+$/, '')}/${path}`

/** The ids that make up an address (the files hold them as `vn_` / `nd_` / `sn_` ids). */
type IndexRef = { readonly venue_id: string; readonly menu_id: string }
type PointerRef = { readonly snapshot_id: string }

/**
 * A cache-busting query for `live.json`: the version of the snapshot the page shows (`?v=<version>`),
 * and, from the second try on, the try's number (`&r=<n>`). The CDN keys its cache by the full
 * address, so an address it has not seen makes it ask the origin. Later tries get an address of
 * their own because the answer to `?v=<version>` may itself have been cached while the origin still
 * held the old overlay.
 */
export interface LiveCacheBust {
  readonly version: number
  /** 1 for the first fetch with the query, 2 for the next, ... */
  readonly attempt: number
}

/** The address of each published file. */
export const files = {
  index: (base: string, slug: string) => join(base, `v/${slug}.json`),
  current: (base: string, index: IndexRef) =>
    join(base, `m/${index.menu_id}/${index.venue_id}/current.json`),
  live: (base: string, index: IndexRef, bust?: LiveCacheBust) => {
    const url = join(base, `m/${index.menu_id}/${index.venue_id}/live.json`)
    if (bust === undefined) return url
    return `${url}?v=${bust.version}${bust.attempt > 1 ? `&r=${bust.attempt}` : ''}`
  },
  snapshot: (base: string, pointer: PointerRef) => join(base, `snap/${pointer.snapshot_id}.json`),
  table: (base: string, token: string) => join(base, `t/${token}.json`),
}

/** Fetches a file and checks it with `schema`. A 404 is `whenMissing`; anything else wrong is `failed`. */
async function getFile<S extends z.ZodType>(
  deps: LoadDeps,
  url: string,
  schema: S,
  whenMissing: LoadFailure,
): Promise<z.output<S>> {
  let response: Response
  try {
    response = await deps.fetch(url)
  } catch {
    throw new GuestLoadError('failed')
  }
  if (response.status === 404) throw new GuestLoadError(whenMissing)
  if (!response.ok) throw new GuestLoadError('failed')
  let body: unknown
  try {
    body = await response.json()
  } catch {
    throw new GuestLoadError('failed')
  }
  const parsed = schema.safeParse(body)
  if (!parsed.success) throw new GuestLoadError('failed')
  return parsed.data
}

/** `v/<slug>.json`. An address that cannot be a slug is unknown without asking anyone. */
export function loadVenueIndex(deps: LoadDeps, slug: string): Promise<VenueIndex> {
  if (!isVenueSlug(slug)) return Promise.reject(new GuestLoadError('unknown_venue'))
  return getFile(deps, files.index(deps.base, slug), VenueIndexSchema, 'unknown_venue')
}

/** `current.json`. No pointer means nothing was published yet. */
export function loadPointer(deps: LoadDeps, index: VenueIndex): Promise<CurrentPointer> {
  return getFile(deps, files.current(deps.base, index), CurrentPointerSchema, 'not_published')
}

/** The snapshot a pointer names. */
export function loadSnapshot(deps: LoadDeps, pointer: CurrentPointer): Promise<MenuSnapshot> {
  return getFile(deps, files.snapshot(deps.base, pointer), MenuSnapshotSchema, 'failed')
}

/**
 * `live.json`; null when there is none (nothing marked sold out yet). `bust` adds the
 * cache-busting query (see `LiveCacheBust`).
 */
export async function loadLive(
  deps: LoadDeps,
  index: VenueIndex,
  bust?: LiveCacheBust,
): Promise<LiveOverlay | null> {
  try {
    return await getFile(
      deps,
      files.live(deps.base, index, bust),
      LiveOverlaySchema,
      'not_published',
    )
  } catch (error) {
    if (error instanceof GuestLoadError && error.reason === 'not_published') return null
    throw error
  }
}

/** How many times the loader asks again for an overlay of another version, and how far apart. */
export const LIVE_REFETCH_ATTEMPTS = 3
export const LIVE_REFETCH_DELAY_MS = 2_000

export interface LiveRefetchOptions {
  readonly attempts?: number
  readonly delayMs?: number
  /** Resolves after `ms`; tests pass an instant one. */
  readonly sleep?: (ms: number) => Promise<void>
  /** True when nobody wants the answer any more (the page moved on); stops the asking. */
  readonly cancelled?: () => boolean
}

/**
 * The overlay for the snapshot `version` the page shows, after the one it loaded was made for
 * another version (the CDN still held the old `live.json`, or the publish had not written the new
 * one yet). Asks again at once, with the cache-busting query `?v=<version>`, then up to
 * `attempts` times in all, `delayMs` apart (each later address differs, see `LiveCacheBust`).
 * Returns the first overlay whose version is the snapshot's, or null when none came: the caller
 * keeps what it has and the normal polling takes over. A failed fetch counts as a try and is never
 * thrown.
 */
export async function refetchLiveForSnapshot(
  deps: LoadDeps,
  index: VenueIndex,
  version: number,
  options: LiveRefetchOptions = {},
): Promise<LiveOverlay | null> {
  const attempts = options.attempts ?? LIVE_REFETCH_ATTEMPTS
  const delayMs = options.delayMs ?? LIVE_REFETCH_DELAY_MS
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((done) => setTimeout(done, ms)))
  for (let attempt = 1; attempt <= attempts; attempt++) {
    if (options.cancelled?.()) return null
    // The first ask is immediate; the others wait.
    if (attempt > 1) {
      await sleep(delayMs)
      if (options.cancelled?.()) return null
    }
    try {
      const live = await loadLive(deps, index, { version, attempt })
      if (live !== null && live.version === version) return live
    } catch {
      // The next try, or the normal polling, asks again.
    }
  }
  return null
}

/** What a loaded menu consists of. */
export interface LoadedMenu {
  readonly index: VenueIndex
  readonly pointer: CurrentPointer
  readonly snapshot: MenuSnapshot
  readonly live: LiveOverlay | null
}

/**
 * Follows the whole chain. The overlay is a refinement: if only it fails, the menu is shown
 * without sold-out marks and the next poll tries again.
 */
export async function loadMenu(deps: LoadDeps, slug: string): Promise<LoadedMenu> {
  const index = await loadVenueIndex(deps, slug)
  const pointer = await loadPointer(deps, index)
  const [snapshot, live] = await Promise.all([
    loadSnapshot(deps, pointer),
    loadLive(deps, index).catch(() => null),
  ])
  return { index, pointer, snapshot, live }
}

/**
 * The label of a table from its code, or null when the code is unknown, malformed, belongs to
 * another venue or cannot be read. A table banner is a nicety: any problem just leaves it out.
 */
export async function loadTableLabel(
  deps: LoadDeps,
  token: string,
  slug: string,
): Promise<string | null> {
  if (!TABLE_TOKEN_PATTERN.test(token)) return null
  try {
    const file = await getFile(
      deps,
      files.table(deps.base, token),
      TableTokenFileSchema,
      'unknown_venue',
    )
    return file.venue_slug === slug ? file.table_label : null
  } catch {
    return null
  }
}
