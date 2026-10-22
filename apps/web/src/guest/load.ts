// The guest page's loader: it follows the published files and nothing else (rule 4).
//
//   o/<organisation slug>.json          -> the organisation's venues by address name, or {redirect_to}
//   v/<public code>.json                -> {venue_id, menu_id, slug, organization}   (the address of before)
//   t/<token>.json                      -> {venue_public_id, venue_slug, table_label, menu_id}
//   m/<menu>/<venue>/current.json       -> {snapshot_id, version, hash}
//   snap/<snapshot>.json                -> the snapshot (immutable, cached for a year)
//   m/<menu>/<venue>/live.json          -> the sold-out marks
//
// An address `/m/<organisation>/<venue>` (D84) starts from the organisation's file: a renamed
// organisation leaves a redirect under its old name, a renamed venue is listed under its old name
// too, and the loader follows both and says where the page should correct the address bar to.
// The address of before, `/m/<slug>-<code>`, starts from the venue's own file by its code. A
// table's code (`?t=`) may name the menu it opens (D95); the loader then reads that menu's files
// instead of the venue's live menu.
//
// Every file is checked with the same schema the publisher wrote it with. Pure apart from the
// `fetch` it is given, so the chain is tested without a browser.

import {
  type CurrentPointer,
  CurrentPointerSchema,
  hashTableCode,
  isOrganizationSlug,
  isPublicId,
  isVenueSlug,
  type LiveOverlay,
  LiveOverlaySchema,
  type MenuSnapshot,
  MenuSnapshotSchema,
  type NodeId,
  type OrganizationFile,
  OrganizationFileSchema,
  TABLE_TOKEN_PATTERN,
  TableTokenFileSchema,
  type VenueIndex,
  VenueIndexSchema,
} from '@restro/core'
import type { z } from 'zod'

import type { ConfirmedTable } from './context'

/** The `fetch` the loader uses; tests pass their own. */
export type FetchLike = (url: string) => Promise<Response>

/** What a loader needs: where the files are and how to get them. */
export interface LoadDeps {
  readonly fetch: FetchLike
  readonly base: string
}

