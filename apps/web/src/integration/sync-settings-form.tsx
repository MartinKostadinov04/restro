'use client'

// The schedule of the Automatic sync card (brief S3-04, decisions D59 and D73): when the till is
// read (the change check and the daily full pull, each on or off, with its interval or time of
// day), for the whole installation, in the integration's time zone ("Sofia time"). Every control
// carries a one-line explanation. They are saved together, whole, and the worker follows them from
// its next tick. Owners and admins change them; everyone else sees them read-only. The publishing
// rules (publish after a sync, new items) are not here any more: each venue has its own.
import { CLOCK_TIME_PATTERN, INCREMENTAL_MINUTES, type IncrementalMinutes } from '@restro/core'
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

export function SyncSettingsForm({ view }: { view: IntegrationView }) {
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
  const [error, setError] = useState<IntegrationErrorCode | null>(null)
  const [done, setDone] = useState(false)
  const [pending, startTransition] = useTransition()
  const editable = view.integration !== null && view.canManage

  const timeValid = CLOCK_TIME_PATTERN.test(fullPullTime)
  const dirty =
    incrementalEnabled !== saved.incrementalEnabled ||
    incrementalMinutes !== saved.incrementalMinutes ||
    fullPullEnabled !== saved.fullPullEnabled ||
    fullPullTime !== saved.fullPullTime

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
        schedule: {
          incremental_enabled: incrementalEnabled,
          incremental_minutes: incrementalMinutes,
          full_pull_enabled: fullPullEnabled,
          full_pull_time: fullPullTime,
        },
      })
      if (result.ok) setDone(true)
      else setError(result.error)
    })
  }

  // The integration's clock, named the way people say it ("Sofia time").
  const zoneName = view.timeZone === 'Europe/Sofia' ? t('zoneSofia') : view.timeZone
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
            {t('fullPull.timeHelp', { zone: zoneName })}
          </p>
        </div>
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
