'use client'

// The guest face drawn from a snapshot that is not published: the draft the server built in memory
// (the publisher's builder, schema and leak guard). It is the same shell and the same face the
// guest page uses (`/m/<venue>`), so what the preview shows is what the publish would put live; the
// only differences are the source of the snapshot and the frame around it. No table, no ordering.
//
// The template is the one the draft's `presentation` names (the registry's default when it names
// none). `faceId` overrides it, for a preview of a template the venue has not saved yet.
import type { LiveOverlay, Locale, MenuSnapshot } from '@restro/core'
import { buildViewModel, stringsFor } from '@restro/shell'
import { useMemo, useState } from 'react'

import { ChosenFace } from '@/faces/chosen-face'
import { faceEntry } from '@/faces/registry'
import { FONT_STACKS } from '@/fonts'
import { CDN_BASE } from '@/guest/cdn'
import { buildContext, chooseLocale } from '@/guest/context'
import { useAdminLocale } from './names'

export type PreviewScheme = 'light' | 'dark'

export function DraftFace({
  snapshot,
  overlay,
  scheme,
  faceId,
}: {
  snapshot: MenuSnapshot
  overlay: LiveOverlay
  scheme: PreviewScheme
  /** Draw this template instead of the one the snapshot names. */
  faceId?: string
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
  const view = useMemo(
    () =>
      buildViewModel(
        snapshot,
        overlay,
        buildContext({ locale, now, tableToken: null, manifest: entry.manifest }),
      ),
    [snapshot, overlay, locale, now, entry],
  )
  // The snapshot's options belong to the template it names; another template starts from its own.
  const options = entry.id === faceEntry(savedFace).id ? snapshot.presentation?.options : undefined
  return (
    <ChosenFace
      entry={entry}
      strings={stringsFor(view.locale).guest}
      view={view}
      assetBase={CDN_BASE}
      languages={snapshot.locales.available}
      onLanguageChange={setChoice}
      fontStacks={FONT_STACKS}
      scheme={scheme}
      options={options}
    />
  )
}
