// A page that lives in the address: the dish page as `#item-<id>` and the service sheets as `#bag`,
// `#tab`, `#call`, `#pay` and `#receipt`. Being in the address means a dish can be shared, the
// phone's back button closes the page or sheet, and the scroll position of the menu is kept. The
// page behind is never reloaded. Opening pushes a history entry; closing goes back one step, or,
// for a link that opened the page directly, replaces the address. The browser is only touched in
// effects and handlers, so the first render is the same on the server and in the browser.
//
// `useHashRoute` is the one implementation. The dish page and the service sheets are two routes of
// it, each with its own address form and history state, so both can read the same address: a sheet
// that hides itself to let a dish page open over it comes back when the guest goes back.

import { useCallback, useEffect, useRef, useState } from 'react'

import { prefersReducedMotion } from './model'

/** How long a page takes to slide out; the stylesheet's exit animation lasts the same. */
const EXIT_MS = 260

/** One kind of page that lives in the address. */
export interface HashRoute {
  /** The id an address names, or null when it names none of this route's pages. */
  readonly parse: (hash: string) => string | null
  /** The address of a page. */
  readonly format: (id: string) => string
  /** The key of the history state this route pushes. */
  readonly stateKey: string
  /** Opening a page while another of this route is open replaces it instead of adding a step. */
  readonly replaceWhenOpen: boolean
}

const DISH_HASH = /^#item-(.+)$/

/** The dish page: `#item-<id>`; a malformed link names no dish. */
const DISH_ROUTE: HashRoute = {
  parse(hash) {
    const match = DISH_HASH.exec(hash)
    if (match === null) return null
    try {
      return decodeURIComponent(match[1] ?? '')
    } catch {
      return null
    }
  },
  format: (id) => `#item-${encodeURIComponent(id)}`,
  stateKey: 'rmItem',
  replaceWhenOpen: false,
}

/** True for the history state a route pushes. */
function isRouteState(route: HashRoute, state: unknown): boolean {
  return typeof state === 'object' && state !== null && route.stateKey in state
}

export function useHashRoute(route: HashRoute) {
  // What the address says is open, and what is drawn (it stays drawn while the page slides out).
  const [openId, setOpenId] = useState<string | null>(null)
  const [shown, setShown] = useState<{ readonly id: string; readonly leaving: boolean } | null>(
    null,
  )
  const opener = useRef<HTMLElement | null>(null)
  const wasOpen = useRef(false)
  const openRef = useRef<string | null>(null)
  openRef.current = openId

  // The address is the truth: read it on arrival and whenever the guest goes back or forward.
  useEffect(() => {
    const read = () => setOpenId(route.parse(window.location.hash))
    read()
    window.addEventListener('popstate', read)
    return () => window.removeEventListener('popstate', read)
  }, [route])

  useEffect(() => {
    if (openId !== null) {
      setShown({ id: openId, leaving: false })
    } else {
      const instant = prefersReducedMotion()
      setShown((current) => (current === null || instant ? null : { ...current, leaving: true }))
      // Hand the focus back to the element that opened the page.
      if (wasOpen.current) opener.current?.focus({ preventScroll: true })
      opener.current = null
    }
    wasOpen.current = openId !== null
  }, [openId])

  const leaving = shown?.leaving === true
  useEffect(() => {
    if (!leaving) return
    const timer = window.setTimeout(() => setShown(null), EXIT_MS)
    return () => window.clearTimeout(timer)
  }, [leaving])

  /**
   * Opens a page; `element` is what gets the focus back when it closes. A page that replaces
   * another one keeps the first opener, which is where the guest started.
   */
  const open = useCallback(
    (id: string, element: HTMLElement | null) => {
      const replace = route.replaceWhenOpen && openRef.current !== null
      if (!replace) opener.current = element
      window.history[replace ? 'replaceState' : 'pushState'](
        { [route.stateKey]: id },
        '',
        route.format(id),
      )
      setOpenId(id)
    },
    [route],
  )

  /** Closes it: one step back if this route pushed the entry, else the address is cleaned up. */
  const close = useCallback(() => {
    if (isRouteState(route, window.history.state)) {
      window.history.back()
    } else {
      window.history.replaceState(null, '', window.location.pathname + window.location.search)
      setOpenId(null)
    }
  }, [route])

  /**
   * Hides the page without touching the address, and without handing the focus back: another page
   * is about to open over it. Going back to the address brings it back.
   */
  const hide = useCallback(() => {
    opener.current = null
    setOpenId(null)
  }, [])

  return { isOpen: openId !== null, shownId: shown?.id ?? null, leaving, open, close, hide }
}

/** The dish page as a route: `#item-<id>`. */
export function useDishRoute() {
  return useHashRoute(DISH_ROUTE)
}
