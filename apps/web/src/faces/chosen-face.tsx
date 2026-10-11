'use client'

// Draws the template a venue chose, loading it on first use. The guest page and the previews both
// render through this: they pick an entry from the registry (`faceEntry`), build the view model
// with that entry's manifest, and hand the entry and the host props here. The face's code is a
// separate chunk (the registry's `load` is a dynamic import), so a guest downloads one template.
//
// While the chunk is on its way the host's loading skeleton shows. If it cannot be fetched (the
// phone lost its connection) or the face fails while drawing, a short notice offers another try
// instead of an error page; the next try loads the chunk again.

import { localeToBcp47 } from '@restro/core'
import { QrPhoneNotice, QrPhoneSkeleton } from '@restro/qr-phone/notices'
import type { FaceHostProps } from '@restro/shell'
import {
  Component,
  type ComponentType,
  type LazyExoticComponent,
  lazy,
  type ReactNode,
  Suspense,
  useState,
} from 'react'

import type { FaceEntry } from './registry'

/** The words the loading and failure states need, from the shell's guest strings. */
export interface ChosenFaceStrings {
  readonly loading: string
  readonly loadFailedTitle: string
  readonly loadFailedText: string
  readonly retry: string
}

/** One lazy component per template, made once: React keeps what it loaded with the component. */
const lazyFaces = new Map<string, LazyExoticComponent<ComponentType<FaceHostProps>>>()

function lazyFace(entry: FaceEntry): LazyExoticComponent<ComponentType<FaceHostProps>> {
  let component = lazyFaces.get(entry.id)
  if (component === undefined) {
    component = lazy(async () => ({ default: await entry.load() }))
    lazyFaces.set(entry.id, component)
  }
  return component
}

/**
 * Starts loading a template's code without drawing it, so the chunk arrives while the menu's own
 * files are still on their way. Never throws: a failure here shows up when the face is drawn.
 */
export function preloadFace(entry: FaceEntry): void {
  entry.load().catch(() => {})
}

/** Catches a chunk that did not load (or a face that threw) and shows `failed` instead. */
class LoadBoundary extends Component<
  { readonly children: ReactNode; readonly failed: ReactNode },
  { readonly error: boolean }
> {
  override state = { error: false }

  static getDerivedStateFromError() {
    return { error: true }
  }

  override render() {
    return this.state.error ? this.props.failed : this.props.children
  }
}

export function ChosenFace({
  entry,
  strings,
  ...host
}: FaceHostProps & { readonly entry: FaceEntry; readonly strings: ChosenFaceStrings }) {
  // Another try drops the lazy component that failed and gives the boundary a new key, so React
  // asks for the chunk again.
  const [attempt, setAttempt] = useState(0)
  const Face = lazyFace(entry)
  const lang = localeToBcp47(host.view.locale)
  return (
    <LoadBoundary
      key={`${entry.id}:${attempt}`}
      failed={
        <QrPhoneNotice
          title={strings.loadFailedTitle}
          text={strings.loadFailedText}
          lang={lang}
          actionLabel={strings.retry}
          onAction={() => {
            lazyFaces.delete(entry.id)
            setAttempt((n) => n + 1)
          }}
        />
      }
    >
      <Suspense fallback={<QrPhoneSkeleton label={strings.loading} lang={lang} />}>
        <Face {...host} />
      </Suspense>
    </LoadBoundary>
  )
}
