'use client'

// The guest phone page: loads the published files (never the database, rule 4), builds the shell's
// view model for the guest's language and draws it with the QR phone face. It keeps itself fresh
// while visible: the pointer every 30 seconds (a new publish swaps the snapshot) and the sold-out
// overlay every 15 seconds. An overlay made for another snapshot version still applies (marks belong
// to the service day) and is fetched again at once with a cache-busting query. States: a loading
// skeleton, and a friendly notice for an unknown venue, a menu that is not published yet, or a
// failed load.
//
// The address is `/m/<organisation>/<venue>` (D84), read from the organisation's published file,
// which also knows the old names of the organisation and of its venues. The address of before,
// `/m/<slug>-<code>` (D68), still works: the code finds the venue (`parseMenuParam`) and its file
// names the organisation. In both cases the page replaces what the address bar says with the
// canonical path through the History API, keeping `?t=`, `?lang=` and the rest. There is no
// redirect and no server read: the page stays a static shell over published files (rule 4).
// A table's code in `?t=` may name the menu it opens (D95); the loader reads that one.

import {
  guestMenuPath,
  type LiveOverlay,
  type Locale,
  localeToBcp47,
  menuPath,
  parseMenuParam,
} from '@restro/core'
import { QrPhoneNotice, QrPhoneSkeleton } from '@restro/qr-phone/notices'
import { buildViewModel, stringsFor } from '@restro/shell'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { ChosenFace, preloadFace } from '@/faces/chosen-face'
import { faceEntry } from '@/faces/registry'
import { FONT_STACKS } from '@/fonts'
import { cleanAddressBar } from '../connectors/card-forms'
import { CDN_BASE } from './cdn'
import {
  buildContext,
  chooseLocale,
  confirmedTable,
  hasTableService,
  langParam,
  readTableToken,
  rememberedTable,
  rememberTable,
  tabStorage,
  withCodeInFragment,
} from './context'
import {
  type GuestAddress,
  GuestLoadError,
  type LoadDeps,
  type LoadedMenu,
  type LoadFailure,
  loadLive,
  loadMenu,
  loadMenuAt,
  loadPointer,
  loadSnapshot,
  refetchLiveForSnapshot,
} from './load'
import { PAY_RETURNED_KEY } from './services-client'
import { SHARED_ORDER_FACES, useTableServices } from './use-table-services'

type Phase =
  | { readonly kind: 'loading' }
  | { readonly kind: 'error'; readonly reason: LoadFailure }
  | { readonly kind: 'ready'; readonly menu: LoadedMenu }

/** How often the pointer, the overlay and the clock are looked at while the page is visible. */
const POINTER_EVERY_MS = 30_000
const LIVE_EVERY_MS = 15_000
const CLOCK_EVERY_MS = 60_000

/** Runs `callback` every `ms` while the page is visible, and once when it becomes visible again. */
function useVisibleInterval(callback: () => void, ms: number, enabled: boolean): void {
  const latest = useRef(callback)
  useEffect(() => {
    latest.current = callback
  })
  useEffect(() => {
    if (!enabled) return
    let timer: ReturnType<typeof setInterval> | null = null
    const start = () => {
      if (timer === null) timer = setInterval(() => latest.current(), ms)
    }
    const stop = () => {
      if (timer !== null) clearInterval(timer)
      timer = null
    }
    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        latest.current()
        start()
      } else {
        stop()
      }
    }
    if (document.visibilityState === 'visible') start()
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      stop()
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [ms, enabled])
}

/**
 * What the page is opened with: the two parts of `/m/<organisation>/<venue>` (D84), or the one
 * part of the address of before, `/m/<slug>-<code>` (or the bare code).
 */
export type GuestMenuProps = { readonly address: GuestAddress } | { readonly venue: string }

