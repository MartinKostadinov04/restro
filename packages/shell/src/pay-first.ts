// Pay first at Send (#258, D113, D127 "Pay-first at Send"): what every face that draws the table's
// order says and works out the same way for the lines of items the guest pays for before they go.
// Pure; a face keeps its own look and imports these so the platform's words and rules live in one
// place (as `table-order.ts` does for the rest of the order).
//
// - `payFirstWords` says what a pay-first line carries on the order: "Not ordered until paid"
//   where the phone can pay for it (`ordering.payFirst` `on`), else "Order this from your waiter".
// - `planPayFirst` builds the Send's `payFirst` part from the free pay-first lines and the tip
//   choice, with the amounts the button shows. The amounts are the bag's estimate (the view's
//   prices, added with core's money module, rule 8); the hold is priced by the server.
// - `callIsSingleStep` is D127's single-step Call a waiter.

import { type NodeId, sumSignedMinor } from '@restro/core'

import { NO_TIP, type PayTotals, payTotalsOf, type TipChoice } from './paying'
import type { GuestCommand } from './services'
import type { ServiceStrings } from './strings'

/** The Send command, for its pay-first part's type. */
type SendCommand = Extract<GuestCommand, { readonly kind: 'order.send' }>

/** The pay-first part of an `order.send`. */
export type PayFirstPart = NonNullable<SendCommand['payFirst']>

/** Whether pay-first is on, paused or off at this table; absent (the host did not say) is off. */
export type PayFirstState = 'on' | 'paused' | 'off'

/** The state of pay-first at the table, from `state.ordering.payFirst`. */
export function payFirstStateOf(
  ordering: { readonly payFirst?: PayFirstState } | null | undefined,
): PayFirstState {
  return ordering?.payFirst ?? 'off'
}

/**
 * What a pay-first line says on the order (D113): "Not ordered until paid" where the phone pays for
 * it at Send, "Order this from your waiter" where it can't (paying paused or not offered here).
 */
export function payFirstWords(state: PayFirstState, words: ServiceStrings): string {
  return state === 'on' ? words.notUntilPaid : words.orderFromWaiter
}

/** One pay-first line of the order as the phone saw it, with its estimated amount. */
export interface PayFirstLine {
  readonly itemId: NodeId
  readonly optionIds: readonly NodeId[]
  readonly qty: number
  readonly note: string
  /** The estimate of the line in minor units (the view's prices; the server prices the hold). */
  readonly amountMinor: number
}

/** The pay-first part of a Send, with what the button and the tip row show. */
export interface PayFirstPlan {
  /** The `payFirst` of the `order.send`: every free pay-first line, as the phone saw it, and the tip. */
  readonly part: PayFirstPart
  /** The lines, the tip and what they come to; `tipValid` false greys the button. */
  readonly totals: PayTotals
}

/**
 * The pay-first part of a Send for these free lines (the order's pay-first lines no payment holds,
 * that can still be ordered; all of them, as "Send and pay" must name every one), or null when
 * there are none. The tip is none where the till can't record one (`tipsOffered` false); a preset
 * goes as its percent (the server prices it), an amount as the amount, and none starts chosen.
 */
export function planPayFirst(
  lines: readonly PayFirstLine[],
  chosen: TipChoice,
  tipsOffered: boolean,
): PayFirstPlan | null {
  if (lines.length === 0) return null
  const tip = tipsOffered ? chosen : NO_TIP
  const totals = payTotalsOf(
    sumSignedMinor(lines.map((line) => line.amountMinor)),
    tip,
    tipsOffered,
  )
  return {
    part: {
      lines: lines.map((line) => ({
        itemId: line.itemId,
        optionIds: [...line.optionIds],
        qty: line.qty,
        note: line.note,
      })),
      tipPercent: tip.kind === 'percent' ? tip.percent : null,
      tipMinor: tip.kind === 'other' && totals.tipMinor > 0 ? totals.tipMinor : null,
    },
    totals,
  }
}

/**
 * Whether Call a waiter is the single step of D127 ("with only `waiter` ticked it is a single
 * button that calls at once"): the venue's kinds, as they stand, are the waiter alone.
 */
export function callIsSingleStep(
  callWaiter: { readonly kinds: readonly string[] } | null | undefined,
): boolean {
  return callWaiter != null && callWaiter.kinds.length === 1 && callWaiter.kinds[0] === 'waiter'
}
