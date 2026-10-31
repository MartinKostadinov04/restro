'use client'

// One frame of the Design page, as the page sees it (D129, RR-87): an iframe laid out at `width` and
// scaled down to fit the box it sits in, never up. `content` is handed to the frame's page through
// its store (`preview-frames.ts`). With `picture`, it is a picture and not a control (a Style tile):
// nothing in it can be focused, clicked or read twice.
import { useEffect, useLayoutEffect, useRef, useState } from 'react'

import { cn } from '@/lib/utils'

import { type FrameContent, framePath, openFrameStore } from './preview-frames'

export function ScaledFrame({
  venueId,
  slot,
  width,
  title,
  content,
  picture = false,
  className,
  testId,
}: {
  venueId: string
  /** The frame's name on this page. */
  slot: string
  /** The width the renderer lays out at. */
  width: number
  title: string
  content: FrameContent | null
  picture?: boolean
  className?: string
  testId?: string
}) {
  const box = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState<{ width: number; height: number } | null>(null)
  const store = useRef<ReturnType<typeof openFrameStore> | null>(null)
  const latest = useRef(content)
  latest.current = content

  // Before the frame is put in, so its page always finds its store.
  useLayoutEffect(() => {
    const opened = openFrameStore(slot)
    opened.set(latest.current)
    store.current = opened
    return () => {
      store.current = null
      opened.close()
    }
  }, [slot])

  useEffect(() => {
    store.current?.set(content)
  }, [content])

  useLayoutEffect(() => {
    const element = box.current
    if (element === null) return undefined
    const measure = () => {
      const next = { width: element.clientWidth, height: element.clientHeight }
      setSize((previous) =>
        previous?.width === next.width && previous.height === next.height ? previous : next,
      )
    }
    measure()
    if (typeof ResizeObserver === 'undefined') return undefined
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  const scale = size !== null && size.width > 0 ? Math.min(1, size.width / width) : 1

  return (
    <div
      ref={box}
      className={cn(
        'relative size-full overflow-hidden',
        picture && 'pointer-events-none',
        className,
      )}
      inert={picture}
      aria-hidden={picture ? true : undefined}
    >
      {size === null ? null : (
        <iframe
          src={framePath(venueId, slot)}
          title={title}
          tabIndex={picture ? -1 : undefined}
          scrolling={picture ? 'no' : undefined}
          loading={picture ? 'lazy' : undefined}
          data-testid={testId}
          className="absolute top-0 origin-top-left border-0"
          style={{
            left: Math.max(0, (size.width - width * scale) / 2),
            width,
            height: size.height / scale,
            transform: scale === 1 ? undefined : `scale(${scale})`,
          }}
        />
      )}
    </div>
  )
}
