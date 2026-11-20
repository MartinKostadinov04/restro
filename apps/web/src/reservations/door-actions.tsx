'use client'

// The door's writes (#329), shared by the night's list, a reservation's sheet and the floor plan so
// that marking a party present is worded, questioned and signed the same wherever the hostess taps:
//   • Arrived — one tap: the party becomes Seated and every table code of its spots opens for
//     phones. The Undo on the toast is `reservation.undo_arrival`, which closes the codes this very
//     arrival opened and puts the party back where it was;
//   • Seat a walk-in — two taps on the plan: the free spot, then the button;
//   • Guests — the count, asked from the sheet after they are sitting, never at the door;
//   • Free — the spots go back to the plan and the codes of their Tables close, so no phone puts
//     another round on a bill the party has left. Secondary, under "…": freeing is the end of a
//     night, not its default. Its Undo is the party claiming the same spots again, which opens the
//     codes again — a new sitting, since the one its guests left was ended by the freeing.
//
// **The questions.** Before a seating the door reads its advice (`arrivalChecksAction`) and then:
//   • a table of theirs has an order on it, sent or in the guests' bag → the same-party question (#419: the
//     order on the table, not the people at the door), both answers at equal weight.
//     Its own words say what happens to the order and what stays on the bill, so the open-bill
//     warning is not stacked on top of it;
//   • no such order but a table still carries a bill → the open-bill warning, whose two buttons are
//     "Seat them anyway" and "Check the bill first".
// Freeing reads the same advice and warns the same way, in its own words: the bill does not stop
// the table being freed, it is only the thing she should look at before the codes close.
// Where the advice does not get through, the write is attempted and the service path refuses
// `same_guests_unanswered` if a table turns out to carry an order; the question is then asked and the
// write repeated. Neither route can seat a party onto an open table without an answer.
//
// Nothing here decides whether a person may: the service path does, inside its own transaction.
// A role that may not open and close tables still marks Arrived, and the answer says in one line
// that the table stayed closed (`tableClosed` in the details) — never a refusal.
import type { PayRule } from '@restro/core'
import { useTranslations } from 'next-intl'
import { useCallback, useState } from 'react'

import {
  arrivalChecksAction,
  arriveAction,
  freeSpotsAction,
  holdSpotsAction,
  seatWalkInAction,
  setGuestsAction,
  undoArrivalAction,
} from '@/server/reservations/actions'
import type { RvFrame } from '@/server/reservations/view'
import { ConfirmDialog } from './confirm-dialog'
import { SameGuestsDialog } from './door-dialogs'
import { useSpotsText } from './reservation-words'
import { type RvRunSpec, useSpotsLostLine } from './use-reservation-run'

/** The party at the door: what a seating needs to know about it. */
export interface DoorParty {
  /** The booking or waiting line being seated; null when a walk-in is being put down. */
  readonly reservationId: string | null
  /** The night its hours belong to. */
  readonly day: string
  /** Its name, for the sentences; null for a walk-in nobody named. */
  readonly name: string | null
  /**
   * The spots they are taking. Empty for an arrival onto the spots the party already holds: the
   * write keeps them, and the advice reads them off the reservation.
   */
  readonly spotIds: readonly string[]
  /**
   * A walk-in's count, which is required of it (a party that is not a block has one). For an
   * arrival it is left out, and the booking keeps the count it was taken for.
   */
  readonly partySize?: number
  /** The hour "Seat until {time}" offered, where she took it. */
  readonly until?: string | null
  /**
   * The spot the party was given, by name (#330): where she chose the spot herself, the toast says
   * which one they are sitting on, since that is the thing she wants read back to her.
   */
  readonly onSpot?: string
}

/**
 * How many tables the write left open for phones, as the service answered it (`tablesOpen`). A
 * missing or odd value reads as none: the screen says a table is open only when the write said so.
 */
export function tablesOpenFor(details: Readonly<Record<string, unknown>>): number {
  const count = details.tablesOpen
  return typeof count === 'number' && count > 0 ? count : 0
}

/** A write waiting on the hostess's answer. */
interface Asking {
  readonly party: DoorParty
  readonly step: 'same_guests' | 'bill' | 'free_bill'
  /** The pay rule the party carries, so the same-guests answers say what becomes of it (#334). */
  readonly payRule: PayRule | null
  /** The tables that still carry something, by name: the open-bill sentence names them. */
  readonly billSpots: readonly string[]
  /** The spots the advice was about, for the Undo of a freeing; empty where it is not known. */
  readonly spots: readonly string[]
}

