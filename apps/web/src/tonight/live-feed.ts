'use client'

// A list the screen keeps current by asking again every few seconds (plans: sent orders §3, Log
// §3, "New sent orders while the list is read"). Frequency rule: data the owner reads never moves
// for style. While the page is scrolled to the top, rows join at the top as they come; otherwise
// the rows already drawn only change in place and a still line says "{k} new", and one tap shows
// them. Nothing slides. A new query (a search, a filter, a day, "Show earlier") fetches at once
// and replaces the list.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

/** How often the list asks the server again. */
export const FEED_POLL_MS = 5000
/** "At the top": the page has not been scrolled further than this. */
const TOP_PX = 120

interface Options<V> {
  /** What the server drew for the first query. */
  readonly initial: V
  /** Reads the list for the current query; null when it could not be read. */
  readonly load: () => Promise<V | null>
  /** The keys of the rows of a view, newest first. */
  readonly keysOf: (view: V) => readonly (string | number)[]
  /** `shown` with its rows replaced by their fresh versions in `latest`; no row is added. */
  readonly refresh: (shown: V, latest: V) => V
  /** A change here fetches at once and replaces the list. */
  readonly query: readonly unknown[]
  /** False for a night that is over: nothing new can come. */
  readonly live: boolean
}

export function useLiveFeed<V>(options: Options<V>) {
  const [shown, setShown] = useState(options.initial)
  const [pending, setPending] = useState<V | null>(null)
  const [failed, setFailed] = useState(false)
  const [loading, setLoading] = useState(false)
  const latest = useRef(options)
  latest.current = options
  const generation = useRef(0)
  const first = useRef(true)
  const queryKey = JSON.stringify(options.query)

  // A new query: ask at once and replace the list.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the query key is the trigger
  useEffect(() => {
    if (first.current) {
      first.current = false
      return
    }
    const mine = ++generation.current
    setLoading(true)
    void latest.current.load().then((view) => {
      if (mine !== generation.current) return
      setLoading(false)
      if (view === null) {
        setFailed(true)
        return
      }
      setFailed(false)
      setShown(view)
      setPending(null)
    })
  }, [queryKey])

  // Keep current.
  // biome-ignore lint/correctness/useExhaustiveDependencies: restarts with the query
  useEffect(() => {
    if (!options.live) return
    const timer = window.setInterval(() => {
      if (document.visibilityState !== 'visible') return
      const mine = generation.current
      void latest.current.load().then((view) => {
        if (mine !== generation.current) return
        if (view === null) {
          setFailed(true)
          return
        }
        setFailed(false)
        if (window.scrollY < TOP_PX) {
          setShown(view)
          setPending(null)
        } else {
          setShown((before) => latest.current.refresh(before, view))
          setPending(view)
        }
      })
    }, FEED_POLL_MS)
    return () => window.clearInterval(timer)
  }, [options.live, queryKey])

  const fresh = useMemo(() => {
    if (pending === null) return 0
    const have = new Set(options.keysOf(shown))
    return options.keysOf(pending).filter((key) => !have.has(key)).length
  }, [pending, shown, options.keysOf])

  const show = useCallback(() => {
    if (pending === null) return
    setShown(pending)
    setPending(null)
  }, [pending])

  /** Reads again now and shows the result, wherever the page is scrolled (after an answer). */
  const reload = useCallback(() => {
    const mine = ++generation.current
    void latest.current.load().then((view) => {
      if (mine !== generation.current || view === null) return
      setShown(view)
      setPending(null)
    })
  }, [])

  return { shown, fresh, show, failed, loading, reload } as const
}
