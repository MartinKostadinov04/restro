'use client'

// The booking page `/book/<organisation>/<venue>` (#577; spec #322 stories 1–9, 32, 33): a guest
// asks for a table for one night. Like the menu page it is a static shell over the published files
// (rule 4): the organisation's index finds the venue, the menu's snapshot gives the venue's Style,
// and the venue's booking file `b/<venue id>.json` says whether the page takes requests, which
// nights it offers and which ones the club closed. The renderer draws it (D128); a renderer with no
// booking page shows "online booking is not available".
//
// It asks the server two things only: whether a chosen night can be booked
// (`GET /api/booking/night`) and the request itself (`POST /api/booking`, behind Turnstile). The
// answer screen shows only once the server took the request (D72). The page corrects the address
// bar to the current names, as the menu page does.

import { guestBookingPath, type Locale, localeToBcp47, type MenuSnapshot } from '@restro/core'
import {
  type BookingBinding,
  type BookingForm,
  type BookingHostProps,
  type BookingNightReply,
  BookingNightReplySchema,
  type BookingRefusal,
  BookingReplySchema,
  type BookingRequest,
  type BookingStage,
  bookingViewOf,
  buildViewModel,
  stringsFor,
  TURNSTILE_BOOKING_ACTION,
} from '@restro/shell'
import { type ComponentType, useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { MenuNotice, MenuSkeleton } from '@/faces/notices'
import { faceEntry } from '@/faces/registry'
import { FONT_STACKS } from '@/fonts'
import { CDN_BASE } from './cdn'
import { buildContext, chooseLocale } from './context'
import {
  type GuestAddress,
  GuestLoadError,
  type LoadDeps,
  type LoadFailure,
  loadBookingFile,
  loadPointer,
  loadSnapshot,
  resolveGuestAddress,
} from './load'
import { turnstileTokens } from './turnstile'

/** The one face (D128). */
const RENDERER = faceEntry(null)

/** What the page loaded: the venue's ids, its snapshot (for the Style) and its booking file. */
interface LoadedBooking {
  readonly organizationId: string
  readonly venueId: string
  readonly canonical: GuestAddress
  readonly snapshot: MenuSnapshot
  /** Null when no booking file was written yet: the page takes no requests. */
  readonly file: Awaited<ReturnType<typeof loadBookingFile>> | null
}

type Phase =
  | { readonly kind: 'loading' }
  | { readonly kind: 'error'; readonly reason: LoadFailure }
  | { readonly kind: 'ready'; readonly booking: LoadedBooking }

async function loadBooking(deps: LoadDeps, address: GuestAddress): Promise<LoadedBooking> {
  const resolved = await resolveGuestAddress(deps, address)
  const [snapshot, file] = await Promise.all([
    loadPointer(deps, resolved.index).then((pointer) => loadSnapshot(deps, pointer)),
    loadBookingFile(deps, resolved.index.venue_id).catch((error: unknown) => {
      if (error instanceof GuestLoadError && error.reason === 'not_published') return null
      throw error
    }),
  ])
  return {
    organizationId: resolved.organizationId,
    venueId: resolved.index.venue_id,
    canonical: resolved.canonical,
    snapshot,
    file,
  }
}

/** The host's side of the form: the night it asked about, the request and its answer. */
function useBookingBinding(loaded: LoadedBooking | null): BookingBinding | undefined {
  const [stage, setStage] = useState<BookingStage>('form')
  const [refusal, setRefusal] = useState<BookingRefusal | null>(null)
  const [night, setNight] = useState<BookingNightReply | null>(null)
  // One action id per page: sending the same request again is the same request.
  const actionId = useRef<string | null>(null)
  const organizationId = loaded?.organizationId ?? null
  const venueId = loaded?.venueId ?? null

  const checkNight = useCallback(
    (date: string) => {
      if (organizationId === null || venueId === null) return
      const query = new URLSearchParams({
        organization: organizationId,
        venue: venueId,
        night: date,
      })
      fetch(`/api/booking/night?${query}`, { cache: 'no-store' })
        .then(async (response) => {
          const parsed = BookingNightReplySchema.safeParse(await response.json())
          if (response.ok && parsed.success) setNight(parsed.data)
        })
        .catch(() => {})
    },
    [organizationId, venueId],
  )

  const send = useCallback(
    (form: BookingForm) => {
      if (organizationId === null || venueId === null) return
      actionId.current ??= crypto.randomUUID()
      const id = actionId.current
      setStage('sending')
      setRefusal(null)
      void (async () => {
        const tokens = turnstileTokens(process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY)
        const humanToken = tokens === undefined ? null : await tokens(TURNSTILE_BOOKING_ACTION)
        const body: BookingRequest = {
          ...form,
          organization: organizationId as BookingRequest['organization'],
          venue: venueId as BookingRequest['venue'],
          actionId: id,
          ...(humanToken === null ? {} : { humanToken }),
        }
        try {
          const response = await fetch('/api/booking', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
            cache: 'no-store',
          })
          const parsed = BookingReplySchema.safeParse(await response.json())
          if (!parsed.success) throw new Error('unreadable answer')
          if (parsed.data.ok) {
            setStage('sent')
            return
          }
          setRefusal(parsed.data.refusal)
        } catch {
          setRefusal('unavailable')
        }
        setStage('form')
      })()
    },
    [organizationId, venueId],
  )

  if (loaded === null) return undefined
  return { stage, refusal, night, checkNight, send }
}

