'use client'

// Binds the services client (./services-client.ts) to the guest page: one client per table code,
// polling while the page is visible and stopped when it hides or the code changes. Answers the
// binding a face draws, or undefined when the page has no table or the template doesn't draw the
// shared order.

import type { ServiceBinding } from '@restro/shell'
import { useEffect, useMemo, useSyncExternalStore } from 'react'

import { createTableServices, type TableServices } from './services-client'

/** The templates that draw the table's shared order (#75); the others keep their own bag. */
export const SHARED_ORDER_FACES: ReadonlySet<string> = new Set(['qr-phone'])

const NO_STATE = () => null

export function useTableServices(code: string | null): ServiceBinding | undefined {
  const services = useMemo<TableServices | null>(
    () =>
      code === null
        ? null
        : createTableServices({
            code,
            fetch: (url, init) => fetch(url, init),
            now: () => Date.now(),
            setTimer: (run, ms) => {
              const timer = setTimeout(run, ms)
              return () => clearTimeout(timer)
            },
          }),
    [code],
  )

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
      services === null || state === null ? undefined : { state, dispatch: services.dispatch },
    [services, state],
  )
}
