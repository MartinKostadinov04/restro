'use client'

// Everything one spot holds (#327; Patterns: "Everything about one thing"): a side sheet on the
// tablet, a bottom drawer on a phone, opened by tapping the spot on the plan — one tap, as the
// screen plan's budget says.
//
// What it says, in this order: the state in a word, the seats, the Table its orders go onto (a
// spot that is not a table says so plainly — log 1.68), then every party and block on it this
// night, each with its hours. The whole of a name the tile had to clip is here.
//
// Two writes and one more read live on it: Block… opens the dialog, Unblock lifts the block in one
// tap, and History reads the spot's lines out of the one Log (D141) — the second tap of the budget,
// not a screen of its own. A role that may not block is told who may, in one line; on the venue's
// shared device the button is there and the PIN sheet asks for a name (D141 12.11).
//
// The door is the sheet's own work now (#329), and it is where the plan's two taps are spent:
//   • the party holding this spot is here → "Arrived", one gesture, on **this** spot, which is also
//     how a party is seated somewhere other than where it was booked: she taps the spot she wants
//     and the party under "Seat a party that is coming";
//   • nobody booked it → "Seat a walk-in", or "Seat until {time}" where somebody holds it later
//     tonight and a whole turn time still fits before their hour — with their name and hour read
//     out above the button, so she sees who she is seating in front of;
//   • they have gone → "Free", under the others, because freeing ends a night.
// A spot nobody is on also carries the queue (#330; D137): "From the waiting list" lists the
// parties with no spot, oldest first, and the tap on a party seats it **here** — two taps from the
// plan, no Select and no second button. The list is the night's own queue, read with the plan, so
// the plan and the night's list can never offer it in two different orders.
// The hour, and whether early seating is offered at all, are the venue's own turn time (D135): the
// door's advice works it out, and the sheet reads it when it opens.
import { useTranslations } from 'next-intl'
import { useCallback, useEffect, useState } from 'react'

import { Badge } from '@/components/ui/badge'
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
import { cn } from '@/lib/utils'
import { WRAPS } from '@/lib/wrapping'
import { arrivalChecksAction, spotHistoryAction } from '@/server/reservations/actions'
import type {
  RvArrivalChecksView,
  RvFrame,
  RvHoldView,
  RvKindView,
  RvSpotHistoryList,
  RvSpotView,
  RvWaitingView,
} from '@/server/reservations/view'
import { useDuration } from '@/settings/use-duration'
import { READ_FAILED, readAttempt } from '@/tonight/read-attempt'
import { ReadFailed } from '@/tonight/tab-parts'
import { useWho } from '@/tonight/who'
import { KindSymbol, StateMark } from './plan-shape'
import { useHoldText, useSpotHistoryText, useSpotStateWord } from './plan-words'
import { useGuestsText } from './reservation-words'

/** One party still to come tonight, as the door offers it. */
export interface ComingParty {
  readonly reservationId: string
  readonly name: string | null
  /** `HH:mm` in the venue's zone: the hour they are expected. */
  readonly time: string
}

/** One labelled line; nothing is drawn where there is nothing to say. */
function Line({ label, value }: { label: string; value: string | null }) {
  if (value === null || value === '') return null
  return (
    <p className="[overflow-wrap:anywhere]">
      <span className="text-muted-foreground">{label}</span> {value}
    </p>
  )
}

/** One party or block on the spot, with its hours. */
function Hold({ hold }: { hold: RvHoldView }) {
  const t = useTranslations('reservations')
  const text = useHoldText()
  const guests = useGuestsText()
  const { main, until } = text(hold)
  const name = hold.kind === 'block' ? null : (hold.name ?? t('no_name'))
  return (
    <li
      className="flex flex-wrap items-baseline gap-x-2 [overflow-wrap:anywhere]"
      data-testid="rv-spot-hold"
      data-now={hold.now}
    >
      {name === null ? null : <span className="font-medium">{name}</span>}
      {hold.partySize === null ? null : (
        <span className="text-muted-foreground">{guests(hold.partySize)}</span>
      )}
      <span>{main}</span>
      {until === '' ? null : <span className="text-muted-foreground">{until}</span>}
    </li>
  )
}

