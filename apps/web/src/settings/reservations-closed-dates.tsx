'use client'

// "One-off closed dates" on Settings › Reservations (#325; D136): the nights the club is shut on top
// of its service hours. A list of records, newest first: "Add a closed date" is a one-field dialog,
// and removing one is one tap with the undo toast (no dialog: it comes back with Undo). Both save at
// once through the closed-date commands. Nothing yet is the empty-state block.
import { XIcon } from 'lucide-react'
import { useFormatter, useTranslations } from 'next-intl'
import { type FormEvent, useState } from 'react'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Empty, EmptyDescription, EmptyHeader } from '@/components/ui/empty'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { addClosedDateAction, removeClosedDateAction } from '@/server/settings/reservations-actions'
import type { ReservationsView } from '@/server/settings/reservations-view'

import type { useSettingsRun } from './use-settings-run'

/** `YYYY-MM-DD` as a date to read: "Fri, 14 Nov 2026" in the language of the screen. */
function useDateWords() {
  const format = useFormatter()
  return (date: string): string =>
    format.dateTime(new Date(`${date}T12:00:00Z`), {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      timeZone: 'UTC',
    })
}

export function ClosedDatesCard({
  view,
  runner,
  enabled,
}: {
  view: ReservationsView
  runner: ReturnType<typeof useSettingsRun>
  /** The person may change it and the venue's settings row exists. */
  enabled: boolean
}) {
  const t = useTranslations('ownerSettings')
  const words = useDateWords()
  const { pending, run } = runner
  const dates = view.settings.closedDates
  const [open, setOpen] = useState(false)

  function remove(date: string) {
    run(() => removeClosedDateAction({ venueId: view.venueId, date }), {
      done: t('rs_closed_removed'),
      undo: () => addClosedDateAction({ venueId: view.venueId, date }),
    })
  }

  return (
    <section className="grid grid-cols-1 gap-3" data-testid="rs-closed">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <h3 className="min-w-0 break-words font-medium">{t('rs_closed_h')}</h3>
        {enabled && dates.length > 0 ? (
          <Button
            variant="outline"
            className="h-auto max-w-full whitespace-normal py-2 text-left"
            disabled={pending}
            onClick={() => setOpen(true)}
            data-testid="rs-closed-add"
          >
            {t('rs_closed_add')}
          </Button>
        ) : null}
      </div>

      {dates.length === 0 ? (
        <Empty data-testid="rs-closed-empty">
          <EmptyHeader>
            <EmptyDescription>{t('rs_closed_empty')}</EmptyDescription>
          </EmptyHeader>
          {enabled ? (
            <Button
              className="h-auto max-w-full whitespace-normal py-2"
              disabled={pending}
              onClick={() => setOpen(true)}
              data-testid="rs-closed-add"
            >
              {t('rs_closed_add')}
            </Button>
          ) : null}
        </Empty>
      ) : (
        <ul className="grid grid-cols-1 divide-y rounded-lg border bg-card">
          {dates.map((date) => (
            <li
              key={date}
              className="flex items-center justify-between gap-3 p-3"
              data-testid="rs-closed-row"
              data-date={date}
            >
              <span className="min-w-0 break-words tabular-nums">{words(date)}</span>
              {enabled ? (
                <Button
                  variant="ghost"
                  size="icon"
                  disabled={pending}
                  aria-label={t('rs_closed_remove', { date: words(date) })}
                  onClick={() => remove(date)}
                  data-testid="rs-closed-remove"
                >
                  <XIcon aria-hidden />
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        {open ? (
          <AddClosedDate
            dates={dates}
            pending={pending}
            onAdd={(date) => {
              setOpen(false)
              run(() => addClosedDateAction({ venueId: view.venueId, date }), {
                done: t('rs_closed_added'),
                undo: () => removeClosedDateAction({ venueId: view.venueId, date }),
              })
            }}
          />
        ) : null}
      </Dialog>
    </section>
  )
}

/** The one-field dialog: which night. It is mounted on every opening, so it starts empty. */
function AddClosedDate({
  dates,
  pending,
  onAdd,
}: {
  dates: readonly string[]
  pending: boolean
  onAdd: (date: string) => void
}) {
  const t = useTranslations('ownerSettings')
  const [date, setDate] = useState('')
  const [problem, setProblem] = useState<'empty' | 'listed' | null>(null)

  function submit(event: FormEvent) {
    event.preventDefault()
    if (date === '') return setProblem('empty')
    // Adding a night that is already closed would offer an Undo that opens it again: say so instead.
    if (dates.includes(date)) return setProblem('listed')
    onAdd(date)
  }

  return (
    <DialogContent data-testid="rs-closed-dialog">
      <form onSubmit={submit} className="grid grid-cols-1 gap-4" noValidate>
        <DialogHeader>
          <DialogTitle>{t('rs_closed_add')}</DialogTitle>
          <DialogDescription>{t('rs_closed_dialog_d')}</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-1 gap-2">
          <Label htmlFor="rs-closed-date">{t('rs_closed_date')}</Label>
          <Input
            id="rs-closed-date"
            type="date"
            value={date}
            autoFocus
            aria-invalid={problem === null ? undefined : true}
            aria-describedby={problem === null ? undefined : 'rs-closed-problem'}
            data-testid="rs-closed-date"
            onChange={(event) => {
              setDate(event.target.value)
              setProblem(null)
            }}
          />
          {problem === null ? null : (
            <p id="rs-closed-problem" className="text-sm text-destructive" role="alert">
              {t(problem === 'empty' ? 'rs_closed_pick' : 'rs_closed_listed')}
            </p>
          )}
        </div>
        <DialogFooter>
          <Button type="submit" disabled={pending} data-testid="rs-closed-confirm">
            {t('rs_closed_confirm')}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  )
}
