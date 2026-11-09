'use client'

// Venue › Reservations, the floor plan (#327; D134, D137, D141, D123, D107). The second view of
// the tab: the club's own room, every spot with its name, its kind's symbol and its state tonight,
// and a legend that names all five states — a hostess must read this at a glance at 02:00, so the
// state is never a colour alone and never behind a toggle.
//
// It only reads the plan. The two writes it offers — keep a spot back from booking, and lift that
// block — go through the service write path like every other service write (rule 1), and each one
// is a tap on the spot's own sheet, never a drag.
//
// Moving and zooming is `plan-zoom.ts`: pinch, wheel and drag, the −, + and "fit" buttons (which
// is the alternative WCAG 2.2 AA asks of every dragging gesture, 2.5.7), and the keyboard on the
// plan itself (2.1.1). Tab walks the spots, because every spot is a button.
//
// A night that has passed is read-only unless the club allows corrections and this role may make
// them; a night more than a month back is not drawn at all — the Log keeps what happened on it
// (D141, 9.21). A read that does not get through keeps the plan that is on screen and says so in a
// notice that stays (RR-O47), because an empty room would read as an empty club.
import { CircleAlertIcon, LockIcon, MaximizeIcon, MinusIcon, PlusIcon } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { WRAPS } from '@/lib/wrapping'
import { blockSpotAction, floorPlanAction, unblockSpotAction } from '@/server/reservations/actions'
import type { RvFrame, RvPlanView, RvSpotView } from '@/server/reservations/view'
import { DayPicker } from '@/tonight/day-picker'
import { FEED_POLL_MS } from '@/tonight/live-feed'
import { FailedBlock, NothingHere } from '@/tonight/tab-parts'

import type { BlockChoice } from './block-dialog'
import { BlockDialog } from './block-dialog'
import { KindSymbol, SpotTile, StateMark, stateTileClass } from './plan-shape'
import { useSpotLine, useSpotStateWord } from './plan-words'
import { usePlanView } from './plan-zoom'
import { SpotSheet } from './spot-sheet'
import { RV_SPOT_STATES } from './spot-states'
import { useReservationRun } from './use-reservation-run'

/** How many nights ahead the night button lists: bookings are taken for them. */
const NIGHTS_AHEAD = 60
/** How far back the plan of a night can be read (D141, 9.21: a month). */
const NIGHTS_BACK = 31

/** The nights the night button may open: a month back, and the nights still to come. */
function plannedNights(today: string): string[] {
  const at = (back: number) => {
    const date = new Date(`${today}T00:00:00Z`)
    date.setUTCDate(date.getUTCDate() - back)
    return date.toISOString().slice(0, 10)
  }
  return Array.from({ length: NIGHTS_BACK }, (_, n) => at(n + 1))
}

/** The one banner that says what the whole night is (Patterns: "A state of the whole page"). */
function PlanBanner({ plan, frame }: { plan: RvPlanView; frame: RvFrame }) {
  const t = useTranslations('reservations')
  const kind = plan.tooOld
    ? 'old'
    : plan.settingsMissing
      ? 'settings'
      : !plan.passed
        ? null
        : frame.editPastNights
          ? frame.can.editPast
            ? 'open'
            : 'denied'
          : 'passed'
  if (kind === null) return null
  const text =
    kind === 'old'
      ? t('p_too_old')
      : kind === 'settings'
        ? t('b_settings')
        : kind === 'open'
          ? t('b_passed_open')
          : kind === 'denied'
            ? t('b_passed_denied')
            : t('b_passed')
  const Icon = kind === 'settings' ? CircleAlertIcon : LockIcon
  return (
    <div
      role="status"
      className="flex items-start gap-3 rounded-lg border bg-info/10 p-4"
      data-testid="rv-plan-banner"
      data-kind={kind}
    >
      <Icon aria-hidden className="mt-0.5 size-5 shrink-0 text-info" />
      <p className="min-w-0 flex-1 text-base [overflow-wrap:anywhere]">{text}</p>
    </div>
  )
}