export function GuestMenu(props: GuestMenuProps) {
  const address = 'address' in props ? props.address : null
  // The code of the address of before; null for one that names no venue.
  const publicId = 'venue' in props ? parseMenuParam(props.venue) : null
  const [phase, setPhase] = useState<Phase>({ kind: 'loading' })
  // The address and the browser are read after mount, so the first client render equals the server's.
  const [search, setSearch] = useState('')
  const [fragment, setFragment] = useState('')
  const [browser, setBrowser] = useState<readonly string[]>([])
  const [now, setNow] = useState(() => new Date())
  const deps = useMemo<LoadDeps>(() => ({ fetch: (url) => fetch(url), base: CDN_BASE }), [])

  useEffect(() => {
    // Back from a redirect of the card form: its values come out of the address before the
    // page asks for anything (#114, design §11), and the tab notes that the guest came back so the
    // services client sends `pay.returned`.
    if (cleanAddressBar(window.location, window.history)) {
      try {
        tabStorage()?.setItem(PAY_RETURNED_KEY, '1')
      } catch {
        // Nothing kept: the payment's poll still finds where it stands.
      }
    }
    // A table code in the query (a link of before #70) goes into the fragment, out of the address
    // the page's later requests and a shared link would carry.
    const moved = withCodeInFragment(window.location.href)
    if (moved !== null) window.history.replaceState(null, '', moved)
    setSearch(window.location.search)
    setFragment(window.location.hash)
    setBrowser(navigator.languages?.length > 0 ? navigator.languages : [navigator.language])
    // Nearly every venue uses the default template: fetch its code now, while the menu's files are
    // still on their way. (A venue that chose another one fetches that when its snapshot arrives.)
    preloadFace(faceEntry(null))
  }, [])

  // --- loading ----------------------------------------------------------------------------
  const [attempt, setAttempt] = useState(0)
  // The snapshot version the overlay was last asked for again (see "the overlay of another version").
  const refetchedFor = useRef<number | null>(null)
  // biome-ignore lint/correctness/useExhaustiveDependencies: `attempt` only restarts the load
  useEffect(() => {
    let cancelled = false
    refetchedFor.current = null
    if (address === null && publicId === null) {
      setPhase({ kind: 'error', reason: 'unknown_venue' })
      return
    }
    setPhase({ kind: 'loading' })
    // The table's code in the address goes with the load: its file may name the menu to show.
    // Without one (a reload on a dish page, whose address took the fragment), the code this tab
    // kept for the venue is checked instead.
    const token = readTableToken(window.location.search, window.location.hash)
    const storage = tabStorage()
    const remembered = (venue: string) => rememberedTable(storage, venue)
    const loading =
      address !== null
        ? loadMenuAt(deps, address, token, remembered)
        : loadMenu(deps, publicId ?? '', token, remembered)
    loading.then(
      (menu) => {
        rememberTable(storage, menu.publicId, menu.table?.token ?? null)
        if (!cancelled) setPhase({ kind: 'ready', menu })
      },
      (error: unknown) => {
        const reason = error instanceof GuestLoadError ? error.reason : 'failed'
        if (!cancelled) setPhase({ kind: 'error', reason })
      },
    )
    return () => {
      cancelled = true
    }
  }, [deps, publicId, address, attempt])

  // The address corrects itself: the files name the organisation's and the venue's current slugs
  // (D84), or, for a venue whose files do not know the organisation yet, the current slug for the
  // address of before. The address bar is replaced (not pushed, no redirect) when it shows another
  // path.
  const loaded = phase.kind === 'ready' ? phase.menu : null
  const canonicalOrganization = loaded?.canonical?.organization ?? null
  const canonicalVenue = loaded?.canonical?.venue ?? null
  const indexSlug = loaded?.index.slug ?? null
  const loadedPublicId = loaded?.publicId ?? null
  useEffect(() => {
    let canonical: string
    if (canonicalOrganization !== null && canonicalVenue !== null) {
      canonical = guestMenuPath({ organization: canonicalOrganization, venue: canonicalVenue })
    } else if (indexSlug !== null && loadedPublicId !== null) {
      canonical = menuPath({ slug: indexSlug, publicId: loadedPublicId })
    } else {
      return
    }
    if (window.location.pathname === canonical) return
    const url = new URL(window.location.href)
    url.pathname = canonical
    window.history.replaceState(null, '', url)
  }, [canonicalOrganization, canonicalVenue, indexSlug, loadedPublicId])

  // The code in the address is a claim until the published `t/<hash>.json` answered for this venue
  // (the loader asked). The banner and the shell's context use the confirmed table only: an
  // unknown code is no code.
  // Without a code in the address, the claim is the one the tab kept, which the load checked.
  const requestedToken = readTableToken(search, fragment) ?? loaded?.table?.token ?? null
  const table = confirmedTable(requestedToken, loaded?.table ?? null)
  const tableToken = table?.token ?? null
  const tableLabel = table?.label ?? null

  // --- keeping fresh ----------------------------------------------------------------------
  const ready = phase.kind === 'ready'
  const index = phase.kind === 'ready' ? phase.menu.index : null
  const currentSnapshotId = phase.kind === 'ready' ? phase.menu.pointer.snapshot_id : null

  useVisibleInterval(
    () => {
      if (index === null) return
      loadPointer(deps, index)
        .then(async (pointer) => {
          if (pointer.snapshot_id === currentSnapshotId) return
          const snapshot = await loadSnapshot(deps, pointer)
          setPhase((current) =>
            current.kind === 'ready'
              ? { kind: 'ready', menu: { ...current.menu, pointer, snapshot } }
              : current,
          )
        })
        // What is on the screen stays; the next tick tries again.
        .catch(() => {})
    },
    POINTER_EVERY_MS,
    ready,
  )
  useVisibleInterval(
    () => {
      if (index === null) return
      loadLive(deps, index)
        .then((live: LiveOverlay | null) =>
          setPhase((current) =>
            current.kind === 'ready' ? { kind: 'ready', menu: { ...current.menu, live } } : current,
          ),
        )
        .catch(() => {})
    },
    LIVE_EVERY_MS,
    ready,
  )
  // Schedules ("from 18:00") follow the clock.
  useVisibleInterval(() => setNow(new Date()), CLOCK_EVERY_MS, ready)

  // The overlay on the screen was made for another snapshot version than the one shown (the CDN
  // still held the old live.json, or the publish had not written the new one yet). It stays
  // applied, since marks belong to the service day and hiding them would show sold-out items as
  // available, and a fresher one is asked for at once with a cache-busting query: up to three
  // tries, two seconds apart (`refetchLiveForSnapshot`). Once per snapshot version; after that the
  // 15-second poll above is all that runs.
  const snapshotVersion = phase.kind === 'ready' ? phase.menu.snapshot.snapshot.version : null
  const liveVersion = phase.kind === 'ready' ? (phase.menu.live?.version ?? null) : null
  const liveForAnotherVersion =
    snapshotVersion !== null && liveVersion !== null && liveVersion !== snapshotVersion
  useEffect(() => {
    if (!liveForAnotherVersion || index === null || snapshotVersion === null) return
    if (refetchedFor.current === snapshotVersion) return
    let cancelled = false
    refetchLiveForSnapshot(deps, index, snapshotVersion, { cancelled: () => cancelled }).then(
      (fresh) => {
        if (cancelled) return
        refetchedFor.current = snapshotVersion
        if (fresh === null) return
        setPhase((current) =>
          current.kind === 'ready' && current.menu.snapshot.snapshot.version === snapshotVersion
            ? { kind: 'ready', menu: { ...current.menu, live: fresh } }
            : current,
        )
      },
    )
    return () => {
      cancelled = true
    }
  }, [deps, index, snapshotVersion, liveForAnotherVersion])

  // --- what the guest sees ----------------------------------------------------------------
  const snapshot = phase.kind === 'ready' ? phase.menu.snapshot : null
  const live = phase.kind === 'ready' ? phase.menu.live : null
  const locale: Locale = chooseLocale({
    search,
    browser,
    available: snapshot?.locales.available ?? [],
    menuDefault: snapshot?.locales.default ?? null,
  })
  // The template the venue chose (the registry's default when it chose none); its manifest decides
  // which photo sizes the shell asks for.
  const faceId = snapshot?.presentation?.face
  const entry = useMemo(() => faceEntry(faceId), [faceId])
  // The table's shared order (#75), where the template draws it and the page has a table: the
  // guest API's client, and ordering on in the shell's context (the venue's own switch for
  // ordering, in the snapshot's features, still decides).
  // A venue with every table service off is a menu only: its page never asks the guest API.
  const sharedOrder =
    tableToken !== null && SHARED_ORDER_FACES.has(entry.id) && hasTableService(snapshot?.features)
  const services = useTableServices(sharedOrder ? tableToken : null)
  const view = useMemo(
    () =>
      snapshot === null
        ? null
        : buildViewModel(
            snapshot,
            live,
            buildContext({ locale, now, tableToken, manifest: entry.manifest, sharedOrder }),
          ),
    [snapshot, live, locale, now, tableToken, entry, sharedOrder],
  )

  const switchLanguage = useCallback((next: Locale) => {
    const url = new URL(window.location.href)
    url.searchParams.set('lang', langParam(next))
    window.history.replaceState(null, '', url)
    setSearch(url.search)
  }, [])

  // The page around the template is ours (globals.css, `html[data-guest-page]`): templates never
  // style html or body themselves, so the admin's previews of them stay untouched.
  useEffect(() => {
    const root = document.documentElement
    root.dataset.guestPage = ''
    return () => {
      delete root.dataset.guestPage
    }
  }, [])

  const shownLocale = view?.locale ?? locale
  useEffect(() => {
    const root = document.documentElement
    const previous = root.lang
    root.lang = localeToBcp47(shownLocale)
    return () => {
      root.lang = previous
    }
  }, [shownLocale])
  const title = view?.menu.title?.text
  useEffect(() => {
    if (title !== undefined) document.title = title
  }, [title])

  const strings = stringsFor(shownLocale).guest
  if (view === null || snapshot === null) {
    if (phase.kind === 'error') {
      const text =
        phase.reason === 'unknown_venue'
          ? { title: strings.notFoundTitle, text: strings.notFoundText }
          : phase.reason === 'not_published'
            ? { title: strings.notPublishedTitle, text: strings.notPublishedText }
            : { title: strings.loadFailedTitle, text: strings.loadFailedText }
      return (
        <QrPhoneNotice
          {...text}
          lang={localeToBcp47(shownLocale)}
          {...(phase.reason === 'unknown_venue'
            ? {}
            : { actionLabel: strings.retry, onAction: () => setAttempt((n) => n + 1) })}
        />
      )
    }
    return <QrPhoneSkeleton label={strings.loading} lang={localeToBcp47(shownLocale)} />
  }

  return (
    <ChosenFace
      entry={entry}
      strings={strings}
      view={view}
      assetBase={CDN_BASE}
      languages={snapshot.locales.available}
      onLanguageChange={switchLanguage}
      tableLabel={tableLabel}
      fontStacks={FONT_STACKS}
      scheme={view.theme.scheme}
      options={snapshot.presentation?.options}
      {...(services === undefined ? {} : { services })}
    />
  )
}
