'use client'

// The menu address of a venue in its Settings tab (brief CF-14 and S3, D84): `/m/<organisation>/
// <venue>`. The organisation part is the organisation's (Settings › General) and is shown as a
// fixed prefix; the venue part, the venue's address name, is the field. An old address name keeps
// redirecting. An owner or admin gets the field with a suggestion from the venue's name; everyone
// else sees the address. The rules are the server action's (`renameVenueSlugAction`): this only
// collects the name, checks its shape with core's `isVenueSlug` while it is typed, previews the
// address with core's `guestMenuPath`, and shows the answer.
import { guestMenuPath, isOrganizationSlug, isVenueSlug, MAX_VENUE_SLUG_LENGTH } from '@restro/core'
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
  /** The venue's address name as saved. */
  readonly slug: string
  /** The organisation's address name (the fixed prefix), or null when it cannot be read. */
  readonly organizationSlug: string | null
  /** Owner or admin: may rename. Decided again by the action. */
  readonly canEdit: boolean
}

/** The address of a venue, `/m/<organisation>/<venue>`, with "…" for a part that is not known. */
function addressOf(organization: string | null, venue: string): string {
  if (isOrganizationSlug(organization) && isVenueSlug(venue)) {
    return guestMenuPath({ organization, venue })
  }
  return `/m/${organization ?? '…'}/${venue === '' ? '…' : venue}`
}

export function VenueAddress({
  venueId,
  venueName,
  slug,
  organizationSlug,
  canEdit,
}: VenueAddressProps) {
  const t = useTranslations('workspace.settings')
  const formId = useId()
  const [saved, setSaved] = useState(slug)
  const [value, setValue] = useState(slug)
  const [error, setError] = useState<RenameVenueSlugError | null>(null)
  const [pending, startTransition] = useTransition()

  const valid = isVenueSlug(value)
  const dirty = value !== saved
  const suggestion = suggestSlug(venueName)
  const prefix = `/m/${organizationSlug ?? '…'}/`
  // The address as it will be once saved: it follows what is typed. Only a saved address can be
  // opened, so the link waits until the typed name is the saved one.
  const preview = addressOf(organizationSlug, value)
  const canOpen = isOrganizationSlug(organizationSlug) && valid && !dirty

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
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <code
          className="break-all rounded-md bg-muted px-2 py-0.5 font-mono text-xs"
          data-testid="venue-address"
        >
          {preview}
        </code>
        {canOpen ? (
          <a
            href={preview}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-primary underline-offset-4 hover:underline"
            title={t('slug.openTitle')}
            data-testid="venue-address-open"
          >
            {t('slug.open')}
            <ExternalLinkIcon aria-hidden className="size-3.5 shrink-0" />
          </a>
        ) : null}
      </div>

      {canEdit ? (
        <form onSubmit={submit} className="grid gap-2" noValidate data-testid="venue-slug-form">
          <Label htmlFor={`${formId}-slug`}>{t('slug.label')}</Label>
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex w-full max-w-md items-center gap-1">
              <span
                className="max-w-[60%] shrink-0 truncate font-mono text-sm text-muted-foreground"
                title={prefix}
                data-testid="venue-slug-prefix"
              >
                {prefix}
              </span>
              <Input
                id={`${formId}-slug`}
                value={value}
                onChange={(event) => {
                  // Lower-case as typed, and a space becomes a hyphen.
                  setValue(event.target.value.toLowerCase().replace(/\s+/g, '-'))
                  setError(null)
                }}
                maxLength={MAX_VENUE_SLUG_LENGTH}
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                className="min-w-0 flex-1 font-mono"
                aria-invalid={!valid || error !== null || undefined}
                aria-describedby={`${formId}-slug-help`}
                data-testid="venue-slug-input"
              />
            </div>
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