/** The legend: every state, in a word and a symbol, always on screen. */
function Legend() {
  const t = useTranslations('reservations')
  const word = useSpotStateWord()
  return (
    <ul
      aria-label={t('p_states')}
      className="flex min-w-0 flex-wrap gap-x-4 gap-y-2 text-sm"
      data-testid="rv-legend"
    >
      {RV_SPOT_STATES.map((state) => (
        <li key={state} className="flex items-center gap-1.5" data-state={state}>
          <span
            aria-hidden
            className={`flex size-5 items-center justify-center rounded-sm border ${stateTileClass(state)}`}
          >
            <StateMark state={state} className="size-3" />
          </span>
          {word(state)}
        </li>
      ))}
    </ul>
  )
}

/** The plan, as the server read it for this venue's own tonight. */
export function FloorPlan({ initial, frame }: { initial: RvPlanView; frame: RvFrame }) {
  const t = useTranslations('reservations')
  const stateWord = useSpotStateWord()
  const spotLine = useSpotLine()
  const [plan, setPlan] = useState(initial)
  const [day, setDay] = useState(initial.day)
  const [planId, setPlanId] = useState(initial.planId)
  const [kindKey, setKindKey] = useState<string>('all')
  const [openSpot, setOpenSpot] = useState<string | null>(null)
  const [blocking, setBlocking] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)
  const [loading, setLoading] = useState(false)
  const frameRef = useRef<HTMLDivElement | null>(null)
  const { view, zoomIn, zoomOut, fit, onKeyDown, dragged } = usePlanView(frameRef)
  const { run, busy, pinSheet } = useReservationRun({ device: frame.device })

  /** Only the newest read is believed: a slow answer for last night never replaces tonight. */
  const generation = useRef(0)
  const read = useCallback(
    (quiet: boolean) => {
      const mine = ++generation.current
      if (!quiet) setLoading(true)
      void floorPlanAction({
        venueId: frame.venueId,
        day,
        ...(planId === null ? {} : { planId }),
      })
        .then((result) => {
          if (mine !== generation.current) return
          setLoading(false)
          if (!result.ok) {
            setFailed(true)
            return
          }
          setFailed(false)
          setPlan(result.plan)
        })
        .catch(() => {
          if (mine !== generation.current) return
          setLoading(false)
          setFailed(true)
        })
    },
    [day, frame.venueId, planId],
  )

  // A new night or another plan: read at once. The first render already has the server's read.
  const first = useRef(true)
  useEffect(() => {
    if (first.current) {
      first.current = false
      return
    }
    read(false)
  }, [read])

  // Tonight moves, so it is kept current; a night that is over, and one still to come, stand still.
  const live = plan.day === frame.today
  useEffect(() => {
    if (!live) return
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') read(true)
    }, FEED_POLL_MS)
    return () => window.clearInterval(timer)
  }, [live, read])

  // A failed read keeps the plan and says so in a notice that stays until a read gets through.
  const failedWithPlan = failed && plan.spots.length > 0
  useEffect(() => {
    if (!failedWithPlan) return
    const id = toast.error(t('p_fail'), { duration: Number.POSITIVE_INFINITY })
    return () => {
      toast.dismiss(id)
    }
  }, [failedWithPlan, t])

  const reading = plan.day !== day
  const kinds = plan.kinds
  const kindOf = useCallback(
    (spot: RvSpotView) => kinds.find((one) => one.key === spot.kind) ?? null,
    [kinds],
  )
  const shown = useMemo(
    () => (kindKey === 'all' ? plan.spots : plan.spots.filter((spot) => spot.kind === kindKey)),
    [kindKey, plan.spots],
  )
  const chips = kinds.filter((kind) => kind.filters)
  const spot = openSpot === null ? null : (plan.spots.find((one) => one.id === openSpot) ?? null)
  const blocked = blocking === null ? null : (plan.spots.find((one) => one.id === blocking) ?? null)

  /** Whether this night may be written at all (D135, D141), and whether this person blocks. */
  const writable = !plan.passed || (frame.editPastNights && frame.can.editPast)
  const mayBlock = writable && (frame.can.block || frame.device)

  /** The refusal that names the party in the way: the whole point of the sentence (#327). */
  const takenText = useCallback(
    (error: string, details: Readonly<Record<string, unknown>> | undefined): string | null => {
      if (error !== 'spot_taken' || details === undefined) return null
      const party = plan.spots
        .flatMap((one) => one.holds)
        .find((hold) => hold.reservationId === details.reservationId)
      const where = plan.spots.find((one) => one.id === details.spotId)
      if (party === undefined || where === undefined) return null
      return t('p_taken', {
        party: party.name ?? t('no_name'),
        spot: where.name,
        time: party.time,
      })
    },
    [plan.spots, t],
  )

  const blockWrite = useCallback(
    (which: RvSpotView, choice: BlockChoice) => ({
      id: `rv-block:${which.id}`,
      done: t('p_blocked_ok', { spot: which.name }),
      pin: { title: t('p_pin_block', { spot: which.name }), body: t('p_pin_b') },
      act: (pin?: string) =>
        blockSpotAction({
          venueId: frame.venueId,
          spotId: which.id,
          reason: choice.reason,
          ...(choice.from === undefined ? {} : { from: choice.from }),
          ...(choice.until === undefined ? {} : { until: choice.until }),
          ...(pin === undefined ? {} : { pin }),
        }),
      refusal: takenText,
      after: () => read(true),
    }),
    [frame.venueId, read, t, takenText],
  )

  const block = useCallback(
    (which: RvSpotView, choice: BlockChoice) => {
      setBlocking(null)
      run(blockWrite(which, choice))
    },
    [blockWrite, run],
  )

  const unblock = useCallback(
    (which: RvSpotView, reservationId: string, reason: string | null) => {
      setOpenSpot(null)
      run({
        id: `rv-unblock:${which.id}`,
        done: t('p_unblocked', { spot: which.name }),
        pin: { title: t('p_pin_unblock', { spot: which.name }), body: t('p_pin_b') },
        act: (pin?: string) =>
          unblockSpotAction({
            venueId: frame.venueId,
            reservationId,
            ...(pin === undefined ? {} : { pin }),
          }),
        // Undo here is the opposite write: the same spot, blocked again for the same reason.
        again: {
          label: t('p_undo'),
          done: t('p_blocked_ok', { spot: which.name }),
          act: (pin?: string) =>
            blockSpotAction({
              venueId: frame.venueId,
              spotId: which.id,
              reason: reason === null ? 'other' : reason,
              ...(pin === undefined ? {} : { pin }),
            }),
        },
        refusal: takenText,
        after: () => read(true),
      })
    },
    [frame.venueId, read, run, t, takenText],
  )

  const body = (() => {
    if (reading || (plan.spots.length === 0 && loading)) {
      return <Skeleton className="h-[60vh] min-h-80 w-full rounded-lg" data-testid="rv-plan-wait" />
    }
    if (failed && plan.spots.length === 0) return <FailedBlock text={t('p_fail')} />
    if (plan.tooOld) return null
    if (plan.planId === null) return <NothingHere text={t('p_empty')} />
    return (
      // The region holds the keys as well as the buttons: a keyboard reaches the plan by tabbing to
      // its own zoom buttons or to a spot, and the arrows, + - and 0 work from there (2.1.1). The
      // canvas itself is a viewport, not a control, so it is not in the tab order — the spots are.
      <section aria-label={t('p_view')} className="space-y-2" onKeyDown={onKeyDown}>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="size-11"
            aria-label={t('p_zoom_out')}
            data-testid="rv-zoom-out"
            onClick={zoomOut}
          >
            <MinusIcon aria-hidden />
          </Button>
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="size-11"
            aria-label={t('p_zoom_in')}
            data-testid="rv-zoom-in"
            onClick={zoomIn}
          >
            <PlusIcon aria-hidden />
          </Button>
          <Button
            type="button"
            variant="outline"
            className="h-11"
            data-testid="rv-zoom-fit"
            onClick={fit}
          >
            <MaximizeIcon aria-hidden />
            {t('p_zoom_reset')}
          </Button>
          <p className="text-sm text-muted-foreground">{t('p_keys')}</p>
        </div>
        <div
          ref={frameRef}
          className="relative h-[60vh] min-h-80 touch-none overflow-hidden rounded-lg border bg-muted/40 focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-ring"
          data-testid="rv-plan"
        >
          <div
            className="absolute left-0 top-0 w-full origin-top-left"
            style={{
              aspectRatio: `${plan.extent.width} / ${plan.extent.height}`,
              transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})`,
            }}
            data-testid="rv-plan-room"
          >
            {shown.map((one) => {
              const kind = kindOf(one)
              return (
                <SpotTile
                  key={one.id}
                  spot={one}
                  box={plan.extent}
                  symbol={kind?.symbol ?? 'dot'}
                  kindLabel={kind?.label ?? ''}
                  line={spotLine(one)}
                  stateWord={stateWord(one.state)}
                  selected={one.id === openSpot}
                  label={t('p_spot', {
                    name: one.name,
                    kind: kind?.label ?? '',
                    state: stateWord(one.state),
                  })}
                  onOpen={() => {
                    // A drag that ended on a spot moved the plan; it did not open the spot.
                    if (dragged()) return
                    setOpenSpot(one.id)
                  }}
                />
              )
            })}
          </div>
        </div>
        {plan.unreadable === 0 ? null : (
          <p className="text-sm text-muted-foreground" data-testid="rv-unreadable">
            {t('p_unreadable', { k: plan.unreadable })}
          </p>
        )}
      </section>
    )
  })()

  const blockNow = spot !== null && mayBlock ? () => setBlocking(spot.id) : null

  return (
    <div className="space-y-4" data-testid="reservations-plan">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h2 className="text-xl font-semibold tracking-tight">
          {t('tab_plan')}
          {plan.planName === null ? null : (
            <span className="ml-2 text-base font-normal text-muted-foreground">
              {plan.planName}
            </span>
          )}
        </h2>
      </div>
      <PlanBanner plan={plan} frame={frame} />
      <div className="flex flex-wrap items-center gap-2">
        <DayPicker
          day={day}
          today={frame.today}
          days={plannedNights(frame.today)}
          ahead={NIGHTS_AHEAD}
          label={t('tab_list')}
          anyDate
          onPick={setDay}
        />
        {plan.plans.length < 2 ? null : (
          <fieldset className="flex min-w-0 flex-wrap gap-2">
            <legend className="sr-only">{t('p_which_plan')}</legend>
            {plan.plans.map((one) => (
              <Button
                key={one.id}
                type="button"
                size="sm"
                variant={one.id === plan.planId ? 'default' : 'outline'}
                aria-pressed={one.id === plan.planId}
                className="min-h-11"
                data-testid={`rv-plan-pick-${one.id}`}
                onClick={() => setPlanId(one.id)}
              >
                {one.name}
              </Button>
            ))}
          </fieldset>
        )}
      </div>
      {plan.planId === null ? null : (
        <>
          <Legend />
          {chips.length === 0 ? null : (
            <fieldset className="flex min-w-0 flex-wrap gap-2">
              <legend className="sr-only">{t('p_kinds')}</legend>
              <Button
                type="button"
                size="sm"
                variant={kindKey === 'all' ? 'default' : 'outline'}
                aria-pressed={kindKey === 'all'}
                className="min-h-11"
                data-testid="rv-kind-all"
                onClick={() => setKindKey('all')}
              >
                {t('f_all')}
              </Button>
              {chips.map((kind) => (
                <Button
                  key={kind.key}
                  type="button"
                  size="sm"
                  variant={kindKey === kind.key ? 'default' : 'outline'}
                  aria-pressed={kindKey === kind.key}
                  className={`min-h-11 ${WRAPS}`}
                  data-testid={`rv-kind-${kind.key}`}
                  onClick={() => setKindKey(kind.key)}
                >
                  <KindSymbol symbol={kind.symbol} className="size-4" />
                  {kind.label}
                </Button>
              ))}
            </fieldset>
          )}
        </>
      )}
      {body}
      {spot === null ? null : (
        <SpotSheet
          spot={spot}
          kind={kindOf(spot)}
          frame={frame}
          day={plan.day}
          busy={busy}
          sayWhoBlocks={writable && !mayBlock}
          onBlock={blockNow}
          onUnblock={
            mayBlock
              ? (reservationId) => {
                  const hold = spot.holds.find((one) => one.reservationId === reservationId)
                  unblock(spot, reservationId, hold?.reason ?? null)
                }
              : null
          }
          onClose={() => setOpenSpot(null)}
        />
      )}
      {blocked === null ? null : (
        <BlockDialog
          spotName={blocked.name}
          day={plan.day}
          today={frame.today}
          busy={busy}
          onLeave={() => setBlocking(null)}
          onBlock={(choice) => block(blocked, choice)}
        />
      )}
      {pinSheet}
    </div>
  )
}
