'use client'

// The small form that names a tag and gives it a colour (brief S3-06). One component for the Tags
// panel (create, rename) and for the "new tag" row of the tags editor in the item sheet. It is not
// a <form>: the item sheet's editor is a form already, and forms do not nest, so Enter and the
// buttons are handled here.
import {
  DEFAULT_TAG_COLOR,
  type Locale,
  type LocalizedText,
  MAX_TAG_NAME_LENGTH,
  TAG_COLORS,
  type TagColor,
} from '@restro/core'
import { useLocale, useTranslations } from 'next-intl'
import { useId, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'

import { TAG_COLOR_CLASSES, TagChip } from './tag-chip'

/** What a tag form edits. */
export interface TagFormValue {
  readonly label: LocalizedText
  readonly color: TagColor
}

export interface TagFormProps {
  readonly defaultLocale: Locale
  readonly enabledLocales: readonly Locale[]
  readonly initial?: TagFormValue
  readonly submitLabel: string
  /** True while the save is under way: the buttons wait. */
  readonly busy?: boolean
  readonly onSubmit: (value: TagFormValue) => void
  readonly onCancel?: () => void
  /** Focus the first name when the form appears (a form the person just asked for). */
  readonly autoFocus?: boolean
}

export function TagForm({
  defaultLocale,
  enabledLocales,
  initial,
  submitLabel,
  busy = false,
  onSubmit,
  onCancel,
  autoFocus = true,
}: TagFormProps) {
  const t = useTranslations('fields.tags')
  const uiLocale = useLocale()
  const formId = useId()
  const [names, setNames] = useState<Partial<Record<Locale, string>>>(() => ({
    ...initial?.label,
  }))
  const [color, setColor] = useState<TagColor>(initial?.color ?? DEFAULT_TAG_COLOR)
  const [missing, setMissing] = useState(false)

  const ordered = [defaultLocale, ...enabledLocales.filter((locale) => locale !== defaultLocale)]
  const languageNames = new Intl.DisplayNames([uiLocale], { type: 'language' })
  const languageName = (locale: Locale) =>
    languageNames.of(locale.split('_')[0] ?? locale) ?? locale
  const preview =
    names[defaultLocale]?.trim() ||
    Object.values(names)
      .find((text) => text?.trim())
      ?.trim() ||
    '…'

  function submit() {
    if (busy) return
    const label: LocalizedText = {}
    for (const locale of ordered) {
      const text = (names[locale] ?? '').trim()
      if (text !== '') label[locale] = text
    }
    if (label[defaultLocale] === undefined) {
      setMissing(true)
      return
    }
    setMissing(false)
    onSubmit({ label, color })
  }

  return (
    <fieldset
      className="m-0 grid min-w-0 gap-3 border-0 p-0"
      data-testid="tag-form"
      onKeyDown={(event) => {
        // Plain Enter saves the tag, not the form around it; Ctrl/Cmd+Enter is the sheet's save.
        if (
          event.key === 'Enter' &&
          !event.metaKey &&
          !event.ctrlKey &&
          event.target instanceof HTMLInputElement
        ) {
          event.preventDefault()
          submit()
        }
      }}
    >
      <legend className="sr-only">{submitLabel}</legend>
      {ordered.map((locale, index) => {
        const isDefault = locale === defaultLocale
        return (
          <div key={locale} className="grid gap-1.5">
            <Label htmlFor={`${formId}-${locale}`}>
              {t('nameIn', { language: languageName(locale) })}
              {isDefault ? null : (
                <span className="font-normal text-muted-foreground"> · {t('optional')}</span>
              )}
            </Label>
            <Input
              id={`${formId}-${locale}`}
              value={names[locale] ?? ''}
              maxLength={MAX_TAG_NAME_LENGTH}
              onChange={(event) =>
                setNames((current) => ({ ...current, [locale]: event.target.value }))
              }
              aria-invalid={isDefault && missing ? true : undefined}
              aria-describedby={isDefault && missing ? `${formId}-error` : undefined}
              autoFocus={autoFocus && index === 0}
              autoComplete="off"
              data-testid={`tag-name-${locale}`}
            />
            {isDefault && missing ? (
              <p id={`${formId}-error`} role="alert" className="text-sm text-destructive">
                {t('nameRequired', { language: languageName(locale) })}
              </p>
            ) : null}
          </div>
        )
      })}

      <fieldset className="m-0 grid min-w-0 gap-1.5 border-0 p-0">
        <legend className="mb-1.5 text-sm font-medium">{t('colour')}</legend>
        {/* Real radio buttons: the arrow keys move between the colours. */}
        <div className="flex flex-wrap gap-2">
          {TAG_COLORS.map((option) => (
            <label key={option} className="relative" title={t(`colours.${option}`)}>
              <input
                type="radio"
                name={`${formId}-colour`}
                value={option}
                checked={color === option}
                onChange={() => setColor(option)}
                aria-label={t(`colours.${option}`)}
                data-testid={`tag-color-${option}`}
                className="peer sr-only"
              />
              <span
                className={cn(
                  'inline-flex h-8 min-w-12 cursor-pointer items-center justify-center rounded-full border px-3 text-xs font-medium peer-checked:ring-2 peer-checked:ring-ring peer-checked:ring-offset-2 peer-checked:ring-offset-background peer-focus-visible:ring-[3px] peer-focus-visible:ring-ring/50',
                  TAG_COLOR_CLASSES[option],
                )}
              >
                Aa
              </span>
            </label>
          ))}
        </div>
        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          {t('preview')}
          <TagChip color={color}>{preview}</TagChip>
        </p>
      </fieldset>

      <div className="flex flex-wrap justify-end gap-2">
        {onCancel ? (
          <Button type="button" variant="outline" size="sm" onClick={onCancel} disabled={busy}>
            {t('cancel')}
          </Button>
        ) : null}
        <Button
          type="button"
          size="sm"
          onClick={submit}
          disabled={busy}
          data-testid="tag-form-save"
        >
          {submitLabel}
        </Button>
      </div>
    </fieldset>
  )
}
