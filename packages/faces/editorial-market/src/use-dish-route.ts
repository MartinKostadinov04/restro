// The dish page as a route: it lives in the address as `#item-<id>`, so a dish can be shared, the
// phone's back button closes it and the scroll position of the menu is kept. The page behind it
// is never reloaded. Opening pushes a history entry; closing goes back one step, or, for a link
// that opened the page directly, replaces the address. The browser is only touched in effects
// and handlers, so the first render is the same on the server and in the browser.

import { useCallback, useEffect, useRef, useState } from 'react'

import { prefersReducedMotion } from './model'

/** How long the dish page takes to slide out; the stylesheet's exit animation lasts the same. */
const EXIT_MS = 260

const DISH_HASH = /^#item-(.+)$/

/** The item id an address names, or null when it names none. */
function dishIdFromHash(hash: string): string | null {
  const match = DISH_HASH.exec(hash)
  if (match === null) return null
  try {
    return decodeURIComponent(match[1] ?? '')
  } catch {
    return null // a malformed link names no dish
  }
}

/** True for the history state this hook pushes. */
function isDishState(state: unknown): boolean {
  return typeof state === 'object' && state !== null && 'rmItem' in state
}

export function useDishRoute() {
  // What the address says is open, and what is drawn (it stays drawn while the page slides out).
  const [openId, setOpenId] = useState<string | null>(null)
  const [shown, setShown] = useState<{ readonly id: string; readonly leaving: boolean } | null>(
    null,
  )
  const opener = useRef<HTMLElement | null>(null)
  const wasOpen = useRef(false)

  // The address is the truth: read it on arrival and whenever the guest goes back or forward.
  useEffect(() => {
    const read = () => setOpenId(dishIdFromHash(window.location.hash))
    read()
    window.addEventListener('popstate', read)
    return () => window.removeEventListener('popstate', read)
  }, [])

  useEffect(() => {
    if (openId !== null) {
      setShown({ id: openId, leaving: false })
    } else {
      const instant = prefersReducedMotion()
      setShown((current) => (current === null || instant ? null : { ...current, leaving: true }))
      // Hand the focus back to the card that opened the page.
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

  /** Opens the dish page; `element` is what gets the focus back when it closes. */
  const open = useCallback((id: string, element: HTMLElement) => {
    opener.current = element
    window.history.pushState({ rmItem: id }, '', `#item-${encodeURIComponent(id)}`)
    setOpenId(id)
  }, [])

  /** Closes it: one step back if this page pushed the entry, else the address is cleaned up. */
  const close = useCallback(() => {
    if (isDishState(window.history.state)) {
      window.history.back()
    } else {
      window.history.replaceState(null, '', window.location.pathname + window.location.search)
      setOpenId(null)
    }
  }, [])

  return { isOpen: openId !== null, shownId: shown?.id ?? null, leaving, open, close }
}
