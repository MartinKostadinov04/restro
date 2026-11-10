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
  return (line: RvHistoryView): string | null => {
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
        return t(line.toState === 'released' ? 'lg_rv_freed' : 'lg_rv_held')
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
