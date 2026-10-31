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
import { useCallback, useEffect, useMemo, useSyncExternalStore } from 'react'

import { DraftFace } from '@/publish/draft-face'

import type { Stage } from './advanced-model'
import { type FrameContent, frameStoreOf } from './preview-frames'

const nothing = (): FrameContent | null => null

/** A phone's scrollbar lies over the page and takes no width: the same here, on any computer. */
const FRAME_CSS = 'html{scrollbar-width:none}html::-webkit-scrollbar{display:none}'

const slotOf = (name: string) => `[data-slot="${name}"]`

/**
 * The controls to press, in order, to reach a stage: each is pressed once it exists. A stage ends at
 * `until`, which is what shows when it is reached.
 */
const WAYS: Readonly<
  Record<Stage, { readonly press: readonly string[]; readonly until: string | null }>
> = {
  menu: { press: [], until: null },
  order: { press: [slotOf('item.add')], until: slotOf('menu.bag') },
  bag: { press: [slotOf('item.add'), slotOf('menu.bag')], until: '[role="dialog"]' },
  bill: { press: [slotOf('menu.bill')], until: '[role="dialog"]' },
  call: { press: [slotOf('menu.call_waiter')], until: '[role="dialog"]' },
  pay: { press: [slotOf('menu.pay'), slotOf('pay.whole')], until: slotOf('pay.tip.row') },
  receipt: {
    press: [
      slotOf('menu.pay'),
      slotOf('pay.whole'),
      slotOf('pay.start'),
      `${slotOf('pay.form')} button`,
    ],
    until: slotOf('pay.number'),
  },
  dish: { press: [slotOf('item.open')], until: '[role="dialog"]' },
}

/** How long the frame keeps looking for a control before it shows what it has. */
const GIVE_UP_MS = 20_000
const STEP_MS = 120

/** Scrolls to the first part that exists: the page for a part of the menu, the sheet for one in a sheet. */
function reveal(markers: readonly string[]): void {
  for (const marker of markers) {
    const part = document.querySelector<HTMLElement>(`[data-design-part="${marker}"]`)
    if (part === null) continue
    if (part.closest('[role="dialog"], dialog') !== null) {
      part.scrollIntoView({ block: 'center' })
    } else {
      window.scrollTo({ top: Math.max(0, part.getBoundingClientRect().top + window.scrollY - 8) })
    }
    return
  }
}

/** Presses the stage's controls one after the other, then scrolls. Returns what stops it. */
function drive(stage: Stage, focus: readonly string[]): () => void {
  const way = WAYS[stage]
  const started = Date.now()
  let step = 0
  let timer: ReturnType<typeof setTimeout> | undefined
  let stopped = false
  const tick = () => {
    if (stopped) return
    const press = way.press[step]
    if (press !== undefined) {
      const control = document.querySelector<HTMLElement>(press)
      if (control !== null) {
        control.click()
        step += 1
      }
    } else if (way.until === null || document.querySelector(way.until) !== null) {
      // The screen is up; a moment for its own entrance, then to the part.
      timer = setTimeout(() => reveal(focus), 250)
      return
    }
    if (Date.now() - started > GIVE_UP_MS) {
      reveal(focus)
      return
    }
    timer = setTimeout(tick, STEP_MS)
  }
  tick()
  return () => {
    stopped = true
    if (timer !== undefined) clearTimeout(timer)
  }
}

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

  // A tap on a marked part names the part to the Design page. Captured before the renderer's own
  // handler, which still runs.
  useEffect(() => {
    const tapped = (event: MouseEvent) => {
      const target = event.target instanceof Element ? event.target : null
      const part = target?.closest<HTMLElement>('[data-design-part]')?.dataset.designPart
      if (part !== undefined) frameStoreOf(slot)?.tap(part)
    }
    document.addEventListener('click', tapped, true)
    return () => document.removeEventListener('click', tapped, true)
  }, [slot])

  // The stage is reached once per frame and stage: a change of value redraws the same frame.
  const stage = content?.stage ?? 'menu'
  const focus = content?.focus?.join(' ') ?? ''
  const ready = content !== null
  useEffect(() => {
    if (!ready) return undefined
    return drive(stage, focus === '' ? [] : focus.split(' '))
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
