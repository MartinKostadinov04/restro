'use client'

// The codes the Tables tab draws (#70). A code is stored as its hash and a copy only the worker
// can open, so the tab asks the worker for the codes it shows: once when the page is up, and again
// only for a code it has not been given yet (a new one, or one made again). The refresh after
// each action brings the same codes, so it asks for nothing: no wait on the worker, no Log entry,
// nothing that redraws the tab under an open menu. A code the worker does not give is drawn as
// none, and is not asked for again until the page is loaded again.
import { useEffect, useRef, useState } from 'react'

import { revealCodesAction } from '@/server/tables/actions'
import type { RevealCodesResult, RevealedCode, TablesView } from '@/server/tables/view'

/** Asks for the codes of some of the venue's tables (the server action; tests pass their own). */
export type RevealTablesCodes = (input: {
  venueId: string
  tableIds: string[]
}) => Promise<RevealCodesResult>

/** The codes revealed so far, by `codeKey`. */
export function useRevealedCodes(
  view: TablesView,
  reveal: RevealTablesCodes = revealCodesAction,
): ReadonlyMap<string, RevealedCode> {
  const [revealed, setRevealed] = useState<ReadonlyMap<string, RevealedCode>>(() => new Map())
  // The keys already asked for, answered or not: each is asked for once per page load.
  const asked = useRef(new Set<string>())

  const missing = view.halls
    .flatMap((hall) => hall.tables)
    .flatMap((row) =>
      row.codeKey !== null && !revealed.has(row.codeKey) ? [`${row.id} ${row.codeKey}`] : [],
    )
    .join('\n')

  useEffect(() => {
    if (missing === '') return
    const wanted = missing
      .split('\n')
      .map((entry) => entry.split(' ') as [string, string])
      .filter(([, key]) => !asked.current.has(key))
    if (wanted.length === 0) return
    for (const [, key] of wanted) asked.current.add(key)
    reveal({ venueId: view.venueId, tableIds: wanted.map(([id]) => id) }).then(
      (result) => {
        if (!result.ok || result.codes.length === 0) return
        setRevealed((before) => {
          const next = new Map(before)
          for (const code of result.codes) next.set(code.codeKey, code)
          return next
        })
      },
      // The action logs its own failures; the cards then draw no code.
      () => undefined,
    )
  }, [missing, reveal, view.venueId])

  return revealed
}
