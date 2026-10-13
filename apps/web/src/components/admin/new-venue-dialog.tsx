'use client'

// "New venue" in two steps (CF-01, D64; D85, D87). Step 1 asks where the menu comes from: one of
// the organisation's active POS instances, or "By hand". The choice is final: a venue's source is
// fixed when it is created (D87), and the dialog says so.
//   - From a POS, step 2 lists the instance's venues. A venue that already serves one of ours is
//     shown "linked to …" and cannot be picked. Nothing is typed: name, address and languages come
//     from the POS and are editable later.
//   - By hand, step 2 asks for a name and languages and previews the address
//     `/m/<organisation>/<venue>`, editable (D84). The time zone and the currency are not asked:
//     every new venue gets the same ones, shown as one read-only line.
// The dialog only collects and shows; the rules are the server action's (`createVenueAction`),
// and what step 1 lists is the server's too (`loadNewVenueSourcesAction`, when the dialog opens).
// Modelled on the composer's "New section" dialog.
import { isVenueSlug, LOCALES, type Locale } from '@restro/core'
import { PlusIcon } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useLocale, useTranslations } from 'next-intl'
import { type FormEvent, type ReactNode, useEffect, useId, useState, useTransition } from 'react'

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
import { createVenueAction, loadNewVenueSourcesAction } from '@/server/venues-actions'
import {
  type CreateVenueError,
  NEW_VENUE_CURRENCY,
  NEW_VENUE_TIMEZONE,
  type NewVenueInstance,
  type NewVenueSources,
} from '@/server/venues-result'

const MAX_NAME_LENGTH = 120
const DEFAULT_LOCALE: Locale = 'bg_BG'
/** The languages a hand-made venue starts with: the pilot venues are Bulgarian clubs with English guests. */
const STARTING_LOCALES: readonly Locale[] = ['bg_BG', 'en_US']
/** The value of the "By hand" choice; an instance's choice is its `in_` id. */
const HAND = 'hand'

interface NewVenueDialogProps {
  readonly open: boolean
  readonly onOpenChange: (open: boolean) => void
  /** Called with the new venue's id once it is saved; the caller opens it. */
  readonly onCreated: (venueId: string) => void
}

export function NewVenueDialog(props: NewVenueDialogProps) {
  // The form is remounted on every opening so it starts at step 1 with nothing chosen.
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      {props.open ? <NewVenueForm {...props} /> : null}
    </Dialog>
  )
}

type SourcesState =
  | { readonly status: 'loading' }
  | { readonly status: 'failed' }
  | { readonly status: 'ready'; readonly sources: NewVenueSources }

function NewVenueForm({ onOpenChange, onCreated }: NewVenueDialogProps) {
  const [state, setState] = useState<SourcesState>({ status: 'loading' })
  const [attempt, setAttempt] = useState(0)
  const [choice, setChoice] = useState<string | null>(null)
  const [step, setStep] = useState<'source' | 'details'>('source')

  // What step 1 lists is read from the server each time the dialog opens, so a connection made a
  // moment ago is there.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `attempt` re-runs the load on "Try again".
  useEffect(() => {
    let current = true
    loadNewVenueSourcesAction()
      .then((result) => {
        if (!current) return
        if (result.ok) {
          setState({ status: 'ready', sources: result.sources })
          // Without a POS instance there is one way to make a venue: it is already the choice.
          if (result.sources.instances.length === 0) setChoice(HAND)
        } else setState({ status: 'failed' })
      })
      .catch(() => {
        if (current) setState({ status: 'failed' })
      })
    return () => {
      current = false
    }
  }, [attempt])

  const instance =
    state.status === 'ready' && choice !== null && choice !== HAND
      ? state.sources.instances.find((candidate) => candidate.id === choice)
      : undefined

  let body: ReactNode
  if (step === 'details' && state.status === 'ready' && choice === HAND) {
    body = (
      <HandStep
        organizationSlug={state.sources.organizationSlug}
        onBack={() => setStep('source')}
        onCancel={() => onOpenChange(false)}
        onCreated={(venueId) => {
          onOpenChange(false)
          onCreated(venueId)
        }}
      />
    )
  } else if (step === 'details' && instance !== undefined) {
    body = (
      <InstanceStep
        instance={instance}
        onBack={() => setStep('source')}
        onCancel={() => onOpenChange(false)}
        onCreated={(venueId) => {
          onOpenChange(false)
          onCreated(venueId)
        }}
      />
    )
  } else {
    body = (
      <SourceStep
        state={state}
        choice={choice}
        onChoose={setChoice}
        onRetry={() => {
          setState({ status: 'loading' })
          setAttempt((count) => count + 1)
        }}
        onCancel={() => onOpenChange(false)}
        onNext={() => setStep('details')}
      />
    )
  }
  return <DialogContent data-testid="new-venue-dialog">{body}</DialogContent>
}

