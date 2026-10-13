'use client'

// Settings › General (brief S3, D84, D91): the organisation's name and its address name, the first
// part of every guest address `/m/<organisation>/<venue>`. Each is a field with its own Save. An
// owner edits; an admin or member sees the values as text. The rules are the server action's
// (`updateOrganizationAction`, owners only, the name taken-check, the redirect from the old name
// and the guest-file jobs): this collects the two values, checks the shape of the address name
// with core's `isOrganizationSlug` while it is typed, and shows the answer. Ported from the
// Synex Platform's settings pages (`FormSection`: title and description in a left column, the
// fields in a card), already ported as `components/ui/form-section.tsx`.
import { guestMenuPath, isOrganizationSlug, MAX_ORGANIZATION_SLUG_LENGTH } from '@restro/core'
import { useTranslations } from 'next-intl'
import { type FormEvent, useId, useState, useTransition } from 'react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { FormSection } from '@/components/ui/form-section'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { suggestSlug } from '@/lib/slug'
import { updateOrganizationAction } from '@/server/organization-actions'
import type { UpdateOrganizationError } from '@/server/organization-actions-result'

/** The same limit as the action (core's `MAX_ORGANIZATION_NAME_LENGTH`; core's writers are server-only). */
const MAX_NAME_LENGTH = 200

/** The venue part of the example address: only there to show the shape. */
const EXAMPLE_VENUE = 'your-venue'

interface OrganizationGeneralProps {
  /** The organisation's name as saved. */
  readonly name: string
  /** The organisation's address name as saved. */
  readonly slug: string
  /** An owner: may change both. Decided again by the action. */
  readonly canEdit: boolean
}

