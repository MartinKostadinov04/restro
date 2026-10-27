'use client'

// The barsy system settings card of an instance (B6, D82): how barsy's data is read, for the whole
// installation. The characteristic that holds allergens (barsy defines characteristics once per
// installation) and the language of text that carries no language tag (`default_locale`, an
// instance setting, D77). Nothing else: the schedule and the rollback pause are each venue's,
// the price is each venue's (its Menu source), the menu roots are barsy's own (D88). A change
// applies from the next sync.
//
// Ported from the Integration tab's mapping card (S2-05); changed: the card belongs to one
// instance, saves through the generic settings action, and names barsy only in this folder.
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
import { ErrorNote, Notice } from '@/integration/error-note'
import { saveInstanceSettingsAction } from '@/server/integration/actions'
import type { IntegrationErrorCode } from '@/server/integration/view'

import type { BarsyInstanceSettings } from '../data'

/** The select's value for "detect automatically" (a characteristic key is never this). */
const AUTO = '__auto__'

export function BarsySettingsCard({
  integrationId,
  canManage,
  data,
}: {
  integrationId: string
  canManage: boolean
  data: BarsyInstanceSettings
}) {
  const t = useTranslations('connectors.barsy.settings')
  const uiLocale = useLocale()
  const formId = useId()
  const [allergenKey, setAllergenKey] = useState<string>(data.allergenKey ?? AUTO)
  const [defaultLocale, setDefaultLocale] = useState(data.defaultLocale)
  const [error, setError] = useState<IntegrationErrorCode | null>(null)
  const [saved, setSaved] = useState(false)
  const [pending, startTransition] = useTransition()

  const languageNames = new Intl.DisplayNames([uiLocale], { type: 'language' })
  const languageName = (locale: string) =>
    languageNames.of(locale.split('_')[0] ?? locale) ?? locale

  const dirty = allergenKey !== (data.allergenKey ?? AUTO) || defaultLocale !== data.defaultLocale

  const autoLabel = data.allergenDetected
    ? t('allergen.autoFound', { name: data.allergenDetected.name })
    : t('allergen.autoNone')

  function submit(event: FormEvent) {
    event.preventDefault()
    setError(null)
    setSaved(false)
    startTransition(async () => {
      const result = await saveInstanceSettingsAction({
        integrationId,
        settings: { allergenKey: allergenKey === AUTO ? null : allergenKey, defaultLocale },
      })
      if (result.ok) setSaved(true)
      else setError(result.error)
    })
  }

  return (
    <FormSection title={t('title')} description={t('description')}>
      <form onSubmit={submit} className="grid gap-5" data-testid="settings-form">
        <div className="grid min-w-0 gap-1.5">
          <Label htmlFor={`${formId}-allergen`}>{t('allergen.label')}</Label>
          <Select
            value={allergenKey}
            onValueChange={(value) => {
              setAllergenKey(value)
              setSaved(false)
            }}
            disabled={!canManage}
          >
            <SelectTrigger id={`${formId}-allergen`} className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={AUTO}>{autoLabel}</SelectItem>
              {data.allergenOptions.map((option) => (
                <SelectItem key={option.key} value={option.key}>
                  {option.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">
            {data.allergenOptions.length === 0 ? t('allergen.noOptions') : t('allergen.help')}
          </p>
        </div>

        <div className="grid min-w-0 gap-1.5">
          <Label htmlFor={`${formId}-locale`}>{t('locale.label')}</Label>
          <Select
            value={defaultLocale}
            onValueChange={(value) => {
              setDefaultLocale(value)
              setSaved(false)
            }}
            disabled={!canManage}
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

        <ErrorNote code={error} source="barsy" />
        {saved ? <Notice>{t('saved')}</Notice> : null}
        {canManage ? (
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
