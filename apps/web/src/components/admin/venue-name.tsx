'use client'

// The name of a venue in its Settings tab (brief CF-18, D76). Owners and admins get a field next to
// the address card; everyone else sees the name. The rules are the server action's
// (`renameVenueAction`): this collects the name, checks its length while it is typed and shows the
// answer. A new name reaches guests with the next publish, which the toast says, as the Design tab
// does. The sidebar and the page title follow at once: the action revalidates the layout.
import { useTranslations } from 'next-intl'
import { type FormEvent, useId, useState, useTransition } from 'react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { renameVenueAction } from '@/server/venues-actions'
import type { RenameVenueError } from '@/server/venues-result'

/** The same limit as creating a venue (core's `MAX_VENUE_NAME_LENGTH`). */
const MAX_NAME_LENGTH = 120

interface VenueNameProps {
  readonly venueId: string
  readonly name: string
  /** Owner or admin: may rename. Decided again by the action. */
  readonly canEdit: boolean
}

export function VenueName({ venueId, name, canEdit }: VenueNameProps) {
  const t = useTranslations('workspace.settings.rename')
  const formId = useId()
  const [saved, setSaved] = useState(name)
  const [value, setValue] = useState(name)
  const [error, setError] = useState<RenameVenueError | null>(null)
  const [pending, startTransition] = useTransition()

  if (!canEdit) return <span data-testid="venue-name">{name}</span>

  const trimmed = value.trim()
  const valid = trimmed.length > 0 && trimmed.length <= MAX_NAME_LENGTH
  const dirty = trimmed !== saved

  function submit(event: FormEvent) {
    event.preventDefault()
    if (!valid || !dirty || pending) return
    setError(null)
    startTransition(async () => {
      const result = await renameVenueAction({ venueId, name: trimmed }).catch(
        () => ({ ok: false, error: 'failed' }) as const,
      )
      if (result.ok) {
        setSaved(result.name)
        setValue(result.name)
        toast.success(t('saved'))
      } else {
        setError(result.error)
      }
    })
  }

  return (
    <form
      onSubmit={submit}
      className="grid grid-cols-1 gap-2"
      noValidate
      data-testid="venue-name-form"
    >
      <Label htmlFor={`${formId}-name`} className="sr-only">
        {t('label')}
      </Label>
      <div className="flex flex-wrap items-center gap-2">
        <Input
          id={`${formId}-name`}
          value={value}
          onChange={(event) => {
            setValue(event.target.value)
            setError(null)
          }}
          maxLength={MAX_NAME_LENGTH}
          className="w-full max-w-xs"
          aria-invalid={!valid || error !== null || undefined}
          aria-describedby={`${formId}-name-help`}
          data-testid="venue-name-input"
        />
        <Button type="submit" disabled={pending || !valid || !dirty} data-testid="venue-name-save">
          {pending ? t('saving') : t('save')}
        </Button>
      </div>
      {!valid ? (
        <p className="text-sm text-destructive" role="alert" data-testid="venue-name-invalid">
          {t('invalid')}
        </p>
      ) : null}
      {error !== null ? (
        <p className="text-sm text-destructive" role="alert" data-testid="venue-name-error">
          {t(`errors.${error}`)}
        </p>
      ) : null}
      <p id={`${formId}-name-help`} className="text-xs text-muted-foreground">
        {t('help')}
      </p>
    </form>
  )
}
