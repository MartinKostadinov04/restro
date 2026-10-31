'use client'

// The venue's logo on the Design page: ported from the old Appearance card unchanged in behaviour.
// The picture goes up through the same route as the item photos, with the same checks first
// (`precheckImage`, `uploadImage`); what comes back is an asset id that is attached to the look when
// "Save look" is pressed. A saved logo is shown from its signed link, a new one from the file just
// chosen.
import { useTranslations } from 'next-intl'
import { type ChangeEvent, useEffect, useRef, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { IMAGE_ACCEPT, precheckImage, uploadImage } from '@/composer/item-sheet-upload'

/** The logo in the form: its asset id and what the tab shows of it. */
export interface LogoState {
  readonly assetId: string
  /** The signed link of a saved logo, or the local file just chosen. */
  readonly url: string | null
}

export function LogoField({
  logo,
  savedAssetId,
  canEdit,
  onChange,
  onBusy,
}: {
  logo: LogoState | null
  /** The logo the venue has saved, to tell a new one from it. */
  savedAssetId: string | null
  canEdit: boolean
  onChange: (logo: LogoState | null) => void
  /** True while a file is going up, so the tab holds Save back. */
  onBusy: (busy: boolean) => void
}) {
  const t = useTranslations('design.logo')
  const tErrors = useTranslations('itemSheet.media.errors')
  const fileInput = useRef<HTMLInputElement>(null)
  const [progress, setProgress] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)

  // A blob link made for a chosen file is released when it is replaced or the tab goes away.
  const blob = useRef<string | null>(null)
  useEffect(
    () => () => {
      if (blob.current) URL.revokeObjectURL(blob.current)
    },
    [],
  )

  async function onFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    setError(null)
    const refused = precheckImage(file)
    if (refused) {
      setError(tErrors(refused))
      return
    }
    setProgress(0)
    onBusy(true)
    const outcome = await uploadImage(file, { onProgress: setProgress })
    setProgress(null)
    onBusy(false)
    if (!outcome.ok) {
      setError(tErrors(outcome.error))
      return
    }
    if (blob.current) URL.revokeObjectURL(blob.current)
    blob.current = URL.createObjectURL(file)
    onChange({ assetId: outcome.assetId, url: blob.current })
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
              onChange={onFile}
            />
            <Button
              type="button"
              variant="outline"
              disabled={progress !== null}
              onClick={() => fileInput.current?.click()}
            >
              {progress !== null
                ? `${t('uploading')} ${Math.round(progress * 100)}%`
                : logo
                  ? t('replace')
                  : t('upload')}
            </Button>
            {logo ? (
              <Button type="button" variant="ghost" onClick={() => onChange(null)}>
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
          {error}
        </p>
      ) : null}
    </div>
  )
}