/** One radio choice of a step: a title, a line under it, and the reason it cannot be picked. */
function Choice({
  group,
  value,
  checked,
  disabled = false,
  title,
  caption,
  testId,
  onSelect,
}: {
  readonly group: string
  readonly value: string
  readonly checked: boolean
  readonly disabled?: boolean
  readonly title: string
  readonly caption?: string
  readonly testId: string
  readonly onSelect: (value: string) => void
}) {
  return (
    <label className="flex cursor-pointer items-start gap-3 rounded-md border p-3 has-checked:border-primary has-checked:bg-accent has-disabled:cursor-not-allowed has-disabled:opacity-60">
      <input
        type="radio"
        name={group}
        value={value}
        checked={checked}
        disabled={disabled}
        onChange={() => onSelect(value)}
        className="mt-1 accent-primary"
        data-testid={testId}
      />
      <span className="grid gap-0.5">
        <span className="text-sm font-medium">{title}</span>
        {caption ? <span className="text-xs text-muted-foreground">{caption}</span> : null}
      </span>
    </label>
  )
}

// --- step 1: the source ----------------------------------------------------------------------

function SourceStep({
  state,
  choice,
  onChoose,
  onRetry,
  onCancel,
  onNext,
}: {
  readonly state: SourcesState
  readonly choice: string | null
  readonly onChoose: (value: string) => void
  readonly onRetry: () => void
  readonly onCancel: () => void
  readonly onNext: () => void
}) {
  const t = useTranslations('venues.new')
  const group = useId()

  function submit(event: FormEvent) {
    event.preventDefault()
    if (choice !== null && state.status === 'ready') onNext()
  }

  return (
    <form onSubmit={submit} className="grid gap-4" noValidate>
      <DialogHeader>
        <DialogTitle>{t('title')}</DialogTitle>
        <DialogDescription>{t('description')}</DialogDescription>
      </DialogHeader>

      {state.status === 'loading' ? (
        <p className="text-sm text-muted-foreground" data-testid="new-venue-sources-loading">
          {t('sources.loading')}
        </p>
      ) : null}

      {state.status === 'failed' ? (
        <div className="grid justify-items-start gap-2">
          <p
            className="text-sm text-destructive"
            role="alert"
            data-testid="new-venue-sources-error"
          >
            {t('sources.failed')}
          </p>
          <Button type="button" variant="outline" size="sm" onClick={onRetry}>
            {t('sources.retry')}
          </Button>
        </div>
      ) : null}

      {state.status === 'ready' ? (
        <fieldset className="grid gap-2" data-testid="new-venue-sources">
          <legend className="sr-only">{t('sources.legend')}</legend>
          {state.sources.instances.map((instance) => (
            <Choice
              key={instance.id}
              group={group}
              value={instance.id}
              checked={choice === instance.id}
              title={instance.name}
              caption={t('sources.venueCount', { count: instance.tillVenues.length })}
              testId={`new-venue-source-${instance.id}`}
              onSelect={onChoose}
            />
          ))}
          <Choice
            group={group}
            value={HAND}
            checked={choice === HAND}
            title={t('sources.hand')}
            caption={t('sources.handHelp')}
            testId="new-venue-source-hand"
            onSelect={onChoose}
          />
          {state.sources.instances.length === 0 ? (
            <p className="text-sm text-muted-foreground" data-testid="new-venue-no-instances">
              {t('sources.none')}{' '}
              <Link href="/settings/integrations" className="underline underline-offset-4">
                {t('sources.connect')}
              </Link>
            </p>
          ) : null}
        </fieldset>
      ) : null}

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onCancel}>
          {t('cancel')}
        </Button>
        <Button
          type="submit"
          disabled={choice === null || state.status !== 'ready'}
          data-testid="new-venue-next"
        >
          {t('next')}
        </Button>
      </DialogFooter>
    </form>
  )
}

// --- step 2, from a POS: pick one of its venues ----------------------------------------------

