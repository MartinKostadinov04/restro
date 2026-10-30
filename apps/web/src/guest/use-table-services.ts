'use client'

// Binds the services client (./services-client.ts) to the guest page: one client per table code,
// polling while the page is visible and stopped when it hides or the code changes. Answers the
// binding a face draws, or undefined when the page has no table or the template doesn't draw the
// shared order. The page gives the client what only a browser has (#76): the phone value made at
// load, the tab's session storage, the phone's position and Turnstile's token.

import { type GuestPosition, LOCATE_TIMEOUT_MS } from '@restro/core'
import type { PayFormSlot, ServiceBinding } from '@restro/shell'
import { useEffect, useMemo, useSyncExternalStore } from 'react'

import { cardFormFor, cardReturnUrl } from '../connectors/card-forms'
import {
  createTableServices,
  newPhoneValue,
  PAY_RETURNED_KEY,
  type SessionMemory,
  type TableServices,
} from './services-client'
import { turnstileTokens } from './turnstile'

/**
 * The templates that draw the table's shared order (#75) and the table services around it (the
 * bill, paying, the waiter): the page binds the services client for these. A template outside the
 * list gets no table and the menu only.
 */
export const SHARED_ORDER_FACES: ReadonlySet<string> = new Set(['editorial-market'])

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

/**
 * The browser's local storage: what outlives the tab for the sitting (the payment handle, D127 log
 * 2.2). A private window or blocked storage just remembers nothing.
 */
const localMemory: SessionMemory = {
  get(key) {
    try {
      return window.localStorage.getItem(key)
    } catch {
      return null
    }
  },
  set(key, value) {
    try {
      window.localStorage.setItem(key, value)
    } catch {
      // Nothing kept: the payment is found again by the tab's own poll only.
    }
  },
  remove(key) {
    try {
      window.localStorage.removeItem(key)
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

/**
 * The form slot the face places (#114, D127): the page fills it with the card form of the payment's
 * provider, from the values the client holds. A payment of a provider the page has no form for gets
 * none, and the face draws the paying screen without it.
 */
function payFormSlot(services: TableServices): PayFormSlot {
  return {
    mount(target, props) {
      const values = services.formValues()
      const form = values === null ? null : cardFormFor(values.provider)
      if (values === null || form === null) return { update: () => {}, unmount: () => {} }
      return form.mount(target as HTMLElement, props, {
        values: values.values,
        returnUrl: cardReturnUrl(window.location.href),
        onReturned: () => {
          void services.dispatch({ kind: 'pay.returned', actionId: crypto.randomUUID() })
        },
        markRedirect: (on) => {
          if (on) sessionMemory.set(PAY_RETURNED_KEY, '1')
          else sessionMemory.remove(PAY_RETURNED_KEY)
        },
      })
    },
  }
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
      durable: localMemory,
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
  // One slot per client: a face mounts the form once and keeps it across the polls' new states.
  const payForm = useMemo(() => (services === null ? null : payFormSlot(services)), [services])
  return useMemo(
    () =>
      services === null || state === null || payForm === null
        ? undefined
        : {
            state,
            dispatch: services.dispatch,
            location: services.location,
            setScreen: services.setScreen,
            payForm,
            payControls: { dismiss: services.dismissPayment },
          },
    [services, state, payForm],
  )
}
