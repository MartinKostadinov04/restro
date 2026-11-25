'use client'

// The page inside a Design page's frame (D129, RR-87): the real renderer, on a document of its own,
// drawing what the Design page holds for this frame (`preview-frames.ts`). It reads no data of its
// own: with no Design page around it, it is empty.
//
// Two kinds of frame:
//   - the live preview draws the whole menu. A tap on a marked part (`data-design-part`) tells the
//     Design page which part it was, so the page opens the page that owns it; the renderer still
//     gets the tap (the dish opens, a sheet opens), as for a guest. While a page of the panel is
//     open, the preview shows that page's part at its stage: the frame opens the dish or the sheet
//     by tapping the renderer's own controls, as a person would, and closes it again when the stage
//     is taken away (`frame-stage.ts`). The demo host behind the sheets is the preview's.
//   - a tile of an option (D159) draws one part alone (`content.specimen`): the face's specimen view,
//     no menu around it and no stage, and it tells the Design page the part's height so the tile is
//     as tall as the part (0: it drew nothing). Only a sheet's body binds the demo host.
import {
  EditorialSpecimen,
  type EditorialSpecimenProps,
  type SpecimenPart,
  specimenNeedsHost,
  useDemoServices,
} from '@restro/editorial-market/preview'
import {
  Component,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react'

import { faceEntry } from '@/faces/registry'
import { FONT_STACKS } from '@/fonts'
import { DraftFace, previewLocaleOf, previewViewOf } from '@/publish/draft-face'
import { useAdminLocale } from '@/publish/names'

import type { Stage } from './advanced-model'
import {
  closeStage,
  drive,
  holdScroll,
  keepFocusOut,
  keepHistoryInside,
  stagePressing,
} from './frame-stage'
import { type FrameContent, frameStoreOf } from './preview-frames'

const nothing = (): FrameContent | null => null

/**
 * The marked part a tap landed on (the innermost), and the part the tap opens: the control that
 * opens a dish (`item.open`) opens the Dish page's part. The parts around it (the dish's section)
 * are not the tap's.
 */
export function partOf(target: Element): { part: string; opens: string | null } | null {
  const marked = target.closest<HTMLElement>('[data-design-part]')
  let part = marked?.dataset.designPart
  if (marked === null || part === undefined) return null
  // The dish shown as a sheet sits in the renderer's sheet panel (marked `sheet`), with its close
  // button outside the dish's own part: a tap anywhere in it is the dish's, not the sheets'.
  if (part === 'sheet' && marked.querySelector('[data-design-part="dish"]') !== null) part = 'dish'
  return { part, opens: target.closest('[data-slot="item.open"]') !== null ? 'dish' : null }
}

/**
 * Reaches the frame's stage, once per stage and focus: a change of value redraws the same frame. A
 * frame with a stage keeps `focus()` from scrolling (a tile never scrolls the panel it sits in)
 * while the stage lasts. Another stage first closes the dish or sheet the last one opened, so the new
 * one starts from the menu and does not take the old dialog for its own. A frame whose stage is taken
 * away goes back to the menu the same way. It runs again when the frame's services come on (the
 * Design page turns them on when a service part opens), since a sheet's controls are drawn only then.
 */
export function useStage(
  ready: boolean,
  stage: Stage | undefined,
  focus: string,
  services = false,
): void {
  const staged = useRef<Stage | undefined>(undefined)
  // biome-ignore lint/correctness/useExhaustiveDependencies: `services` is read by the renderer, not here: the stage is driven again once the sheets' controls are drawn
  useEffect(() => {
    if (!ready) return undefined
    if (staged.current !== undefined && staged.current !== stage) closeStage()
    staged.current = stage
    const release = stage === undefined ? undefined : holdScroll(window)
    const stop = drive(stage ?? 'menu', focus === '' ? [] : focus.split(' '))
    return () => {
      stop()
      release?.()
    }
  }, [ready, stage, focus, services])
}

/**
 * A phone's scrollbar lies over the page and takes no width: the same here, on any computer. A frame
 * is a page of its own, so in development Next.js draws its badge in each one, over the picture;
 * the frames hide it (the Design page keeps its own).
 */
const FRAME_CSS =
  'html{scrollbar-width:none}html::-webkit-scrollbar{display:none}nextjs-portal{display:none!important}'

/**
 * A part that cannot be drawn (its view model refused, its code threw) draws nothing, not the app's
 * error page inside a tile, and tells the tile so: the tile keeps its placeholder, its value word and
 * its radio. It tries again when `content` changes (another value, a new draft).
 */
class QuietBoundary extends Component<
  {
    readonly content: FrameContent
    readonly onFailed: () => void
    readonly children: ReactNode
  },
  { readonly failed: boolean; readonly content: FrameContent }
> {
  override state = { failed: false, content: this.props.content }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  /** New content (another value, a new draft) is drawn afresh. */
  static getDerivedStateFromProps(
    props: { readonly content: FrameContent },
    state: { readonly content: FrameContent },
  ) {
    return props.content === state.content ? null : { failed: false, content: props.content }
  }

  override componentDidCatch() {
    this.props.onFailed()
  }

  override render() {
    return this.state.failed ? null : this.props.children
  }
}

/**
 * One part of the guest page alone (D159), from the content the Design page holds for the frame:
 * copied into the frame's own window, its view model built as the preview's (`previewViewOf`) and
 * drawn by the face's specimen view, all inside the boundary.
 */
export function SpecimenFrame({
  shared,
  onHeight,
}: {
  /** The content as the Design page holds it: made in the page's window, copied here. */
  shared: FrameContent
  onHeight: (height: number) => void
}) {
  return (
    <QuietBoundary content={shared} onFailed={() => onHeight(0)}>
      <SpecimenOf shared={shared} onHeight={onHeight} />
    </QuietBoundary>
  )
}

function SpecimenOf({
  shared,
  onHeight,
}: {
  shared: FrameContent
  onHeight: (height: number) => void
}) {
  // The objects were made in the page's window: the frame draws its own copy.
  const content = useMemo(() => structuredClone(shared), [shared])
  const part: SpecimenPart | undefined = content.specimen
  const { snapshot, overlay, services } = content
  const adminLocale = useAdminLocale()
  // The clock is fixed when the frame opens, so the picture does not shift while it is looked at.
  const [now] = useState(() => new Date())
  const view = useMemo(
    () =>
      previewViewOf({
        snapshot,
        overlay,
        locale: previewLocaleOf(snapshot, adminLocale),
        now,
        manifest: faceEntry(undefined).manifest,
        services,
      }),
    [snapshot, overlay, adminLocale, now, services],
  )
  if (part === undefined) return null
  const props: EditorialSpecimenProps = {
    view,
    part,
    onHeight,
    assetBase: content.assetBase,
    languages: snapshot.locales.available,
    fontStacks: FONT_STACKS,
    scheme: content.scheme,
  }
  return specimenNeedsHost(part) ? <HostedSpecimen {...props} /> : <EditorialSpecimen {...props} />
}

/** The specimen with the demo host bound; its own component, so the host is loaded only here. */
function HostedSpecimen(props: EditorialSpecimenProps) {
  const services = useDemoServices(props.view)
  return <EditorialSpecimen {...props} services={services} />
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
  // A part alone is copied inside its boundary (`SpecimenFrame`); the menu is copied here.
  const specimen = shared !== null && shared.specimen !== undefined
  const content = useMemo(
    () => (shared === null || specimen ? null : structuredClone(shared)),
    [shared, specimen],
  )

  // A tap on a marked part names the part to the Design page, with what the tap opens. Captured
  // before the renderer's own handler, which still runs. The stage's own presses are not taps.
  useEffect(() => {
    const tapped = (event: MouseEvent) => {
      if (stagePressing()) return
      const target = event.target instanceof Element ? event.target : null
      const tap = target === null ? null : partOf(target)
      if (tap !== null) frameStoreOf(slot)?.tap(tap.part, tap.opens)
    }
    document.addEventListener('click', tapped, true)
    return () => document.removeEventListener('click', tapped, true)
  }, [slot])

  useEffect(() => keepHistoryInside(window), [])
  // Before the stage's own hold on `focus()`, so the hold wraps it.
  useEffect(() => keepFocusOut(window), [])
  // A specimen is a part alone: there is no menu to drive to a stage.
  useStage(
    content !== null,
    content?.stage,
    content?.focus?.join(' ') ?? '',
    content?.services ?? false,
  )
  const tellHeight = useCallback((height: number) => frameStoreOf(slot)?.size(height), [slot])

  return (
    <>
      <style>{FRAME_CSS}</style>
      {shared !== null && specimen ? (
        <SpecimenFrame shared={shared} onHeight={tellHeight} />
      ) : content === null ? null : (
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
