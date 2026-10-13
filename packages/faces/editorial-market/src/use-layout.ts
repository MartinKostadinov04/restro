// The layout the menu is drawn in. It starts as the menu's layout (D92: `view.layout.default`, set
// in the composer); a guest who has chosen one keeps it for the visit (`sessionStorage`), and that
// choice wins while the switch is shown (`view.layout.guestSwitch`). The
// storage is read after the first render, never during it, and may be missing (a private window).

import { useCallback, useEffect, useState } from 'react'

import { isLayout, LAYOUT_STORAGE_KEY, type Layout } from './model'

export function useLayout(start: Layout, switchShown: boolean) {
  const [chosen, setChosen] = useState<Layout | null>(null)

  useEffect(() => {
    if (!switchShown) return
    try {
      const remembered = window.sessionStorage.getItem(LAYOUT_STORAGE_KEY)
      if (isLayout(remembered)) setChosen(remembered)
    } catch {
      // storage is not available: the venue's layout stays
    }
  }, [switchShown])

  const choose = useCallback((layout: Layout) => {
    setChosen(layout)
    try {
      window.sessionStorage.setItem(LAYOUT_STORAGE_KEY, layout)
    } catch {
      // storage is not available: the choice lasts until the page is closed
    }
  }, [])

  return [switchShown && chosen !== null ? chosen : start, choose] as const
}
