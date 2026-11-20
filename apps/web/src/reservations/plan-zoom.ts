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
//
// The scale is drawn as the room's **width** (`roomStyle`), not as a CSS `scale()`: a spot's name,
// its border and its symbol stay their own size at any zoom, so a spot drawn 44 px wide shows its
// name in 12 px type instead of a sliver of a 100 px letter (S7 of the 11-18 screen round).
//
// On a phone or any touch screen the plan opens at the zoom where its smallest spot is a 44 px
// target (Restro's floor, D123; S17), centred on the first spot in the venue's order (or the
// room's start, where that spot is in a corner). «Покажи целия план» still shows the whole room.
import {
  type CSSProperties,
  type KeyboardEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react'

/** The smallest and largest the plan is drawn at, and the step each tap or key takes. */
export const PLAN_ZOOM_MIN = 0.6
// Large enough that a bar stool of a 118-spot club (72 grid units in a room 4,882 wide) reaches
// 44 px on a 390 px phone: 8.3 times the whole room.
export const PLAN_ZOOM_MAX = 10
/** Restro's touch floor (D123): the side a spot is drawn at when the plan opens on a phone. */
export const PLAN_TOUCH_FLOOR_PX = 44
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

/** A phone, or any touch screen: the `phone` variant of globals.css. */
const TOUCH_QUERY = '(width < 48rem), (pointer: coarse)'

/** Elements a pointer drags on their own (the editor's spots): pressing one never pans the plan. */
export const PLAN_GRAB = 'data-plan-grab'

/**
 * The room as drawn at a view: its width is the frame's times the scale, and it is moved by the
 * view's offset. Its height follows from the room's own proportions (`aspectRatio`).
 */
export function roomStyle(view: PlanView, room: { width: number; height: number }): CSSProperties {
  return {
    width: `${(view.scale * 100).toFixed(4)}%`,
    aspectRatio: `${room.width} / ${room.height}`,
    transform: `translate(${view.x}px, ${view.y}px)`,
  }
}

/**
 * The scale at which the smallest of these spots is drawn `floor` px on its shorter side, in a
 * frame `frameWidth` px wide showing a room `roomWidth` grid units wide. Never below the whole room
 * (1) and never past `PLAN_ZOOM_MAX`: a spot too small even then is drawn as large as the plan
 * goes.
 */
export function openingScale(
  smallestSide: number,
  roomWidth: number,
  frameWidth: number,
  floor = PLAN_TOUCH_FLOOR_PX,
): number {
  if (smallestSide <= 0 || roomWidth <= 0 || frameWidth <= 0) return 1
  const atFit = (smallestSide / roomWidth) * frameWidth
  // Half a pixel over the floor, so rounding in the browser never draws a spot at 43.99 px.
  return clamp((floor + 0.5) / atFit, 1, PLAN_ZOOM_MAX)
}

/** A box in the plan's grid units: the room, or one spot. */
interface GridBox {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

/** How a plan opens: its smallest spot's shorter side, its room, and the spot it opens on. */
export interface PlanOpening {
  /** Changes when another plan is drawn: the view opens again for it, and only then. */
  readonly key: string
  readonly smallestSide: number
  readonly room: GridBox
  /** The middle of the first spot in the venue's order, in grid units. */
  readonly first: { readonly x: number; readonly y: number }
}

/**
 * The opening facts of a list of spots (in the venue's order, S5), or null when there is nothing
 * to open on.
 */
export function planOpening(
  key: string,
  places: readonly GridBox[],
  room: GridBox,
): PlanOpening | null {
  const [head] = places
  if (head === undefined) return null
  const smallestSide = Math.min(...places.map((place) => Math.min(place.width, place.height)))
  return {
    key,
    smallestSide,
    room: { x: room.x, y: room.y, width: room.width, height: room.height },
    first: { x: head.x + head.width / 2, y: head.y + head.height / 2 },
  }
}

/**
 * The view a plan opens at on a touch screen: the zoom where its smallest spot is a 44 px target,
 * with the first spot in the middle of the frame. The room is kept against the frame's edges, so
 * a first spot in a corner opens with the room's start there, never with empty space beside it.
 */
export function openingView(
  opening: PlanOpening,
  frame: { readonly width: number; readonly height: number },
): PlanView {
  const { room } = opening
  const scale = openingScale(opening.smallestSide, room.width, frame.width)
  if (room.width <= 0) return { scale, x: 0, y: 0 }
  const unit = (frame.width * scale) / room.width
  const drawn = { width: room.width * unit, height: room.height * unit }
  const centre = (at: number, start: number, side: number, span: number) =>
    clamp(side / 2 - (at - start) * unit, Math.min(0, side - span), 0)
  return {
    scale,
    x: centre(opening.first.x, room.x, frame.width, drawn.width),
    y: centre(opening.first.y, room.y, frame.height, drawn.height),
  }
}

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
 * The plan's view, with every way of changing it. `frame` is the element the plan is drawn in (held
 * in state through a callback ref, so a frame drawn again after a skeleton is followed too): the
 * hook puts its own wheel and pointer listeners on it, because a wheel that zooms must be able to
 * refuse the page's own scroll, which React's own `onWheel` cannot do.
 */
export function usePlanView(frame: HTMLElement | null, opening: PlanOpening | null = null) {
  const [view, setView] = useState<PlanView>(FIT)
  const viewRef = useRef(view)
  viewRef.current = view
  /** The frame's size in pixels, so a spot's drawn size is known (its label shows when it fits). */
  const [frameSize, setFrameSize] = useState({ width: 0, height: 0 })
  /** The plan the view last opened on: a re-read of the same plan never moves it. */
  const openedFor = useRef<string | null>(null)
  /** The pointers on the plan right now, so two of them read as a pinch. */
  const pointers = useRef(new Map<number, { x: number; y: number }>())
  const pinch = useRef<{ gap: number; scale: number } | null>(null)
  /** How far the pointer has travelled since it went down: a drag must not open a spot. */
  const moved = useRef(0)

  const sizeOf = useCallback(() => {
    const box = frame?.getBoundingClientRect()
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

  // The frame's width, followed as the screen turns or the sheet around it grows.
  useEffect(() => {
    const element = frame
    if (element === null) return
    const box = element.getBoundingClientRect()
    setFrameSize({ width: box.width, height: box.height })
    if (typeof ResizeObserver === 'undefined') return
    const watch = new ResizeObserver(([entry]) => {
      if (entry !== undefined) {
        setFrameSize({ width: entry.contentRect.width, height: entry.contentRect.height })
      }
    })
    watch.observe(element)
    return () => watch.disconnect()
  }, [frame])

  // A plan opens once per plan: on a touch screen at the zoom where its smallest spot is a 44 px
  // target, on its first spot (`openingView`); elsewhere whole.
  const frameWidth = frameSize.width
  const openingRef = useRef(opening)
  openingRef.current = opening
  const openKey = opening?.key ?? null
  useEffect(() => {
    const now = openingRef.current
    if (now === null || openKey === null || frameSize.width <= 0 || openedFor.current === openKey)
      return
    openedFor.current = openKey
    const touch = typeof window.matchMedia === 'function' && window.matchMedia(TOUCH_QUERY).matches
    setView(touch ? openingView(now, frameSize) : FIT)
  }, [frameSize, openKey])

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
    const element = frame
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
      // A spot the editor drags is its own gesture: the plan stays where it is under it.
      if (event.target instanceof Element && event.target.closest(`[${PLAN_GRAB}]`) !== null) {
        return
      }
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

  return { view, frameWidth, zoomIn, zoomOut, fit, onKeyDown, dragged }
}
