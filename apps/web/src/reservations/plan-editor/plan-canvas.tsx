'use client'

// The plan editor's canvas (#397): the room drawn to fit the width, each spot where its numbers put
// it, and the three ways to lay one out:
//   • drag a spot to move it, drag the corner of the chosen one to resize it (pointer, mouse or
//     finger);
//   • the arrow keys on a focused spot move it, Shift + the arrows resize it (2.1.1);
//   • the spot's own sheet, a tap away, with its numbers and shape as fields — the alternative to
//     dragging that WCAG 2.2 AA asks for (2.5.7).
// Every place shown while dragging is one the shape folder accepts (`movePlace`, `resizePlace`), and
// the room the drag is held inside is the one it started in, so nothing jumps while a finger is
// down. The write happens once, when the finger lifts or the keys rest.
//
// Nothing stored becomes markup here either (`plan-markup.test.tsx` scans this folder): a spot's
// name is a React child, the class comes from the folder's corner name, the style is per cent built
// from checked whole numbers.
import { movePlace, type PlanBox, resizePlace, type SpotPlace, type SpotSymbol } from '@restro/core'
import { useTranslations } from 'next-intl'
import {
  type KeyboardEvent,
  type PointerEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react'

import { cn } from '@/lib/utils'

import { cornerClassOf, KindSymbol, placeStyle } from '../plan-shape'

/** How far a pointer travels before a press is a drag rather than a tap, in pixels. */
const DRAG_FROM_PX = 4
/** How long the keys rest before a keyboard move is saved. */
const KEYS_REST_MS = 600
/** The tallest the canvas is drawn, as a share of the screen's height. */
const MAX_HEIGHT_VH = 70

/** One spot as the canvas draws it. */
export interface CanvasSpot {
  readonly id: string
  readonly name: string
  readonly place: SpotPlace
  readonly symbol: SpotSymbol
  /** What a screen reader hears: the spot and its kind. */
  readonly label: string
}

const same = (a: SpotPlace, b: SpotPlace) =>
  a.x === b.x &&
  a.y === b.y &&
  a.width === b.width &&
  a.height === b.height &&
  a.shape === b.shape &&
  a.rotation === b.rotation

interface Gesture {
  readonly id: string
  readonly mode: 'move' | 'resize'
  readonly pointerId: number
  readonly startX: number
  readonly startY: number
  readonly from: SpotPlace
  /** Pixels per grid unit when the drag began. */
  readonly unit: number
  readonly room: PlanBox
  moved: boolean
}

export function PlanCanvas({
  spots,
  room,
  selected,
  can,
  onOpen,
  onCommit,
}: {
  spots: readonly CanvasSpot[]
  room: PlanBox
  selected: string | null
  /** The person may change the plan: otherwise the spots are drawn and nothing moves. */
  can: boolean
  onOpen: (id: string) => void
  /** A move or a resize is finished: save `place`; `from` is where it was, for Undo. */
  onCommit: (id: string, place: SpotPlace, from: SpotPlace) => void
}) {
  const t = useTranslations('ownerSettings')
  const frame = useRef<HTMLElement | null>(null)
  const [live, setLive] = useState<{ id: string; place: SpotPlace } | null>(null)
  const liveRef = useRef(live)
  liveRef.current = live
  const gesture = useRef<Gesture | null>(null)
  /** A drag just ended on this spot: the click the browser fires after it is not a tap. */
  const dragged = useRef<string | null>(null)
  const keys = useRef<{ id: string; from: SpotPlace; timer: number } | null>(null)

  // Keys still resting when the canvas goes: their move is saved, not lost.
  useEffect(
    () => () => {
      const pending = keys.current
      if (pending === null) return
      window.clearTimeout(pending.timer)
    },
    [],
  )

  const placeOf = useCallback(
    (spot: CanvasSpot) => (live?.id === spot.id ? live.place : spot.place),
    [live],
  )

  function begin(event: PointerEvent<HTMLElement>, spot: CanvasSpot, mode: Gesture['mode']) {
    if (!can || event.button !== 0) return
    const box = frame.current?.getBoundingClientRect()
    if (box === undefined || box.width === 0) return
    if (mode === 'resize') event.stopPropagation()
    event.currentTarget.setPointerCapture(event.pointerId)
    gesture.current = {
      id: spot.id,
      mode,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      from: placeOf(spot),
      unit: box.width / room.width,
      room,
      moved: false,
    }
  }

  function follow(event: PointerEvent<HTMLElement>) {
    const now = gesture.current
    if (now === null || now.pointerId !== event.pointerId) return
    const dxPx = event.clientX - now.startX
    const dyPx = event.clientY - now.startY
    if (!now.moved && Math.hypot(dxPx, dyPx) < DRAG_FROM_PX) return
    now.moved = true
    const dx = dxPx / now.unit
    const dy = dyPx / now.unit
    const place =
      now.mode === 'move'
        ? movePlace(now.from, dx, dy, now.room)
        : resizePlace(now.from, dx, dy, now.room)
    setLive({ id: now.id, place })
  }

  function end(event: PointerEvent<HTMLElement>) {
    const now = gesture.current
    if (now === null || now.pointerId !== event.pointerId) return
    gesture.current = null
    if (!now.moved) return
    dragged.current = now.id
    const shown = liveRef.current
    setLive(null)
    if (shown !== null && shown.id === now.id && !same(shown.place, now.from)) {
      onCommit(now.id, shown.place, now.from)
    }
  }

  function cancel(event: PointerEvent<HTMLElement>) {
    if (gesture.current?.pointerId !== event.pointerId) return
    gesture.current = null
    setLive(null)
  }

  function nudge(event: KeyboardEvent<HTMLElement>, spot: CanvasSpot) {
    const step = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[
      event.key
    ]
    if (!can || step === undefined) return
    event.preventDefault()
    const [dx = 0, dy = 0] = step
    const at = placeOf(spot)
    const place = event.shiftKey ? resizePlace(at, dx, dy, room) : movePlace(at, dx, dy, room)
    const pending = keys.current
    const from = pending?.id === spot.id ? pending.from : spot.place
    if (pending !== null) window.clearTimeout(pending.timer)
    setLive({ id: spot.id, place })
    const timer = window.setTimeout(() => {
      keys.current = null
      setLive(null)
      if (!same(place, from)) onCommit(spot.id, place, from)
    }, KEYS_REST_MS)
    keys.current = { id: spot.id, from, timer }
  }

  const chosen = spots.find((spot) => spot.id === selected) ?? null
  const chosenPlace = chosen === null ? null : placeOf(chosen)
  const ratio = room.width / room.height

  return (
    <div className="grid grid-cols-1 gap-2">
      <section
        ref={frame}
        className="relative mx-auto w-full overflow-hidden rounded-lg border bg-muted/40"
        style={{
          aspectRatio: `${room.width} / ${room.height}`,
          maxWidth: `calc(${MAX_HEIGHT_VH}vh * ${ratio.toFixed(4)})`,
        }}
        aria-label={t('pe_canvas')}
        data-testid="pe-canvas"
      >
        {spots.map((spot) => {
          const place = placeOf(spot)
          const style = placeStyle(place, room)
          const look = cn(
            'absolute flex min-w-0 items-center justify-center gap-1 overflow-hidden border-2 border-foreground/30 bg-card px-1 text-center text-xs leading-tight font-medium text-foreground',
            cornerClassOf(place.shape),
            spot.id === selected && 'border-primary ring-2 ring-primary/30',
          )
          const inside = (
            <>
              <KindSymbol symbol={spot.symbol} className="size-3.5" />
              <span className="truncate">{spot.name}</span>
            </>
          )
          if (!can) {
            return (
              <div
                key={spot.id}
                style={style}
                className={look}
                title={spot.label}
                data-testid="pe-spot"
                data-spot={spot.id}
              >
                {inside}
              </div>
            )
          }
          return (
            <button
              key={spot.id}
              type="button"
              style={style}
              className={cn(
                look,
                'cursor-grab touch-none select-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring active:cursor-grabbing',
              )}
              aria-label={spot.label}
              aria-describedby="pe-canvas-keys"
              title={spot.label}
              data-testid="pe-spot"
              data-spot={spot.id}
              data-x={place.x}
              data-y={place.y}
              data-w={place.width}
              data-h={place.height}
              onPointerDown={(event) => begin(event, spot, 'move')}
              onPointerMove={follow}
              onPointerUp={end}
              onPointerCancel={cancel}
              onKeyDown={(event) => nudge(event, spot)}
              onClick={() => {
                if (dragged.current === spot.id) {
                  dragged.current = null
                  return
                }
                onOpen(spot.id)
              }}
            >
              {inside}
            </button>
          )
        })}
        {can && chosen !== null && chosenPlace !== null && chosenPlace.rotation === 0 ? (
          // The chosen spot's corner: drag it to resize. A pointer's handle only — the keys and the
          // sheet's fields do the same (2.1.1, 2.5.7) — so it is hidden from the reading order.
          <div
            aria-hidden
            className="absolute z-10 size-4 -translate-x-1/2 -translate-y-1/2 cursor-nwse-resize touch-none rounded-sm border-2 border-primary bg-background after:absolute after:-inset-3 after:content-['']"
            style={{
              left: `${(((chosenPlace.x + chosenPlace.width - room.x) / room.width) * 100).toFixed(4)}%`,
              top: `${(((chosenPlace.y + chosenPlace.height - room.y) / room.height) * 100).toFixed(4)}%`,
            }}
            data-testid="pe-resize"
            onPointerDown={(event) => begin(event, chosen, 'resize')}
            onPointerMove={follow}
            onPointerUp={end}
            onPointerCancel={cancel}
          />
        ) : null}
        {spots.length === 0 ? (
          <p className="absolute inset-0 flex items-center justify-center p-4 text-center text-sm text-muted-foreground">
            {can ? t('pe_canvas_empty') : t('pe_canvas_empty_ro')}
          </p>
        ) : null}
      </section>
      {can && spots.length > 0 ? (
        <p id="pe-canvas-keys" className="text-sm text-muted-foreground">
          {t('pe_canvas_keys')}
        </p>
      ) : null}
    </div>
  )
}
