'use client'

// Choosing the spots of a booking (#328; D134: a booking may hold several). Two ways to the same
// choice, both always one tap away because a hostess is on a phone in one hand or at a tablet:
// a named list with the venue's kind filter, and the plan itself, where a tap on a spot picks it.
// The choice lives in the form, so going to the plan and back keeps everything she typed.
//
// A spot somebody else holds that night is in the list with its state in words, never greyed out:
// she may be moving a party onto it with the other booking's blessing, and the form says who holds
// it before Save (`taken`), while the write path refuses it in the end (D134, log 3.20).
//
// The list is in the venue's natural order (1, 2, 10, 11: the read side sorts it, S5). Where a tap
// on a row *is* the act (Give a spot), each row is a button that says what it does, «Настани на 9»,
// never a checkbox that acts the moment it is ticked (S19, WCAG 3.2.2).
import { ChevronRightIcon, MaximizeIcon, MinusIcon, PlusIcon } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'

import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import { WRAPS } from '@/lib/wrapping'
import { floorPlanAction } from '@/server/reservations/actions'
import type { RvFrame, RvKindView, RvPlanView, RvSpotView } from '@/server/reservations/view'

import { drawnSize, KindSymbol, SpotTile } from './plan-shape'
import { useSpotCalled, useSpotLine, useSpotStateWord } from './plan-words'
import { planOpening, roomStyle, usePlanView } from './plan-zoom'

/** More spots than this and the list is searchable by name. */
const SEARCH_FROM = 12

/** A phone, as `useIsMobile` reads it. */
const PHONE_QUERY = '(max-width: 767px)'

function watchPhone(onChange: () => void) {
  if (typeof window.matchMedia !== 'function') return () => {}
  const query = window.matchMedia(PHONE_QUERY)
  query.addEventListener('change', onChange)
  return () => query.removeEventListener('change', onChange)
}

const isPhone = () =>
  typeof window.matchMedia === 'function' && window.matchMedia(PHONE_QUERY).matches

/**
 * Which picker a dialog shows (S17): the one she chose, else the named list on a phone and the
 * plan elsewhere. The screen is read on the first render (`useIsMobile` answers only after it), so
 * a phone never draws the plan for a frame; with no screen to read, the list.
 */
export function usePickerWay() {
  const phone = useSyncExternalStore(watchPhone, isPhone, () => true)
  const [chosen, setChosen] = useState<'plan' | 'list' | null>(null)
  const picker: 'plan' | 'list' = chosen ?? (phone ? 'list' : 'plan')
  return [picker, setChosen] as const
}

/** The plan of one night, read for choosing spots: the current plan, or the one asked for. */
export function usePickPlan(frame: RvFrame, day: string) {
  const [plan, setPlan] = useState<RvPlanView | null>(null)
  const [planId, setPlanId] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)
  const generation = useRef(0)

  const read = useCallback(() => {
    const mine = ++generation.current
    void floorPlanAction({
      venueId: frame.venueId,
      day,
      ...(planId === null ? {} : { planId }),
    })
      .then((result) => {
        if (mine !== generation.current) return
        setFailed(!result.ok)
        if (result.ok) setPlan(result.plan)
      })
      .catch(() => {
        if (mine === generation.current) setFailed(true)
      })
  }, [day, frame.venueId, planId])
  useEffect(() => read(), [read])

  return { plan: plan?.day === day ? plan : null, failed, reload: read, planId, setPlanId }
}

/** The kinds the venue offers as a filter, and the one chosen. */
function KindChips({
  kinds,
  value,
  onPick,
}: {
  kinds: readonly RvKindView[]
  value: string
  onPick: (key: string) => void
}) {
  const t = useTranslations('reservations')
  const chips = kinds.filter((kind) => kind.filters)
  if (chips.length === 0) return null
  return (
    <fieldset className="flex min-w-0 flex-wrap gap-2">
      <legend className="sr-only">{t('p_kinds')}</legend>
      <Button
        type="button"
        size="sm"
        variant={value === 'all' ? 'default' : 'outline'}
        aria-pressed={value === 'all'}
        className="min-h-11"
        onClick={() => onPick('all')}
      >
        {t('f_all')}
      </Button>
      {chips.map((kind) => (
        <Button
          key={kind.key}
          type="button"
          size="sm"
          variant={value === kind.key ? 'default' : 'outline'}
          aria-pressed={value === kind.key}
          className={cn('min-h-11', WRAPS)}
          data-testid={`rv-pick-kind-${kind.key}`}
          onClick={() => onPick(kind.key)}
        >
          <KindSymbol symbol={kind.symbol} className="size-4" />
          {kind.label}
        </Button>
      ))}
    </fieldset>
  )
}

