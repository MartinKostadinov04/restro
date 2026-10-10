'use client'

// The Appearance card of the Settings tab (brief S3-03): the look of the guest menu from one brand
// colour and a logo. The colour is typed as hex, picked, or taken from a swatch; the card shows
// the semantic colour pairs a guest's screen will use, for a light and a dark screen, each with
// its contrast. The logo goes up through the same route as the item photos (same checks); it is
// attached when the card is saved. A saved look reaches guests with the next publish.
//
// Ported from the Platform's Design page (`Pages/Design/Index.jsx` 26-46, 120-130, 167-180). Changed: a hex input and
// swatches beside the colour picker, a preview of the pairs that matter instead of eleven bare
// swatches, the logo from the item photo upload instead of a file browser, no rounding, shadow
// or font controls (the venue theme is the colour and the logo; the rest stay at their defaults).
import { useTranslations } from 'next-intl'
import {
  type ChangeEvent,
  type FormEvent,
  useEffect,
  useId,
  useRef,
  useState,
  useTransition,
} from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { FormSection } from '@/components/ui/form-section'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { IMAGE_ACCEPT, precheckImage, uploadImage } from '@/composer/item-sheet-upload'
import { saveAppearanceAction } from '@/server/appearance/actions'
import type { AppearanceError, AppearanceView } from '@/server/appearance/service'

import { BRAND_SWATCHES, normaliseHex, previewOf, type SchemeView } from './preview'

/** The neutral colour shown when the venue has not chosen one yet. */
const DEFAULT_BRAND = '#6b7280'

interface LogoState {
  readonly assetId: string
  /** What the preview shows: the signed link of a saved logo, or the local file just chosen. */
  readonly url: string | null
}

