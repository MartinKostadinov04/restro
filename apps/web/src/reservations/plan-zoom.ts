'use client'

// Moving and zooming the floor plan (#327; screen plan §2: "zoom 0 + keyboard").
//
// Three ways in, all of them the same two numbers — a scale and an offset in pixels:
//   • pinch on a phone, wheel on a desk (Ctrl-wheel and a trackpad pinch zoom, a plain wheel
//     moves), and dragging with a finger or the mouse;
//   • the −, + and "fit" buttons, which is the alternative every dragging gesture must have
//     (WCAG 2.2 AA, 2.5.7);
//   • the keyboard on the plan itself: arrows move, + and − zoom, 0 fits (2.1.1). Tab still walks
//     the spots themselves, because each one is a button.
//
// The view is held in one state object, so a gesture never writes two states that could be drawn
// apart. Nothing here reads the database or the plan's data: it is pixels and a scale.
import { type KeyboardEvent, type RefObject, useCallback, useEffect, useRef, useState } from 'react'

/** The smallest and largest the plan is drawn at, and the step each tap or key takes. */
export const PLAN_ZOOM_MIN = 0.6
export const PLAN_ZOOM_MAX = 6
const ZOOM_STEP = 1.25
/** How far one arrow key moves the plan, in pixels of the frame. */
const KEY_PAN_PX = 48

/** What the plan is drawn at: a scale, and where its top-left corner sits in the frame. */
export interface PlanView {
  readonly scale: number
  readonly x: number
  readonly y: number
}

const FIT: PlanView = { scale: 1, x: 0, y: 0 }

const clamp = (value: number, least: number, most: number) =>
  value < least ? least : value > most ? most : value

/** The view scaled about one point of the frame, so what was under the fingers stays there. */
export function zoomAbout(view: PlanView, factor: number, at: { x: number; y: number }): PlanView {
  const scale = clamp(view.scale * factor, PLAN_ZOOM_MIN, PLAN_ZOOM_MAX)
  const real = scale / view.scale
  return { scale, x: at.x - (at.x - view.x) * real, y: at.y - (at.y - view.y) * real }
}

/** Keeps the plan from being pushed out of its frame: a corner may reach the middle, no further. */
export function holdInFrame(view: PlanView, frame: { width: number; height: number }): PlanView {
  const half = { x: frame.width / 2, y: frame.height / 2 }
  const span = { x: frame.width * view.scale, y: frame.height * view.scale }
  return {
    scale: view.scale,
    x: clamp(view.x, half.x - span.x, half.x),
    y: clamp(view.y, half.y - span.y, half.y),
  }
}

/** Two points' distance and middle, for a pinch. */
function pinchOf(points: readonly { x: number; y: number }[]) {
  const [first, second] = points
  if (first === undefined || second === undefined) return null
  const gap = Math.hypot(second.x - first.x, second.y - first.y)
  return { gap, middle: { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 } }
}

/**
 * The plan's view, with every way of changing it. `frame` is the element the plan is drawn in: the
 * hook puts its own wheel and pointer listeners on it, because a wheel that zooms must be able to
 * refuse the page's own scroll, which React's own `onWheel` cannot do.
 */
