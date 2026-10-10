'use client'

// The guest face drawn from a snapshot that is not published: the draft the server built in memory
// (the publisher's builder, schema and leak guard). It is the same shell and the same face the
// guest page uses (`/m/<venue>`), so what the preview shows is what the publish would put live; the
// only differences are the source of the snapshot and the frame around it. No table, no ordering.
import type { LiveOverlay, Locale, MenuSnapshot } from '@restro/core'
import { QrPhoneFace } from '@restro/qr-phone'
import { buildViewModel } from '@restro/shell'
import { useMemo, useState } from 'react'

import { CDN_BASE } from '@/guest/cdn'
import { buildContext, chooseLocale } from '@/guest/context'
import { FONT_STACKS } from '@/guest/guest-menu'
import { useAdminLocale } from './names'

export type PreviewScheme = 'light' | 'dark'

export function DraftFace({
  snapshot,
  overlay,
  scheme,
}: {
  snapshot: MenuSnapshot
  overlay: LiveOverlay
  scheme: PreviewScheme
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
  const view = useMemo(
    () => buildViewModel(snapshot, overlay, buildContext({ locale, now, tableToken: null })),
    [snapshot, overlay, locale, now],
  )
  return (
    <QrPhoneFace
      view={view}
      assetBase={CDN_BASE}
      languages={snapshot.locales.available}
      onLanguageChange={setChoice}
      fontStacks={FONT_STACKS}
      scheme={scheme}
    />
  )
}
