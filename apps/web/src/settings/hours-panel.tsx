'use client'

// Settings › Hours (#87, plan `2026-10-27-settings-hours-ordering-plan.md` §3): seven rows Monday
// first, each with a switch and "23:00 – 05:00 · last orders 04:30"; switching a closed day on
// opens its dialog, tapping an open row opens it too; switching a day off saves at once with Undo.
// Before opening: the pre-opening check's timing, only for a venue with a POS. Writes go through
// `settings.ordering_set`, which checks `settings.guards` and the sign-in again.
import type { ServiceHours, ServiceHoursOfDay } from '@restro/core'
import { PencilIcon } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useEffect, useState } from 'react'

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
import { Switch } from '@/components/ui/switch'
import { useTillLabel } from '@/fields/till-label'
import { saveOrderingAction } from '@/server/settings/ordering-actions'
import type { OrderingView } from '@/server/settings/ordering-view'

import {
  CHOICES,
  dayEndText,
  hoursProblemOf,
  isNextMorning,
  nearestOpenDay,
  noNightOpen,
  WEEKDAYS,
  type Weekday,
} from './hours'
import { ReadOnlyLine } from './section-notices'
import { useDuration } from './use-duration'
import { useSettingsRun } from './use-settings-run'

export function HoursPanel({ view }: { view: OrderingView }) {
  const t = useTranslations('ownerSettings')
  const runner = useSettingsRun(view.email)
  const { pending, run } = runner
  const hours = view.settings.serviceHours
  const dayEnd = dayEndText(view.dayEndsAt)
  const [editing, setEditing] = useState<Weekday | null>(null)

  function saveHours(next: ServiceHours, options: { onOk?: () => void } = {}) {
    const previous = hours
    run(() => saveOrderingAction({ venueId: view.venueId, changes: { serviceHours: next } }), {
      done: view.openNow ? `${t('st_saved')} ${t('st_now')}` : t('st_saved'),
      undo: () =>
        saveOrderingAction({ venueId: view.venueId, changes: { serviceHours: previous } }),
      ...(options.onOk === undefined ? {} : { onOk: options.onOk }),
    })
  }

  function switchDay(day: Weekday, on: boolean) {
    if (on) {
      setEditing(day)
      return
    }
    saveHours({ ...hours, [day]: null })
  }

  return (
    <div className="grid gap-4" data-testid="hours-panel" aria-busy={pending}>
      <div>
        <h2 className="text-xl font-semibold tracking-tight">{t('st_hours')}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{t('st_hours_lede', { dayEnd })}</p>
      </div>
      {view.canChange ? null : <ReadOnlyLine />}
      {noNightOpen(hours) ? (
        <p className="text-sm font-medium" data-testid="hours-none">
          {t('st_hours_none')}
        </p>
      ) : null}
      <ul className="divide-y rounded-lg border bg-card" data-testid="hours-days">
        {WEEKDAYS.map((day) => {
          const of = hours[day]
          const name = t(`st_day.${day}`)
          return (
            <li key={day} className="flex flex-wrap items-center gap-x-3 gap-y-1 p-3">
              {view.canChange ? (
                <Switch
                  checked={of !== null}
                  disabled={pending}
                  onCheckedChange={(on) => switchDay(day, on)}
                  aria-label={name}
                />
              ) : null}
              <span className="w-28 shrink-0 font-medium">{name}</span>
              {of === null ? (
                <span className="text-sm text-muted-foreground">{t('st_closed')}</span>
              ) : view.canChange ? (
                <button
                  type="button"
                  className="min-w-0 flex-1 rounded-md px-2 py-1 text-left text-sm hover:bg-accent"
                  onClick={() => setEditing(day)}
                  aria-label={`${name}: ${t('st_change')}`}
                >
                  <DayLine of={of} />
                </button>
              ) : (
                <span className="min-w-0 flex-1 text-sm">
                  <DayLine of={of} />
                </span>
              )}
            </li>
          )
        })}
      </ul>
      {view.hasPos ? <PreOpening view={view} runner={runner} /> : null}
      <DayDialog
        day={editing}
        view={view}
        pending={pending}
        onClose={() => setEditing(null)}
        onSave={(next) => saveHours(next, { onOk: () => setEditing(null) })}
      />
      {runner.dialog}
    </div>
  )
}