export function usePlanView(frame: RefObject<HTMLElement | null>) {
  const [view, setView] = useState<PlanView>(FIT)
  const viewRef = useRef(view)
  viewRef.current = view
  /** The pointers on the plan right now, so two of them read as a pinch. */
  const pointers = useRef(new Map<number, { x: number; y: number }>())
  const pinch = useRef<{ gap: number; scale: number } | null>(null)
  /** How far the pointer has travelled since it went down: a drag must not open a spot. */
  const moved = useRef(0)

  const sizeOf = useCallback(() => {
    const box = frame.current?.getBoundingClientRect()
    return { width: box?.width ?? 1, height: box?.height ?? 1 }
  }, [frame])

  const change = useCallback(
    (next: (view: PlanView) => PlanView) => {
      setView((before) => holdInFrame(next(before), sizeOf()))
    },
    [sizeOf],
  )

  const middle = useCallback(() => {
    const size = sizeOf()
    return { x: size.width / 2, y: size.height / 2 }
  }, [sizeOf])

  const zoomIn = useCallback(() => {
    change((before) => zoomAbout(before, ZOOM_STEP, middle()))
  }, [change, middle])
  const zoomOut = useCallback(() => {
    change((before) => zoomAbout(before, 1 / ZOOM_STEP, middle()))
  }, [change, middle])
  const fit = useCallback(() => {
    setView(FIT)
  }, [])
  const move = useCallback(
    (by: { x: number; y: number }) => {
      change((before) => ({ scale: before.scale, x: before.x + by.x, y: before.y + by.y }))
    },
    [change],
  )

  /** True while the last gesture was a drag, so the tap that ends it opens nothing. */
  const dragged = useCallback(() => moved.current > 8, [])

  const onKeyDown = useCallback(
    (event: KeyboardEvent) => {
      const step = event.shiftKey ? KEY_PAN_PX * 3 : KEY_PAN_PX
      switch (event.key) {
        case 'ArrowLeft':
          move({ x: step, y: 0 })
          break
        case 'ArrowRight':
          move({ x: -step, y: 0 })
          break
        case 'ArrowUp':
          move({ x: 0, y: step })
          break
        case 'ArrowDown':
          move({ x: 0, y: -step })
          break
        case '+':
        case '=':
          zoomIn()
          break
        case '-':
        case '_':
          zoomOut()
          break
        case '0':
          fit()
          break
        default:
          return
      }
      // Only the keys the plan uses: everything else, Tab above all, stays the page's.
      event.preventDefault()
    },
    [fit, move, zoomIn, zoomOut],
  )

  // The wheel and the pointers, as native listeners: `passive: false` is what lets a pinch zoom
  // the plan instead of the page.
  useEffect(() => {
    const element = frame.current
    if (element === null) return

    const pointOf = (event: { clientX: number; clientY: number }) => {
      const box = element.getBoundingClientRect()
      return { x: event.clientX - box.left, y: event.clientY - box.top }
    }

    const onWheel = (event: WheelEvent) => {
      event.preventDefault()
      // A trackpad pinch arrives as a wheel with Ctrl held; a plain wheel moves the plan.
      if (event.ctrlKey || event.metaKey) {
        const factor = Math.exp(-event.deltaY / 200)
        change((before) => zoomAbout(before, factor, pointOf(event)))
        return
      }
      change((before) => ({
        scale: before.scale,
        x: before.x - event.deltaX,
        y: before.y - event.deltaY,
      }))
    }

    const onPointerDown = (event: PointerEvent) => {
      pointers.current.set(event.pointerId, pointOf(event))
      moved.current = 0
      if (pointers.current.size === 2) {
        const two = pinchOf([...pointers.current.values()])
        pinch.current = two === null ? null : { gap: two.gap, scale: viewRef.current.scale }
      }
    }

    const onPointerMove = (event: PointerEvent) => {
      const before = pointers.current.get(event.pointerId)
      if (before === undefined) return
      const now = pointOf(event)
      pointers.current.set(event.pointerId, now)
      moved.current += Math.hypot(now.x - before.x, now.y - before.y)
      if (pointers.current.size >= 2) {
        const two = pinchOf([...pointers.current.values()])
        const start = pinch.current
        if (two === null || start === null || start.gap === 0) return
        const wanted = (start.scale * two.gap) / start.gap
        change((current) => zoomAbout(current, wanted / current.scale, two.middle))
        return
      }
      change((current) => ({
        scale: current.scale,
        x: current.x + (now.x - before.x),
        y: current.y + (now.y - before.y),
      }))
    }

    const onPointerUp = (event: PointerEvent) => {
      pointers.current.delete(event.pointerId)
      if (pointers.current.size < 2) pinch.current = null
    }

    element.addEventListener('wheel', onWheel, { passive: false })
    element.addEventListener('pointerdown', onPointerDown)
    element.addEventListener('pointermove', onPointerMove)
    element.addEventListener('pointerup', onPointerUp)
    element.addEventListener('pointercancel', onPointerUp)
    element.addEventListener('pointerleave', onPointerUp)
    return () => {
      element.removeEventListener('wheel', onWheel)
      element.removeEventListener('pointerdown', onPointerDown)
      element.removeEventListener('pointermove', onPointerMove)
      element.removeEventListener('pointerup', onPointerUp)
      element.removeEventListener('pointercancel', onPointerUp)
      element.removeEventListener('pointerleave', onPointerUp)
    }
  }, [change, frame])

  return { view, zoomIn, zoomOut, fit, onKeyDown, dragged }
}
