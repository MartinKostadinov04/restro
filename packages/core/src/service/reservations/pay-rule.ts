// The pay rule a reservation carries (ticket #334; D135, log 1.39, 1.61, 1.62; D122 §5).
//
// A pay rule has levels, and a reservation is one of them: someone with `reservations.pay_rule`
// says that **this party**, on **this sitting**, pays everything on the bill or pays first — or
// takes the choice away again, which puts the party back on the club's own rule. The resolution
// over all the levels is `payFirstRuleAt` in `../../pay-first-settings.ts`, one pure function;
// this module answers the two questions that one cannot:
//
// 1. **Is the party's rule in force at this table at all?** A table's own setting still beats it
//    (`payFirstRuleAt`'s order), and the rule lasts for **one sitting**: `payRuleInForce` compares
//    when the table's sitting opened with when the party last took its spot, both the database's
//    own clock. A sitting that began after the party took the spot is a different sitting, so the
//    rule does not reach it, and the table is on the club's rule until somebody sets one again.
//
//    That is how "Is this still Maria's party?" carries the answer without a second question being
//    asked here (#329): **yes** keeps the sitting, so the party keeps its rule; **no** sends
//    ordering's own "New guests", which ends that sitting and opens another, so the rule stops at
//    the boundary. Nothing in this module asks, defaults or writes anything about the same party —
//    `openTableFor` and `newGuests` stay the only ways a table is opened and renewed.
//
// 2. **Whose rule is it, where two parties sit at one table?** Only possible while the hostess has
//    answered "same guests" over a table two bookings are seated at. The more cautious rule wins —
//    pay first over on the bill — never the newer one: a rule read twice in a row must give the
//    same answer, and ours may only ever be more careful than the POS (rule 5).
//
// **No money is here.** The reservation's money record (`prepay_*`) stays empty in part 1 (D136):
// this is a rule about how the bill is met, never an amount, a payment or a prepayment. And no
// guest surface reaches it: the rule leaves this module only as the `payFirst` boolean the guest
// page already reads under D122 §5.

import type { ReadTx } from '@restro/db'
import { reservationSpots, reservations, sittings, spots } from '@restro/db'
import { and, eq, gte, isNotNull, isNull, sql } from 'drizzle-orm'
import { z } from 'zod'

import type { PayFirstSettings, PayRule } from '../../pay-first-settings'
import { PAYMENT_MODES } from '../../templates/venue-menu'
import type { ServiceTx } from '../definition'
import { accepted, type ServiceResult } from '../results'
import { openReservation } from './book'
import { refuse, versionOf } from './rows'
import { isEndStatus, type ReservationStatus } from './status'

/** The read side of a transaction: the reads here never write. */
type Readable = Pick<ReadTx, 'select'>

/**
 * What a reservation's pay rule may be set to: on the bill, pay first, or `null` — the club's own
 * rule, which is the absence of a rule and not a third value of its own.
 */
export const PayRuleSchema = z.enum(PAYMENT_MODES).nullable()

/** `reservation.set_pay_rule`'s payload. */
export const SetPayRuleSchema = z.strictObject({
  type: z.literal('reservation.set_pay_rule'),
  reservationId: z.string(),
  rule: PayRuleSchema,
  /** The version the sheet was read on (`version.ts`); a save over another one is refused. */
  expectedVersion: z.iso.datetime().optional(),
})

/** `reservation.set_pay_rule` as the handler gets it. */
export type SetPayRuleCommand = {
  readonly reservationId: string
  readonly rule: PayRule | null
  readonly expectedVersion?: string | undefined
}

/** The Log's word for a rule: the club's own rule is `venue`, as the other levels' Log says. */
export function payRuleCode(rule: PayRule | null): string {
  return rule ?? 'venue'
}

/** A stored `pay_rule` as this module's value: a code the code does not know reads as none. */
export function storedPayRule(value: string | null): PayRule | null {
  return value === 'on_bill' || value === 'pay_first' ? value : null
}

