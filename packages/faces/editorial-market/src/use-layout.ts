// The layout the menu is drawn in. It starts as the menu's layout (`view.layout.default`, which
// comes from the design, D129), and the guest's own choice wins while the switch is shown
// (`view.layout.guestSwitch`).
//
// On the guest page (`memory`, the venue's public code) the choice is kept for the visit in
// `sessionStorage`, under a key of that venue's own; the storage is read after the first render,
// never during it, and may be missing (a private window). Without `memory` (the admin's previews,
// which share the tab's storage with the guest page and with each other) nothing is read or
// written: the choice lasts while the face is drawn, and gives way when the menu's own layout
// changes, so a preview always shows the layout the design sets (D129).

import { useCallback, useEffect, useState } from 'react'

import { isLayout, LAYOUT_STORAGE_KEY, type Layout } from './model'

/** The storage key of one venue's remembered layout. */
export function layoutStorageKey(memory: string): string {
  return `${LAYOUT_STORAGE_KEY}:${memory}`
}

export function useLayout(start: Layout, switchShown: boolean, memory: string | null = null) {
  const [chosen, setChosen] = useState<Layout | null>(null)
  const key = memory === null ? null : layoutStorageKey(memory)

  useEffect(() => {
    if (!switchShown || key === null) return
    try {
      const remembered = window.sessionStorage.getItem(key)
      if (isLayout(remembered)) setChosen(remembered)
    } catch {
      // storage is not available: the venue's layout stays
    }
  }, [switchShown, key])

  // A choice nobody keeps was made against the menu's layout of the moment: a new one replaces it.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `start` only triggers the reset
  useEffect(() => {
    if (key === null) setChosen(null)
  }, [start, key])

  const choose = useCallback(
    (layout: Layout) => {
      setChosen(layout)
      if (key === null) return
      try {
        window.sessionStorage.setItem(key, layout)
      } catch {
        // storage is not available: the choice lasts until the page is closed
      }
    },
    [key],
  )

  return [switchShown && chosen !== null ? chosen : start, choose] as const
}