function SchemePreview({
  scheme,
  label,
  logo,
  title,
}: {
  scheme: SchemeView
  label: string
  logo: LogoState | null
  title: string
}) {
  const t = useTranslations('appearance')
  const { colours, pairs } = scheme
  return (
    <div className="grid gap-2" data-testid="appearance-scheme">
      <p className="text-sm font-medium">{label}</p>
      <div
        className="grid gap-3 rounded-lg border p-3"
        style={{
          backgroundColor: colours.background,
          color: colours.text,
          borderColor: colours.border,
        }}
      >
        {logo?.url ? (
          // biome-ignore lint/performance/noImgElement: a signed link or a local blob, not a static asset
          <img
            src={logo.url}
            alt=""
            className="max-h-8 w-auto max-w-[60%] object-contain object-left"
          />
        ) : null}
        <div
          className="grid gap-1 rounded-md border p-3"
          style={{ backgroundColor: colours.surface, borderColor: colours.border }}
        >
          <p className="text-xs font-semibold" style={{ color: colours.accentText }}>
            {title}
          </p>
          <div className="flex items-baseline justify-between gap-2">
            <p className="text-sm font-semibold">{t('sampleName')}</p>
            <p className="text-sm font-semibold">{t('samplePrice')}</p>
          </div>
          <p className="text-xs" style={{ color: colours.muted }}>
            {t('sampleText')}
          </p>
          <span
            className="mt-1 w-fit rounded-full px-3 py-1 text-xs font-semibold"
            style={{ backgroundColor: colours.accent, color: colours.onAccent }}
          >
            {t('sampleChip')}
          </span>
        </div>
      </div>
      <ul className="grid grid-cols-2 gap-2">
        {pairs.map((pair) => (
          <li
            key={pair.key}
            className="flex items-center justify-between gap-2 rounded-md border px-2 py-1.5 text-xs"
            style={{
              backgroundColor: pair.background,
              color: pair.foreground,
              borderColor: colours.border,
            }}
            data-pair={pair.key}
          >
            <span>{t(`pairs.${pair.key}`)}</span>
            <span className="font-mono">{t('pairs.ratio', { ratio: pair.ratio })}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

export function AppearanceCard({
  venueId,
  initial,
  canEdit,
}: {
  venueId: string
  initial: AppearanceView
  canEdit: boolean
}) {
  const t = useTranslations('appearance')
  const tErrors = useTranslations('itemSheet.media.errors')
  const id = useId()
  const fileInput = useRef<HTMLInputElement>(null)
  const saved = initial.brand ?? DEFAULT_BRAND

  const [text, setText] = useState(saved)
  const [logo, setLogo] = useState<LogoState | null>(initial.logo)
  const [progress, setProgress] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  const brand = normaliseHex(text)
  const dirty = brand !== saved || (logo?.assetId ?? null) !== (initial.logo?.assetId ?? null)
  const preview = previewOf(brand ?? DEFAULT_BRAND)

  // A blob link made for a chosen file is released when it is replaced or the card goes away.
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
    const outcome = await uploadImage(file, { onProgress: setProgress })
    setProgress(null)
    if (!outcome.ok) {
      setError(tErrors(outcome.error))
      return
    }
    if (blob.current) URL.revokeObjectURL(blob.current)
    blob.current = URL.createObjectURL(file)
    setLogo({ assetId: outcome.assetId, url: blob.current })
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault()
    if (brand === null || !canEdit) return
    setError(null)
    startTransition(async () => {
      const result = await saveAppearanceAction({
        venueId,
        brand,
        logoAssetId: logo?.assetId ?? null,
      })
      if (result.ok) {
        toast.success(t('saved'))
      } else {
        setError(t(`errors.${result.error satisfies AppearanceError}`))
      }
    })
  }

  return (
    <FormSection title={t('title')} description={t('description')}>
      <form onSubmit={onSubmit} className="grid gap-6" data-testid="appearance-card">
        {canEdit ? null : <p className="text-sm text-muted-foreground">{t('readOnly')}</p>}

        <div className="grid gap-2">
          <Label htmlFor={`${id}-brand`}>{t('brand')}</Label>
          <div className="flex items-center gap-2">
            <input
              type="color"
              aria-label={t('brandPicker')}
              className="h-10 w-12 cursor-pointer rounded-md border bg-transparent p-1"
              value={brand ?? DEFAULT_BRAND}
              disabled={!canEdit}
              onChange={(event) => setText(event.target.value)}
            />
            <Input
              id={`${id}-brand`}
              value={text}
              onChange={(event) => setText(event.target.value)}
              disabled={!canEdit}
              inputMode="text"
              autoComplete="off"
              spellCheck={false}
              maxLength={16}
              className="max-w-40 font-mono"
              aria-invalid={brand === null}
              aria-describedby={`${id}-brand-help`}
            />
            {canEdit && brand !== DEFAULT_BRAND ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setText(DEFAULT_BRAND)}
              >
                {t('clearBrand')}
              </Button>
            ) : null}
          </div>
          <p
            id={`${id}-brand-help`}
            className={
              brand === null ? 'text-sm text-destructive' : 'text-xs text-muted-foreground'
            }
            role={brand === null ? 'alert' : undefined}
          >
            {brand === null ? t('brandInvalid') : t('brandHelp')}
          </p>
          <ul className="flex flex-wrap gap-2" aria-label={t('swatches')}>
            {BRAND_SWATCHES.map((swatch) => (
              <li key={swatch}>
                <button
                  type="button"
                  className="size-8 rounded-full border-2 ring-offset-2 focus-visible:ring-2 disabled:opacity-50"
                  style={{
                    backgroundColor: swatch,
                    borderColor: brand === swatch ? 'currentColor' : 'transparent',
                  }}
                  aria-label={swatch}
                  aria-pressed={brand === swatch}
                  disabled={!canEdit}
                  onClick={() => setText(swatch)}
                />
              </li>
            ))}
          </ul>
        </div>

        <div className="grid gap-2">
          <Label>{t('logo')}</Label>
          <p className="text-xs text-muted-foreground">{t('logoHelp')}</p>
          <div className="flex flex-wrap items-center gap-3">
            {logo?.url ? (
              // biome-ignore lint/performance/noImgElement: a signed link or a local blob, not a static asset
              <img
                src={logo.url}
                alt={t('logoCurrent')}
                className="max-h-12 w-auto max-w-48 rounded-md border bg-muted/40 p-1 object-contain"
                data-testid="appearance-logo"
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
                  aria-label={t('logoUpload')}
                  data-testid="appearance-logo-input"
                  onChange={onFile}
                />
                <Button
                  type="button"
                  variant="outline"
                  disabled={progress !== null}
                  onClick={() => fileInput.current?.click()}
                >
                  {progress !== null
                    ? `${t('logoUploading')} ${Math.round(progress * 100)}%`
                    : logo
                      ? t('logoReplace')
                      : t('logoUpload')}
                </Button>
                {logo ? (
                  <Button type="button" variant="ghost" onClick={() => setLogo(null)}>
                    {t('logoRemove')}
                  </Button>
                ) : null}
              </>
            ) : null}
          </div>
          {logo && logo.assetId !== initial.logo?.assetId ? (
            <p className="text-xs text-muted-foreground">{t('logoPending')}</p>
          ) : null}
        </div>

        <div className="grid gap-3">
          <div>
            <p className="text-sm font-medium">{t('previewTitle')}</p>
            <p className="text-xs text-muted-foreground">{t('previewHint')}</p>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <SchemePreview
              scheme={preview.light}
              label={t('previewLight')}
              logo={logo}
              title={t('sampleSection')}
            />
            <SchemePreview
              scheme={preview.dark}
              label={t('previewDark')}
              logo={logo}
              title={t('sampleSection')}
            />
          </div>
        </div>

        {error ? (
          <p role="alert" className="text-sm text-destructive" data-testid="appearance-error">
            {error}
          </p>
        ) : null}
        {canEdit ? (
          <div className="flex justify-end">
            <Button
              type="submit"
              disabled={pending || !dirty || brand === null || progress !== null}
            >
              {pending ? t('saving') : t('save')}
            </Button>
          </div>
        ) : null}
      </form>
    </FormSection>
  )
}
