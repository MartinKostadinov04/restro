'use client'

// The guest phone page: loads the published files (never the database, rule 4), builds the shell's
// view model for the guest's language and draws it with the QR phone face. It keeps itself fresh
// while visible: the pointer every 30 seconds (a new publish swaps the snapshot) and the sold-out
// overlay every 15 seconds. An overlay made for another snapshot version still applies (marks belong
// to the service day) and is fetched again at once with a cache-busting query. States: a loading
// skeleton, and a friendly notice for an unknown venue, a menu that is not published yet, or a
// failed load.

import type { LiveOverlay, Locale } from '@restro/core'
import { bcp47, QrPhoneFace, QrPhoneNotice, QrPhoneSkeleton } from '@restro/qr-phone'
import { buildViewModel, stringsFor } from '@restro/shell'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { CDN_BASE } from './cdn'
import { buildContext, chooseLocale, langParam, readTableToken } from './context'
import {
  GuestLoadError,
  type LoadDeps,
  type LoadedMenu,
  type LoadFailure,
  loadLive,
  loadMenu,
  loadPointer,
  loadSnapshot,
  loadTableLabel,
  refetchLiveForSnapshot,
} from './load'

type Phase =
  | { readonly kind: 'loading' }
  | { readonly kind: 'error'; readonly reason: LoadFailure }
  | { readonly kind: 'ready'; readonly menu: LoadedMenu }

/** How often the pointer, the overlay and the clock are looked at while the page is visible. */
const POINTER_EVERY_MS = 30_000
const LIVE_EVERY_MS = 15_000
const CLOCK_EVERY_MS = 60_000

/** The font stacks of fonts this app serves itself (next/font in the root layout). */
export const FONT_STACKS = { Inter: 'var(--font-inter), "Inter", system-ui, sans-serif' } as const

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

export function GuestMenu({ slug }: { readonly slug: string }) {
  const [phase, setPhase] = useState<Phase>({ kind: 'loading' })
  // The address and the browser are read after mount, so the first client render equals the server's.
  const [search, setSearch] = useState('')
  const [browser, setBrowser] = useState<readonly string[]>([])
  const [tableLabel, setTableLabel] = useState<string | null>(null)
  const [now, setNow] = useState(() => new Date())
  const deps = useMemo<LoadDeps>(() => ({ fetch: (url) => fetch(url), base: CDN_BASE }), [])

  useEffect(() => {
    setSearch(window.location.search)
    setBrowser(navigator.languages?.length > 0 ? navigator.languages : [navigator.language])
  }, [])

  // --- loading ----------------------------------------------------------------------------
  const [attempt, setAttempt] = useState(0)
  // The snapshot version the overlay was last asked for again (see "the overlay of another version").
  const refetchedFor = useRef<number | null>(null)
  // biome-ignore lint/correctness/useExhaustiveDependencies: `attempt` only restarts the load
  useEffect(() => {
    let cancelled = false
    setPhase({ kind: 'loading' })
    refetchedFor.current = null
    loadMenu(deps, slug).then(
      (menu) => {
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
  }, [deps, slug, attempt])

  const tableToken = readTableToken(search)
  useEffect(() => {
    if (tableToken === null) {
      setTableLabel(null)
      return
    }
    let cancelled = false
    loadTableLabel(deps, tableToken, slug).then((label) => {
      if (!cancelled) setTableLabel(label)
    })
    return () => {
      cancelled = true
    }
  }, [deps, slug, tableToken])

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
  const view = useMemo(
    () =>
      snapshot === null
        ? null
        : buildViewModel(snapshot, live, buildContext({ locale, now, tableToken })),
    [snapshot, live, locale, now, tableToken],
  )

  const switchLanguage = useCallback((next: Locale) => {
    const url = new URL(window.location.href)
    url.searchParams.set('lang', langParam(next))
    window.history.replaceState(null, '', url)
    setSearch(url.search)
  }, [])

  const shownLocale = view?.locale ?? locale
  useEffect(() => {
    const root = document.documentElement
    const previous = root.lang
    root.lang = bcp47(shownLocale)
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
          lang={bcp47(shownLocale)}
          {...(phase.reason === 'unknown_venue'
            ? {}
            : { actionLabel: strings.retry, onAction: () => setAttempt((n) => n + 1) })}
        />
      )
    }
    return <QrPhoneSkeleton label={strings.loading} lang={bcp47(shownLocale)} />
  }

  return (
    <QrPhoneFace
      view={view}
      assetBase={CDN_BASE}
      languages={snapshot.locales.available}
      onLanguageChange={switchLanguage}
      tableLabel={tableLabel}
      fontStacks={FONT_STACKS}
    />
  )
}
