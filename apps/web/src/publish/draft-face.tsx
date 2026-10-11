'use client'

// The guest face drawn from a snapshot that is not published: the draft the server built in memory
// (the publisher's builder, schema and leak guard). It is the same shell and the same face the
// guest page uses (`/m/<venue>`), so what the preview shows is what the publish would put live; the
// only differences are the source of the snapshot and the frame around it. No table, no ordering.
//
// The template is the one the draft's `presentation` names (the registry's default when it names
// none). `faceId` overrides it, for a preview of a template the venue has not saved yet.
//
// `servicesPreview` (the Design tab's "Preview guest services", D71) draws the service screens the
// venue switched on as if the platform supported them, at a demo table, with the demo host of
// `@restro/editorial-market/preview` behind them: every sheet carries its "Preview" marker and
// nothing leaves the browser. The venue's own switches still decide what shows (R15); only the
// platform's part (capabilities, the table) is pretended.
import type { LiveOverlay, Locale, MenuSnapshot } from '@restro/core'
import { useDemoServices } from '@restro/editorial-market/preview'
import { buildViewModel, type FaceHostProps, stringsFor, type ViewModel } from '@restro/shell'
import { useMemo, useState } from 'react'

import { ChosenFace, type ChosenFaceStrings } from '@/faces/chosen-face'
import { type FaceEntry, faceEntry } from '@/faces/registry'
import { FONT_STACKS } from '@/fonts'
import { CDN_BASE } from '@/guest/cdn'
import { buildContext, chooseLocale } from '@/guest/context'
import { useAdminLocale } from './names'

export type PreviewScheme = 'light' | 'dark'

/** The table the services preview pretends the phone is at (never a real token). */
const PREVIEW_TABLE_TOKEN = 'preview'
/** The platform's part of R15, pretended on for the services preview. */
const PREVIEW_CAPABILITIES = { callWaiter: true, bill: true, ordering: true, pay: true } as const

export function DraftFace({
  snapshot,
  overlay,
  scheme,
  faceId,
  servicesPreview = false,
}: {
  snapshot: MenuSnapshot
  overlay: LiveOverlay
  scheme: PreviewScheme
  /** Draw this template instead of the one the snapshot names. */
  faceId?: string
  /** Show the service screens the venue switched on, with demo data. */
  servicesPreview?: boolean
}) {
  const adminLocale = useAdminLocale()
  // Starts in the admin's own language when the menu has it, as a guest's browser would.
  const [choice, setChoice] = useState<Locale | null>(null)
  const locale: Locale =
    choice ??
    chooseLocale({
      search: '',
      browser: [adminLocale],
      available: snapshot.locales.available,
      menuDefault: snapshot.locales.default,
    })
  // The clock is fixed when the preview opens, so the picture does not shift while it is looked at.
  const [now] = useState(() => new Date())
  const savedFace = snapshot.presentation?.face
  const entry = useMemo(() => faceEntry(faceId ?? savedFace), [faceId, savedFace])
  const view = useMemo(() => {
    const context = buildContext({ locale, now, tableToken: null, manifest: entry.manifest })
    return buildViewModel(
      snapshot,
      overlay,
      servicesPreview
        ? {
            ...context,
            tableToken: PREVIEW_TABLE_TOKEN,
            orderingEnabled: true,
            capabilities: PREVIEW_CAPABILITIES,
          }
        : context,
    )
  }, [snapshot, overlay, locale, now, entry, servicesPreview])
  // The snapshot's options belong to the template it names; another template starts from its own.
  const options = entry.id === faceEntry(savedFace).id ? snapshot.presentation?.options : undefined
  const host: DrawProps = {
    entry,
    strings: stringsFor(view.locale).guest,
    view,
    assetBase: CDN_BASE,
    languages: snapshot.locales.available,
    onLanguageChange: setChoice,
    fontStacks: FONT_STACKS,
    scheme,
    options,
  }
  return servicesPreview ? <WithDemoServices {...host} /> : <ChosenFace {...host} />
}

type DrawProps = FaceHostProps & {
  readonly entry: FaceEntry
  readonly strings: ChosenFaceStrings
  readonly view: ViewModel
}

/** The face with the demo host bound; its own component, so the demo's state starts afresh each time. */
function WithDemoServices(props: DrawProps) {
  const services = useDemoServices(props.view)
  return <ChosenFace {...props} services={services} />
}