/** The two parts of a guest address (D84). */
export interface GuestAddress {
  readonly organization: string
  readonly venue: string
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
  organization: (base: string, slug: string) => join(base, `o/${slug}.json`),
  index: (base: string, publicId: string) => join(base, `v/${publicId}.json`),
  current: (base: string, index: IndexRef) =>
    join(base, `m/${index.menu_id}/${index.venue_id}/current.json`),
  live: (base: string, index: IndexRef, bust?: LiveCacheBust) => {
    const url = join(base, `m/${index.menu_id}/${index.venue_id}/live.json`)
    if (bust === undefined) return url
    return `${url}?v=${bust.version}${bust.attempt > 1 ? `&r=${bust.attempt}` : ''}`
  },
  snapshot: (base: string, pointer: PointerRef) => join(base, `snap/${pointer.snapshot_id}.json`),
  table: (base: string, codeHash: string) => join(base, `t/${codeHash}.json`),
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

/**
 * `v/<public code>.json`. Something that cannot be a public code is an unknown venue without
 * asking anyone (the address parser, `parseMenuParam`, already hands over only codes).
 */
export function loadVenueIndex(deps: LoadDeps, publicId: string): Promise<VenueIndex> {
  if (!isPublicId(publicId)) return Promise.reject(new GuestLoadError('unknown_venue'))
  return getFile(deps, files.index(deps.base, publicId), VenueIndexSchema, 'unknown_venue')
}

/** `o/<organisation slug>.json`: the index, or a redirect. A slug that cannot be one is an unknown venue. */
export function loadOrganizationFile(deps: LoadDeps, slug: string): Promise<OrganizationFile> {
  if (!isOrganizationSlug(slug)) return Promise.reject(new GuestLoadError('unknown_venue'))
  return getFile(deps, files.organization(deps.base, slug), OrganizationFileSchema, 'unknown_venue')
}

/** How many renames (of the organisation, then of the venue) the loader follows. */
const MAX_REDIRECTS = 3

/** What an address resolves to: the venue's index (as a `v/` file would say it) and its code. */
export interface ResolvedAddress {
  readonly index: VenueIndex
  readonly publicId: string
  /** The address as it should read now (the page corrects the address bar to it). */
  readonly canonical: GuestAddress
}

/**
 * Follows `/m/<organisation>/<venue>` through the organisation's file (D84): an old organisation
 * name redirects to the current one; an old venue name is listed under `old_names`. An address
 * that leads nowhere is an unknown venue; a venue in the index is a published one.
 */
export async function resolveGuestAddress(
  deps: LoadDeps,
  address: GuestAddress,
): Promise<ResolvedAddress> {
  if (!isVenueSlug(address.venue)) throw new GuestLoadError('unknown_venue')
  let organization = address.organization
  for (let hop = 0; hop < MAX_REDIRECTS; hop++) {
    const file = await loadOrganizationFile(deps, organization)
    if ('redirect_to' in file) {
      organization = file.redirect_to
      continue
    }
    const venue = file.old_names[address.venue] ?? address.venue
    const entry = file.venues[venue]
    if (entry === undefined) throw new GuestLoadError('unknown_venue')
    return {
      index: {
        venue_id: entry.venue_id,
        menu_id: entry.menu_id,
        slug: venue,
        organization: file.slug,
      },
      publicId: entry.public_id,
      canonical: { organization: file.slug, venue },
    }
  }
  throw new GuestLoadError('unknown_venue')
}

/** `current.json`. No pointer means nothing was published yet. */
export function loadPointer(deps: LoadDeps, index: IndexRef): Promise<CurrentPointer> {
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
  index: IndexRef,
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
  index: IndexRef,
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

/** What a table's file says, once it answered for this venue. */
export interface TableFile extends ConfirmedTable {
  /** The menu the code opens (D95), or null when the file names none (the venue's live menu). */
  readonly menuId: NodeId | null
}

/**
 * The table behind a code, or null when the code is unknown, malformed, belongs to another venue
 * (its `venue_public_id` is not this venue's code) or cannot be read. A table banner is a nicety:
 * any problem just leaves it out (and the venue's live menu is shown).
 */
export async function loadTableFile(
  deps: LoadDeps,
  token: string,
  publicId: string,
): Promise<TableFile | null> {
  if (!TABLE_TOKEN_PATTERN.test(token)) return null
  try {
    // The file is named after the code's hash (#70, Web Crypto): the code never goes over the wire.
    const codeHash = await hashTableCode(token)
    const file = await getFile(
      deps,
      files.table(deps.base, codeHash),
      TableTokenFileSchema,
      'unknown_venue',
    )
    if (file.venue_public_id !== publicId) return null
    return { token, label: file.table_label, menuId: file.menu_id ?? null }
  } catch {
    return null
  }
}

/** The label of a table from its code, or null (see `loadTableFile`). */
export async function loadTableLabel(
  deps: LoadDeps,
  token: string,
  publicId: string,
): Promise<string | null> {
  return (await loadTableFile(deps, token, publicId))?.label ?? null
}

/** What a loaded menu consists of. */
export interface LoadedMenu {
  /** The venue and the MENU SHOWN (a table's own menu when its code names one, D95). */
  readonly index: VenueIndex
  readonly pointer: CurrentPointer
  readonly snapshot: MenuSnapshot
  readonly live: LiveOverlay | null
  /** The venue's public code (what a table's file is matched against). */
  readonly publicId: string
  /**
   * The table of the code in the address (or, without one, of the code this tab kept), once its
   * file answered for this venue; else null.
   */
  readonly table: ConfirmedTable | null
  /** The address the page should show (D84), or null when the files do not know the organisation. */
  readonly canonical: GuestAddress | null
}

/**
 * The code this tab kept for a venue (`rememberedTable`), asked once the venue's public code is
 * known; the load checks it when the address carries no code.
 */
export type RememberedTable = (publicId: string) => string | null

const NOTHING_REMEMBERED: RememberedTable = () => null

/**
 * The rest of the chain from a venue's index: the table's file when a code is in the address, or
 * else the one this tab kept for the venue (it may name the menu to show), then the pointer, the
 * snapshot and the overlay of that menu.
 * The overlay is a refinement: if only it fails, the menu is shown without sold-out marks and
 * the next poll tries again.
 */
async function loadMenuFrom(
  deps: LoadDeps,
  resolved: { readonly index: VenueIndex; readonly publicId: string },
  token: string | null,
  canonical: GuestAddress | null,
  remembered: RememberedTable,
): Promise<LoadedMenu> {
  const claim = token ?? remembered(resolved.publicId)
  const table = claim === null ? null : await loadTableFile(deps, claim, resolved.publicId)
  const index: VenueIndex =
    table?.menuId == null ? resolved.index : { ...resolved.index, menu_id: table.menuId }
  const pointer = await loadPointer(deps, index)
  const [snapshot, live] = await Promise.all([
    loadSnapshot(deps, pointer),
    loadLive(deps, index).catch(() => null),
  ])
  return {
    index,
    pointer,
    snapshot,
    live,
    publicId: resolved.publicId,
    table: table === null ? null : { token: table.token, label: table.label },
    canonical,
  }
}

/** Follows the whole chain from the address of before, `/m/<slug>-<code>` (the code alone finds the venue). */
export async function loadMenu(
  deps: LoadDeps,
  publicId: string,
  token: string | null = null,
  remembered: RememberedTable = NOTHING_REMEMBERED,
): Promise<LoadedMenu> {
  const index = await loadVenueIndex(deps, publicId)
  const canonical =
    index.organization === undefined
      ? null
      : { organization: index.organization, venue: index.slug }
  return loadMenuFrom(deps, { index, publicId }, token, canonical, remembered)
}

/** Follows the whole chain from `/m/<organisation>/<venue>` (D84). */
export async function loadMenuAt(
  deps: LoadDeps,
  address: GuestAddress,
  token: string | null = null,
  remembered: RememberedTable = NOTHING_REMEMBERED,
): Promise<LoadedMenu> {
  const resolved = await resolveGuestAddress(deps, address)
  return loadMenuFrom(deps, resolved, token, resolved.canonical, remembered)
}
