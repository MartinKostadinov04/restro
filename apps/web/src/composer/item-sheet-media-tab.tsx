'use client'

// The Media tab: the item's picture. Ported from the Platform's FileBrowser upload (a file input
// and drop target with a progress bar) and image card (preview with file facts). Changed: one
// image of three accepted types, checked by its bytes on the server; no chunked upload or folder
// browser; the field value holds the asset id, alt text per language and a focal point, never a
// link (the link on screen is signed and expires). The picture is stored through the asset store
// and attached with a change set like any other edit.
import type { Locale, LocalizedText } from '@restro/core'
import {
  CrosshairIcon,
  ExternalLinkIcon,
  ImageIcon,
  ImageOffIcon,
  Trash2Icon,
  UploadIcon,
} from 'lucide-react'
import { useLocale, useTranslations } from 'next-intl'
import { type DragEvent, useId, useRef, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { localeChip } from '@/fields/localized'
import { ProvenanceBadge } from '@/fields/provenance-badge'
import { cn } from '@/lib/utils'
import type { ItemSheetData, SheetImage } from '@/server/item-sheet/types'

import { badgeProvenance, languageName, type UploadFailure } from './item-sheet-support'
import { IMAGE_ACCEPT, precheckImage, uploadImage } from './item-sheet-upload'

type Focal = { x: number; y: number } | null

export interface ItemSheetMediaTabProps {
  data: ItemSheetData
  /** True while a save is under way. */
  busy: boolean
  /** Attaches an uploaded asset, keeping the alt text; resolves true when it was attached. */
  onAttach: (assetId: string) => Promise<boolean>
  /** Saves the alt text and focal point of the current picture. */
  onSaveDetails: (alt: LocalizedText, focal: Focal) => Promise<boolean>
  /** Takes our picture off the item. */
  onRemove: () => Promise<boolean>
}

/** A fraction as a CSS percentage without floating-point noise (0.55 is `55%`, not `55.0000…%`). */
const percent = (fraction: number) => `${Math.round(fraction * 10_000) / 100}%`

/** How far an arrow key moves the focal point: a twentieth of the photo. */
const KEY_STEPS: Readonly<Record<string, readonly [number, number]>> = {
  ArrowLeft: [-0.05, 0],
  ArrowRight: [0.05, 0],
  ArrowUp: [0, -0.05],
  ArrowDown: [0, 0.05],
}

/** Rounds a fraction to two decimals: a focal point needs no more. */
const round = (value: number) => Math.round(Math.min(1, Math.max(0, value)) * 100) / 100

function Preview({
  image,
  alt,
  focal,
  picking,
  onPick,
}: {
  image: SheetImage
  alt: string
  focal: Focal
  picking: boolean
  onPick: (focal: { x: number; y: number }) => void
}) {
  const t = useTranslations('itemSheet.media')
  if (!image.url) {
    return (
      <div className="flex h-48 flex-col items-center justify-center gap-2 rounded-lg border bg-muted text-sm text-muted-foreground">
        <ImageOffIcon className="size-6" aria-hidden />
        {t('noPreview')}
      </div>
    )
  }
  return (
    <div className="grid justify-items-center rounded-lg border bg-muted/50 p-2">
      <div className="relative w-fit max-w-full">
        {/* biome-ignore lint/performance/noImgElement: plain <img> by decision U7 (no Next.js image optimizer); a signed, expiring link */}
        <img
          src={image.url}
          alt={alt}
          data-testid="item-image"
          data-asset-id={image.assetId}
          className="block max-h-80 w-auto max-w-full rounded-md object-contain"
        />
        {picking ? (
          // While picking, a button covers the photo: a click sets the focal point, and the
          // arrow keys move it for people who do not use a mouse.
          <button
            type="button"
            data-testid="focal-picker"
            aria-label={t('focalPicker')}
            className="absolute inset-0 cursor-crosshair rounded-md outline-offset-2 focus-visible:outline-2 focus-visible:outline-ring"
            onClick={(event) => {
              // Pressing Enter or Space on a button also clicks it, with no pointer position.
              if (event.detail === 0) return
              const box = event.currentTarget.getBoundingClientRect()
              onPick({
                x: round((event.clientX - box.left) / box.width),
                y: round((event.clientY - box.top) / box.height),
              })
            }}
            onKeyDown={(event) => {
              const step = KEY_STEPS[event.key]
              if (!step) return
              event.preventDefault()
              const from = focal ?? { x: 0.5, y: 0.5 }
              onPick({ x: round(from.x + step[0]), y: round(from.y + step[1]) })
            }}
          />
        ) : null}
        {focal ? (
          <span
            aria-hidden
            data-testid="focal-marker"
            className="pointer-events-none absolute size-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-primary shadow-md ring-1 ring-black/30"
            style={{ left: percent(focal.x), top: percent(focal.y) }}
          />
        ) : null}
      </div>
    </div>
  )
}

export function ItemSheetMediaTab({
  data,
  busy,
  onAttach,
  onSaveDetails,
  onRemove,
}: ItemSheetMediaTabProps) {
  const t = useTranslations('itemSheet.media')
  const uiLanguage = useLocale()
  const fileId = useId()
  const input = useRef<HTMLInputElement>(null)
  const { image } = data
  const [progress, setProgress] = useState<number | null>(null)
  const [failure, setFailure] = useState<UploadFailure | null>(null)
  const [dragging, setDragging] = useState(false)
  const [picking, setPicking] = useState(false)
  const [alt, setAlt] = useState<LocalizedText>(image?.alt ?? {})
  const [focal, setFocal] = useState<Focal>(image?.focal ?? null)
  const uploading = progress !== null

  const dirty =
    image !== null &&
    (JSON.stringify(focal) !== JSON.stringify(image.focal) ||
      data.enabledLocales.some((locale) => (alt[locale] ?? '') !== (image.alt[locale] ?? '')))

  async function send(file: File | undefined) {
    if (!file || uploading || busy) return
    setFailure(null)
    const refusal = precheckImage(file)
    if (refusal) {
      setFailure(refusal)
      return
    }
    setProgress(0)
    const outcome = await uploadImage(file, { onProgress: setProgress })
    if (!outcome.ok) {
      setProgress(null)
      setFailure(outcome.error)
      return
    }
    // Uploaded; now it is attached with a change set. A new photo starts without a focal point.
    const attached = await onAttach(outcome.assetId)
    setProgress(null)
    if (attached) {
      setFocal(null)
      setPicking(false)
    }
  }

  function onDrop(event: DragEvent<HTMLLabelElement>) {
    event.preventDefault()
    setDragging(false)
    void send(event.dataTransfer.files[0])
  }

  function saveDetails() {
    const cleaned: LocalizedText = {}
    for (const locale of data.enabledLocales) {
      const text = alt[locale]?.trim()
      if (text) cleaned[locale] = text
    }
    // Languages outside the venue's list keep what they had.
    for (const [locale, text] of Object.entries(image?.alt ?? {})) {
      if (!data.enabledLocales.includes(locale as Locale)) cleaned[locale as Locale] = text
    }
    void onSaveDetails(cleaned, focal)
  }

  const altForPreview =
    image?.alt[data.defaultLocale] ?? Object.values(image?.alt ?? {})[0] ?? t('noAlt')

  return (
    <div className="grid gap-4" data-testid="item-sheet-media">
      <section aria-label={t('title')} className="grid gap-3 rounded-lg border bg-card p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold">{t('title')}</h3>
          {image && badgeProvenance(image.provenance) ? (
            <ProvenanceBadge provenance={badgeProvenance(image.provenance) ?? 'owned'} />
          ) : null}
        </div>

        {image ? (
          <>
            <Preview
              image={image}
              alt={altForPreview}
              focal={focal}
              picking={picking}
              onPick={setFocal}
            />
            <dl className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-muted-foreground">
              {image.width && image.height ? (
                <div className="flex gap-1.5">
                  <dt>{t('dimensions')}</dt>
                  <dd className="tabular-nums" data-testid="image-dimensions">
                    {image.width} × {image.height}
                  </dd>
                </div>
              ) : null}
              {image.contentType ? (
                <div className="flex gap-1.5">
                  <dt>{t('type')}</dt>
                  <dd>{image.contentType.replace('image/', '').toUpperCase()}</dd>
                </div>
              ) : null}
              {image.url ? (
                <a
                  href={image.url}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-foreground underline underline-offset-4"
                >
                  {t('openFull')}
                  <ExternalLinkIcon className="size-3" aria-hidden />
                </a>
              ) : null}
            </dl>
            {image.provenance === 'barsy' ? (
              <p className="text-xs text-muted-foreground">{t('fromBarsyHint')}</p>
            ) : null}
          </>
        ) : (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <ImageIcon className="size-4" aria-hidden />
            {t('none')}
          </p>
        )}

        <label
          htmlFor={fileId}
          data-testid="photo-drop"
          data-dragging={dragging}
          onDragOver={(event) => {
            event.preventDefault()
            setDragging(true)
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          className={cn(
            'flex cursor-pointer flex-col items-center gap-1.5 rounded-lg border border-dashed p-5 text-center text-sm transition-colors focus-within:ring-[3px] focus-within:ring-ring/50',
            dragging ? 'border-primary bg-primary/5' : 'bg-muted/30 hover:bg-muted/50',
            (uploading || busy) && 'pointer-events-none opacity-60',
          )}
        >
          <UploadIcon className="size-5 text-muted-foreground" aria-hidden />
          <span className="font-medium">{image ? t('replace') : t('upload')}</span>
          <span className="text-xs text-muted-foreground">{t('limits')}</span>
          <input
            ref={input}
            id={fileId}
            type="file"
            accept={IMAGE_ACCEPT}
            data-testid="photo-input"
            className="sr-only"
            disabled={uploading || busy}
            onChange={(event) => {
              void send(event.target.files?.[0])
              // The same file can be chosen again after an error.
              event.target.value = ''
            }}
          />
        </label>

        {uploading ? (
          <div className="grid gap-1" role="status" aria-live="polite">
            <div className="h-2 overflow-hidden rounded-full bg-muted">
              <div
                className="h-full bg-primary transition-[width]"
                style={{ width: `${Math.round((progress ?? 0) * 100)}%` }}
              />
            </div>
            <span className="text-xs text-muted-foreground">
              {progress !== null && progress >= 1 ? t('saving') : t('uploading')}
            </span>
          </div>
        ) : null}
        {failure ? (
          <p role="alert" data-testid="upload-error" className="text-sm text-destructive">
            {t(`errors.${failure}`)}
          </p>
        ) : null}

        {image?.canRemove ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="justify-self-start"
            disabled={busy || uploading}
            onClick={() => void onRemove()}
          >
            <Trash2Icon aria-hidden />
            {t('remove')}
          </Button>
        ) : null}
      </section>

      {image ? (
        <section
          aria-label={t('detailsTitle')}
          className="grid gap-3 rounded-lg border bg-card p-4"
          data-testid="image-details"
        >
          <h3 className="text-sm font-semibold">{t('detailsTitle')}</h3>
          <p className="text-xs text-muted-foreground">{t('altHint')}</p>
          <div className="grid gap-3">
            {data.enabledLocales.map((locale) => (
              <div key={locale} className="grid gap-1.5">
                <Label htmlFor={`${fileId}-alt-${locale}`} className="gap-2">
                  {t('altFor', { language: languageName(locale, uiLanguage) })}
                  <span className="font-mono text-xs text-muted-foreground">
                    {localeChip(locale)}
                  </span>
                </Label>
                <Input
                  id={`${fileId}-alt-${locale}`}
                  lang={locale.split('_')[0]}
                  value={alt[locale] ?? ''}
                  maxLength={300}
                  onChange={(event) =>
                    setAlt((current) => {
                      const next = { ...current }
                      if (event.target.value === '') delete next[locale]
                      else next[locale] = event.target.value
                      return next
                    })
                  }
                />
              </div>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant={picking ? 'default' : 'outline'}
              size="sm"
              aria-pressed={picking}
              disabled={!image.url}
              onClick={() => setPicking((value) => !value)}
            >
              <CrosshairIcon aria-hidden />
              {picking ? t('focalDone') : t('focalSet')}
            </Button>
            {focal ? (
              <Button type="button" variant="ghost" size="sm" onClick={() => setFocal(null)}>
                {t('focalClear')}
              </Button>
            ) : null}
            {picking ? (
              <span className="text-xs text-muted-foreground">{t('focalHint')}</span>
            ) : null}
          </div>
          <div className="flex justify-end">
            <Button type="button" size="sm" disabled={!dirty || busy} onClick={saveDetails}>
              {t('saveDetails')}
            </Button>
          </div>
        </section>
      ) : null}
    </div>
  )
}
