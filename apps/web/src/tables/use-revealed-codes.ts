'use client'

// The codes the Tables tab draws (#70). A code is stored as its hash and a copy only the worker
// can open, so the tab asks the worker for the codes it shows: once when the page is up, and again
// only for a code it has not been given yet (a new one, or one made again). The refresh after
// each action brings the same codes, so it asks for nothing: no wait on the worker, no Log entry,
// nothing that redraws the tab under an open menu. A code the worker does not give is drawn as
// none, and is not asked for again until the page is loaded again, or the owner presses Try again
// (#441): `retry` asks once more, once per press, for the codes still missing. `failed` says the
// last ask ended without a code (an error, nothing, or a call that threw), so the tab can say so
// instead of waiting.
import { useCallback, useEffect, useRef, useState } from 'react'

import { revealCodesAction } from '@/server/tables/actions'
import type { RevealCodesResult, RevealedCode, TablesView } from '@/server/tables/view'

/** Asks for the codes of some of the venue's tables (the server action; tests pass their own). */
export type RevealTablesCodes = (input: {
  venueId: string
  tableIds: string[]
}) => Promise<RevealCodesResult>

/** The codes revealed so far, by `codeKey`, and what to do when the worker could not give them. */
export interface RevealedCodes {
  readonly revealed: ReadonlyMap<string, RevealedCode>
  /** True when the last ask ended without giving a code and no new ask is under way. */
  readonly failed: boolean
  /** Asks once more for the codes still missing. */
  readonly retry: () => void
}

/** `missing` as `[table id, code key]` pairs. */
function entries(list: string): [string, string][] {
  return list === '' ? [] : list.split('\n').map((entry) => entry.split(' ') as [string, string])
}

export function useRevealedCodes(
  view: TablesView,
  reveal: RevealTablesCodes = revealCodesAction,
): RevealedCodes {
  const [revealed, setRevealed] = useState<ReadonlyMap<string, RevealedCode>>(() => new Map())
  const [failed, setFailed] = useState(false)
  // The keys already asked for, answered or not: each is asked for once per page load, and again
  // only when the owner presses Try again.
  const asked = useRef(new Set<string>())

  const missing = view.halls
    .flatMap((hall) => hall.tables)
    .flatMap((row) =>
      row.codeKey !== null && !revealed.has(row.codeKey) ? [`${row.id} ${row.codeKey}`] : [],
    )
    .join('\n')

  const ask = useCallback(
    (wanted: readonly (readonly [string, string])[]) => {
      for (const [, key] of wanted) asked.current.add(key)
      reveal({ venueId: view.venueId, tableIds: wanted.map(([id]) => id) }).then(
        (result) => {
          if (!result.ok || result.codes.length === 0) {
            setFailed(true)
            return
          }
          setFailed(false)
          setRevealed((before) => {
            const next = new Map(before)
            for (const code of result.codes) next.set(code.codeKey, code)
            return next
          })
        },
        // The action logs its own failures; the cards then draw no code, and the tab says so.
        () => setFailed(true),
      )
    },
    [reveal, view.venueId],
  )

  useEffect(() => {
    const wanted = entries(missing).filter(([, key]) => !asked.current.has(key))
    if (wanted.length > 0) ask(wanted)
  }, [missing, ask])

  const retry = useCallback(() => {
    const wanted = entries(missing)
    if (wanted.length === 0) return
    setFailed(false)
    ask(wanted)
  }, [missing, ask])

  return { revealed, failed, retry }
}