function InstanceStep({
  instance,
  onBack,
  onCancel,
  onCreated,
}: {
  readonly instance: NewVenueInstance
  readonly onBack: () => void
  readonly onCancel: () => void
  readonly onCreated: (venueId: string) => void
}) {
  const t = useTranslations('venues.new')
  const group = useId()
  const [pending, startTransition] = useTransition()
  const [picked, setPicked] = useState<number | null>(null)
  // POS venues found linked after the dialog was opened (another tab got there first).
  const [takenMeanwhile, setTakenMeanwhile] = useState<ReadonlySet<number>>(new Set())
  const [error, setError] = useState<CreateVenueError | null>(null)

  const source = instance.name
  const anyFree = instance.tillVenues.some((venue) => venue.linkedVenueName === null)

  function submit(event: FormEvent) {
    event.preventDefault()
    if (picked === null || pending) return
    const bid = picked
    setError(null)
    startTransition(async () => {
      const result = await createVenueAction({
        source: { kind: 'instance', integrationId: instance.id, bid },
      }).catch(() => ({ ok: false, error: 'failed' }) as const)
      if (result.ok) {
        onCreated(result.venueId)
        return
      }
      if (result.error === 'link_taken') {
        setTakenMeanwhile((set) => new Set(set).add(bid))
        setPicked(null)
      }
      setError(result.error)
    })
  }

  return (
    <form onSubmit={submit} className="grid gap-4" noValidate>
      <DialogHeader>
        <DialogTitle>{t('instance.title', { source })}</DialogTitle>
        <DialogDescription>{t('instance.description', { source })}</DialogDescription>
      </DialogHeader>

      {instance.tillVenues.length === 0 ? (
        <p className="text-sm text-muted-foreground" data-testid="new-venue-no-till-venues">
          {t('instance.noVenues', { source })}
        </p>
      ) : (
        <fieldset
          className="grid max-h-80 gap-2 overflow-y-auto"
          data-testid="new-venue-till-venues"
        >
          <legend className="sr-only">{t('instance.legend', { source })}</legend>
          {anyFree ? null : (
            <p className="text-sm text-muted-foreground" data-testid="new-venue-all-linked">
              {t('instance.allLinked', { source })}
            </p>
          )}
          {instance.tillVenues.map((venue) => {
            const linkedTo = venue.linkedVenueName
            const linked = linkedTo !== null || takenMeanwhile.has(venue.bid)
            return (
              <Choice
                key={venue.bid}
                group={group}
                value={String(venue.bid)}
                checked={picked === venue.bid}
                disabled={linked}
                title={venue.name}
                caption={
                  linkedTo === null ? undefined : t('instance.linkedTo', { venue: linkedTo })
                }
                testId={`new-venue-till-venue-${venue.bid}`}
                onSelect={() => {
                  setPicked(venue.bid)
                  setError(null)
                }}
              />
            )
          })}
        </fieldset>
      )}

      {error !== null ? (
        <p className="text-sm text-destructive" role="alert" data-testid="new-venue-error">
          {t(`errors.${error}`, { source })}
        </p>
      ) : null}

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onBack} disabled={pending}>
          {t('back')}
        </Button>
        <Button type="button" variant="outline" onClick={onCancel} disabled={pending}>
          {t('cancel')}
        </Button>
        <Button type="submit" disabled={picked === null || pending} data-testid="new-venue-submit">
          {pending ? t('creating') : t('create')}
        </Button>
      </DialogFooter>
    </form>
  )
}

// --- step 2, by hand: name, languages, the address preview -----------------------------------

function HandStep({
  organizationSlug,
  onBack,
  onCancel,
  onCreated,
}: {
  readonly organizationSlug: string | null
  readonly onBack: () => void
  readonly onCancel: () => void
  readonly onCreated: (venueId: string) => void
}) {
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
    if (nameMissing || !slugValid || pending) return
    startTransition(async () => {
      const result = await createVenueAction({
        source: { kind: 'hand' },
        name: name.trim(),
        slug,
        languages: { main: defaultLocale, enabled: chosen },
      }).catch(() => ({ ok: false, error: 'failed' }) as const)
      if (result.ok) onCreated(result.venueId)
      else setError(result.error)
    })
  }

  const slugError = touched && !slugValid ? t('slugInvalid') : null
  const generalError = error === null ? null : t(`errors.${error}`, { source: '' })

  return (
    <form onSubmit={submit} className="grid gap-4" noValidate>
      <DialogHeader>
        <DialogTitle>{t('hand.title')}</DialogTitle>
        <DialogDescription>{t('hand.description')}</DialogDescription>
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
          data-testid="new-venue-slug-help"
        >
          {t('slugHelp')}
        </p>
        <p className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
          {t('address')}
          <code
            className="break-all rounded-md bg-muted px-2 py-1 font-mono text-foreground ring-1 ring-border"
            data-testid="new-venue-address"
          >
            {`/m/${organizationSlug ?? '…'}/${slug === '' ? '…' : slug}`}
          </code>
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
        <Select value={defaultLocale} onValueChange={(value) => setDefaultLocale(value as Locale)}>
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
        <Button type="button" variant="outline" onClick={onBack} disabled={pending}>
          {t('back')}
        </Button>
        <Button type="button" variant="outline" onClick={onCancel} disabled={pending}>
          {t('cancel')}
        </Button>
        <Button type="submit" disabled={pending} data-testid="new-venue-submit">
          {pending ? t('creating') : t('create')}
        </Button>
      </DialogFooter>
    </form>
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
