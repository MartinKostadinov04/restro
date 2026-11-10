'use client'

// Change tables (#331; D137, D110): one sheet over the plan, in place of the MVP's Move, Add places
// and Choose places. The party's spots read as chosen; a tap turns a spot on or off, and Save
// writes the set she sees — adding, taking back and moving are the same three taps, no modes.
//
// A tap on a spot another party is on right now asks to **swap** with it, in this same sheet: on a
// full club the swap is the only way two parties trade tables, so it is one save, never two. A spot
// that is blocked is refused by name before anything is written; one booked later tonight is left
// to the write, which judges it by the same rules as every other path and names the party in the
// way.
//
// **No bill moves here.** A party that has ordered leaves its bill on the table it left; Restro
// only closes that table's codes and opens the new ones. The save's result says "the bill stays on
// that spot, move it at the till" (only a venue with a till has a bill) and no button pretends so
// (D137, log 4.22; D110). Nothing on this sheet adds up the party's tables either (D137, log 12.18).
//
// Before a sitting party's save, the door's own advice is read (`arrivalChecksAction`) for the
// tables being added, and the door's own questions are asked: the same-guests question where one
// is already open, the open-bill warning where one still carries a bill (#329).
import type { PayRule } from '@restro/core'
import { useTranslations } from 'next-intl'
import { useCallback, useMemo, useState } from 'react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from '@/components/ui/drawer'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { useIsMobile } from '@/hooks/use-mobile'
import { WRAPS } from '@/lib/wrapping'
import { arrivalChecksAction, changeTablesAction } from '@/server/reservations/actions'
import type { RvFrame, RvHoldView, RvPlanView, RvSpotView } from '@/server/reservations/view'

import { ConfirmDialog } from './confirm-dialog'
import { SameGuestsDialog } from './door-dialogs'
import { useBlockReasonWord } from './plan-words'
import { PickWait, SpotPlan, usePickPlan } from './spot-picker'
import type { RvRunSpec } from './use-reservation-run'

/** The party whose tables change. */
export interface ChangeTablesParty {
  readonly reservationId: string
  readonly name: string | null
  /** The night it belongs to: the plan is read for that night. */
  readonly day: string
}

/** The other party of a swap: who, and where each of the two ends. */
interface Swap {
  readonly reservationId: string
  readonly name: string | null
  /** The spots it holds now, as the plan showed them. */
  readonly from: readonly string[]
}

/** A question the save waits on. */
type Asking =
  | { readonly step: 'swap'; readonly hold: RvHoldView; readonly spot: RvSpotView }
  | { readonly step: 'same_guests'; readonly payRule: PayRule | null }
  | { readonly step: 'bill'; readonly billSpots: readonly string[] }

/** The parties on a spot this night that are not blocks, with their hold. */
const partiesOn = (spot: RvSpotView) => spot.holds.filter((hold) => hold.kind !== 'block')

/** The spots a party holds this night, by the plan. */
const spotsOf = (plan: RvPlanView, reservationId: string) =>
  plan.spots
    .filter((spot) => spot.holds.some((hold) => hold.reservationId === reservationId))
    .map((spot) => spot.id)

/** The hold of a party on the plan, wherever it is: its status and hour. */
const holdOf = (plan: RvPlanView, reservationId: string): RvHoldView | null => {
  for (const spot of plan.spots) {
    const hold = spot.holds.find((one) => one.reservationId === reservationId)
    if (hold !== undefined) return hold
  }
  return null
}

const sameSet = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((id) => b.includes(id))

