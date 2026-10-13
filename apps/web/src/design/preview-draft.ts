'use client'

// The draft the Design tab previews (briefs SH-05a and S7): the menu the server builds in memory
// from what is saved (the publisher's builder, schema and leak guard). It is asked for once when
// the tab opens, and again when "Refresh" is pressed or the header name is saved. One draft
// serves the sticky phone preview and the pop-up of every template, so opening a pop-up asks for
// nothing; the unsaved look is laid over it in the browser (`previewSnapshot`).
import type { LiveOverlay, MenuSnapshot } from '@restro/core'
import { useEffect, useState } from 'react'

import { previewDraftAction } from '@/server/publish/actions'

/** The draft as the tab holds it: loading, ready, or the publish preview's own reason it is not. */
export type Draft =
  | { readonly state: 'loading' }
  | { readonly state: 'ready'; readonly snapshot: MenuSnapshot; readonly overlay: LiveOverlay }
  | {
      readonly state: 'error'
      readonly error: 'no_menu' | 'nothing_visible' | 'blocked' | 'failed'
    }

/** The draft of one menu (null = the venue's live menu), and the way to ask for it again. */
export function usePreviewDraft(venueId: string, menuId: string | null) {
  const [draft, setDraft] = useState<Draft>({ state: 'loading' })
  const [attempt, setAttempt] = useState(0)
  const [refreshing, setRefreshing] = useState(false)

  // biome-ignore lint/correctness/useExhaustiveDependencies: `attempt` only restarts the load
  useEffect(() => {
    let cancelled = false
    setRefreshing(true)
    const load = menuId === null ? previewDraftAction(venueId) : previewDraftAction(venueId, menuId)
    load.then(
      (result) => {
        if (cancelled) return
        setRefreshing(false)
        setDraft(
          result.ok
            ? { state: 'ready', snapshot: result.snapshot, overlay: result.overlay }
            : { state: 'error', error: result.error },
        )
      },
      () => {
        if (cancelled) return
        setRefreshing(false)
        setDraft({ state: 'error', error: 'failed' })
      },
    )
    return () => {
      cancelled = true
    }
  }, [venueId, menuId, attempt])

  return { draft, refreshing, refresh: () => setAttempt((n) => n + 1) }
}
