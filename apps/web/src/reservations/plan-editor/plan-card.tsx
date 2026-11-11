'use client'

// "Floor plan" on Settings › Reservations (#397): the venue lays out its own room. It replaces the
// seats list of #325 — the seats are now one field of a spot, beside its name, kind, shape, place
// and Table.
//
// The screen's states:
//   • no plan yet — one empty-state block with one button, "Draw the plan": it starts the plan
//     (and, for a venue with none, the spot kinds it begins with) so the first spot can be added;
//   • a plan with no spots — the canvas says to add the first one; "New spot" is the one primary
//     action;
//   • a plan being edited — drag, keys or the spot's sheet; every change saves at once with Undo,
//     and the drawn place is the one sent until the server answers (it goes back if refused);
//   • a refusal — a sentence that names the rule and the fix, in an error toast that stays (the
//     shape folder's codes, the database's last word `plan_refused`, a name taken meanwhile);
//   • a spot a booking still holds — its sheet says so, and removing it names how many bookings
//     lose their spot before anything happens;
//   • read-only — a role without `settings.reservations` sees the plan and the list, nothing moves.
import {
  editorRoom,
  freePlace,
  NEW_SPOT_LOOK,
  newKindKey,
  nextSpotName,
  type SpotPlace,
  type SpotSymbol,
} from '@restro/core'
import { EllipsisIcon, PlusIcon } from 'lucide-react'
import { useLocale, useTranslations } from 'next-intl'
import { useMemo, useState } from 'react'

import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from '@/components/ui/empty'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { WRAPS } from '@/lib/wrapping'
import {
  removeSpotAction,
  removeSpotKindAction,
  savePlanAction,
  saveSpotAction,
  saveSpotKindAction,
  startPlanAction,
} from '@/server/settings/plan-actions'
import type { ReservationsView } from '@/server/settings/reservations-view'
import type { useSettingsRun } from '@/settings/use-settings-run'

import { ConfirmDialog } from '../confirm-dialog'
import { KindSymbol } from '../plan-shape'
import type { EditorKind, EditorSpot } from './editor-types'
import { usePlanRefusalWords } from './editor-words'
import { type CanvasSpot, PlanCanvas } from './plan-canvas'
import { KindDialog, type KindFields, NewSpotDialog, PlanNameDialog } from './plan-dialogs'
import { SpotEditor, type SpotFields } from './spot-editor'

type Runner = ReturnType<typeof useSettingsRun>

/** The kinds a venue with none begins with, by symbol, with their usual seats. */
const STARTER_KINDS: readonly { symbol: SpotSymbol; seats: number | null }[] = [
  { symbol: 'table', seats: 4 },
  { symbol: 'booth', seats: 6 },
  { symbol: 'stool', seats: 1 },
  { symbol: 'standing', seats: null },
]

type Asking =
  | { readonly step: 'new_spot' }
  | { readonly step: 'rename' }
  | { readonly step: 'kind'; readonly kind: EditorKind | null }
  | { readonly step: 'remove_spot'; readonly spot: EditorSpot }

/** What `saveSpotAction` is handed for a spot with these fields. */
function spotInput(venueId: string, planId: string, spotId: string | undefined, f: SpotFields) {
  return {
    venueId,
    ...(spotId === undefined ? {} : { spotId }),
    planId,
    name: f.name,
    kind: f.kind,
    ...f.place,
    seats: f.seats,
    tableId: f.tableId,
  }
}

