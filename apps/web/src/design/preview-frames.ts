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
import type { SpecimenPart } from '@restro/editorial-market/preview'

import type { PreviewScheme } from '@/publish/draft-face'

import type { Stage } from './advanced-model'

/** What one frame draws. */
export interface FrameContent {
  readonly snapshot: MenuSnapshot
  readonly overlay: LiveOverlay
  readonly scheme: PreviewScheme
  /** Draw the service screens the venue switched on, with demo data (D71). */
  readonly services: boolean
  /** What the frame shows first: the menu, or a sheet opened for it (a tile of a screen's page). */
  readonly stage?: Stage
  /** The parts (`data-design-part`) the frame scrolls to, the first it finds. */
  readonly focus?: readonly string[]
  /** Where the frame reads photos from, when it draws the demo photo (`specimen.ts`). */
  readonly assetBase?: string
  /**
   * The one part the frame draws, alone (D159: an option's tile): the face's specimen view instead
   * of the whole menu. The frame then has no stage, and tells its page the part's height.
   */
  readonly specimen?: SpecimenPart
}

export interface FrameStore {
  read(): FrameContent | null
  subscribe(listener: () => void): () => void
  /**
   * A tap on a marked part of the frame (`data-design-part`), the innermost: the page opens that
   * part's page. `opens` is the part the tap opens, if any (`dish`).
   */
  tap(marker: string, opens?: string | null): void
  /** The height of what the frame draws, in CSS pixels at its own width (a specimen's part). */
  size(height: number): void
}

const STORES_KEY = '__restroDesignFrames'

type StoresWindow = { [STORES_KEY]?: Map<string, FrameStore> }

/** The address of a frame's page. */
export function framePath(venueId: string, slot: string): string {
  return `/venues/${venueId}/design/frame?${new URLSearchParams({ slot }).toString()}`
}

/** The page's side: makes the store of a frame, and the way to give it new content. */
export function openFrameStore(
  slot: string,
  onPart?: (marker: string, opens: string | null) => void,
  onSize?: (height: number) => void,
): {
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
    tap: (marker, opens = null) => onPart?.(marker, opens),
    size: (height) => onSize?.(height),
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
