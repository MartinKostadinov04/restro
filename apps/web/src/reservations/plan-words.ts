'use client'

// The words of the floor plan (#327). A state is always a word — „Блокирано“, „Настанени“ — and
// the tile draws that word beside its symbol, because a hostess reads this at 02:00 under club
// lighting and colour alone says nothing to her, to a colour-blind colleague, or to a screen
// reader (WCAG 2.2 AA, 1.4.1).
//
// A block's reason is stored as a code and worded here, so a reason set at a Bulgarian club reads
// in English on the same night's Log. A code the screen no longer offers is shown as itself rather
// than as "other": it is a code out of our own alphabet, never markup.
//
// A spot's history is the Log's own sentences (`useHistoryText`), not a second set of words for
// the same events (copy rules §3: one name per action).
import { useTranslations } from 'next-intl'

import type {
  RvHoldView,
  RvSpotHistoryView,
  RvSpotState,
  RvSpotView,
} from '@/server/reservations/view'

import { isBlockReason } from './block-reasons'
import { useHistoryText } from './reservation-words'

/** One state of a spot, as the legend and the tile say it. */
export function useSpotStateWord() {
  const t = useTranslations('reservations')
  return (state: RvSpotState): string => t(`p_${state}`)
}

/** Why a spot is out of use, in the reader's own language; an unknown code stays itself. */
export function useBlockReasonWord() {
  const t = useTranslations('reservations')
  return (code: string | null): string =>
    code === null ? t('r_other') : isBlockReason(code) ? t(`r_${code}`) : code
}

/**
 * The second line of a tile: the state, and the one thing that makes it this state — the reason a
 * spot is blocked, the hour a party is expected. Clipped on the tile where it does not fit; the
 * sheet carries the whole of it (screen plan §5).
 */
export function useSpotLine() {
  const t = useTranslations('reservations')
  const word = useSpotStateWord()
  const reason = useBlockReasonWord()
  return (spot: RvSpotView): string => {
    if (spot.state === 'blocked') {
      return t('p_hold_blocked', { reason: reason(spot.leading?.reason ?? null) })
    }
    const state = word(spot.state)
    if (spot.state === 'free' || spot.leading === null) return state
    return `${state} · ${spot.leading.time}`
  }
}

/** One hold in the spot's sheet: what it is, and until when. */
export function useHoldText() {
  const t = useTranslations('reservations')
  const reason = useBlockReasonWord()
  return (hold: RvHoldView): { readonly main: string; readonly until: string } => {
    const main =
      hold.kind === 'block'
        ? t('p_hold_blocked', { reason: reason(hold.reason) })
        : hold.seatedAt !== null
          ? t('p_hold_sitting', { time: hold.seatedAt })
          : t('p_hold_held', { time: hold.time })
    // A block nobody has put an end to stays on until somebody lifts it (D137): it has no hour to
    // show, and saying so is the whole point of the line.
    const until =
      hold.until !== null
        ? t('p_until_time', { time: hold.until })
        : hold.kind === 'block'
          ? t('p_until_lifted')
          : ''
    return { main, until }
  }
}

/**
 * One line of a spot's history. The reservation lines are the Log's own sentences; a spot that was
 * changed on the plan gets this screen's one sentence, and a kind we have no sentence for draws
 * nothing rather than a raw code.
 */
export function useSpotHistoryText() {
  const t = useTranslations('reservations')
  const reservationText = useHistoryText()
  return (line: RvSpotHistoryView): string | null =>
    line.kind === 'spot.changed' ? t('p_h_spot') : reservationText(line)
}
