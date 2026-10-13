'use client'

// Settings › Publish = the venue's Automation settings (D82, D96, T76), for a venue with a till:
//
//   Sync       automatic (a change check every N minutes, and a full read daily at HH:MM in the
//              venue's own time zone) or manual (only when someone presses "Sync this venue");
//   Publish    after a sync, publish by itself, or wait until a person presses Publish.
//
// Both are the venue's own. Until it saves them the venue follows what its connection said before
// the settings moved here ("inherited"), so nothing changed for it; a save writes both as its own.
// The "new items from the till" rule is gone (D96). Owners and admins change them; everyone else
// sees what is set.
import {
  AFTER_SYNC_MODES,
  type AfterSyncMode,
  CLOCK_TIME_PATTERN,
  INCREMENTAL_MINUTES,
  type IncrementalMinutes,
  SYNC_MODES,
  type SyncMode,
} from '@restro/core'
import { useTranslations } from 'next-intl'
import { type FormEvent, useId, useState, useTransition } from 'react'

import { Button } from '@/components/ui/button'
import { FormSection } from '@/components/ui/form-section'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { saveAutomationAction } from '@/server/publish/actions'
import type { PublishActionError } from '@/server/publish/service'
import type { AutomationView } from '@/server/publish/view'

/** One choice of a radio group, with a line of help. */
function Choice<T extends string>({
  name,
  value,
  current,
  onSelect,
  label,
  help,
  disabled,
  testId,
}: {
  name: string
  value: T
  current: T
  onSelect: (value: T) => void
  label: string
  help: string
  disabled: boolean
  testId: string
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
        data-testid={testId}
      />
      <span className="grid gap-0.5">
        <span className="font-medium">{label}</span>
        <span className="text-xs text-muted-foreground">{help}</span>
      </span>
    </label>
  )
}

export function AutomationSettings({
  venueId,
  canManage,
  view,
}: {
  venueId: string
  canManage: boolean
  view: AutomationView
}) {
  const t = useTranslations('publish.automation')
  const errors = useTranslations('publish.errors')
  const formId = useId()
  const source = view.source
  const [mode, setMode] = useState<SyncMode>(view.sync.mode)
  const [minutes, setMinutes] = useState<IncrementalMinutes>(view.sync.incremental_minutes)
  const [time, setTime] = useState(view.sync.full_pull_time)
  const [afterSync, setAfterSync] = useState<AfterSyncMode>(view.afterSync)
  const [error, setError] = useState<PublishActionError | null>(null)
  const [saved, setSaved] = useState(false)
  const [pending, startTransition] = useTransition()

  const inherited = view.syncInherited || view.afterSyncInherited
  const timeValid = CLOCK_TIME_PATTERN.test(time)
  // Saving also makes inherited values the venue's own, so an unchanged form is worth saving then.
  const dirty =
    mode !== view.sync.mode ||
    minutes !== view.sync.incremental_minutes ||
    time !== view.sync.full_pull_time ||
    afterSync !== view.afterSync ||
    inherited
  const edit = <T,>(set: (value: T) => void) => (value: T) => {
    set(value)
    setSaved(false)
  }

  function submit(event: FormEvent) {
    event.preventDefault()
    if (!timeValid) return
    setError(null)
    setSaved(false)
    startTransition(async () => {
      const result = await saveAutomationAction({
        venueId,
        sync: { mode, incremental_minutes: minutes, full_pull_time: time },
        afterSync,
      })
      if (result.ok) setSaved(true)
      else setError(result.error)
    })
  }

  return (
    <FormSection title={t('title')} description={t('description', { source })}>
      <form onSubmit={submit} className="grid gap-5" data-testid="automation-form">
        <fieldset className="grid gap-2" disabled={!canManage}>
          <legend className="mb-1 text-sm font-medium">{t('sync.legend', { source })}</legend>
          {SYNC_MODES.map((value) => (
            <Choice
              key={value}
              name={`${formId}-sync`}
              value={value}
              current={mode}
              onSelect={edit(setMode)}
              label={t(`sync.${value}`)}
              help={t(`sync.${value}Help`, { source })}
              disabled={!canManage}
              testId={`automation-sync-${value}`}
            />
          ))}
          {mode === 'auto' ? (
            <div className="grid gap-4 rounded-md border border-dashed p-3 sm:grid-cols-2">
              <div className="grid gap-1.5">
                <Label htmlFor={`${formId}-minutes`}>{t('sync.interval')}</Label>
                <Select
                  value={String(minutes)}
                  onValueChange={(value) =>
                    edit(setMinutes)(Number(value) as IncrementalMinutes)
                  }
                  disabled={!canManage}
                >
                  <SelectTrigger id={`${formId}-minutes`} data-testid="automation-interval">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {INCREMENTAL_MINUTES.map((value) => (
                      <SelectItem key={value} value={String(value)}>
                        {t('sync.minutes', { count: value })}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor={`${formId}-time`}>{t('sync.fullRead')}</Label>
                <div className="flex items-center gap-2">
                  <Input
                    id={`${formId}-time`}
                    type="time"
                    step={60}
                    className="w-32"
                    value={time}
                    onChange={(event) => edit(setTime)(event.target.value)}
                    aria-invalid={!timeValid}
                    disabled={!canManage}
                    data-testid="automation-time"
                  />
                  <span className="text-xs text-muted-foreground" data-testid="automation-zone">
                    {view.timeZone}
                  </span>
                </div>
                {timeValid ? null : (
                  <p role="alert" className="text-xs text-destructive">
                    {t('sync.timeInvalid')}
                  </p>
                )}
              </div>
            </div>
          ) : null}
        </fieldset>

        <fieldset className="grid gap-2" disabled={!canManage}>
          <legend className="mb-1 text-sm font-medium">{t('afterSync.legend')}</legend>
          {AFTER_SYNC_MODES.map((value) => (
            <Choice
              key={value}
              name={`${formId}-after-sync`}
              value={value}
              current={afterSync}
              onSelect={edit(setAfterSync)}
              label={t(`afterSync.${value}`)}
              help={t(`afterSync.${value}Help`, { source })}
              disabled={!canManage}
              testId={`automation-after-${value}`}
            />
          ))}
        </fieldset>

        {inherited ? (
          <p className="text-xs text-muted-foreground" data-testid="automation-inherited">
            {t('inherited')}
          </p>
        ) : null}
        {error !== null ? (
          <p role="alert" className="text-sm text-destructive" data-testid="automation-error">
            {errors(error)}
          </p>
        ) : null}
        {saved ? (
          <p role="status" className="text-sm text-muted-foreground" data-testid="automation-saved">
            {t('saved')}
          </p>
        ) : null}
        {canManage ? (
          <div className="flex justify-end">
            <Button
              type="submit"
              disabled={pending || !dirty || !timeValid}
              data-testid="automation-save"
            >
              {pending ? t('saving') : t('save')}
            </Button>
          </div>
        ) : null}
      </form>
    </FormSection>
  )
}
