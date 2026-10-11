'use client'

// "New venue" (CF-01, D64): a venue with its own menu, languages and public address, made by an
// owner or admin without anyone running a script. Modelled on the composer's "New section"
// dialog. Asked: a name, the readable part of the menu's web address (suggested from the name; a
// short unique code is added to it automatically, D68) and the languages the menu can be written
// in. The time zone and the currency are not asked: every new venue gets the same ones
// (Europe/Sofia, EUR), shown as one read-only line.
// The dialog only collects and shows; the rules are the server action's (`createVenueAction`).
import { isVenueSlug, LOCALES, type Locale } from '@restro/core'
import { PlusIcon } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useLocale, useTranslations } from 'next-intl'
import { type FormEvent, useId, useState, useTransition } from 'react'

import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { suggestSlug } from '@/lib/slug'
import { createVenueAction } from '@/server/venues-actions'
import {
  type CreateVenueError,
  NEW_VENUE_CURRENCY,
  NEW_VENUE_TIMEZONE,
} from '@/server/venues-result'

const MAX_NAME_LENGTH = 120
const DEFAULT_LOCALE: Locale = 'bg_BG'
/** The languages a new venue starts with: the pilot venues are Bulgarian clubs with English guests. */
const STARTING_LOCALES: readonly Locale[] = ['bg_BG', 'en_US']

interface NewVenueDialogProps {
  readonly open: boolean
  readonly onOpenChange: (open: boolean) => void
  /** Called with the new venue's id once it is saved; the caller opens it. */
  readonly onCreated: (venueId: string) => void
}

export function NewVenueDialog(props: NewVenueDialogProps) {
  // The form is remounted on every opening so it starts empty.
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      {props.open ? <NewVenueForm {...props} /> : null}
    </Dialog>
  )
}

