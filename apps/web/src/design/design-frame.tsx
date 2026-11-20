'use client'

// The page inside a Design page's frame (D129, RR-87): the real renderer, on a document of its own,
// drawing what the Design page holds for this frame (`preview-frames.ts`). It reads no data of its
// own: with no Design page around it, it is empty.
//
// Two things beyond drawing, both for the Advanced panel (D129, D130):
//   - a tap on a marked part (`data-design-part`) tells the Design page which part it was, so the
//     page opens the page that owns it. The renderer still gets the tap: the dish opens, a sheet
//     opens, as for a guest.
//   - a tile of a screen's page asks for a stage: the frame opens the sheet the tile is about by
//     tapping the renderer's own controls, as a person would, and scrolls to the part the option
//     styles. The demo host behind the sheets is the preview's (`useDemoServices`).
import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from 'react'

import { DraftFace } from '@/publish/draft-face'

import type { Stage } from './advanced-model'
import { closeDish, drive, holdScroll, keepHistoryInside } from './frame-stage'
import { type FrameContent, frameStoreOf } from './preview-frames'

const nothing = (): FrameContent | null => null

/**
 * The marked part a tap landed on (the innermost), and the part the tap opens: the control that
 * opens a dish (`item.open`) opens the Dish page's part. The parts around it (the dish's section)
 * are not the tap's.
 */
export function partOf(target: Element): { part: string; opens: string | null } | null {
  const part = target.closest<HTMLElement>('[data-design-part]')?.dataset.designPart
  if (part === undefined) return null
  return { part, opens: target.closest('[data-slot="item.open"]') !== null ? 'dish' : null }
}

/**
 * Reaches the frame's stage, once per stage and focus: a change of value redraws the same frame. A
 * frame with a stage keeps `focus()` from scrolling (a tile never scrolls the panel it sits in)
 * while the stage lasts. A frame whose stage is taken away (the live preview, once the Dish page is
 * left) goes back to the menu: the dish it opened is closed.
 */
export function useStage(ready: boolean, stage: Stage | undefined, focus: string): void {
  const staged = useRef(false)
  useEffect(() => {
    if (!ready) return undefined
    if (staged.current && stage === undefined) closeDish()
    staged.current = stage !== undefined
    const release = stage === undefined ? undefined : holdScroll(window)
    const stop = drive(stage ?? 'menu', focus === '' ? [] : focus.split(' '))
    return () => {
      stop()
      release?.()
    }
  }, [ready, stage, focus])
}

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

  // A tap on a marked part names the part to the Design page, with what the tap opens. Captured
  // before the renderer's own handler, which still runs.
  useEffect(() => {
    const tapped = (event: MouseEvent) => {
      const target = event.target instanceof Element ? event.target : null
      const tap = target === null ? null : partOf(target)
      if (tap !== null) frameStoreOf(slot)?.tap(tap.part, tap.opens)
    }
    document.addEventListener('click', tapped, true)
    return () => document.removeEventListener('click', tapped, true)
  }, [slot])

  useEffect(() => keepHistoryInside(window), [])
  useStage(content !== null, content?.stage, content?.focus?.join(' ') ?? '')

  return (
    <>
      <style>{FRAME_CSS}</style>
      {content === null ? null : (
        <DraftFace
          snapshot={content.snapshot}
          overlay={content.overlay}
          scheme={content.scheme}
          servicesPreview={content.services}
          assetBase={content.assetBase}
        />
      )}
    </>
  )
}