/** The chosen spots, plus the toggle both ways of choosing share. */
function useToggle(selected: readonly string[], onChange: (ids: string[]) => void) {
  return useCallback(
    (id: string) =>
      onChange(selected.includes(id) ? selected.filter((one) => one !== id) : [...selected, id]),
    [onChange, selected],
  )
}

/**
 * The named list: one row per spot, with its kind, seats and what it is tonight in words.
 *
 * Ticking spots on and off for a form saved as a whole (the booking form; Change tables with
 * `onTap` for its swap and block questions), or, with `onSeat`, a row per spot that seats the
 * party there at once (Give a spot: "A choice that is also the action").
 */
export function SpotList({
  plan,
  selected,
  onChange,
  onTap,
  onSeat,
}: {
  plan: RvPlanView
  selected: readonly string[]
  onChange: (ids: string[]) => void
  /** Replaces the plain toggle where a tap means more (Change tables). */
  onTap?: (spot: RvSpotView) => void
  /** Each row is a button that does this; nothing is ticked. */
  onSeat?: (spot: RvSpotView) => void
}) {
  const t = useTranslations('reservations')
  const line = useSpotLine()
  const called = useSpotCalled()
  const toggle = useToggle(selected, onChange)
  const [kindKey, setKindKey] = useState('all')
  const [search, setSearch] = useState('')
  const kindOf = useMemo(() => new Map(plan.kinds.map((kind) => [kind.key, kind])), [plan.kinds])
  const shown = plan.spots.filter(
    (spot) =>
      (kindKey === 'all' || spot.kind === kindKey) &&
      spot.name.toLowerCase().includes(search.trim().toLowerCase()),
  )
  return (
    <div className="space-y-2">
      <KindChips kinds={plan.kinds} value={kindKey} onPick={setKindKey} />
      {plan.spots.length < SEARCH_FROM ? null : (
        <Input
          type="search"
          value={search}
          aria-label={t('bk_spots_find')}
          placeholder={t('bk_spots_find')}
          onChange={(event) => setSearch(event.target.value)}
        />
      )}
      <ul
        className="max-h-72 divide-y overflow-y-auto rounded-lg border"
        data-testid="rv-pick-list"
      >
        {shown.map((spot) => {
          const kind = kindOf.get(spot.kind)
          const checked = selected.includes(spot.id)
          const about = [
            kind?.label,
            spot.seats === null ? null : `${t('p_seats')} ${spot.seats}`,
            line(spot),
          ]
            .filter((part): part is string => part !== null && part !== undefined && part !== '')
            .join(' · ')
          if (onSeat !== undefined) {
            return (
              <li key={spot.id}>
                <button
                  type="button"
                  className="flex min-h-11 w-full items-center gap-3 p-3 text-left text-sm hover:bg-muted/50 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
                  data-testid={`rv-seat-${spot.name}`}
                  onClick={() => onSeat(spot)}
                >
                  <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">
                    <span className="font-medium">
                      {t('w_seat_at', { spot: called(spot.name) })}
                    </span>
                    <span className="block text-muted-foreground">{about}</span>
                  </span>
                  <ChevronRightIcon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
                </button>
              </li>
            )
          }
          return (
            <li key={spot.id}>
              {/* pl-4 keeps the checkbox's 44 px hit area inside the scrolling list (D123). */}
              <label
                htmlFor={`rv-pick-id-${spot.id}`}
                className="flex min-h-11 cursor-pointer items-center gap-3 py-3 pr-3 pl-4 text-sm"
              >
                <Checkbox
                  id={`rv-pick-id-${spot.id}`}
                  checked={checked}
                  onCheckedChange={() => (onTap === undefined ? toggle(spot.id) : onTap(spot))}
                  data-testid={`rv-pick-${spot.name}`}
                  aria-label={spot.name}
                />
                <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">
                  <span className="font-medium">{spot.name}</span>
                  <span className="block text-muted-foreground">{about}</span>
                </span>
              </label>
            </li>
          )
        })}
        {shown.length === 0 ? (
          <li className="p-3 text-sm text-muted-foreground">{t('bk_spots_none_found')}</li>
        ) : null}
      </ul>
    </div>
  )
}

