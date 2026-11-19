'use client'

// The venue's logo on the Design page: ported from the old Appearance card unchanged in behaviour.
// The picture goes up through the same route as the item photos, with the same checks first
// (`precheckImage`, `uploadImage`); what comes back is an asset id that is attached to the look when
// Done is pressed. A saved logo is shown from its signed link, a new one from the file just chosen.
//
// The upload lives on the page (`useLogoUpload`), not in the field: the field comes and goes with
// Simple and Advanced, while a file going up, its error and the local links the draft and Undo's
// steps hold stay with the page.
import { useTranslations } from 'next-intl'
import { type ChangeEvent, useEffect, useRef, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import type { UploadFailure } from '@/composer/item-sheet-support'
import { IMAGE_ACCEPT, precheckImage, uploadImage } from '@/composer/item-sheet-upload'

/** The logo in the form: its asset id and what the tab shows of it. */
export interface LogoState {
  readonly assetId: string
  /** The signed link of a saved logo, or the local file just chosen. */
  readonly url: string | null
}

/** A logo file going up, as the page keeps it. */
export interface LogoUpload {
  /** 0 to 1 while a file goes up, else null. */
  readonly progress: number | null
  /** Why the last file was not taken, or null. */
  readonly error: UploadFailure | null
  readonly choose: (file: File) => void
}

/**
 * The page's side of a logo upload. `held` are the links the page still shows or can go back to
 * (the draft, Undo's steps, the saved design): a local link no longer among them is released at
 * once, and every one when the page goes.
 */
export function useLogoUpload(
  held: readonly (string | null)[],
  onLogo: (logo: LogoState) => void,
): LogoUpload {
  const [progress, setProgress] = useState<number | null>(null)
  const [error, setError] = useState<UploadFailure | null>(null)
  const pictures = useRef<string[]>([])
  const landed = useRef(onLogo)
  landed.current = onLogo

  useEffect(() => {
    const kept = new Set(held)
    pictures.current = pictures.current.filter((url) => {
      if (kept.has(url)) return true
      URL.revokeObjectURL(url)
      return false
    })
  }, [held])
  useEffect(
    () => () => {
      for (const url of pictures.current.splice(0)) URL.revokeObjectURL(url)
    },
    [],
  )

  async function choose(file: File) {
    setError(null)
    const refused = precheckImage(file)
    if (refused) {
      setError(refused)
      return
    }
    setProgress(0)
    const outcome = await uploadImage(file, { onProgress: setProgress })
    setProgress(null)
    if (!outcome.ok) {
      setError(outcome.error)
      return
    }
    const url = URL.createObjectURL(file)
    pictures.current.push(url)
    // The logo lands on the draft as it is now, not as it was when the file was chosen.
    landed.current({ assetId: outcome.assetId, url })
  }

  return { progress, error, choose: (file) => void choose(file) }
}

export function LogoField({
  logo,
  savedAssetId,
  canEdit,
  upload,
  onRemove,
}: {
  logo: LogoState | null
  /** The logo the venue has saved, to tell a new one from it. */
  savedAssetId: string | null
  canEdit: boolean
  upload: LogoUpload
  onRemove: () => void
}) {
  const t = useTranslations('design.logo')
  const tErrors = useTranslations('itemSheet.media.errors')
  const fileInput = useRef<HTMLInputElement>(null)
  const { progress, error } = upload

  function onFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (file) upload.choose(file)
  }

  return (
    <div className="grid gap-2" data-testid="design-logo">
      <Label>{t('title')}</Label>
      <p className="text-xs text-muted-foreground">{t('help')}</p>
      <div className="flex flex-wrap items-center gap-3">
        {logo?.url ? (
          // biome-ignore lint/performance/noImgElement: a signed link or a local blob, not a static asset
          <img
            src={logo.url}
            alt={t('current')}
            className="max-h-12 w-auto max-w-48 rounded-md border bg-muted/40 p-1 object-contain"
            data-testid="design-logo-image"
          />
        ) : null}
        {canEdit ? (
          <>
            <input
              ref={fileInput}
              type="file"
              accept={IMAGE_ACCEPT}
              className="sr-only"
              tabIndex={-1}
              aria-label={t('upload')}
              data-testid="design-logo-input"
              disabled={progress !== null}
              onChange={onFile}
            />
            <Button
              type="button"
              variant="outline"
              disabled={progress !== null}
              onClick={() => fileInput.current?.click()}
              data-testid="design-logo-upload"
            >
              {progress !== null
                ? `${t('uploading')} ${Math.round(progress * 100)}%`
                : logo
                  ? t('replace')
                  : t('upload')}
            </Button>
            {logo ? (
              <Button type="button" variant="ghost" onClick={onRemove}>
                {t('remove')}
              </Button>
            ) : null}
          </>
        ) : null}
      </div>
      {logo && logo.assetId !== savedAssetId ? (
        <p className="text-xs text-muted-foreground">{t('pending')}</p>
      ) : null}
      {error ? (
        <p role="alert" className="text-sm text-destructive" data-testid="design-logo-error">
          {tErrors(error)}
        </p>
      ) : null}
    </div>
  )
}