export function PlanCard({ view, runner }: { view: ReservationsView; runner: Runner }) {
  const t = useTranslations('ownerSettings')
  const locale = useLocale()
  const words = usePlanRefusalWords()
  const { run, pending } = runner
  const { plans, kinds, tables, unreadable } = view.plan
  const can = view.canChange
  const venueId = view.venueId

  const [planChoice, setPlanChoice] = useState<string | null>(null)
  const plan =
    plans.find((one) => one.id === planChoice) ??
    plans.find((one) => one.current) ??
    plans[0] ??
    null

  // Places drawn before the server answers: dropped when the page's data comes back.
  const [moved, setMoved] = useState<Readonly<Record<string, SpotPlace>>>({})
  const [movedFor, setMovedFor] = useState(view.plan.spots)
  if (movedFor !== view.plan.spots) {
    setMovedFor(view.plan.spots)
    setMoved({})
  }
  const [openId, setOpenId] = useState<string | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [asking, setAsking] = useState<Asking | null>(null)

  const spots = useMemo(
    () => (plan === null ? [] : view.plan.spots.filter((spot) => spot.planId === plan.id)),
    [plan, view.plan.spots],
  )
  const placeOf = (spot: EditorSpot) => moved[spot.id] ?? spot.place
  const kindOf = (key: string) => kinds.find((one) => one.key === key) ?? null
  const room = editorRoom(spots.map(placeOf))
  const canvasSpots: CanvasSpot[] = spots.map((spot) => {
    const kind = kindOf(spot.kind)
    return {
      id: spot.id,
      name: spot.name,
      place: placeOf(spot),
      symbol: kind?.symbol ?? 'dot',
      label: `${spot.name} · ${kind?.label ?? spot.kind}`,
    }
  })
  const open = spots.find((spot) => spot.id === openId) ?? null

  const fieldsOf = (spot: EditorSpot): SpotFields => ({
    name: spot.name,
    kind: spot.kind,
    place: placeOf(spot),
    seats: spot.seats,
    tableId: spot.tableId,
  })

  function saveSpot(spot: EditorSpot, next: Partial<SpotFields>, done: string) {
    const from = fieldsOf(spot)
    const to = { ...from, ...next }
    const { place } = next
    if (place !== undefined) setMoved((now) => ({ ...now, [spot.id]: place }))
    run(() => saveSpotAction(spotInput(venueId, spot.planId, spot.id, to)), {
      done,
      words,
      onFail: () =>
        setMoved((now) => {
          const { [spot.id]: _gone, ...rest } = now
          return rest
        }),
      undo: () => saveSpotAction(spotInput(venueId, spot.planId, spot.id, from)),
    })
  }

  function addSpot(name: string, kind: EditorKind) {
    if (plan === null) return
    setAsking(null)
    const place = freePlace(spots.map(placeOf), NEW_SPOT_LOOK[kind.symbol])
    let made: string | null = null
    run(
      () =>
        saveSpotAction(
          spotInput(venueId, plan.id, undefined, {
            name,
            kind: kind.key,
            place,
            seats: null,
            tableId: null,
          }),
        ),
      {
        done: t('pe_spot_added', { name }),
        words,
        onOk: (answer) => {
          const id = answer.ok ? answer.details.spotId : null
          if (typeof id === 'string') {
            made = id
            setSelected(id)
          }
        },
        undo: () =>
          made === null
            ? Promise.resolve({ ok: false as const, error: 'spot_missing' })
            : removeSpotAction({ venueId, spotId: made }),
      },
    )
  }

  function removeSpot(spot: EditorSpot) {
    setAsking(null)
    setOpenId(null)
    run(() => removeSpotAction({ venueId, spotId: spot.id }), {
      done: t('pe_spot_removed', { name: spot.name }),
      words,
    })
  }

  function startPlan() {
    const starters =
      kinds.length > 0
        ? []
        : STARTER_KINDS.map((one) => ({
            key: one.symbol,
            label: t(`pe_start_kind.${one.symbol}`),
            symbol: one.symbol,
            defaultSeats: one.seats,
          }))
    run(() => startPlanAction({ venueId, name: t('pe_first_plan'), kinds: starters }), {
      done: t('pe_started'),
      words,
    })
  }

  function saveKind(kind: EditorKind | null, fields: KindFields) {
    setAsking(null)
    const key =
      kind?.key ??
      newKindKey(
        fields.symbol,
        kinds.map((one) => one.key),
      )
    run(() => saveSpotKindAction({ venueId, key, ...fields }), {
      done: kind === null ? t('pe_kind_added', { name: fields.label }) : t('pe_kind_saved'),
      words,
      undo:
        kind === null
          ? () => removeSpotKindAction({ venueId, key })
          : () =>
              saveSpotKindAction({
                venueId,
                key,
                label: kind.label,
                symbol: kind.symbol,
                defaultSeats: kind.defaultSeats,
              }),
    })
  }

  function removeKind(kind: EditorKind) {
    run(() => removeSpotKindAction({ venueId, key: kind.key }), {
      done: t('pe_kind_removed', { name: kind.label }),
      words,
      undo: () =>
        saveSpotKindAction({
          venueId,
          key: kind.key,
          label: kind.label,
          symbol: kind.symbol,
          defaultSeats: kind.defaultSeats,
        }),
    })
  }

  const names = view.plan.spots.map((spot) => spot.name)
  const collator = new Intl.Collator(locale, { numeric: true })

  const heading = (
    <div className="grid grid-cols-1 gap-1">
      <h3 className="font-medium">{t('pe_title')}</h3>
      <p className="text-sm text-muted-foreground">{t('pe_d')}</p>
    </div>
  )

  if (plan === null) {
    return (
      <section className="grid grid-cols-1 gap-3" data-testid="pe-card">
        {heading}
        <Empty className="border" data-testid="pe-empty">
          <EmptyHeader>
            <EmptyTitle>{t('pe_empty_t')}</EmptyTitle>
            <EmptyDescription>{can ? t('pe_empty_d') : t('pe_empty_ro')}</EmptyDescription>
          </EmptyHeader>
          {can ? (
            <EmptyContent>
              <Button
                type="button"
                className={WRAPS}
                disabled={pending}
                data-testid="pe-start"
                onClick={startPlan}
              >
                {t('pe_start')}
              </Button>
            </EmptyContent>
          ) : null}
        </Empty>
      </section>
    )
  }

  return (
    <section className="grid grid-cols-1 gap-4" data-testid="pe-card">
      {heading}

      <div className="flex flex-wrap items-center gap-2">
        {plans.length > 1 ? (
          <Select value={plan.id} onValueChange={(id) => setPlanChoice(id)}>
            <SelectTrigger className="w-auto max-w-full" aria-label={t('pe_plan_pick')}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {plans.map((one) => (
                <SelectItem key={one.id} value={one.id}>
                  {one.current ? t('pe_plan_current', { name: one.name }) : one.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          <span className="font-medium [overflow-wrap:anywhere]" data-testid="pe-plan-name-shown">
            {plan.name}
          </span>
        )}
        {can ? (
          <>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-11"
                  aria-label={t('pe_plan_more')}
                  data-testid="pe-plan-more"
                >
                  <EllipsisIcon aria-hidden />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                <DropdownMenuItem
                  data-testid="pe-plan-rename"
                  onSelect={() => setAsking({ step: 'rename' })}
                >
                  {t('pe_rename')}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <Button
              type="button"
              className={`ml-auto ${WRAPS}`}
              disabled={pending}
              data-testid="pe-add-spot"
              onClick={() =>
                setAsking(kinds.length === 0 ? { step: 'kind', kind: null } : { step: 'new_spot' })
              }
            >
              <PlusIcon aria-hidden />
              {t('pe_add_spot')}
            </Button>
          </>
        ) : null}
      </div>

      {unreadable > 0 ? (
        <p className="text-sm text-muted-foreground" data-testid="pe-unreadable">
          {t('pe_unreadable', { n: unreadable })}
        </p>
      ) : null}

      <PlanCanvas
        spots={canvasSpots}
        room={room}
        selected={selected}
        can={can}
        onOpen={(id) => {
          setSelected(id)
          setOpenId(id)
        }}
        onCommit={(id, place) => {
          const spot = spots.find((one) => one.id === id)
          setSelected(id)
          if (spot !== undefined) saveSpot(spot, { place }, t('pe_spot_moved', { name: spot.name }))
        }}
      />

      {spots.length > 0 ? (
        <ul
          className="grid grid-cols-1 divide-y rounded-lg border bg-card"
          aria-label={t('pe_list')}
          data-testid="pe-spot-list"
        >
          {[...spots]
            .sort((a, b) => collator.compare(a.name, b.name))
            .map((spot) => {
              const kind = kindOf(spot.kind)
              const seats = spot.seats ?? kind?.defaultSeats ?? null
              const inside = (
                <>
                  <KindSymbol symbol={kind?.symbol ?? 'dot'} />
                  <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">{spot.name}</span>
                  <span className="text-sm text-muted-foreground">
                    {kind?.label ?? spot.kind}
                    {seats === null ? '' : ` · ${t('pe_seats_n', { n: seats })}`}
                  </span>
                </>
              )
              return (
                <li key={spot.id} data-testid="pe-spot-row" data-spot={spot.id}>
                  {can ? (
                    <button
                      type="button"
                      className="flex min-h-11 w-full items-center gap-3 p-3 text-left hover:bg-muted/50 focus-visible:outline-2 focus-visible:outline-ring"
                      onClick={() => {
                        setSelected(spot.id)
                        setOpenId(spot.id)
                      }}
                    >
                      {inside}
                    </button>
                  ) : (
                    <div className="flex min-h-11 items-center gap-3 p-3">{inside}</div>
                  )}
                </li>
              )
            })}
        </ul>
      ) : null}

      <KindsList
        kinds={kinds}
        can={can}
        busy={pending}
        onAdd={() => setAsking({ step: 'kind', kind: null })}
        onEdit={(kind) => setAsking({ step: 'kind', kind })}
        onRemove={removeKind}
      />

      {open === null ? null : (
        <SpotEditor
          spot={open}
          place={placeOf(open)}
          kinds={kinds}
          tables={tables}
          busy={pending}
          onSave={(next, done) => saveSpot(open, next, done)}
          onRemove={() => setAsking({ step: 'remove_spot', spot: open })}
          onClose={() => setOpenId(null)}
        />
      )}

      {asking?.step === 'new_spot' ? (
        <NewSpotDialog
          kinds={kinds}
          firstKind={kinds[0]?.key ?? ''}
          nameFor={(kind) => nextSpotName(kind.label, names)}
          onSave={addSpot}
          onClose={() => setAsking(null)}
        />
      ) : null}
      {asking?.step === 'rename' ? (
        <PlanNameDialog
          saved={plan.name}
          onSave={(name) => {
            setAsking(null)
            const before = plan.name
            run(() => savePlanAction({ venueId, planId: plan.id, name }), {
              done: t('pe_renamed'),
              words,
              undo: () => savePlanAction({ venueId, planId: plan.id, name: before }),
            })
          }}
          onClose={() => setAsking(null)}
        />
      ) : null}
      {asking?.step === 'kind' ? (
        <KindDialog
          saved={asking.kind}
          onSave={(fields) => saveKind(asking.kind, fields)}
          onClose={() => setAsking(null)}
        />
      ) : null}
      {asking?.step === 'remove_spot' ? (
        <ConfirmDialog
          title={t('pe_remove_t', { name: asking.spot.name })}
          body={
            asking.spot.bookings > 0
              ? t('pe_remove_booked', { n: asking.spot.bookings })
              : t('pe_remove_b')
          }
          doLabel={t('pe_remove_do')}
          keepLabel={t('pe_remove_keep')}
          testId="pe-remove-spot"
          busy={pending}
          onDo={() => removeSpot(asking.spot)}
          onKeep={() => setAsking(null)}
        />
      ) : null}
    </section>
  )
}

/** The venue's spot kinds: what each is called, its symbol and its usual seats. */
function KindsList({
  kinds,
  can,
  busy,
  onAdd,
  onEdit,
  onRemove,
}: {
  kinds: readonly EditorKind[]
  can: boolean
  busy: boolean
  onAdd: () => void
  onEdit: (kind: EditorKind) => void
  onRemove: (kind: EditorKind) => void
}) {
  const t = useTranslations('ownerSettings')
  return (
    <div className="grid grid-cols-1 gap-2" data-testid="pe-kinds">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="grid grid-cols-1 gap-0.5">
          <h4 className="text-sm font-medium">{t('pe_kinds_h')}</h4>
          <p className="text-sm text-muted-foreground">{t('pe_kinds_d')}</p>
        </div>
        {can ? (
          <Button
            type="button"
            variant="outline"
            className={WRAPS}
            disabled={busy}
            data-testid="pe-kind-add"
            onClick={onAdd}
          >
            <PlusIcon aria-hidden />
            {t('pe_kind_add')}
          </Button>
        ) : null}
      </div>
      {kinds.length === 0 ? (
        <p className="text-sm text-muted-foreground" data-testid="pe-kinds-empty">
          {t('pe_kinds_empty')}
        </p>
      ) : (
        <ul className="grid grid-cols-1 divide-y rounded-lg border bg-card">
          {kinds.map((kind) => (
            <li
              key={kind.key}
              className="flex min-h-11 items-center gap-3 px-3 py-1.5"
              data-testid="pe-kind-row"
              data-kind={kind.key}
            >
              <KindSymbol symbol={kind.symbol} />
              <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">{kind.label}</span>
              <span className="text-sm text-muted-foreground">
                {kind.defaultSeats === null
                  ? t('pe_kind_spots', { n: kind.spots })
                  : `${t('pe_seats_n', { n: kind.defaultSeats })} · ${t('pe_kind_spots', { n: kind.spots })}`}
              </span>
              {can ? (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="size-11"
                      aria-label={t('pe_kind_more', { name: kind.label })}
                      data-testid="pe-kind-more"
                    >
                      <EllipsisIcon aria-hidden />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onSelect={() => onEdit(kind)}>
                      {t('pe_kind_edit')}
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => onRemove(kind)}>
                      {t('pe_kind_remove')}
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
