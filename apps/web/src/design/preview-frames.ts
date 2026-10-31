// How the Design page's frames get what they draw (D129, RR-87). The preview and every Style tile are
// a same-origin iframe of `/venues/<id>/design/frame`, so the renderer lays out at the frame's own
// width: its media queries, fixed sheets, `dvh` units, hash routes and focus handling all read the
// frame, as they read a guest's phone, with no change to the renderer.
//
// No messages go between the page and its frames, and nothing goes through the server: the page keeps
// a small store for each frame on its own window, the frame's page reads it through `window.parent`
// and subscribes. So a change to the draft reaches the frame at once, and the frame never holds any
// state of the design's.
import type { LiveOverlay, MenuSnapshot } from '@restro/core'

import type { PreviewScheme } from '@/publish/draft-face'

/** What one frame draws. */
export interface FrameContent {
  readonly snapshot: MenuSnapshot
  readonly overlay: LiveOverlay
  readonly scheme: PreviewScheme
  /** Draw the service screens the venue switched on, with demo data (D71). */
  readonly services: boolean
}

export interface FrameStore {
  read(): FrameContent | null
  subscribe(listener: () => void): () => void
}

const STORES_KEY = '__restroDesignFrames'

type StoresWindow = { [STORES_KEY]?: Map<string, FrameStore> }

/** The address of a frame's page. */
export function framePath(venueId: string, slot: string): string {
  return `/venues/${venueId}/design/frame?${new URLSearchParams({ slot }).toString()}`
}

/** The page's side: makes the store of a frame, and the way to give it new content. */
export function openFrameStore(slot: string): {
  readonly set: (content: FrameContent | null) => void
  readonly close: () => void
} {
  const listeners = new Set<() => void>()
  let current: FrameContent | null = null
  const owner = window as unknown as StoresWindow
  const stores = owner[STORES_KEY] ?? new Map<string, FrameStore>()
  owner[STORES_KEY] = stores
  const store: FrameStore = {
    read: () => current,
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
  stores.set(slot, store)
  return {
    set(content) {
      current = content
      for (const listener of listeners) listener()
    },
    close() {
      if (stores.get(slot) === store) stores.delete(slot)
    },
  }
}

/** The frame's side: the store its page keeps for it, or null when it has no such page around it. */
export function frameStoreOf(slot: string): FrameStore | null {
  if (typeof window === 'undefined' || window.parent === window) return null
  try {
    return (window.parent as unknown as StoresWindow)[STORES_KEY]?.get(slot) ?? null
  } catch {
    // A parent of another origin cannot be read: no store.
    return null
  }
}