export function useDoorActions({
  frame,
  run,
  onChanged,
}: {
  frame: RvFrame
  run: (spec: RvRunSpec) => void
  /** Something was written: the screen behind reads again. */
  onChanged: () => void
}) {
  const t = useTranslations('reservations')
  const spotsLostLine = useSpotsLostLine()
  const venueId = frame.venueId
  const [asking, setAsking] = useState<Asking | null>(null)
  const [reading, setReading] = useState(false)
  const spotsText = useSpotsText()

  /** The party in a sentence: its name, or "No name" for a walk-in nobody named. */
  const named = useCallback((party: DoorParty) => party.name ?? t('no_name'), [t])

  /**
   * The one write, with the answer the hostess gave (or none, where nothing was asked). Its one
   * toast names the party and, in the same sentence, what became of its table: open for phones, or
   * closed because the role could not open it.
   */
  const seat = useCallback(
    (party: DoorParty, sameGuests: boolean | undefined) => {
      const reservationId = party.reservationId
      const answer = sameGuests === undefined ? {} : { sameGuests }
      run({
        id:
          reservationId === null
            ? `rv-walk-in:${party.spotIds.join(',')}`
            : `rv-arrive:${reservationId}`,
        // One toast per write (S21), naming the party: that it is seated, and in the same sentence
        // what the write reports of its tables — open for phones, or closed because this role may
        // not open them. Never guessed before the answer (#396).
        done: (details) => {
          const spot = party.onSpot === undefined ? null : spotsText([party.onSpot])
          // A party nobody named reads as a party, never as "Seated: No name."
          const seated =
            reservationId === null || party.name === null
              ? spot === null
                ? t('d_seated_walk_in_bare')
                : t('d_seated_walk_in', { spot })
              : spot === null
                ? t('d_seated', { party: named(party) })
                : t('w_seated', { party: named(party), spot })
          // The role may not open tables: the party is seated and the table stayed closed (#329).
          if (details.tableClosed === true) return `${seated} ${t('d_closed')}`
          return tablesOpenFor(details) > 0 ? `${seated} ${t('d_open')}` : seated
        },
        pin: {
          title:
            reservationId === null
              ? t('d_pin_walk_in')
              : t('d_pin_arrive', { party: named(party) }),
          body: t('d_pin_b'),
        },
        act: (pin) =>
          reservationId === null
            ? seatWalkInAction({
                venueId,
                day: party.day,
                spotIds: party.spotIds,
                partySize: party.partySize,
                ...(party.until === undefined ? {} : { until: party.until }),
                ...answer,
                ...(pin === undefined ? {} : { pin }),
              })
            : arriveAction({
                venueId,
                reservationId,
                day: party.day,
                ...(party.spotIds.length === 0 ? {} : { spotIds: party.spotIds }),
                ...(party.until === undefined ? {} : { until: party.until }),
                ...(party.partySize === undefined ? {} : { partySize: party.partySize }),
                ...answer,
                ...(pin === undefined ? {} : { pin }),
              }),
        // The arrival is undone by its own command, which closes the codes it opened (#329). A
        // walk-in the seat tap itself created is cancelled by the same command, on the line the
        // write reports it made, and says so in its own words (S21: every door write offers its
        // Undo). A walk-in whose write reported no line offers none rather than guess. The party
        // goes back to the spots it held before; where one was taken since, it comes back without
        // them and she reads it in one line (C5 of the 11-18 screen round).
        again: (details) => {
          const made = details.reservationId
          const id = reservationId ?? (typeof made === 'string' ? made : null)
          if (id === null) return undefined
          return {
            label: t('p_undo'),
            done: reservationId === null ? t('d_walk_in_undone') : t('d_undone'),
            notice: (undone) =>
              spotsLostLine(undone, { taken: 'd_undone_lost', other: 'd_undone_nospots' }),
            act: (pin?: string) =>
              undoArrivalAction({
                venueId,
                reservationId: id,
                ...(pin === undefined ? {} : { pin }),
              }),
          }
        },
        // Somebody is on the spot right now (`holdsSpotNow`, not the booking rule): the sentence
        // names them and their hour, which is the whole point of it. `spot_taken` carries only
        // ids, so the names come from the door's own advice, read once, on the refusal only.
        refusal: async (error) => {
          if (error !== 'spot_taken') return null
          const read = await arrivalChecksAction({
            venueId,
            day: party.day,
            ...(party.spotIds.length === 0 ? {} : { spotIds: party.spotIds }),
            ...(reservationId === null ? {} : { reservationId }),
          }).catch(() => ({ ok: false }) as const)
          if (!read.ok || read.checks.onTheSpot === null) return null
          const on = read.checks.onTheSpot
          return t('d_taken', {
            party: on.name ?? t('no_name'),
            spot: on.spotName,
            time: on.time,
          })
        },
        after: onChanged,
        onDone: () => setAsking(null),
      })
    },
    [named, onChanged, run, spotsLostLine, spotsText, t, venueId],
  )

  /** Asks first where the advice says a question is due, and writes where it does not. */
  const begin = useCallback(
    (party: DoorParty) => {
      setReading(true)
      void arrivalChecksAction({
        venueId,
        day: party.day,
        ...(party.spotIds.length === 0 ? {} : { spotIds: party.spotIds }),
        ...(party.reservationId === null ? {} : { reservationId: party.reservationId }),
      })
        .catch(() => ({ ok: false }) as const)
        .then((read) => {
          setReading(false)
          if (!read.ok) {
            // No advice: the write asks the question itself by refusing without an answer.
            seat(party, undefined)
            return
          }
          const billSpots = read.checks.tables
            .filter((table) => table.bill)
            .map((table) => table.tableName)
          // Only an order already on the table is a question: open for phones alone asks nothing.
          if (read.checks.tables.some((table) => table.hasOrder)) {
            setAsking({
              party,
              step: 'same_guests',
              billSpots,
              spots: read.checks.spotIds,
              payRule: read.checks.payRule,
            })
            return
          }
          if (billSpots.length > 0) {
            setAsking({
              party,
              step: 'bill',
              billSpots,
              spots: read.checks.spotIds,
              payRule: read.checks.payRule,
            })
            return
          }
          seat(party, undefined)
        })
    },
    [seat, venueId],
  )

  /** The guests are here. */
  const arrive = useCallback((party: DoorParty) => begin(party), [begin])

  /** Somebody nobody booked, straight onto a free spot. A walk-in always carries its count. */
  const walkIn = useCallback(
    (party: DoorParty & { readonly partySize: number }) => begin({ ...party, reservationId: null }),
    [begin],
  )

  /** The count of a party already sitting: the sitting stands and the order is not touched. */
  const setGuests = useCallback(
    (reservationId: string, party: string, guests: number, onDone: () => void) =>
      run({
        id: `rv-guests:${reservationId}`,
        done: t('d_guests_done', { k: guests }),
        pin: { title: t('d_pin_guests', { party }), body: t('d_pin_b') },
        act: (pin) =>
          setGuestsAction({
            venueId,
            reservationId,
            partySize: guests,
            ...(pin === undefined ? {} : { pin }),
          }),
        after: onChanged,
        onDone,
      }),
    [onChanged, run, t, venueId],
  )

  /**
   * They have gone: the spots go back and the codes of their Tables close. `held` is what the
   * party was holding, read with the advice — the Undo claims exactly those again, and where
   * nothing could be read the toast offers no Undo rather than a wrong one.
   */
  const letGo = useCallback(
    (party: DoorParty, held: readonly string[]) => {
      const reservationId = party.reservationId
      if (reservationId === null) return
      const asked = party.spotIds
      run({
        id: `rv-free:${reservationId}`,
        done: party.name === null ? t('d_freed_bare') : t('d_freed', { party: party.name }),
        pin: { title: t('d_pin_free', { party: named(party) }), body: t('d_pin_b') },
        act: (pin) =>
          freeSpotsAction({
            venueId,
            reservationId,
            ...(asked.length === 0 ? {} : { spotIds: asked }),
            ...(pin === undefined ? {} : { pin }),
          }),
        ...(held.length === 0
          ? {}
          : {
              again: {
                label: t('p_undo'),
                done: t('d_free_undone'),
                act: (pin?: string) =>
                  holdSpotsAction({
                    venueId,
                    reservationId,
                    spotIds: held,
                    ...(pin === undefined ? {} : { pin }),
                  }),
              },
            }),
        after: onChanged,
        onDone: () => setAsking(null),
      })
    },
    [named, onChanged, run, t, venueId],
  )

  /** Warns first where a table of theirs still carries a bill; frees either way afterwards. */
  const free = useCallback(
    (party: DoorParty) => {
      if (party.reservationId === null) return
      setReading(true)
      void arrivalChecksAction({
        venueId,
        day: party.day,
        ...(party.spotIds.length === 0 ? {} : { spotIds: party.spotIds }),
        reservationId: party.reservationId,
      })
        .catch(() => ({ ok: false }) as const)
        .then((read) => {
          setReading(false)
          if (!read.ok) {
            letGo(party, party.spotIds)
            return
          }
          const billSpots = read.checks.tables
            .filter((table) => table.bill)
            .map((table) => table.tableName)
          const spots = read.checks.spotIds
          if (billSpots.length > 0) {
            setAsking({
              party,
              step: 'free_bill',
              billSpots,
              spots,
              payRule: read.checks.payRule,
            })
            return
          }
          letGo(party, spots)
        })
    },
    [letGo, venueId],
  )

  const node =
    asking === null ? null : asking.step === 'same_guests' ? (
      <SameGuestsDialog
        busy={reading}
        payRule={asking.payRule}
        onAnswer={(sameGuests) => seat(asking.party, sameGuests)}
        onLeave={() => setAsking(null)}
      />
    ) : asking.step === 'free_bill' ? (
      <ConfirmDialog
        title={t('d_free_t', { spot: asking.billSpots.join(', ') })}
        body={t('d_free_b')}
        doLabel={t('d_free_do')}
        keepLabel={t('d_bill_no')}
        testId="rv-free-bill"
        busy={reading}
        onDo={() => letGo(asking.party, asking.spots)}
        onKeep={() => setAsking(null)}
      />
    ) : (
      <ConfirmDialog
        title={t('d_bill_t', { spot: asking.billSpots.join(', ') })}
        body={t('d_bill_b')}
        doLabel={t('d_bill_do')}
        keepLabel={t('d_bill_no')}
        testId="rv-open-bill"
        busy={reading}
        onDo={() => seat(asking.party, undefined)}
        onKeep={() => setAsking(null)}
      />
    )

  return { arrive, walkIn, setGuests, free, reading, node }
}
