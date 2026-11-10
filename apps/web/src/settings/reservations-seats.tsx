'use client'

// "Seats" on Settings › Reservations (#325; D134, log 1.22): the venue's spots, one number each,
// every one saving at once with Undo. Part 1 ships no plan editor, so the seats are the one thing of
// a spot the venue sets itself; no geometry and no kinds are edited here. The number is a warning's
// input only ("more guests than seats"), never a refusal. Empty seats are the spot's kind default.
import { useTranslations } from 'next-intl'
import { useEffect, useState } from 'react'

import { Empty, EmptyDescription, EmptyHeader } from '@/components/ui/empty'
import { Input } from '@/components/ui/input'
import { setSpotSeatsAction } from '@/server/settings/reservations-actions'
import type { ReservationsView } from '@/server/settings/reservations-view'

import { SettingValue } from './settings-row'
import type { useSettingsRun } from './use-settings-run'

/** What a spot's seats are bounded by (the command's own range). */
const MIN_SEATS = 1
const MAX_SEATS = 100

type Spot = ReservationsView['settings']['spots'][number]

export function SpotSeatsCard({
  view,
  runner,
}: {
  view: ReservationsView
  runner: ReturnType<typeof useSettingsRun>
}) {
  const t = useTranslations('ownerSettings')
  const spots = view.settings.spots
  return (
    <section className="grid grid-cols-1 gap-3" data-testid="rs-seats">
      <div className="grid grid-cols-1 gap-1">
        <h3 className="font-medium">{t('rs_seats_h')}</h3>
        <p className="text-sm text-muted-foreground">{t('rs_seats_d')}</p>
      </div>
      {spots.length === 0 ? (
        <Empty data-testid="rs-seats-empty">
          <EmptyHeader>
            <EmptyDescription>{t('rs_seats_empty')}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <ul className="grid grid-cols-1 divide-y rounded-lg border bg-card">
          {spots.map((spot) => (
            <SeatRow
              key={spot.id}
              venueId={view.venueId}
              spot={spot}
              can={view.canChange}
              runner={runner}
            />
          ))}
        </ul>
      )}
    </section>
  )
}

/** One spot: its name and kind, and its seats as a number saved when it is left. */
function SeatRow({
  venueId,
  spot,
  can,
  runner,
}: {
  venueId: string
  spot: Spot
  can: boolean
  runner: ReturnType<typeof useSettingsRun>
}) {
  const t = useTranslations('ownerSettings')
  const { run } = runner
  const saved = spot.seats === null ? '' : String(spot.seats)
  const [text, setText] = useState(saved)
  const [problem, setProblem] = useState(false)
  useEffect(() => {
    setText(saved)
    setProblem(false)
  }, [saved])
  const id = `rs-seats-${spot.id}`

  function save() {
    const typed = text.trim()
    if (typed === saved) {
      setProblem(false)
      return
    }
    const seats = typed === '' ? null : Number(typed)
    if (seats !== null && (!Number.isInteger(seats) || seats < MIN_SEATS || seats > MAX_SEATS)) {
      setProblem(true)
      return
    }
    setProblem(false)
    const previous = spot.seats
    run(() => setSpotSeatsAction({ venueId, spotId: spot.id, seats }), {
      done: t('rs_seats_saved'),
      onFail: () => setText(saved),
      undo: () => setSpotSeatsAction({ venueId, spotId: spot.id, seats: previous }),
    })
  }

  return (
    <li
      className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 p-3"
      data-testid="rs-spot-row"
    >
      <label htmlFor={id} className="grid min-w-0 flex-1 basis-40 grid-cols-1 gap-0.5">
        <span className="break-words">{spot.name}</span>
        <span className="break-words text-sm text-muted-foreground">{spot.kindLabel}</span>
      </label>
      {can ? (
        <div className="grid grid-cols-1 gap-1">
          <Input
            id={id}
            inputMode="numeric"
            className="w-24 max-w-full"
            value={text}
            placeholder={spot.kindSeats === null ? '–' : String(spot.kindSeats)}
            aria-invalid={problem ? true : undefined}
            aria-describedby={problem ? `${id}-problem` : undefined}
            data-testid="rs-spot-seats"
            onChange={(event) => {
              setText(event.target.value)
              setProblem(false)
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') save()
              if (event.key === 'Escape') {
                setText(saved)
                setProblem(false)
              }
            }}
            onBlur={save}
          />
          {problem ? (
            <p id={`${id}-problem`} className="text-sm text-destructive" role="alert">
              {t('rs_seats_bad', { min: MIN_SEATS, max: MAX_SEATS })}
            </p>
          ) : null}
        </div>
      ) : (
        <SettingValue testId="rs-spot-seats-value">
          {spot.seats ?? spot.kindSeats ?? '–'}
        </SettingValue>
      )}
    </li>
  )
}
