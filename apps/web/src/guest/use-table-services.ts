'use client'

// Binds the services client (./services-client.ts) to the guest page: one client per table code,
// polling while the page is visible and stopped when it hides or the code changes. Answers the
// binding a face draws, or undefined when the page has no table or the template doesn't draw the
// shared order. The page gives the client what only a browser has (#76): the phone value made at
// load, the tab's session storage, the phone's position and Turnstile's token.

import { type GuestPosition, LOCATE_TIMEOUT_MS } from '@restro/core'
import type { ServiceBinding } from '@restro/shell'
import { useEffect, useMemo, useSyncExternalStore } from 'react'

import {
  createTableServices,
  newPhoneValue,
  type SessionMemory,
  type TableServices,
} from './services-client'
import { turnstileTokens } from './turnstile'

/** The templates that draw the table's shared order (#75); the others keep their own bag. */
export const SHARED_ORDER_FACES: ReadonlySet<string> = new Set(['qr-phone'])

const NO_STATE = () => null

/** The phone value of this page load: kept in memory only, gone with the page (D122 §4). */
let phone: string | null = null

function phoneValue(): string {
  phone ??= newPhoneValue(crypto.getRandomValues(new Uint8Array(16)))
  return phone
}

/** The tab's session storage; a private window or blocked storage just remembers nothing. */
const sessionMemory: SessionMemory = {
  get(key) {
    try {
      return window.sessionStorage.getItem(key)
    } catch {
      return null
    }
  },
  set(key, value) {
    try {
      window.sessionStorage.setItem(key, value)
    } catch {
      // Nothing kept: the guest is asked again.
    }
  },
  remove(key) {
    try {
      window.sessionStorage.removeItem(key)
    } catch {
      // Nothing was kept.
    }
  },
}

/** The phone's position, precise, within about 10 s; null when refused, unavailable or slow. */
function locate(): Promise<GuestPosition | null> {
  return new Promise((resolve) => {
    if (!('geolocation' in navigator)) {
      resolve(null)
      return
    }
    navigator.geolocation.getCurrentPosition(
      (position) =>
        resolve({
          lat: position.coords.latitude,
          lng: position.coords.longitude,
          accuracyM: position.coords.accuracy,
        }),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: LOCATE_TIMEOUT_MS, maximumAge: 0 },
    )
  })
}

export function useTableServices(code: string | null): ServiceBinding | undefined {
  const services = useMemo<TableServices | null>(() => {
    if (code === null) return null
    const humanToken = turnstileTokens(process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY)
    return createTableServices({
      code,
      fetch: (url, init) => fetch(url, init),
      now: () => Date.now(),
      setTimer: (run, ms) => {
        const timer = setTimeout(run, ms)
        return () => clearTimeout(timer)
      },
      phone: phoneValue(),
      memory: sessionMemory,
      locate,
      ...(humanToken === undefined ? {} : { humanToken }),
    })
  }, [code])

  useEffect(() => {
    if (services === null) return
    const onVisibility = () => {
      if (document.visibilityState === 'visible') services.start()
      else services.stop()
    }
    onVisibility()
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      services.stop()
    }
  }, [services])

  const state = useSyncExternalStore(
    services?.subscribe ?? (() => () => {}),
    services?.getState ?? NO_STATE,
    NO_STATE,
  )
  return useMemo(
    () =>
      services === null || state === null
        ? undefined
        : { state, dispatch: services.dispatch, location: services.location },
    [services, state],
  )
}
