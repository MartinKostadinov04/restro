'use client'

// The page inside a Design page's frame (D129, RR-87): the real renderer, on a document of its own,
// drawing what the Design page holds for this frame (`preview-frames.ts`). It reads no data of its
// own: with no Design page around it, it is empty.
import { useCallback, useMemo, useSyncExternalStore } from 'react'

import { DraftFace } from '@/publish/draft-face'

import { type FrameContent, frameStoreOf } from './preview-frames'

const nothing = (): FrameContent | null => null

/** A phone's scrollbar lies over the page and takes no width: the same here, on any computer. */
const FRAME_CSS = 'html{scrollbar-width:none}html::-webkit-scrollbar{display:none}'

export function DesignFrame({ slot }: { slot: string }) {
  const subscribe = useCallback(
    (listener: () => void) => {
      const unsubscribe = frameStoreOf(slot)?.subscribe(listener)
      if (unsubscribe === undefined) return () => undefined
      // A frame that goes away (a reload) stops listening before its code does.
      window.addEventListener('pagehide', unsubscribe)
      return () => {
        window.removeEventListener('pagehide', unsubscribe)
        unsubscribe()
      }
    },
    [slot],
  )
  const read = useCallback(() => frameStoreOf(slot)?.read() ?? null, [slot])
  const shared = useSyncExternalStore(subscribe, read, nothing)
  // The objects were made in the page's window: the frame draws its own copy.
  const content = useMemo(() => (shared === null ? null : structuredClone(shared)), [shared])
  return (
    <>
      <style>{FRAME_CSS}</style>
      {content === null ? null : (
        <DraftFace
          snapshot={content.snapshot}
          overlay={content.overlay}
          scheme={content.scheme}
          servicesPreview={content.services}
        />
      )}
    </>
  )
}