function NewVenueForm({ onOpenChange, onCreated }: NewVenueDialogProps) {
  const t = useTranslations('venues.new')
  const uiLocale = useLocale()
  const formId = useId()
  const [pending, startTransition] = useTransition()
  const [name, setName] = useState('')
  const [slug, setSlug] = useState('')
  // Until the person edits the address themselves it follows the name.
  const [slugEdited, setSlugEdited] = useState(false)
  const [enabled, setEnabled] = useState<ReadonlySet<Locale>>(new Set(STARTING_LOCALES))
  const [defaultLocale, setDefaultLocale] = useState<Locale>(DEFAULT_LOCALE)
  const [touched, setTouched] = useState(false)
  const [error, setError] = useState<CreateVenueError | null>(null)

  const languageNames = new Intl.DisplayNames([uiLocale], { type: 'language' })
  const languageName = (locale: Locale) =>
    languageNames.of(locale.split('_')[0] ?? locale) ?? locale

  const nameMissing = name.trim() === ''
  const slugValid = isVenueSlug(slug)
  const chosen = LOCALES.filter((locale) => enabled.has(locale))

  function changeName(value: string) {
    setName(value)
    if (!slugEdited) setSlug(suggestSlug(value))
    setError(null)
  }

  function toggleLocale(locale: Locale, on: boolean) {
    const next = new Set(enabled)
    if (on) next.add(locale)
    else next.delete(locale)
    // At least one language stays; the main language is always one of the chosen.
    if (next.size === 0) return
    setEnabled(next)
    if (!next.has(defaultLocale)) {
      setDefaultLocale(LOCALES.find((candidate) => next.has(candidate)) ?? DEFAULT_LOCALE)
    }
  }

  function submit(event: FormEvent) {
    event.preventDefault()
    setTouched(true)
    setError(null)
    if (nameMissing || !slugValid) return
    startTransition(async () => {
      const result = await createVenueAction({
        name: name.trim(),
        slug,
        defaultLocale,
        enabledLocales: chosen,
      }).catch(() => ({ ok: false, error: 'failed' }) as const)
      if (result.ok) {
        onOpenChange(false)
        onCreated(result.venueId)
      } else {
        setError(result.error)
      }
    })
  }

  // The readable part of the address need not be free: a random code is added to it (D68).
  const slugError = touched && !slugValid ? t('slugInvalid') : null
  const generalError = error === null ? null : t(`errors.${error}`)

  return (
    <DialogContent data-testid="new-venue-dialog">
      <form onSubmit={submit} className="grid gap-4" noValidate>
        <DialogHeader>
          <DialogTitle>{t('title')}</DialogTitle>
          <DialogDescription>{t('description')}</DialogDescription>
        </DialogHeader>

        <div className="grid gap-1.5">
          <Label htmlFor={`${formId}-name`}>{t('name')}</Label>
          <Input
            id={`${formId}-name`}
            value={name}
            onChange={(event) => changeName(event.target.value)}
            maxLength={MAX_NAME_LENGTH}
            autoFocus
            aria-invalid={(touched && nameMissing) || undefined}
            data-testid="new-venue-name"
          />
          {touched && nameMissing ? (
            <p className="text-sm text-destructive" role="alert">
              {t('nameRequired')}
            </p>
          ) : null}
        </div>

        <div className="grid gap-1.5">
          <Label htmlFor={`${formId}-slug`}>{t('slug')}</Label>
          <Input
            id={`${formId}-slug`}
            value={slug}
            onChange={(event) => {
              // Lower-case as typed, and a space becomes a hyphen.
              setSlug(event.target.value.toLowerCase().replace(/\s+/g, '-'))
              setSlugEdited(true)
              setError(null)
            }}
            maxLength={63}
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            aria-invalid={slugError !== null || undefined}
            aria-describedby={`${formId}-slug-help`}
            data-testid="new-venue-slug"
          />
          {slugError ? (
            <p className="text-sm text-destructive" role="alert" data-testid="new-venue-slug-error">
              {slugError}
            </p>
          ) : null}
          <p
            id={`${formId}-slug-help`}
            className="text-xs text-muted-foreground"
            data-testid="new-venue-address"
          >
            {t('slugHelp')}
          </p>
        </div>

        <fieldset className="grid gap-3">
          <legend className="mb-1 text-sm font-medium">{t('languages')}</legend>
          <div className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-3">
            {LOCALES.map((locale) => {
              const on = enabled.has(locale)
              return (
                <div key={locale} className="flex items-center gap-2">
                  <Checkbox
                    id={`${formId}-lang-${locale}`}
                    checked={on}
                    // The last language cannot be taken away.
                    disabled={on && enabled.size === 1}
                    onCheckedChange={(value) => toggleLocale(locale, value === true)}
                    data-testid={`new-venue-language-${locale}`}
                  />
                  <Label htmlFor={`${formId}-lang-${locale}`} className="font-normal">
                    {languageName(locale)}
                  </Label>
                </div>
              )
            })}
          </div>
          <p className="text-xs text-muted-foreground">{t('languagesHelp')}</p>
        </fieldset>

        <div className="grid gap-1.5">
          <Label htmlFor={`${formId}-default`}>{t('defaultLanguage')}</Label>
          <Select
            value={defaultLocale}
            onValueChange={(value) => setDefaultLocale(value as Locale)}
          >
            <SelectTrigger
              id={`${formId}-default`}
              className="w-full"
              data-testid="new-venue-default-language"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {chosen.map((locale) => (
                <SelectItem key={locale} value={locale}>
                  {languageName(locale)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">{t('defaultLanguageHelp')}</p>
        </div>

        <p className="text-sm text-muted-foreground" data-testid="new-venue-defaults">
          {t('defaults', { timeZone: NEW_VENUE_TIMEZONE, currency: NEW_VENUE_CURRENCY })}
        </p>

        {generalError ? (
          <p className="text-sm text-destructive" role="alert" data-testid="new-venue-error">
            {generalError}
          </p>
        ) : null}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {t('cancel')}
          </Button>
          <Button type="submit" disabled={pending} data-testid="new-venue-submit">
            {pending ? t('creating') : t('create')}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  )
}

/** The "New venue" button with its dialog; opens the new venue once it is saved. */
export function NewVenueButton({ testId = 'new-venue' }: { readonly testId?: string }) {
  const t = useTranslations('venues.new')
  const router = useRouter()
  const [open, setOpen] = useState(false)
  return (
    <>
      <Button type="button" onClick={() => setOpen(true)} data-testid={testId}>
        <PlusIcon aria-hidden />
        {t('button')}
      </Button>
      <NewVenueDialog
        open={open}
        onOpenChange={setOpen}
        onCreated={(venueId) => router.push(`/venues/${venueId}`)}
      />
    </>
  )
}