export function SpotSheet({
  spot,
  kind,
  frame,
  day,
  busy,
  sayWhoBlocks,
  coming,
  waiting,
  onBook,
  onBlock,
  onUnblock,
  onArrive,
  onSeatWaiting,
  onWalkIn,
  onFree,
  onClose,
}: {
  spot: RvSpotView
  /** The venue's own kind of this spot, for its symbol and its word. */
  kind: RvKindView | null
  frame: RvFrame
  /** The night the plan is showing, so the history knows which night it is read from. */
  day: string
  busy: boolean
  /**
   * Whether to say who may block instead: this night may be written, but this role may not block.
   * A night that has passed says so in its own banner, so the line would only repeat it.
   */
  sayWhoBlocks: boolean
  /** Opens the booking form with this spot chosen (#328); absent where this night cannot be booked. */
  onBook: (() => void) | null
  /** Opens the Block dialog; absent where this role may not block. */
  onBlock: (() => void) | null
  /** Lifts the block that holds the spot now, by its reservation. */
  onUnblock: ((reservationId: string) => void) | null
  /**
   * The parties still to come tonight, nearest hour first: what "Seat a party that is coming"
   * offers, so seating somebody on a spot other than the one they booked is one gesture (#329).
   */
  coming: readonly ComingParty[]
  /**
   * The night's waiting list, oldest first (#330): what "From the waiting list" offers on a spot
   * nobody is on. Empty on a night that has passed, where nothing is offered a spot.
   */
  waiting: readonly RvWaitingView[]
  /** Marks a party present on **this** spot; absent where this night or this role cannot seat. */
  onArrive: ((party: ComingParty) => void) | null
  /** Gives a waiting party **this** spot, which seats it in the same move; same role as seating. */
  onSeatWaiting: ((party: RvWaitingView) => void) | null
  /** Seats people who walked in, with the end hour where she took the one offered. */
  onWalkIn: ((until: string | null) => void) | null
  /** They have gone: the spots go back and the table codes close. */
  onFree: ((reservationId: string, name: string | null) => void) | null
  onClose: () => void
}) {
  const t = useTranslations('reservations')
  const stateWord = useSpotStateWord()
  const duration = useDuration()
  const sentence = useSpotHistoryText()
  const who = useWho()
  // undefined before History is tapped, null when the read never got through.
  const [history, setHistory] = useState<RvSpotHistoryList | null | undefined>(undefined)
  const [reading, setReading] = useState(false)
  // The door's advice for this spot: the hour to offer, and who holds it later tonight. Null while
  // it is being read and where it did not get through — the sheet then offers no end hour, which
  // is what a venue with no turn time to spare would get anyway.
  const [door, setDoor] = useState<RvArrivalChecksView | null>(null)
  const maySeat = onArrive !== null || onWalkIn !== null

  useEffect(() => {
    if (!maySeat) return
    let gone = false
    void arrivalChecksAction({ venueId: frame.venueId, day, spotIds: [spot.id] })
      .catch(() => ({ ok: false }) as const)
      .then((read) => {
        if (!gone) setDoor(read.ok ? read.checks : null)
      })
    return () => {
      gone = true
    }
  }, [day, frame.venueId, maySeat, spot.id])

  const read = useCallback(() => {
    setReading(true)
    void readAttempt(() => spotHistoryAction({ venueId: frame.venueId, spotId: spot.id })).then(
      (result) => {
        setReading(false)
        setHistory(result === READ_FAILED || !result.ok ? null : result.history)
      },
    )
  }, [frame.venueId, spot.id])

  /** The block holding the spot now: what Unblock lifts. */
  const block = spot.holds.find((hold) => hold.kind === 'block' && hold.now) ?? null
  /** The party holding this spot now and still to come: "Arrived" is about them. */
  const expected =
    spot.holds.find(
      (hold) => hold.now && (hold.status === 'reserved' || hold.status === 'waiting'),
    ) ?? null
  /** The party sitting here: what "Free" frees. */
  const seated = spot.holds.find((hold) => hold.now && hold.status === 'seated') ?? null
  /** Somebody holds it later tonight: her two taps become "Seat until {time}". */
  const until = door?.until ?? null
  const later = door?.heldLater ?? null
  /** Parties coming tonight that are not already on this spot. */
  const elsewhere = coming.filter((party) => party.reservationId !== expected?.reservationId)
  const lines = (history?.lines ?? [])
    .map((line) => ({ line, words: sentence(line) }))
    .filter((one): one is { line: typeof one.line; words: string } => one.words !== null)

  const body = (
    <div className="space-y-4 overflow-y-auto px-4 text-sm" data-testid="rv-spot-body">
      <p className="flex flex-wrap items-center gap-2">
        <Badge variant="outline" data-testid="rv-spot-state">
          <StateMark state={spot.state} className="size-3.5" />
          {stateWord(spot.state)}
        </Badge>
        {kind === null ? null : (
          <span className="flex items-center gap-1 text-muted-foreground">
            <KindSymbol symbol={kind.symbol} className="size-3.5" />
            {kind.label}
          </span>
        )}
      </p>
      <Line label={t('p_seats')} value={spot.seats === null ? null : String(spot.seats)} />
      {spot.table === null ? (
        <p className="text-muted-foreground" data-testid="rv-spot-no-table">
          {t('p_no_table')}
        </p>
      ) : (
        <div className="space-y-1" data-testid="rv-spot-table">
          <Line label={t('p_table')} value={spot.table.label} />
          <p className="text-muted-foreground">
            {spot.table.hasCode ? t('p_code_yes') : t('p_code_no')}
          </p>
        </div>
      )}
      <section className="space-y-1">
        <h3 className="font-medium">{t('p_holds')}</h3>
        {spot.holds.length === 0 ? (
          <p className="text-muted-foreground" data-testid="rv-spot-nothing">
            {t('p_nothing')}
          </p>
        ) : (
          <ul className="space-y-1" data-testid="rv-spot-holds">
            {spot.holds.map((hold) => (
              <Hold key={`${hold.reservationId}:${hold.time}`} hold={hold} />
            ))}
          </ul>
        )}
      </section>
      {later === null || seated !== null ? null : (
        <p className="text-muted-foreground" data-testid="rv-held-later">
          {t('d_holds', {
            party: later.name ?? t('no_name'),
            spot: spot.name,
            time: later.time,
          })}
        </p>
      )}
      {onArrive === null || elsewhere.length === 0 || seated !== null || block !== null ? null : (
        <section className="space-y-1">
          <h3 className="font-medium">{t('d_seat_who')}</h3>
          <ul className="flex min-w-0 flex-wrap gap-2" data-testid="rv-coming">
            {elsewhere.map((party) => (
              <li key={party.reservationId}>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="min-h-11"
                  disabled={busy}
                  data-testid="rv-seat-coming"
                  onClick={() => onArrive(party)}
                >
                  <span className="tabular-nums">{party.time}</span>
                  {party.name ?? t('no_name')}
                </Button>
              </li>
            ))}
          </ul>
        </section>
      )}
      {onSeatWaiting === null ||
      waiting.length === 0 ||
      seated !== null ||
      expected !== null ||
      block !== null ? null : (
        <section className="space-y-1">
          <h3 className="font-medium">{t('w_from')}</h3>
          <p className="text-muted-foreground">{t('w_order')}</p>
          <ul className="flex min-w-0 flex-wrap gap-2" data-testid="rv-from-waiting">
            {waiting.map((party) => (
              <li key={party.reservationId}>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className={cn('min-h-11', WRAPS)}
                  disabled={busy}
                  data-testid="rv-seat-waiting"
                  onClick={() => onSeatWaiting(party)}
                >
                  {party.name ?? t('no_name')}
                  <span className="text-muted-foreground">
                    {t('w_for', { duration: duration(party.waitedMinutes) })}
                  </span>
                </Button>
              </li>
            ))}
          </ul>
        </section>
      )}
      {sayWhoBlocks ? (
        <p className="text-muted-foreground" data-testid="rv-no-block">
          {t('p_no_block')}
        </p>
      ) : null}
      <section className="space-y-1">
        <h3 className="font-medium">{t('p_history_t', { spot: spot.name })}</h3>
        {history === undefined ? (
          <Button
            type="button"
            variant="outline"
            className={WRAPS}
            disabled={reading}
            data-testid="rv-spot-history"
            onClick={read}
          >
            {t('sh_history')}
          </Button>
        ) : history === null ? (
          <ReadFailed onRetry={read} />
        ) : lines.length === 0 ? (
          <p className="text-muted-foreground" data-testid="rv-history-empty">
            {t('p_history_empty')}
          </p>
        ) : (
          <ul className="space-y-1 text-muted-foreground" data-testid="rv-spot-log">
            {lines.map(({ line, words }) => (
              <li key={line.seq} className="[overflow-wrap:anywhere]">
                <span className="tabular-nums">
                  {line.day === day ? line.time : `${line.day} ${line.time}`}
                </span>
                {' · '}
                {line.name === null ? words : `${words} — ${line.name}`}
                {' · '}
                {who(line.by)}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )

  const buttons = (
    <>
      {expected !== null && onArrive !== null ? (
        <Button
          type="button"
          className={WRAPS}
          disabled={busy}
          data-testid="rv-spot-arrive"
          onClick={() =>
            onArrive({
              reservationId: expected.reservationId,
              name: expected.name,
              time: expected.time,
            })
          }
        >
          {t('d_arrived')}
        </Button>
      ) : null}
      {expected === null && seated === null && block === null && onWalkIn !== null ? (
        <Button
          type="button"
          className={WRAPS}
          disabled={busy}
          data-testid="rv-walk-in"
          onClick={() => onWalkIn(until)}
        >
          {until === null ? t('d_walk_in') : t('d_seat_until', { time: until })}
        </Button>
      ) : null}
      {seated !== null && onFree !== null ? (
        <Button
          type="button"
          variant="outline"
          className={WRAPS}
          disabled={busy}
          data-testid="rv-spot-free"
          onClick={() => onFree(seated.reservationId, seated.name)}
        >
          {t('d_free')}
        </Button>
      ) : null}
      {onBook !== null && spot.state !== 'blocked' ? (
        <Button
          type="button"
          variant={
            expected !== null || seated !== null || onWalkIn !== null ? 'outline' : 'default'
          }
          className={WRAPS}
          disabled={busy}
          data-testid="rv-book-spot"
          onClick={onBook}
        >
          {t('bk_book_spot')}
        </Button>
      ) : null}
      {block !== null && onUnblock !== null ? (
        <Button
          type="button"
          className={WRAPS}
          disabled={busy}
          data-testid="rv-unblock"
          onClick={() => onUnblock(block.reservationId)}
        >
          {t('p_unblock')}
        </Button>
      ) : null}
      {block === null && onBlock !== null ? (
        <Button
          type="button"
          variant="outline"
          className={WRAPS}
          disabled={busy}
          data-testid="rv-block"
          onClick={onBlock}
        >
          {t('p_block')}
        </Button>
      ) : null}
      <Button
        type="button"
        variant="ghost"
        className="h-12"
        data-testid="rv-spot-close"
        onClick={onClose}
      >
        {t('close')}
      </Button>
    </>
  )

  const isMobile = useIsMobile()
  const sub = [kind?.label, spot.seats === null ? null : `${t('p_seats')} ${spot.seats}`]
    .filter((part): part is string => part !== null && part !== undefined)
    .join(' · ')

  return isMobile ? (
    <Drawer open onOpenChange={(open) => !open && onClose()}>
      <DrawerContent data-testid="rv-spot-sheet">
        <DrawerHeader>
          <DrawerTitle className="[overflow-wrap:anywhere]">{spot.name}</DrawerTitle>
          <DrawerDescription>{sub}</DrawerDescription>
        </DrawerHeader>
        {body}
        <DrawerFooter>{buttons}</DrawerFooter>
      </DrawerContent>
    </Drawer>
  ) : (
    <Sheet open onOpenChange={(open) => !open && onClose()}>
      <SheetContent data-testid="rv-spot-sheet">
        <SheetHeader>
          <SheetTitle className="[overflow-wrap:anywhere]">{spot.name}</SheetTitle>
          <SheetDescription>{sub}</SheetDescription>
        </SheetHeader>
        {body}
        <SheetFooter>{buttons}</SheetFooter>
      </SheetContent>
    </Sheet>
  )
}
