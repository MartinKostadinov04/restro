'use client'

// "New item": an item made by hand (CF-01, D64), for a venue with no till or for one thing the
// till does not know. It needs a name in the venue's main language (check V3); the other enabled
// languages and the price are optional. The dialog sends the price as the text the person typed
// (`4.50` or `4,50`): the server converts it with core's money module (rule 8). Allergens, the
// description and the photo are filled in next, in the item sheet that opens after creating.
// Modelled on ./new-section-dialog.tsx.
import type { Currency, Locale, LocalizedText } from '@restro/core'
import { useLocale, useTranslations } from 'next-intl'
import { type FormEvent, useId, useState } from 'react'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { parseMoneyInput } from '@/fields/money-input'

interface NewItemDialogProps {
  readonly open: boolean
  readonly onOpenChange: (open: boolean) => void
  readonly defaultLocale: Locale
  readonly enabledLocales: readonly Locale[]
  /** The venue's currency: prices typed here are in it. */
  readonly currency: Currency
  /** Where the item will go: the open section's title, or "Unsorted". */
  readonly sectionLabel: string
  /** `price` is the trimmed text as typed; `''` = no price. */
  readonly onCreate: (input: { name: LocalizedText; price: string }) => void
}

export function NewItemDialog(props: NewItemDialogProps) {
  // The form is remounted on every opening so it starts empty.
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      {props.open ? <NewItemForm {...props} /> : null}
    </Dialog>
  )
}

function NewItemForm({
  onOpenChange,
  defaultLocale,
  enabledLocales,
  currency,
  sectionLabel,
  onCreate,
}: NewItemDialogProps) {
  const t = useTranslations('composer.newItem')
  const uiLocale = useLocale()
  const formId = useId()
  const [names, setNames] = useState<Partial<Record<Locale, string>>>({})
  const [price, setPrice] = useState('')
  const [touched, setTouched] = useState(false)

  const languageNames = new Intl.DisplayNames([uiLocale], { type: 'language' })
  const languageName = (locale: Locale) =>
    languageNames.of(locale.split('_')[0] ?? locale) ?? locale

  const defaultMissing = (names[defaultLocale] ?? '').trim() === ''
  const priceInvalid = parseMoneyInput(price, currency) === 'invalid'

  function submit(event: FormEvent) {
    event.preventDefault()
    setTouched(true)
    if (defaultMissing || priceInvalid) return
    const name: LocalizedText = {}
    for (const locale of enabledLocales) {
      const text = (names[locale] ?? '').trim()
      if (text !== '') name[locale] = text
    }
    onCreate({ name, price: price.trim() })
    onOpenChange(false)
  }

  // The default language first, then the rest in the venue's order.
  const ordered = [defaultLocale, ...enabledLocales.filter((locale) => locale !== defaultLocale)]

  return (
    <DialogContent data-testid="new-item-dialog">
      <form onSubmit={submit} className="grid gap-4" noValidate>
        <DialogHeader>
          <DialogTitle>{t('title')}</DialogTitle>
          <DialogDescription>{t('description', { section: sectionLabel })}</DialogDescription>
        </DialogHeader>

        <fieldset className="grid gap-3">
          <legend className="mb-2 text-sm font-medium">{t('names')}</legend>
          {ordered.map((locale) => {
            const isDefault = locale === defaultLocale
            const invalid = isDefault && touched && defaultMissing
            return (
              <div key={locale} className="grid gap-1.5">
                <Label htmlFor={`${formId}-${locale}`}>
                  {t('name', { language: languageName(locale) })}
                  {isDefault ? null : (
                    <span className="font-normal text-muted-foreground">({t('optional')})</span>
                  )}
                </Label>
                <Input
                  id={`${formId}-${locale}`}
                  value={names[locale] ?? ''}
                  onChange={(event) =>
                    setNames((current) => ({ ...current, [locale]: event.target.value }))
                  }
                  maxLength={120}
                  autoFocus={isDefault}
                  aria-invalid={invalid || undefined}
                  data-testid={`new-item-name-${locale}`}
                />
                {invalid ? (
                  <p className="text-sm text-destructive" role="alert">
                    {t('nameRequired')}
                  </p>
                ) : null}
              </div>
            )
          })}
        </fieldset>

        <div className="grid gap-1.5">
          <Label htmlFor={`${formId}-price`}>
            {t('price', { currency })}{' '}
            <span className="font-normal text-muted-foreground">({t('optional')})</span>
          </Label>
          <Input
            id={`${formId}-price`}
            value={price}
            onChange={(event) => setPrice(event.target.value)}
            inputMode="decimal"
            maxLength={12}
            placeholder="0.00"
            aria-invalid={(touched && priceInvalid) || undefined}
            data-testid="new-item-price"
          />
          {touched && priceInvalid ? (
            <p className="text-sm text-destructive" role="alert">
              {t('priceInvalid')}
            </p>
          ) : (
            <p className="text-xs text-muted-foreground">{t('priceHelp')}</p>
          )}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {t('cancel')}
          </Button>
          <Button type="submit" data-testid="new-item-submit">
            {t('create')}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  )
}