/** "23:00 – 05:00 (next morning) · last orders 04:30". */
function DayLine({ of }: { of: ServiceHoursOfDay }) {
  const t = useTranslations('ownerSettings')
  const morning = (time: string) =>
    isNextMorning(time, of.opens) ? ` ${t('st_next_morning')}` : ''
  return (
    <span>
      {t('st_day_line', {
        opens: of.opens,
        closes: `${of.closes}${morning(of.closes)}`,
        last: `${of.lastOrders}${morning(of.lastOrders)}`,
      })}
    </span>
  )
}

/** The day's dialog: three times, "Same hours on" and Save; the problem shows under its field. */
function DayDialog({
  day,
  view,
  pending,
  onClose,
  onSave,
}: {
  day: Weekday | null
  view: OrderingView
  pending: boolean
  onClose: () => void
  onSave: (next: ServiceHours) => void
}) {
  const t = useTranslations('ownerSettings')
  const hours = view.settings.serviceHours
  const dayEnd = dayEndText(view.dayEndsAt)
  const [opens, setOpens] = useState('')
  const [lastOrders, setLastOrders] = useState('')
  const [closes, setCloses] = useState('')
  const [same, setSame] = useState<ReadonlySet<Weekday>>(new Set())
  const [tried, setTried] = useState(false)

  useEffect(() => {
    if (day === null) return
    const start = hours[day] ?? nearestOpenDay(hours, day)
    setOpens(start?.opens ?? '')
    setLastOrders(start?.lastOrders ?? '')
    setCloses(start?.closes ?? '')
    setSame(new Set())
    setTried(false)
  }, [day, hours])

  const complete = opens !== '' && lastOrders !== '' && closes !== ''
  const problem = complete ? hoursProblemOf({ opens, lastOrders, closes }, view.dayEndsAt) : null
  const shown = tried ? problem : null

  function toggle(other: Weekday, on: boolean) {
    setSame((current) => {
      const next = new Set(current)
      if (on) next.add(other)
      else next.delete(other)
      return next
    })
  }

  function submit() {
    setTried(true)
    if (day === null || !complete || problem !== null) return
    const entry = { opens, lastOrders, closes }
    const next: ServiceHours = { ...hours, [day]: entry }
    for (const other of same) next[other] = entry
    onSave(next)
  }

  return (
    <Dialog open={day !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <form
          className="grid gap-4"
          noValidate
          onSubmit={(event) => {
            event.preventDefault()
            submit()
          }}
        >
          <DialogHeader>
            <DialogTitle>{day === null ? '' : t(`st_day.${day}`)}</DialogTitle>
            <DialogDescription className="sr-only">
              {t('st_hours_lede', { dayEnd })}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 sm:grid-cols-3">
            <TimeField id="hours-opens" label={t('st_opens')} value={opens} onChange={setOpens} />
            <TimeField
              id="hours-last"
              label={t('st_last')}
              value={lastOrders}
              onChange={setLastOrders}
              problem={shown?.field === 'lastOrders' ? t(shown.key, { dayEnd }) : null}
            />
            <TimeField
              id="hours-closes"
              label={t('st_closes')}
              value={closes}
              onChange={setCloses}
              problem={shown?.field === 'closes' ? t(shown.key, { dayEnd }) : null}
            />
          </div>
          <fieldset className="grid gap-2">
            <legend className="text-sm font-medium">{t('st_same_on')}</legend>
            <div className="flex flex-wrap gap-x-4 gap-y-2">
              {WEEKDAYS.filter((other) => other !== day).map((other) => (
                <Label key={other} className="font-normal">
                  <Checkbox
                    checked={same.has(other)}
                    onCheckedChange={(on) => toggle(other, on === true)}
                  />
                  {t(`st_day_short.${other}`)}
                </Label>
              ))}
            </div>
          </fieldset>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              {t('st_cancel')}
            </Button>
            <Button type="submit" disabled={pending || !complete}>
              {t('st_save')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function TimeField({
  id,
  label,
  value,
  onChange,
  problem = null,
}: {
  id: string
  label: string
  value: string
  onChange: (value: string) => void
  problem?: string | null
}) {
  return (
    <div className="grid content-start gap-2">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        type="time"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        aria-invalid={problem === null ? undefined : true}
        aria-describedby={problem === null ? undefined : `${id}-problem`}
      />
      {problem === null ? null : (
        <p id={`${id}-problem`} className="text-sm text-destructive" role="alert">
          {problem}
        </p>
      )}
    </div>
  )
}

/** "From 2 h before opening Restro checks the connection to {pos} every 10 minutes…" and Change. */
function PreOpening({
  view,
  runner,
}: {
  view: OrderingView
  runner: ReturnType<typeof useSettingsRun>
}) {
  const t = useTranslations('ownerSettings')
  const source = useTillLabel()
  const duration = useDuration()
  const { pending, run } = runner
  const rule = view.settings.preOpeningCheck
  const [open, setOpen] = useState(false)
  const [start, setStart] = useState(rule.startMinutes)
  const [every, setEvery] = useState(rule.everyMinutes)
  const [alert, setAlert] = useState(rule.alertMinutes)
  useEffect(() => {
    if (!open) return
    setStart(rule.startMinutes)
    setEvery(rule.everyMinutes)
    setAlert(rule.alertMinutes)
  }, [open, rule.startMinutes, rule.everyMinutes, rule.alertMinutes])

  const alerts = CHOICES.preOpeningAlert.filter((minutes) => minutes <= start)
  return (
    <section className="grid gap-2" aria-labelledby="hours-preopen">
      <h3 id="hours-preopen" className="text-lg font-medium">
        {t('st_preopen_h')}
      </h3>
      <div className="flex flex-wrap items-start gap-3">
        <p className="min-w-0 flex-1 basis-64 text-sm" data-testid="hours-preopen">
          {t('st_preopen', {
            start: duration(rule.startMinutes),
            pos: source,
            every: duration(rule.everyMinutes),
            alert: duration(rule.alertMinutes),
          })}
        </p>
        {view.canChange ? (
          <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
            <PencilIcon aria-hidden />
            {t('st_change')}
          </Button>
        ) : null}
      </div>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <form
            className="grid gap-4"
            onSubmit={(event) => {
              event.preventDefault()
              setOpen(false)
              const previous = rule
              run(
                () =>
                  saveOrderingAction({
                    venueId: view.venueId,
                    changes: {
                      preOpeningCheck: {
                        startMinutes: start,
                        everyMinutes: every,
                        alertMinutes: Math.min(alert, start),
                      },
                    },
                  }),
                {
                  done: t('st_saved'),
                  undo: () =>
                    saveOrderingAction({
                      venueId: view.venueId,
                      changes: { preOpeningCheck: previous },
                    }),
                },
              )
            }}
          >
            <DialogHeader>
              <DialogTitle>{t('st_preopen_h')}</DialogTitle>
            </DialogHeader>
            <MinutesSelect
              id="pre-start"
              label={t('st_preopen_start')}
              value={start}
              choices={CHOICES.preOpeningStart}
              onChange={(minutes) => {
                setStart(minutes)
                setAlert((current) => Math.min(current, minutes))
              }}
            />
            <MinutesSelect
              id="pre-every"
              label={t('st_preopen_every')}
              value={every}
              choices={CHOICES.preOpeningEvery}
              onChange={setEvery}
            />
            <MinutesSelect
              id="pre-alert"
              label={t('st_preopen_alert')}
              value={Math.min(alert, start)}
              choices={alerts}
              onChange={setAlert}
            />
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                {t('st_cancel')}
              </Button>
              <Button type="submit" disabled={pending}>
                {t('st_save')}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </section>
  )
}

/** A Select of durations in minutes. */
export function MinutesSelect({
  id,
  label,
  value,
  choices,
  onChange,
}: {
  id: string
  label: string
  value: number
  choices: readonly number[]
  onChange: (minutes: number) => void
}) {
  const duration = useDuration()
  return (
    <div className="grid gap-2">
      {label === '' ? null : <Label htmlFor={id}>{label}</Label>}
      <Select value={String(value)} onValueChange={(next) => onChange(Number(next))}>
        <SelectTrigger id={id} className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {choices.map((minutes) => (
            <SelectItem key={minutes} value={String(minutes)}>
              {duration(minutes)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}