export function BookingPage({ address }: { readonly address: GuestAddress }) {
  const [phase, setPhase] = useState<Phase>({ kind: 'loading' })
  const [attempt, setAttempt] = useState(0)
  const [search, setSearch] = useState('')
  const [browser, setBrowser] = useState<readonly string[]>([])
  const [now] = useState(() => new Date())
  const [Booking, setBooking] = useState<ComponentType<BookingHostProps> | null | undefined>(
    undefined,
  )
  const deps = useMemo<LoadDeps>(() => ({ fetch: (url) => fetch(url), base: CDN_BASE }), [])
  const organization = address.organization
  const venue = address.venue

  useEffect(() => {
    setSearch(window.location.search)
    setBrowser(navigator.languages?.length > 0 ? navigator.languages : [navigator.language])
  }, [])

  // The renderer's booking page, or null for a renderer that has none.
  useEffect(() => {
    let cancelled = false
    const load = RENDERER.loadBooking
    if (load === undefined) {
      setBooking(null)
      return
    }
    load().then(
      (component) => {
        if (!cancelled) setBooking(() => component)
      },
      () => {
        if (!cancelled) setPhase({ kind: 'error', reason: 'failed' })
      },
    )
    return () => {
      cancelled = true
    }
  }, [])

  // biome-ignore lint/correctness/useExhaustiveDependencies: `attempt` only re-runs the load
  useEffect(() => {
    let cancelled = false
    setPhase({ kind: 'loading' })
    loadBooking(deps, { organization, venue }).then(
      (booking) => {
        if (!cancelled) setPhase({ kind: 'ready', booking })
      },
      (error: unknown) => {
        const reason = error instanceof GuestLoadError ? error.reason : 'failed'
        if (!cancelled) setPhase({ kind: 'error', reason })
      },
    )
    return () => {
      cancelled = true
    }
  }, [deps, organization, venue, attempt])

  const loaded = phase.kind === 'ready' ? phase.booking : null

  // The address corrects itself to the current names (D84), with no redirect.
  const canonicalOrganization = loaded?.canonical.organization ?? null
  const canonicalVenue = loaded?.canonical.venue ?? null
  useEffect(() => {
    if (canonicalOrganization === null || canonicalVenue === null) return
    const canonical = guestBookingPath({
      organization: canonicalOrganization,
      venue: canonicalVenue,
    })
    if (window.location.pathname === canonical) return
    const url = new URL(window.location.href)
    url.pathname = canonical
    window.history.replaceState(null, '', url)
  }, [canonicalOrganization, canonicalVenue])

  const snapshot = loaded?.snapshot ?? null
  const locale: Locale = chooseLocale({
    search,
    browser,
    remembered: null,
    available: snapshot?.locales.available ?? [],
    menuDefault: snapshot?.locales.default ?? null,
  })
  const view = useMemo(
    () =>
      snapshot === null
        ? null
        : buildViewModel(
            snapshot,
            null,
            buildContext({ locale, now, tableToken: null, manifest: RENDERER.manifest }),
          ),
    [snapshot, locale, now],
  )
  const booking = useMemo(() => {
    if (loaded === null || view === null) return null
    if (loaded.file === null) {
      // No file yet (never written since the page existed): the page takes no requests.
      return { locale: view.locale, venueName: view.menu.title?.text ?? '', on: false, nights: [] }
    }
    return bookingViewOf(loaded.file, view.locale, now)
  }, [loaded, view, now])
  const binding = useBookingBinding(loaded)

  // The page around the template is ours, as on the menu page (globals.css).
  useEffect(() => {
    const root = document.documentElement
    root.dataset.guestPage = ''
    return () => {
      delete root.dataset.guestPage
    }
  }, [])

  const shownLocale = view?.locale ?? locale
  const lang = localeToBcp47(shownLocale)
  const guest = stringsFor(shownLocale).guest
  const words = stringsFor(shownLocale).booking
  useEffect(() => {
    document.documentElement.lang = lang
    document.title = words.title
  }, [lang, words.title])

  if (phase.kind === 'error') {
    const text =
      phase.reason === 'unknown_venue'
        ? { title: guest.notFoundTitle, text: guest.notFoundText }
        : phase.reason === 'not_published'
          ? { title: guest.notPublishedTitle, text: guest.notPublishedText }
          : { title: guest.loadFailedTitle, text: guest.loadFailedText }
    return (
      <MenuNotice
        {...text}
        lang={lang}
        {...(phase.reason === 'unknown_venue'
          ? {}
          : { actionLabel: guest.retry, onAction: () => setAttempt((n) => n + 1) })}
      />
    )
  }
  if (Booking === null) {
    return <MenuNotice title={words.unavailableTitle} text={words.unavailableText} lang={lang} />
  }
  if (view === null || booking === null || Booking === undefined) {
    return <MenuSkeleton label={guest.loading} lang={lang} />
  }
  return (
    <Booking
      view={view}
      booking={booking}
      {...(binding === undefined ? {} : { binding })}
      assetBase={CDN_BASE}
      fontStacks={FONT_STACKS}
      scheme={view.theme.scheme}
    />
  )
}