export function OrganizationGeneral({ name, slug, canEdit }: OrganizationGeneralProps) {
  const t = useTranslations('settings.general')
  const formId = useId()
  const [saved, setSaved] = useState({ name, slug })
  const [nameValue, setNameValue] = useState(name)
  const [slugValue, setSlugValue] = useState(slug)
  const [nameError, setNameError] = useState<UpdateOrganizationError | null>(null)
  const [slugError, setSlugError] = useState<UpdateOrganizationError | null>(null)
  const [namePending, startName] = useTransition()
  const [slugPending, startSlug] = useTransition()

  const trimmedName = nameValue.trim()
  const nameValid = trimmedName !== '' && [...trimmedName].length <= MAX_NAME_LENGTH
  const nameDirty = trimmedName !== saved.name
  const slugValid = isOrganizationSlug(slugValue)
  const slugDirty = slugValue !== saved.slug
  const suggestion = suggestSlug(trimmedName)

  // The address as a guest will see it: what is typed while it is a valid address name.
  const shownSlug = slugValid ? slugValue : saved.slug
  const preview = isOrganizationSlug(shownSlug)
    ? guestMenuPath({ organization: shownSlug, venue: EXAMPLE_VENUE })
    : `/m/${shownSlug}/${EXAMPLE_VENUE}`

  function submitName(event: FormEvent) {
    event.preventDefault()
    if (!canEdit || !nameValid || !nameDirty || namePending) return
    setNameError(null)
    startName(async () => {
      const result = await updateOrganizationAction({ name: trimmedName }).catch(
        () => ({ ok: false, error: 'failed' }) as const,
      )
      if (result.ok) {
        setSaved((previous) => ({ ...previous, name: result.name }))
        setNameValue(result.name)
        toast.success(t('name.saved'))
      } else {
        setNameError(result.error)
      }
    })
  }

  function submitSlug(event: FormEvent) {
    event.preventDefault()
    if (!canEdit || !slugValid || !slugDirty || slugPending) return
    setSlugError(null)
    startSlug(async () => {
      const result = await updateOrganizationAction({ slug: slugValue }).catch(
        () => ({ ok: false, error: 'failed' }) as const,
      )
      if (result.ok) {
        setSaved((previous) => ({ ...previous, slug: result.slug }))
        setSlugValue(result.slug)
        if (result.filesQueued) toast.success(t('address.saved'))
        else toast.warning(t('address.savedLate'))
      } else {
        setSlugError(result.error)
      }
    })
  }

  return (
    <div className="grid gap-8" data-testid="organization-general">
      <form onSubmit={submitName} noValidate data-testid="general-name-form">
        <FormSection
          title={t('name.title')}
          description={t('name.description')}
          actions={
            canEdit ? (
              <Button
                type="submit"
                disabled={namePending || !nameValid || !nameDirty}
                data-testid="general-name-save"
              >
                {namePending ? t('name.saving') : t('name.save')}
              </Button>
            ) : null
          }
        >
          {canEdit ? (
            <div className="grid gap-2">
              <Label htmlFor={`${formId}-name`}>{t('name.label')}</Label>
              <Input
                id={`${formId}-name`}
                value={nameValue}
                onChange={(event) => {
                  setNameValue(event.target.value)
                  setNameError(null)
                }}
                maxLength={MAX_NAME_LENGTH}
                autoComplete="organization"
                aria-invalid={!nameValid || nameError !== null || undefined}
                data-testid="general-name-input"
              />
              {!nameValid ? (
                <p
                  className="text-sm text-destructive"
                  role="alert"
                  data-testid="general-name-invalid"
                >
                  {t('name.invalid')}
                </p>
              ) : null}
              {nameError !== null ? (
                <p
                  className="text-sm text-destructive"
                  role="alert"
                  data-testid="general-name-error"
                >
                  {t(`errors.${nameError}`)}
                </p>
              ) : null}
            </div>
          ) : (
            <div className="grid gap-1">
              <p className="text-sm font-medium" data-testid="general-name-text">
                {saved.name}
              </p>
              <p className="text-xs text-muted-foreground" data-testid="general-read-only">
                {t('readOnly')}
              </p>
            </div>
          )}
        </FormSection>
      </form>

      <form onSubmit={submitSlug} noValidate data-testid="general-slug-form">
        <FormSection
          title={t('address.title')}
          description={t('address.description')}
          actions={
            canEdit ? (
              <Button
                type="submit"
                disabled={slugPending || !slugValid || !slugDirty}
                data-testid="general-slug-save"
              >
                {slugPending ? t('address.saving') : t('address.save')}
              </Button>
            ) : null
          }
        >
          {canEdit ? (
            <div className="grid gap-2">
              <Label htmlFor={`${formId}-slug`}>{t('address.label')}</Label>
              <div className="flex flex-wrap items-center gap-2">
                <div className="flex w-full max-w-sm items-center gap-2">
                  <span aria-hidden className="font-mono text-sm text-muted-foreground">
                    /m/
                  </span>
                  <Input
                    id={`${formId}-slug`}
                    value={slugValue}
                    onChange={(event) => {
                      // Lower-case as typed, and a space becomes a hyphen.
                      setSlugValue(event.target.value.toLowerCase().replace(/\s+/g, '-'))
                      setSlugError(null)
                    }}
                    maxLength={MAX_ORGANIZATION_SLUG_LENGTH}
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck={false}
                    className="min-w-0 flex-1 font-mono"
                    aria-invalid={!slugValid || slugError !== null || undefined}
                    aria-describedby={`${formId}-slug-help`}
                    data-testid="general-slug-input"
                  />
                </div>
                <Button
                  type="button"
                  variant="outline"
                  disabled={slugPending || suggestion === '' || suggestion === slugValue}
                  onClick={() => {
                    setSlugValue(suggestion)
                    setSlugError(null)
                  }}
                  data-testid="general-slug-suggest"
                >
                  {t('address.suggest')}
                </Button>
              </div>
              {!slugValid ? (
                <p
                  className="text-sm text-destructive"
                  role="alert"
                  data-testid="general-slug-invalid"
                >
                  {t('address.invalid')}
                </p>
              ) : null}
              {slugError !== null ? (
                <p
                  className="text-sm text-destructive"
                  role="alert"
                  data-testid="general-slug-error"
                >
                  {t(`errors.${slugError}`)}
                </p>
              ) : null}
              <p id={`${formId}-slug-help`} className="text-xs text-muted-foreground">
                {t('address.help')}
              </p>
            </div>
          ) : (
            <p className="font-mono text-sm font-medium" data-testid="general-slug-text">
              {saved.slug}
            </p>
          )}

          <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
            {t('address.example')}
            <code
              className="break-all rounded-md bg-muted px-2 py-1 font-mono text-foreground ring-1 ring-border"
              data-testid="general-slug-preview"
            >
              {preview}
            </code>
          </p>
          {canEdit ? (
            <p className="text-xs text-muted-foreground" data-testid="general-slug-keep">
              {t('address.keep')}
            </p>
          ) : (
            <p className="text-xs text-muted-foreground" data-testid="general-slug-read-only">
              {t('readOnly')}
            </p>
          )}
        </FormSection>
      </form>
    </div>
  )
}
