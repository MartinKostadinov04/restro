'use client'

// "Preview" on a template of the chooser (D92, brief S7): a phone pop-up with the venue's general
// menu drawn in that template, no table. It is the same draft as the live preview (`previewSnapshot`
// with the form's unsaved look laid over it), drawn by the template named here instead of the
// chosen one, with that template's own look options. Nothing is saved by looking; "Use this
// template" in the pop-up chooses it, as the chooser's button does.
import type { VenueTheme } from '@restro/core'
import { useTranslations } from 'next-intl'
import { useState } from 'react'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import type { FaceEntry } from '@/faces/registry'
import { DraftFace, type PreviewScheme } from '@/publish/draft-face'
import { PhoneFrame } from '@/publish/phone-frame'

import { DraftMessage, SchemeSwitch, usePreviewLook } from './design-preview'
import type { Draft } from './preview-draft'
import type { OptionValues } from './template-options'

export function TemplatePreviewDialog({
  entry,
  name,
  draft,
  onRetry,
  theme,
  options,
  scheme,
  inUse,
  canChoose,
  onChoose,
  onClose,
}: {
  /** The template to preview; null = the pop-up is closed. */
  entry: FaceEntry | null
  /** Its name in the interface language. */
  name: string
  draft: Draft
  onRetry: () => void
  /** The form's look, whole. */
  theme: VenueTheme
  /** The options this template would be drawn with. */
  options: OptionValues
  /** The screen the live preview shows: where this pop-up starts. */
  scheme: PreviewScheme
  /** The venue has this template already. */
  inUse: boolean
  canChoose: boolean
  onChoose: (entry: FaceEntry) => void
  onClose: () => void
}) {
  const t = useTranslations('design.templates')
  const tPublish = useTranslations('publish.previewDialog')
  const [chosenScheme, setScheme] = useState<PreviewScheme | null>(null)
  const shown = chosenScheme ?? scheme
  const snapshot = usePreviewLook(draft, { theme, face: entry?.id ?? '', options })

  return (
    <Dialog
      open={entry !== null}
      onOpenChange={(open) => {
        if (!open) {
          setScheme(null)
          onClose()
        }
      }}
    >
      <DialogContent className="sm:max-w-md" data-testid="template-preview-dialog">
        <DialogHeader>
          <DialogTitle>{t('previewTitle', { name })}</DialogTitle>
          <DialogDescription>{t('previewDescription')}</DialogDescription>
        </DialogHeader>
        {entry !== null && draft.state === 'ready' && snapshot !== null ? (
          <>
            <SchemeSwitch scheme={shown} onScheme={setScheme} />
            <PhoneFrame label={tPublish('frame')}>
              <DraftFace
                snapshot={snapshot}
                overlay={draft.overlay}
                scheme={shown}
                faceId={entry.id}
              />
            </PhoneFrame>
          </>
        ) : draft.state !== 'ready' ? (
          <DraftMessage draft={draft} onRetry={onRetry} />
        ) : null}
        {entry !== null && canChoose && !inUse ? (
          <DialogFooter>
            <Button
              type="button"
              onClick={() => {
                onChoose(entry)
                onClose()
              }}
            >
              {t('useNamed', { name })}
            </Button>
          </DialogFooter>
        ) : null}
      </DialogContent>
    </Dialog>
  )
}
