'use client'

// The sync settings of the Synchronisation card (brief S3-04, decision D59): when barsy is read
// (the change check and the daily full pull, each on or off, with its interval or time of day in
// the venue's clock), whether a sync goes live by itself, and whether new items from barsy are
// shown or kept hidden until a manager reviews them. Every control carries a one-line
// explanation. They are saved together, whole, and the worker follows them from its next tick.
// Owners and admins change them; everyone else sees them read-only.
import {
  AFTER_SYNC_MODES,
  type AfterSyncMode,
  CLOCK_TIME_PATTERN,
  INCREMENTAL_MINUTES,
  type IncrementalMinutes,
  NEW_ITEMS_MODES,
  type NewItemsMode,
} from '@restro/core'
import { useFormatter, useTranslations } from 'next-intl'
import { type FormEvent, useId, useState, useTransition } from 'react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { saveSyncSettingsAction } from '@/server/integration/actions'
import type { IntegrationErrorCode, IntegrationView } from '@/server/integration/view'

import { ErrorNote, Notice } from './error-note'

/** The two choices of a radio group, each with a one-line help. */
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

export function SyncSettingsForm({ venueId, view }: { venueId: string; view: IntegrationView }) {
  const t = useTranslations('integration.sync.settings')
  const format = useFormatter()
  const formId = useId()
  const { syncSettings: saved } = view
  const [incrementalEnabled, setIncrementalEnabled] = useState(saved.incrementalEnabled)
  const [incrementalMinutes, setIncrementalMinutes] = useState<IncrementalMinutes>(
    saved.incrementalMinutes,
  )
  const [fullPullEnabled, setFullPullEnabled] = useState(saved.fullPullEnabled)
  const [fullPullTime, setFullPullTime] = useState(saved.fullPullTime)
  const [afterSync, setAfterSync] = useState<AfterSyncMode>(saved.afterSync)
  const [newItems, setNewItems] = useState<NewItemsMode>(saved.newItems)
  const [error, setError] = useState<IntegrationErrorCode | null>(null)
  const [done, setDone] = useState(false)
  const [pending, startTransition] = useTransition()
  const editable = view.integration !== null && view.canManage

  const timeValid = CLOCK_TIME_PATTERN.test(fullPullTime)
  const dirty =
    incrementalEnabled !== saved.incrementalEnabled ||
    incrementalMinutes !== saved.incrementalMinutes ||
    fullPullEnabled !== saved.fullPullEnabled ||
    fullPullTime !== saved.fullPullTime ||
    afterSync !== saved.afterSync ||
    newItems !== saved.newItems

  /** Any change takes the "saved" notice away. */
  function edited<T>(set: (value: T) => void) {
    return (value: T) => {
      set(value)
      setDone(false)
    }
  }

  function submit(event: FormEvent) {
    event.preventDefault()
    if (!timeValid) return
    setError(null)
    setDone(false)
    startTransition(async () => {
      const result = await saveSyncSettingsAction({
        venueId,
        schedule: {
          incremental_enabled: incrementalEnabled,
          incremental_minutes: incrementalMinutes,
          full_pull_enabled: fullPullEnabled,
          full_pull_time: fullPullTime,
        },
        publish: { after_sync: afterSync, new_items: newItems },
      })
      if (result.ok) setDone(true)
      else setError(result.error)
    })
  }

  const clock = (iso: string) =>
    format.dateTime(new Date(iso), {
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
      timeZone: view.timeZone,
    })
  const dayAndClock = (iso: string) =>
    format.dateTime(new Date(iso), {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
      timeZone: view.timeZone,
    })
  const nextText = (() => {
    if (!saved.scheduleActive) return t('next.inactive')
    const incremental = saved.nextIncrementalAt
    const fullPull = saved.nextFullPullAt
    if (incremental !== null && fullPull !== null) {
      return t('next.both', { incremental: clock(incremental), fullPull: dayAndClock(fullPull) })
    }
    if (incremental !== null) return t('next.incremental', { incremental: clock(incremental) })
    if (fullPull !== null) return t('next.fullPull', { fullPull: dayAndClock(fullPull) })
    return t('next.none')
  })()

  return (
    <form
      onSubmit={submit}
      className="grid gap-5 border-t pt-4"
      data-testid="sync-settings-form"
      aria-labelledby={`${formId}-heading`}
    >
      <h4 id={`${formId}-heading`} className="text-base font-medium">
        {t('heading')}
      </h4>

      <fieldset className="grid gap-3" disabled={!editable}>
        <div className="flex items-start gap-3">
          <Switch
            id={`${formId}-incremental`}
            checked={incrementalEnabled}
            onCheckedChange={edited(setIncrementalEnabled)}
            disabled={!editable}
            aria-describedby={`${formId}-incremental-help`}
          />
          <div className="grid gap-0.5">
            <Label htmlFor={`${formId}-incremental`}>{t('incremental.label')}</Label>
            <p id={`${formId}-incremental-help`} className="text-xs text-muted-foreground">
              {t('incremental.help')}
            </p>
          </div>
        </div>
        <div className="grid gap-1.5 ps-11">
          <Label htmlFor={`${formId}-interval`}>{t('incremental.every')}</Label>
          <Select
            value={String(incrementalMinutes)}
            onValueChange={(value) =>
              edited(setIncrementalMinutes)(Number(value) as IncrementalMinutes)
            }
            disabled={!editable || !incrementalEnabled}
          >
            <SelectTrigger id={`${formId}-interval`} className="w-full sm:w-56">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {INCREMENTAL_MINUTES.map((minutes) => (
                <SelectItem key={minutes} value={String(minutes)}>
                  {t('incremental.minutes', { minutes })}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </fieldset>

      <fieldset className="grid gap-3" disabled={!editable}>
        <div className="flex items-start gap-3">
          <Switch
            id={`${formId}-full`}
            checked={fullPullEnabled}
            onCheckedChange={edited(setFullPullEnabled)}
            disabled={!editable}
            aria-describedby={`${formId}-full-help`}
          />
          <div className="grid gap-0.5">
            <Label htmlFor={`${formId}-full`}>{t('fullPull.label')}</Label>
            <p id={`${formId}-full-help`} className="text-xs text-muted-foreground">
              {t('fullPull.help')}
            </p>
          </div>
        </div>
        <div className="grid gap-1.5 ps-11">
          <Label htmlFor={`${formId}-time`}>{t('fullPull.time')}</Label>
          <Input
            id={`${formId}-time`}
            type="time"
            step={60}
            className="sm:w-40"
            value={fullPullTime}
            onChange={(event) => edited(setFullPullTime)(event.target.value)}
            disabled={!editable || !fullPullEnabled}
            aria-invalid={!timeValid}
            aria-describedby={`${formId}-time-help`}
          />
          <p id={`${formId}-time-help`} className="text-xs text-muted-foreground">
            {t('fullPull.timeHelp', { zone: view.timeZone })}
          </p>
        </div>
      </fieldset>

      <fieldset className="grid gap-2" disabled={!editable}>
        <legend className="mb-1 text-sm font-medium">{t('afterSync.legend')}</legend>
        {AFTER_SYNC_MODES.map((mode) => (
          <Choice
            key={mode}
            name={`${formId}-after-sync`}
            value={mode}
            current={afterSync}
            onSelect={edited(setAfterSync)}
            label={t(`afterSync.${mode}`)}
            help={t(`afterSync.${mode}Help`)}
            disabled={!editable}
          />
        ))}
      </fieldset>

      <fieldset className="grid gap-2" disabled={!editable}>
        <legend className="mb-1 text-sm font-medium">{t('newItems.legend')}</legend>
        {NEW_ITEMS_MODES.map((mode) => (
          <Choice
            key={mode}
            name={`${formId}-new-items`}
            value={mode}
            current={newItems}
            onSelect={edited(setNewItems)}
            label={t(`newItems.${mode}`)}
            help={t(`newItems.${mode}Help`)}
            disabled={!editable}
          />
        ))}
      </fieldset>

      <p className="text-sm text-muted-foreground" data-testid="sync-next">
        {nextText}
      </p>
      <ErrorNote code={error} />
      {done ? <Notice>{t('saved')}</Notice> : null}
      {editable ? (
        <div className="flex justify-end">
          <Button type="submit" disabled={pending || !dirty || !timeValid}>
            {pending ? t('saving') : t('save')}
          </Button>
        </div>
      ) : null}
    </form>
  )
}