/**
 * The plan, to tap spots on, with the plan screen's own pan and zoom (#382): pinch or wheel, drag,
 * the −, + and fit buttons, and the keys (`plan-zoom.ts`, shared, not copied). The frame is lower
 * than the plan screen's so that the sheet around it still scrolls: a finger on the plan moves the
 * plan, a finger anywhere else in the sheet moves the sheet.
 *
 * `onTap` replaces the plain toggle where a tap means more than "chosen or not" — Change tables
 * (#331) asks to swap when the spot is another party's.
 */
export function SpotPlan({
  plan,
  selected,
  onChange,
  onTap,
}: {
  plan: RvPlanView
  selected: readonly string[]
  onChange: (ids: string[]) => void
  onTap?: (spot: RvSpotView) => void
}) {
  const t = useTranslations('reservations')
  const stateWord = useSpotStateWord()
  const line = useSpotLine()
  const toggle = useToggle(selected, onChange)
  const [kindKey, setKindKey] = useState('all')
  const [frameEl, setFrameEl] = useState<HTMLDivElement | null>(null)
  const opening = useMemo(
    () =>
      planOpening(
        `${plan.planId ?? ''}:${plan.day}`,
        plan.spots.map((spot) => spot.place),
        plan.extent,
      ),
    [plan.day, plan.extent, plan.planId, plan.spots],
  )
  const { view, frameWidth, zoomIn, zoomOut, fit, onKeyDown, dragged } = usePlanView(frameEl, {
    opening,
    room: plan.extent,
  })
  const kindOf = (spot: RvSpotView) => plan.kinds.find((kind) => kind.key === spot.kind) ?? null
  const shown = kindKey === 'all' ? plan.spots : plan.spots.filter((spot) => spot.kind === kindKey)
  return (
    // The keys work from the zoom buttons and from the spots, as on the plan screen (2.1.1).
    <section aria-label={t('p_view')} className="space-y-2" onKeyDown={onKeyDown}>
      <KindChips kinds={plan.kinds} value={kindKey} onPick={setKindKey} />
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="size-11"
          aria-label={t('p_zoom_out')}
          data-testid="rv-pick-zoom-out"
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
          data-testid="rv-pick-zoom-in"
          onClick={zoomIn}
        >
          <PlusIcon aria-hidden />
        </Button>
        <Button
          type="button"
          variant="outline"
          className="h-11"
          data-testid="rv-pick-zoom-fit"
          onClick={fit}
        >
          <MaximizeIcon aria-hidden />
          {t('p_zoom_reset')}
        </Button>
      </div>
      <div
        ref={setFrameEl}
        className="relative h-[45vh] min-h-64 w-full touch-none overflow-hidden rounded-lg border bg-muted/40 focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-ring"
        data-testid="rv-pick-plan"
        // On a phone the sheet is a drawer: a drag on the plan pans the plan, never the drawer.
        data-vaul-no-drag=""
      >
        <div
          className="absolute left-0 top-0"
          style={roomStyle(view, plan.extent)}
          data-scale={view.scale.toFixed(3)}
        >
          {shown.map((spot) => {
            const kind = kindOf(spot)
            return (
              <SpotTile
                key={spot.id}
                spot={spot}
                box={plan.extent}
                symbol={kind?.symbol ?? 'dot'}
                kindLabel={kind?.label ?? ''}
                line={line(spot)}
                stateWord={stateWord(spot.state)}
                selected={selected.includes(spot.id)}
                drawn={
                  frameWidth > 0
                    ? drawnSize(spot.place, plan.extent, frameWidth * view.scale)
                    : null
                }
                label={t('p_spot', {
                  name: spot.name,
                  kind: kind?.label ?? '',
                  state: stateWord(spot.state),
                })}
                onOpen={() => {
                  // A drag that ended on a spot moved the plan; it did not pick the spot.
                  if (dragged()) return
                  if (onTap === undefined) toggle(spot.id)
                  else onTap(spot)
                }}
              />
            )
          })}
        </div>
      </div>
    </section>
  )
}

/** Shown while the plan of the night is read. */
export function PickWait() {
  return <Skeleton className="h-40 w-full rounded-lg" data-testid="rv-pick-wait" />
}