export function ChangeTablesSheet({
  frame,
  party,
  run,
  onClose,
  onChanged,
}: {
  frame: RvFrame
  party: ChangeTablesParty
  run: (spec: RvRunSpec) => void
  onClose: () => void
  /** Something was written: the screen behind reads again. */
  onChanged: () => void
}) {
  const t = useTranslations('reservations')
  const isMobile = useIsMobile()
  const reasonWord = useBlockReasonWord()
  const pick = usePickPlan(frame, party.day)
  const plan = pick.plan
  const venueId = frame.venueId
  /** Null until she taps something: then the plan's own reading of the party is the choice. */
  const [picked, setPicked] = useState<readonly string[] | null>(null)
  const [swap, setSwap] = useState<Swap | null>(null)
  const [asking, setAsking] = useState<Asking | null>(null)
  const [busy, setBusy] = useState(false)

  const from = useMemo(
    () => (plan === null ? [] : spotsOf(plan, party.reservationId)),
    [plan, party.reservationId],
  )
  const chosen = picked ?? from
  const nameOf = useCallback((name: string | null) => name ?? t('no_name'), [t])
  const spotName = useCallback(
    (id: string) => plan?.spots.find((spot) => spot.id === id)?.name ?? '',
    [plan],
  )

  /** A tap on the plan: on or off, a swap offered, or a block refused by its name. */
  const tap = useCallback(
    (spot: RvSpotView) => {
      if (chosen.includes(spot.id)) {
        setPicked(chosen.filter((id) => id !== spot.id))
        return
      }
      const block = spot.holds.find((hold) => hold.kind === 'block' && hold.now)
      if (block !== undefined) {
        toast.error(t('ct_blocked', { spot: spot.name, reason: reasonWord(block.reason) }), {
          id: `rv-ct-blocked:${spot.id}`,
        })
        return
      }
      // Somebody else is on it right now: the swap is offered. A booking later tonight is not in
      // the way of every party, so it is left to the write, which says so by name if it is.
      const other = partiesOn(spot).find(
        (hold) =>
          hold.now &&
          hold.reservationId !== party.reservationId &&
          hold.reservationId !== swap?.reservationId,
      )
      if (other !== undefined) {
        if (swap === null) {
          setAsking({ step: 'swap', hold: other, spot })
          return
        }
        // One swap per save: a third party in the way is named and the spot is not taken.
        toast.error(
          t('ct_taken', { party: nameOf(other.name), spot: spot.name, time: other.time }),
          { id: `rv-ct-taken:${spot.id}` },
        )
        return
      }
      setPicked([...chosen, spot.id])
    },
    [chosen, nameOf, party.reservationId, reasonWord, swap, t],
  )

  /** She said yes to the swap: this party takes the other's spots and gives it its own. */
  const takeSwap = useCallback(
    (hold: RvHoldView) => {
      if (plan === null) return
      const theirs = spotsOf(plan, hold.reservationId)
      setSwap({ reservationId: hold.reservationId, name: hold.name, from: theirs })
      setPicked([...chosen.filter((id) => !from.includes(id)), ...theirs])
      setAsking(null)
    },
    [chosen, from, plan],
  )

  /** The write, with the hostess's answer to the same-guests question where one was asked. */
  const write = useCallback(
    (sameGuests: boolean | undefined) => {
      if (plan === null) return
      const mine = [...chosen]
      const was = [...from]
      // In a swap the other party ends on the spots this one had, less any it keeps itself.
      const other =
        swap === null
          ? null
          : {
              reservationId: swap.reservationId,
              from: [...swap.from],
              spotIds: was.filter((id) => !mine.includes(id)),
            }
      const answer = sameGuests === undefined ? {} : { sameGuests }
      setAsking(null)
      run({
        id: `rv-change-tables:${party.reservationId}`,
        done: t('ct_done'),
        pin: { title: t('ct_pin', { party: nameOf(party.name) }), body: t('d_pin_b') },
        act: (pin) =>
          changeTablesAction({
            venueId,
            reservationId: party.reservationId,
            from: was,
            spotIds: mine,
            ...(other === null ? {} : { swap: other }),
            ...answer,
            ...(pin === undefined ? {} : { pin }),
          }),
        // The Undo is the same change the other way round; a table it opens again starts a new
        // sitting, since the one its guests left was ended by this save.
        again: {
          label: t('p_undo'),
          done: t('ct_undone'),
          act: (pin?: string) =>
            changeTablesAction({
              venueId,
              reservationId: party.reservationId,
              from: mine,
              spotIds: was,
              ...(other === null
                ? {}
                : {
                    swap: {
                      reservationId: other.reservationId,
                      from: other.spotIds,
                      spotIds: other.from,
                    },
                  }),
              ...(pin === undefined ? {} : { pin }),
            }),
        },
        refusal: (error, details) => {
          if (error !== 'spot_taken' || details === undefined) return null
          const spot = plan.spots.find((one) => one.id === details.spotId)
          const hold = spot?.holds.find((one) => one.reservationId === details.reservationId)
          if (spot === undefined || hold === undefined) return null
          return hold.kind === 'block'
            ? t('ct_blocked', { spot: spot.name, reason: reasonWord(hold.reason) })
            : t('ct_taken', { party: nameOf(hold.name), spot: spot.name, time: hold.time })
        },
        after: onChanged,
        onDone: (details) => {
          // The bill stays where it was: only the till moves a bill (D110). Said once per table.
          const left = typeof details.billLeft === 'string' ? details.billLeft.split(',') : []
          const spots = plan.spots
            .filter((spot) => spot.table !== null && left.includes(spot.table.id))
            .filter((spot) => was.includes(spot.id) || (other?.from.includes(spot.id) ?? false))
            .map((spot) => spot.name)
          if (spots.length > 0) {
            toast.message(t('ct_bill_stays', { spot: spots.join(', ') }), {
              id: `rv-ct-bill:${party.reservationId}`,
              duration: Number.POSITIVE_INFINITY,
              closeButton: true,
            })
          }
          if (details.tableClosed === true) {
            toast.message(t('d_closed'), { id: `rv-closed:${party.reservationId}` })
          }
          onClose()
        },
      })
    },
    [chosen, from, nameOf, onChanged, onClose, party, plan, reasonWord, run, swap, t, venueId],
  )

  /**
   * Save: for a party at its tables, the door's advice on the tables it is being given first —
   * the same-guests question where one is open, the open-bill warning where one carries a bill.
   * Tables this change itself closes (the party's own, the swap partner's) are no question.
   */
  const save = useCallback(() => {
    if (plan === null) return
    const added = chosen.filter((id) => !from.includes(id))
    const seated = holdOf(plan, party.reservationId)?.status === 'seated'
    if (!seated || added.length === 0) {
      write(undefined)
      return
    }
    const ours = new Set(
      plan.spots
        .filter((spot) => from.includes(spot.id) || (swap?.from.includes(spot.id) ?? false))
        .flatMap((spot) => (spot.table === null ? [] : [spot.table.id])),
    )
    setBusy(true)
    void arrivalChecksAction({
      venueId,
      day: party.day,
      spotIds: added,
      reservationId: party.reservationId,
    })
      .catch(() => ({ ok: false }) as const)
      .then((read) => {
        setBusy(false)
        // No advice: the write asks the question itself by refusing without an answer.
        if (!read.ok) {
          write(undefined)
          return
        }
        const theirs = read.checks.tables.filter((table) => !ours.has(table.tableId))
        if (theirs.some((table) => table.open)) {
          setAsking({ step: 'same_guests', payRule: read.checks.payRule })
          return
        }
        const billSpots = theirs.filter((table) => table.bill).map((table) => table.tableName)
        if (billSpots.length > 0) {
          setAsking({ step: 'bill', billSpots })
          return
        }
        write(undefined)
      })
  }, [chosen, from, party, plan, swap, venueId, write])

  const changed = plan !== null && (!sameSet(chosen, from) || swap !== null)
  const title = `${t('ct_open')} · ${nameOf(party.name)}`

  const body = (
    <div className="space-y-4 overflow-y-auto px-4 pb-2 text-sm" data-testid="rv-ct">
      {plan === null ? (
        <PickWait />
      ) : (
        <>
          <SpotPlan plan={plan} selected={chosen} onChange={(ids) => setPicked(ids)} onTap={tap} />
          <p data-testid="rv-ct-chosen">
            <span className="font-medium">{t('ct_chosen')}: </span>
            {chosen.length === 0
              ? t('ct_chosen_none')
              : chosen.map(spotName).filter(Boolean).join(', ')}
          </p>
          {swap === null ? null : (
            <div className="flex flex-wrap items-center gap-2" data-testid="rv-ct-swap">
              <p className="min-w-0 flex-1 [overflow-wrap:anywhere]">
                <span className="font-medium">{t('ct_swap')}: </span>
                {t('ct_swapping', {
                  party: nameOf(swap.name),
                  spots: from
                    .filter((id) => !chosen.includes(id))
                    .map(spotName)
                    .join(', '),
                })}
              </p>
              <Button
                type="button"
                variant="outline"
                className="h-11"
                data-testid="rv-ct-swap-undo"
                onClick={() => {
                  setSwap(null)
                  setPicked(null)
                }}
              >
                {t('ct_no_swap')}
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  )

  const buttons = (
    <>
      <Button
        type="button"
        className={WRAPS}
        disabled={!changed || busy}
        data-testid="rv-ct-save"
        onClick={save}
      >
        {t('bk_save')}
      </Button>
      <Button
        type="button"
        variant="outline"
        className="h-12"
        data-testid="rv-ct-close"
        onClick={onClose}
      >
        {t('close')}
      </Button>
    </>
  )

  const question =
    asking === null ? null : asking.step === 'swap' ? (
      <ConfirmDialog
        title={t('ct_swap_t', { party: nameOf(asking.hold.name) })}
        body={t('ct_swap_b')}
        doLabel={t('ct_swap_do', { party: nameOf(asking.hold.name) })}
        keepLabel={t('ct_no_swap')}
        testId="rv-ct-swap-dialog"
        busy={false}
        onDo={() => takeSwap(asking.hold)}
        onKeep={() => setAsking(null)}
      />
    ) : asking.step === 'same_guests' ? (
      <SameGuestsDialog
        busy={busy}
        payRule={asking.payRule}
        onAnswer={(sameGuests) => write(sameGuests)}
        onLeave={() => setAsking(null)}
      />
    ) : (
      <ConfirmDialog
        title={t('d_bill_t', { spot: asking.billSpots.join(', ') })}
        body={t('d_bill_b')}
        doLabel={t('d_bill_do')}
        keepLabel={t('d_bill_no')}
        testId="rv-ct-open-bill"
        busy={busy}
        onDo={() => write(undefined)}
        onKeep={() => setAsking(null)}
      />
    )

  return (
    <>
      {isMobile ? (
        <Drawer open dismissible={false} onOpenChange={(open) => !open && onClose()}>
          <DrawerContent data-testid="rv-ct-sheet">
            <DrawerHeader>
              <DrawerTitle className="[overflow-wrap:anywhere]">{title}</DrawerTitle>
              <DrawerDescription>{t('ct_lead')}</DrawerDescription>
            </DrawerHeader>
            {body}
            <DrawerFooter>{buttons}</DrawerFooter>
          </DrawerContent>
        </Drawer>
      ) : (
        <Sheet open onOpenChange={(open) => !open && onClose()}>
          <SheetContent className="sm:max-w-md" data-testid="rv-ct-sheet">
            <SheetHeader>
              <SheetTitle className="[overflow-wrap:anywhere]">{title}</SheetTitle>
              <SheetDescription>{t('ct_lead')}</SheetDescription>
            </SheetHeader>
            {body}
            <SheetFooter>{buttons}</SheetFooter>
          </SheetContent>
        </Sheet>
      )}
      {question}
    </>
  )
}
