'use client'

// The Rules card of a venue's Publishing tab (CF-09b, CF-04, D73): what happens when the till's
// menu changes, for this venue alone.
//
//   After a sync   publish by itself, or wait until a person presses Publish;
//   New items      show them on the menu, or keep them hidden until a manager has looked.
//
// Both are the venue's own: two venues on one catalogue can follow different rules. Until a venue
// saves them it follows what the connection said before the rules moved here ("inherited"), so
// nothing changed for any venue; a save writes both as the venue's. They apply from the venue's
// next sync. Owners and admins change them; everyone else sees what is set.
import {
  AFTER_SYNC_MODES,
  type AfterSyncMode,
  NEW_ITEMS_MODES,
  type NewItemsMode,
} from '@restro/core'
import { useTranslations } from 'next-intl'
import { type FormEvent, useId, useState, useTransition } from 'react'

import { Button } from '@/components/ui/button'
import { FormSection } from '@/components/ui/form-section'
import { savePublishRulesAction } from '@/server/publish/actions'
import type { PublishActionError } from '@/server/publish/service'
import type { PublishRulesView } from '@/server/publish/view'

/** The choices of a radio group, each with a one-line help. */
function Choice<T extends string>({
  name,
  value,
  current,
  onSelect,
  label,
  help,
  disabled,
}: {
  name: string
  value: T
  current: T
  onSelect: (value: T) => void
  label: string
  help: string
  disabled: boolean
}) {
  return (
    <label className="flex items-start gap-3 rounded-md border p-3 text-sm has-[:checked]:border-primary has-[:checked]:bg-accent has-[:disabled]:opacity-70">
      <input
        type="radio"
        name={name}
        value={value}
        className="mt-0.5 size-4 accent-primary"
        checked={current === value}
        disabled={disabled}
        onChange={() => onSelect(value)}
      />
      <span className="grid gap-0.5">
        <span className="font-medium">{label}</span>
        <span className="text-xs text-muted-foreground">{help}</span>
      </span>
    </label>
  )
}

export function RulesCard({
  venueId,
  canPublish,
  rules,
}: {
  venueId: string
  canPublish: boolean
  rules: PublishRulesView
}) {
  const t = useTranslations('publish.rules')
  const errors = useTranslations('publish.errors')
  const formId = useId()
  const [afterSync, setAfterSync] = useState<AfterSyncMode>(rules.afterSync)
  const [newItems, setNewItems] = useState<NewItemsMode>(rules.newItems)
  const [error, setError] = useState<PublishActionError | null>(null)
  const [saved, setSaved] = useState(false)
  const [pending, startTransition] = useTransition()

  // Saving also makes the venue's own what it followed, so an unchanged form is worth saving then.
  const dirty = afterSync !== rules.afterSync || newItems !== rules.newItems || rules.inherited

  function submit(event: FormEvent) {
    event.preventDefault()
    setError(null)
    setSaved(false)
    startTransition(async () => {
      const result = await savePublishRulesAction(venueId, { afterSync, newItems })
      if (result.ok) setSaved(true)
      else setError(result.error)
    })
  }

  return (
    <FormSection title={t('title')} description={t('description')}>
      <form onSubmit={submit} className="grid gap-5" data-testid="rules-form">
        <fieldset className="grid gap-2" disabled={!canPublish}>
          <legend className="mb-1 text-sm font-medium">{t('afterSync.legend')}</legend>
          {AFTER_SYNC_MODES.map((mode) => (
            <Choice
              key={mode}
              name={`${formId}-after-sync`}
              value={mode}
              current={afterSync}
              onSelect={(value) => {
                setAfterSync(value)
                setSaved(false)
              }}
              label={t(`afterSync.${mode}`)}
              help={t(`afterSync.${mode}Help`)}
              disabled={!canPublish}
            />
          ))}
        </fieldset>

        <fieldset className="grid gap-2" disabled={!canPublish}>
          <legend className="mb-1 text-sm font-medium">{t('newItems.legend')}</legend>
          {NEW_ITEMS_MODES.map((mode) => (
            <Choice
              key={mode}
              name={`${formId}-new-items`}
              value={mode}
              current={newItems}
              onSelect={(value) => {
                setNewItems(value)
                setSaved(false)
              }}
              label={t(`newItems.${mode}`)}
              help={t(`newItems.${mode}Help`)}
              disabled={!canPublish}
            />
          ))}
        </fieldset>

        {rules.inherited ? (
          <p className="text-xs text-muted-foreground" data-testid="rules-inherited">
            {t('inherited')}
          </p>
        ) : null}
        {error !== null ? (
          <p role="alert" className="text-sm text-destructive" data-testid="rules-error">
            {errors(error)}
          </p>
        ) : null}
        {saved ? (
          <p role="status" className="text-sm text-muted-foreground" data-testid="rules-saved">
            {t('saved')}
          </p>
        ) : null}
        {canPublish ? (
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