/**
 * Whether a party's rule is in force on the sitting that is open at its table: the rule lasts for
 * one sitting, so a sitting that began **after** the party last took the spot is a new sitting and
 * does not inherit it.
 *
 * Both moments are the database's own clock (`sittings.opened_at` and `reservation_spots.updated_at`
 * are its `now()`), so a table opened in the very transaction that seated the party compares equal
 * and the rule holds. Never the caller's clock: comparing two clocks would decide a guest's
 * payment by a millisecond.
 */
export function payRuleInForce(sittingOpenedAt: Date, spotTakenAt: Date): boolean {
  return sittingOpenedAt.getTime() <= spotTakenAt.getTime()
}

/** The more cautious of two rules (rule 5): pay first beats on the bill, and any rule beats none. */
export function strictestPayRule(rules: readonly (PayRule | null)[]): PayRule | null {
  if (rules.includes('pay_first')) return 'pay_first'
  return rules.includes('on_bill') ? 'on_bill' : null
}

/**
 * The pay rule in force at one table on one sitting, or `null` where no party sitting there
 * carries one (and then the venue's own levels decide alone).
 *
 * A party counts only while it is **seated**, holds a spot of that table that it has not let go,
 * and took that spot no later than the sitting opened (`payRuleInForce`). Two such parties are
 * read through `strictestPayRule`.
 */
export async function payRuleAtTable(
  tx: Readable,
  input: { readonly tableId: string; readonly sittingId: string },
): Promise<PayRule | null> {
  const [sitting] = await tx
    .select({ openedAt: sittings.openedAt })
    .from(sittings)
    .where(eq(sittings.id, input.sittingId))
  if (sitting === undefined) return null
  const rows = await tx
    .select({ rule: reservations.payRule })
    .from(reservations)
    .innerJoin(
      reservationSpots,
      and(
        eq(reservationSpots.tenantId, reservations.tenantId),
        eq(reservationSpots.reservationId, reservations.id),
        isNull(reservationSpots.releasedAt),
      ),
    )
    .innerJoin(
      spots,
      and(eq(spots.tenantId, reservationSpots.tenantId), eq(spots.id, reservationSpots.spotId)),
    )
    .where(
      and(
        eq(spots.tableId, input.tableId),
        eq(reservations.status, 'seated'),
        isNull(reservations.deletedAt),
        isNotNull(reservations.payRule),
        // The sitting boundary, in SQL exactly as `payRuleInForce` states it.
        gte(reservationSpots.updatedAt, sitting.openedAt),
      ),
    )
  return strictestPayRule(rows.map((row) => storedPayRule(row.rule)))
}

/**
 * The pay rule in force at every open table of a venue, by table id, for the one screen that draws
 * them all (Tonight). The same question as `payRuleAtTable`, asked once instead of once a tile:
 * the same seated-party rule, the same released-spot rule, and the same sitting boundary
 * (`payRuleInForce`, in SQL). A table with no party rule in force is simply absent from the map.
 */
export async function payRulesAtTables(
  tx: Readable,
  input: { readonly venueId: string },
): Promise<Map<string, PayRule>> {
  const rows = await tx
    .select({ tableId: sittings.tableId, rule: reservations.payRule })
    .from(sittings)
    .innerJoin(spots, and(eq(spots.venueId, input.venueId), eq(spots.tableId, sittings.tableId)))
    .innerJoin(
      reservationSpots,
      and(
        eq(reservationSpots.tenantId, spots.tenantId),
        eq(reservationSpots.spotId, spots.id),
        isNull(reservationSpots.releasedAt),
        // The sitting boundary, exactly as `payRuleInForce` states it.
        gte(reservationSpots.updatedAt, sittings.openedAt),
      ),
    )
    .innerJoin(
      reservations,
      and(
        eq(reservations.tenantId, reservationSpots.tenantId),
        eq(reservations.id, reservationSpots.reservationId),
        eq(reservations.status, 'seated'),
        isNull(reservations.deletedAt),
        isNotNull(reservations.payRule),
      ),
    )
    .where(and(eq(sittings.venueId, input.venueId), isNull(sittings.endedAt)))
  const byTable = new Map<string, PayRule>()
  for (const row of rows) {
    const rule = strictestPayRule([byTable.get(row.tableId) ?? null, storedPayRule(row.rule)])
    if (rule !== null) byTable.set(row.tableId, rule)
  }
  return byTable
}

