'use client'

// The menu address of a venue in its Settings tab (brief CF-14, D68): `/m/<slug>-<code>`. The code
// at the end is random and permanent; the readable part before it is the venue's to rename. An
// owner or admin gets a field with a suggestion from the venue's name; everyone else sees the
// address. The rules are the server action's (`renameVenueSlugAction`): this only collects the
// slug, checks its shape with core's `isVenueSlug` while it is typed, and shows the answer.
import { isVenueSlug, menuPath } from '@restro/core'
import { ExternalLinkIcon } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { type FormEvent, useId, useState, useTransition } from 'react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { suggestSlug } from '@/lib/slug'
import { renameVenueSlugAction } from '@/server/venues-actions'
import type { RenameVenueSlugError } from '@/server/venues-result'

interface VenueAddressProps {
  readonly venueId: string
  readonly venueName: string
  readonly slug: string
  readonly publicId: string
  /** Owner or admin: may rename. Decided again by the action. */
  readonly canEdit: boolean
}

export function VenueAddress({ venueId, venueName, slug, publicId, canEdit }: VenueAddressProps) {
  const t = useTranslations('workspace.settings')
  const formId = useId()
  const [saved, setSaved] = useState(slug)
  const [value, setValue] = useState(slug)
  const [error, setError] = useState<RenameVenueSlugError | null>(null)
  const [pending, startTransition] = useTransition()

  const path = menuPath({ slug: saved, publicId })
  const valid = isVenueSlug(value)
  const dirty = value !== saved
  const suggestion = suggestSlug(venueName)

  function submit(event: FormEvent) {
    event.preventDefault()
    if (!canEdit || !valid || !dirty || pending) return
    setError(null)
    startTransition(async () => {
      const result = await renameVenueSlugAction({ venueId, slug: value }).catch(
        () => ({ ok: false, error: 'failed' }) as const,
      )
      if (result.ok) {
        setSaved(result.slug)
        setValue(result.slug)
        if (result.filesQueued) toast.success(t('slug.saved'))
        else toast.warning(t('slug.savedLate'))
      } else {
        setError(result.error)
      }
    })
  }

  return (
    <div className="grid gap-3">
      <a
        href={path}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex w-fit max-w-full items-center gap-1.5 text-primary underline-offset-4 hover:underline"
        data-testid="venue-address"
        title={t('slug.open')}
      >
        <code className="break-all rounded-md bg-muted px-2 py-0.5 font-mono text-xs">{path}</code>
        <ExternalLinkIcon aria-hidden className="size-3.5 shrink-0" />
      </a>

      {canEdit ? (
        <form onSubmit={submit} className="grid gap-2" noValidate data-testid="venue-slug-form">
          <Label htmlFor={`${formId}-slug`}>{t('slug.label')}</Label>
          <div className="flex flex-wrap items-center gap-2">
            <Input
              id={`${formId}-slug`}
              value={value}
              onChange={(event) => {
                // Lower-case as typed, and a space becomes a hyphen.
                setValue(event.target.value.toLowerCase().replace(/\s+/g, '-'))
                setError(null)
              }}
              maxLength={63}
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              className="w-full max-w-xs"
              aria-invalid={!valid || error !== null || undefined}
              aria-describedby={`${formId}-slug-help`}
              data-testid="venue-slug-input"
            />
            <Button
              type="button"
              variant="outline"
              disabled={pending || suggestion === '' || suggestion === value}
              onClick={() => {
                setValue(suggestion)
                setError(null)
              }}
              data-testid="venue-slug-suggest"
            >
              {t('slug.suggest')}
            </Button>
            <Button
              type="submit"
              disabled={pending || !valid || !dirty}
              data-testid="venue-slug-save"
            >
              {pending ? t('slug.saving') : t('slug.save')}
            </Button>
          </div>
          {!valid ? (
            <p className="text-sm text-destructive" role="alert" data-testid="venue-slug-invalid">
              {t('slug.invalid')}
            </p>
          ) : null}
          {error !== null ? (
            <p className="text-sm text-destructive" role="alert" data-testid="venue-slug-error">
              {t(`slug.errors.${error}`)}
            </p>
          ) : null}
          <p id={`${formId}-slug-help`} className="text-xs text-muted-foreground">
            {t('slug.help')}
          </p>
          <p className="text-xs text-muted-foreground">{t('slug.keep')}</p>
        </form>
      ) : null}
    </div>
  )
}
