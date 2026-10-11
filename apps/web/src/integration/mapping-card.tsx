'use client'

// How the till's data is read, for the whole installation (the integration's `config`, D73): the
// characteristic that holds allergens, and the language of text that carries no language tag. They
// apply from the next pull. The price is not here any more: it differs per venue, so each venue's
// Menu source card has its own.
import { LOCALES } from '@restro/core'
import { useLocale, useTranslations } from 'next-intl'
import { type FormEvent, useId, useState, useTransition } from 'react'

import { Button } from '@/components/ui/button'
import { FormSection } from '@/components/ui/form-section'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { saveMappingSettingsAction } from '@/server/integration/actions'
import type { IntegrationErrorCode, IntegrationView } from '@/server/integration/view'

import { ErrorNote, Notice } from './error-note'

/** The select's value for "detect automatically" (a characteristic key is never this). */
const AUTO = '__auto__'

export function MappingCard({ view }: { view: IntegrationView }) {
  const t = useTranslations('integration.mapping')
  const uiLocale = useLocale()
  const formId = useId()
  const { mapping: settings } = view
  const [allergenKey, setAllergenKey] = useState<string>(settings.allergenKey ?? AUTO)
  const [defaultLocale, setDefaultLocale] = useState(settings.defaultLocale)
  const [error, setError] = useState<IntegrationErrorCode | null>(null)
  const [saved, setSaved] = useState(false)
  const [pending, startTransition] = useTransition()
  const editable = view.integration !== null && view.canManage

  const languageNames = new Intl.DisplayNames([uiLocale], { type: 'language' })
  const languageName = (locale: string) =>
    languageNames.of(locale.split('_')[0] ?? locale) ?? locale

  const dirty =
    allergenKey !== (settings.allergenKey ?? AUTO) || defaultLocale !== settings.defaultLocale

  const autoLabel = settings.allergenDetected
    ? t('allergen.autoFound', { name: settings.allergenDetected.name })
    : t('allergen.autoNone')

  function submit(event: FormEvent) {
    event.preventDefault()
    setError(null)
    setSaved(false)
    startTransition(async () => {
      const result = await saveMappingSettingsAction({
        allergenKey: allergenKey === AUTO ? null : allergenKey,
        defaultLocale,
      })
      if (result.ok) setSaved(true)
      else setError(result.error)
    })
  }

  return (
    <FormSection title={t('title')} description={t('description')}>
      <form onSubmit={submit} className="grid gap-5" data-testid="mapping-form">
        <div className="grid gap-1.5">
          <Label htmlFor={`${formId}-allergen`}>{t('allergen.label')}</Label>
          <Select
            value={allergenKey}
            onValueChange={(value) => {
              setAllergenKey(value)
              setSaved(false)
            }}
            disabled={!editable}
          >
            <SelectTrigger id={`${formId}-allergen`} className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={AUTO}>{autoLabel}</SelectItem>
              {settings.allergenOptions.map((option) => (
                <SelectItem key={option.key} value={option.key}>
                  {option.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">
            {settings.allergenOptions.length === 0 ? t('allergen.noOptions') : t('allergen.help')}
          </p>
        </div>

        <div className="grid gap-1.5">
          <Label htmlFor={`${formId}-locale`}>{t('locale.label')}</Label>
          <Select
            value={defaultLocale}
            onValueChange={(value) => {
              setDefaultLocale(value)
              setSaved(false)
            }}
            disabled={!editable}
          >
            <SelectTrigger id={`${formId}-locale`} className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {LOCALES.map((locale) => (
                <SelectItem key={locale} value={locale}>
                  {languageName(locale)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">{t('locale.help')}</p>
        </div>

        <ErrorNote code={error} />
        {saved ? <Notice>{t('saved')}</Notice> : null}
        {editable ? (
          <div className="flex justify-end">
            <Button type="submit" disabled={pending || !dirty}>
              {pending ? t('saving') : t('save')}
            </Button>
          </div>
        ) : null}
      </form>
    </FormSection>
  )
}