/** A spot of the party whose table carries a pay-first setting of its own, which beats the party's. */
export interface PayRuleBeaten {
  /** The spot's name, as staff call it. */
  readonly spot: string
  /** What that table's own setting says: pay first, or everything on the bill. */
  readonly rule: PayRule
}

/**
 * The spots of one reservation where a **table's own** pay-first setting wins over the party's
 * rule (D122 §5's order). The sheet says so in one line rather than drawing the party's rule as if
 * it were in force (#334), and the line is there whether or not a rule is set, so a manager knows
 * before they tap. A spot with no table of its own carries no rule at all and is left out.
 */
export async function payRuleBeatenAt(
  tx: Readable,
  input: {
    readonly reservationId: string
    readonly settings: Pick<PayFirstSettings, 'tables'>
  },
): Promise<PayRuleBeaten[]> {
  const rows = await tx
    .select({ name: spots.name, tableId: spots.tableId })
    .from(reservationSpots)
    .innerJoin(
      spots,
      and(eq(spots.tenantId, reservationSpots.tenantId), eq(spots.id, reservationSpots.spotId)),
    )
    .where(
      and(
        eq(reservationSpots.reservationId, input.reservationId),
        isNull(reservationSpots.releasedAt),
      ),
    )
    .orderBy(spots.name)
  return rows.flatMap((row) => {
    if (row.tableId === null) return []
    const own = input.settings.tables[row.tableId as keyof typeof input.settings.tables]
    return own === undefined ? [] : [{ spot: row.name, rule: own ? 'pay_first' : 'on_bill' }]
  })
}

/**
 * `reservation.set_pay_rule`: this party's rule, for this sitting. The permission is its own
 * (`reservations.pay_rule`, Manager-class and a venue may give it to a hostess, D141), the night
 * must be writable like any other change to a booking, and a party whose night is over is not
 * changed. Every change is one Log entry naming the reservation, the rule and what it was — a
 * `record`, kept 18 months like the other levels' changes (D122 §7).
 *
 * The row's `updated_at` is touched, so a sheet opened elsewhere on the old version is refused
 * rather than saving over this (`version.ts`). Setting the rule it already has writes nothing and
 * logs nothing: a repeated tap is the same tap.
 */
export async function setReservationPayRule(
  stx: ServiceTx,
  command: SetPayRuleCommand,
): Promise<ServiceResult> {
  const open = await openReservation(stx, command.reservationId)
  if (!open.ok) return refuse(open.code)
  const { reservation } = open
  // A block is nobody at a table, so it meets no bill (D137).
  if (reservation.kind === 'block') return refuse('kind_not_allowed')
  if (isEndStatus(reservation.status as ReservationStatus)) return refuse('status_move_not_allowed')
  if (
    command.expectedVersion !== undefined &&
    command.expectedVersion !== (await versionOf(stx, reservation))
  ) {
    return refuse('reservation_stale')
  }
  const previous = storedPayRule(reservation.payRule)
  if (previous === command.rule) {
    return accepted(null, {
      details: {
        reservationId: reservation.id,
        rule: payRuleCode(previous),
        changed: false,
      },
    })
  }
  await stx.tx
    .update(reservations)
    .set({
      payRule: command.rule,
      ...stx.provenance,
      updatedAt: sql`now()`,
    })
    .where(eq(reservations.id, reservation.id))
  await stx.log({
    kind: 'reservation.pay_rule',
    reservationId: reservation.id,
    guestId: reservation.guestId ?? undefined,
    fromState: payRuleCode(previous),
    toState: payRuleCode(command.rule),
    details: {
      rule: payRuleCode(command.rule),
      previous: payRuleCode(previous),
    },
  })
  return accepted(null, {
    details: {
      reservationId: reservation.id,
      rule: payRuleCode(command.rule),
      changed: true,
    },
  })
}
