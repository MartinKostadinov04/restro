'use client'

// One frame of the Design page, as the page sees it (D129, RR-87): an iframe laid out at `width` and
// scaled down to fit the box it sits in, never up. `content` is handed to the frame's page through
// its store (`preview-frames.ts`). With `picture`, it is a picture and not a control (a Style tile):
// nothing in it can be focused, clicked or read twice. Until the frame's page has loaded, the box
// shows a placeholder, with `loading` written on it when given (the live preview). A frame that draws
// one part (D159) tells its height through `onHeight`; the box around it sets the frame's height.
import { useTranslations } from 'next-intl'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'

import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'

import { type FrameContent, framePath, openFrameStore } from './preview-frames'

/** What stands in a frame's place while the draft or the frame's page is on its way. */
export function PreviewLoading({ label }: { label: string }) {
  return (
    <div
      role="status"
      className="absolute inset-0 grid place-items-center"
      data-testid="design-preview-loading"
    >
      <Skeleton className="absolute inset-0 rounded-none" />
      <p className="relative text-sm text-muted-foreground">{label}</p>
    </div>
  )
}

/** The quiet placeholder of a tile's picture while it is drawn: a word, no announcement. */
export function TileLoading() {
  const t = useTranslations('design.preview')
  return (
    <div
      aria-hidden
      className="absolute inset-0 grid place-items-center"
      data-testid="design-tile-loading"
    >
      <Skeleton className="absolute inset-0 rounded-none" />
      <p className="relative text-xs text-muted-foreground">{t('tileLoading')}</p>
    </div>
  )
}

export function ScaledFrame({
  venueId,
  slot,
  width,
  title,
  content,
  picture = false,
  className,
  testId,
  onPart,
  onHeight,
  loading,
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
  /** A tap on a marked part of the frame (`data-design-part`), by its name and what the tap opens. */
  onPart?: (marker: string, opens: string | null) => void
  /** The height of what the frame draws, at `width`, each time it changes (a specimen's part). */
  onHeight?: (height: number) => void
  /** What the placeholder says while the frame loads; a picture's placeholder says nothing. */
  loading?: string
}) {
  const box = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState<{ width: number; height: number } | null>(null)
  // The page the frame has loaded: a new address shows the placeholder until it has loaded too.
  const src = framePath(venueId, slot)
  const [loadedSrc, setLoadedSrc] = useState<string | null>(null)
  const loaded = loadedSrc === src
  const store = useRef<ReturnType<typeof openFrameStore> | null>(null)
  const latest = useRef(content)
  latest.current = content
  const tapped = useRef(onPart)
  tapped.current = onPart
  const sized = useRef(onHeight)
  sized.current = onHeight

  // Before the frame is put in, so its page always finds its store.
  useLayoutEffect(() => {
    const opened = openFrameStore(
      slot,
      (marker, opens) => tapped.current?.(marker, opens),
      (height) => sized.current?.(height),
    )
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
          src={src}
          title={title}
          tabIndex={picture ? -1 : undefined}
          scrolling={picture ? 'no' : undefined}
          loading={picture ? 'lazy' : undefined}
          data-testid={testId}
          onLoad={() => setLoadedSrc(src)}
          className="absolute top-0 origin-top-left border-0"
          style={{
            left: Math.max(0, (size.width - width * scale) / 2),
            width,
            height: size.height / scale,
            transform: scale === 1 ? undefined : `scale(${scale})`,
          }}
        />
      )}
      {loaded ? null : loading === undefined ? <TileLoading /> : <PreviewLoading label={loading} />}
    </div>
  )
}
