'use client'

// Choosing the spots of a booking (#328; D134: a booking may hold several). Two ways to the same
// choice, both always one tap away because a hostess is on a phone in one hand or at a tablet:
// a named list with the venue's kind filter, and the plan itself, where a tap on a spot picks it.
// The choice lives in the form, so going to the plan and back keeps everything she typed.
//
// A spot somebody else holds that night is in the list with its state in words, never greyed out:
// she may be moving a party onto it with the other booking's blessing, and the form says who holds
// it before Save (`taken`), while the write path refuses it in the end (D134, log 3.20).
import { useTranslations } from 'next-intl'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import { WRAPS } from '@/lib/wrapping'
import { floorPlanAction } from '@/server/reservations/actions'
import type { RvFrame, RvKindView, RvPlanView, RvSpotView } from '@/server/reservations/view'

import { KindSymbol, SpotTile } from './plan-shape'
import { useSpotLine, useSpotStateWord } from './plan-words'

/** More spots than this and the list is searchable by name. */
const SEARCH_FROM = 12

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

/** The named list: one row per spot, with its kind, seats and what it is tonight in words. */
export function SpotList({
  plan,
  selected,
  onChange,
}: {
  plan: RvPlanView
  selected: readonly string[]
  onChange: (ids: string[]) => void
}) {
  const t = useTranslations('reservations')
  const line = useSpotLine()
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
          return (
            <li key={spot.id}>
              <label
                htmlFor={`rv-pick-id-${spot.id}`}
                className="flex min-h-11 cursor-pointer items-center gap-3 p-3 text-sm"
              >
                <Checkbox
                  id={`rv-pick-id-${spot.id}`}
                  checked={checked}
                  onCheckedChange={() => toggle(spot.id)}
                  data-testid={`rv-pick-${spot.name}`}
                  aria-label={spot.name}
                />
                <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">
                  <span className="font-medium">{spot.name}</span>
                  <span className="block text-muted-foreground">
                    {[
                      kind?.label,
                      spot.seats === null ? null : `${t('p_seats')} ${spot.seats}`,
                      line(spot),
                    ]
                      .filter(
                        (part): part is string =>
                          part !== null && part !== undefined && part !== '',
                      )
                      .join(' · ')}
                  </span>
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
 * The plan, to tap spots on. It is the plan's own drawing at the width the sheet has, without the
 * pan and zoom of the plan screen: a long plan is what the list is for.
 */
export function SpotPlan({
  plan,
  selected,
  onChange,
}: {
  plan: RvPlanView
  selected: readonly string[]
  onChange: (ids: string[]) => void
}) {
  const t = useTranslations('reservations')
  const stateWord = useSpotStateWord()
  const line = useSpotLine()
  const toggle = useToggle(selected, onChange)
  const [kindKey, setKindKey] = useState('all')
  const kindOf = (spot: RvSpotView) => plan.kinds.find((kind) => kind.key === spot.kind) ?? null
  const shown = kindKey === 'all' ? plan.spots : plan.spots.filter((spot) => spot.kind === kindKey)
  return (
    <div className="space-y-2">
      <KindChips kinds={plan.kinds} value={kindKey} onPick={setKindKey} />
      <div
        className="relative w-full overflow-hidden rounded-lg border bg-muted/40"
        style={{ aspectRatio: `${plan.extent.width} / ${plan.extent.height}`, minHeight: '16rem' }}
        data-testid="rv-pick-plan"
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
              label={t('p_spot', {
                name: spot.name,
                kind: kind?.label ?? '',
                state: stateWord(spot.state),
              })}
              onOpen={() => toggle(spot.id)}
            />
          )
        })}
      </div>
    </div>
  )
}

/** Shown while the plan of the night is read. */
export function PickWait() {
  return <Skeleton className="h-40 w-full rounded-lg" data-testid="rv-pick-wait" />
}
