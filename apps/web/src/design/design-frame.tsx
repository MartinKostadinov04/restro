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

import { closeSheets, drive, holdScroll } from './frame-stage'
import { type FrameContent, frameStoreOf } from './preview-frames'

const nothing = (): FrameContent | null => null

/**
 * The marked parts a tap landed in, the innermost first, and then the part the tap opens: the
 * control that opens a dish (`item.open`) opens the Dish page's part.
 */
export function partsOf(target: Element): string[] {
  const parts: string[] = []
  for (
    let part = target.closest<HTMLElement>('[data-design-part]');
    part !== null;
    part = part.parentElement?.closest<HTMLElement>('[data-design-part]') ?? null
  ) {
    const name = part.dataset.designPart
    if (name !== undefined) parts.push(name)
  }
  if (parts.length > 0 && target.closest('[data-slot="item.open"]') !== null) parts.push('dish')
  return parts
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

  // A tap on a marked part names the part to the Design page, with the parts around it and what
  // the tap opens. Captured before the renderer's own handler, which still runs.
  useEffect(() => {
    const tapped = (event: MouseEvent) => {
      const target = event.target instanceof Element ? event.target : null
      const [part, ...around] = target === null ? [] : partsOf(target)
      if (part !== undefined) frameStoreOf(slot)?.tap(part, around)
    }
    document.addEventListener('click', tapped, true)
    return () => document.removeEventListener('click', tapped, true)
  }, [slot])

  // The stage is reached once per frame and stage: a change of value redraws the same frame. A frame
  // whose stage is taken away (the live preview, once the Dish page is left) goes back to the menu.
  const stage = content?.stage
  const focus = content?.focus?.join(' ') ?? ''
  const ready = content !== null
  const staged = useRef(false)
  useEffect(() => {
    if (!ready) return undefined
    if (staged.current && stage === undefined) closeSheets()
    staged.current = stage !== undefined
    // A tile's frame (it names a stage) never scrolls the panel it sits in.
    if (stage !== undefined) holdScroll(window)
    return drive(stage ?? 'menu', focus === '' ? [] : focus.split(' '))
  }, [ready, stage, focus])

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
