'use client'

// The words of Venue › Reservations (#326). Two sets, because Bulgarian makes one word do one job:
// `s_*` is one reservation's own state on its row and in its sheet (singular, agreeing with
// "резервация"), `f_*` is the filter above the list (the group of them). Never a colour alone: the
// state is always this word, and "Late" is a word too.
//
// A reservation's history is the Log's own sentences (`lg_rv_*` in the `tonight` namespace), not a
// second set of words for the same events (copy rules §3: one name per action). The Log and the
// sheet therefore always read the same.
import type { PayRule } from '@restro/core'
import { useTranslations } from 'next-intl'
import { useCallback } from 'react'
import type { RvHistoryView, RvRowView, RvStatus } from '@/server/reservations/view'

/** The state of one reservation, as its row and its sheet say it. */
export function useStatusWord() {
  const t = useTranslations('reservations')
  return (status: RvStatus): string => t(`s_${status}`)
}

/** The same states as a filter over the night: the group, not the one. */
export function useFilterWord() {
  const t = useTranslations('reservations')
  return (status: RvStatus): string => t(`f_${status}`)
}

/** "4 guests" / „4 гости“: the party's size, in numerals (copy rules §6). */
export function useGuestsText() {
  const t = useTranslations('reservations')
  return (party: number | null): string | null =>
    party === null ? null : t('guests', { k: party })
}

/**
 * A spot name that is only a number: "9", "25.1", "40/41", "7,8". Anything with a word in it
 * ("2 VIP", "53 А", "Маса 7") is the venue's own name and is never rewritten (D134). The one test
 * for it, here and in the plan's words (`useSpotCalled`), so a row and a toast name a spot alike.
 */
const BARE_NUMBER = /^\d+(?:[.,/]\d+)*$/

/** Whether a spot's name is only a number, and so needs the word "spot" before it in a sentence. */
export const isBareSpotNumber = (name: string): boolean => BARE_NUMBER.test(name)

/**
 * The spots a party holds, as a row says them (the screen round's S1): a name that is only a number
 * gets the word "spot" before it — «място 9», «места 9, 10» — so "5 guests · 9" never reads as two
 * counts. A name that already says what it is ("Бар 1 · стол 1", "Маса 7") is left as the venue
 * wrote it (D134: spot names are the venue's). Null for a party holding none. The function is
 * stable from render to render, so it can sit in a hook's dependencies.
 */
export function useSpotsText() {
  const t = useTranslations('reservations')
  return useCallback(
    (names: readonly string[]): string | null => {
      if (names.length === 0) return null
      if (names.every((name) => BARE_NUMBER.test(name))) {
        return names.length === 1
          ? t('p_spot_mid', { spot: names.join('') })
          : t('p_spots_mid', { spots: names.join(', ') })
      }
      return names
        .map((name) => (BARE_NUMBER.test(name) ? t('p_spot_mid', { spot: name }) : name))
        .join(', ')
    },
    [t],
  )
}

/**
 * A pay rule in words (#334): the two the levels can carry, and the absence of one, which reads
 * "The club's rule" and never as a blank. The same three words wherever a rule is said — the
 * section's cards, its sentences and the toast (copy rules §3: one name per thing).
 */
export function usePayRuleWord() {
  const t = useTranslations('reservations')
  return (rule: PayRule | null): string =>
    t(rule === null ? 'pr_venue' : rule === 'pay_first' ? 'pr_pay_first' : 'pr_on_bill')
}

/** The state words of the Log, which a reservation's history reuses. */
const LOG_STATE_WORDS: Readonly<Record<string, string>> = {
  reserved: 'lg_rv_s_reserved',
  waiting: 'lg_rv_s_waiting',
  seated: 'lg_rv_s_seated',
  finished: 'lg_rv_s_finished',
  no_show: 'lg_rv_s_no_show',
  cancelled: 'lg_rv_s_cancelled',
  not_seated: 'lg_rv_s_not_seated',
  requested: 'lg_rv_s_requested',
  deleted: 'lg_rv_s_deleted',
}

/** The Log's word for each pay rule, by the code the entry stores (#334). */
/** A spots line's state in the Log: held, freed, or moved by Change tables (#331). */
const SPOTS_WORDS: Readonly<Record<string, string>> = {
  held: 'lg_rv_held',
  released: 'lg_rv_freed',
  moved: 'lg_rv_moved',
  moved_bill: 'lg_rv_moved_bill',
}

const PAY_RULE_LOG_WORDS: Readonly<Record<string, string>> = {
  venue: 'lg_rv_pr_venue',
  on_bill: 'lg_rv_pr_on_bill',
  pay_first: 'lg_rv_pr_pay_first',
}

/**
 * One line of a reservation's history, in the Log's own words. A kind this screen has no sentence
 * for draws nothing rather than a raw code (the same rule as the Log's own unknown kinds).
 */
export function useHistoryText() {
  const t = useTranslations('tonight')
  return (line: Pick<RvHistoryView, 'kind' | 'toState'>): string | null => {
    const state = t(LOG_STATE_WORDS[line.toState ?? ''] ?? 'lg_rv_s_other')
    switch (line.kind) {
      case 'reservation.created':
        return t('lg_rv_created', { state })
      case 'reservation.changed':
        return t('lg_rv_changed', { state })
      case 'reservation.status':
        return t('lg_rv_status', { state })
      case 'reservation.restored':
        return t('lg_rv_restored', { state })
      case 'reservation.spots':
        return t(SPOTS_WORDS[line.toState ?? ''] ?? 'lg_rv_held')
      case 'reservation.pay_rule':
        return t('lg_rv_pay_rule', {
          rule: t(PAY_RULE_LOG_WORDS[line.toState ?? ''] ?? 'lg_rv_pr_venue'),
        })
      default:
        return null
    }
  }
}

/**
 * Who called a reservation off, in one word beside its state: the club's own undo of a mis-tapped
 * walk-in reads "by the club" (`UNDONE_ARRIVAL_REASON`, #329), so nobody reads it as a guest who
 * rang to cancel. Every other reason has no word on this screen and draws nothing.
 */
export function useByClubWord() {
  const t = useTranslations('reservations')
  return (row: RvRowView): string | null => (row.byVenue ? t('by_club') : null)
}
