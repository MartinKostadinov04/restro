'use client'

// Settings › Reservations (#325; D135, D136, D140, D141): the venue's own reservation rules, one-off
// closed dates and the seats of each spot. Every control saves at once with Undo ("a single
// reversible write"): nothing here is a form saved as a whole. Writes go through the reservation
// commands, which need `settings.reservations` and the person's own sign-in; a role without it sees
// the same values as text. The venue's service hours are not repeated here: one line links to Hours.
// Part 2's settings (what guests may do online, the prepayment and its wording) are stored with
// their defaults and have no control on this screen.
import Link from 'next/link'
import { useTranslations } from 'next-intl'
import { useEffect, useState } from 'react'

import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { saveReservationRulesAction } from '@/server/settings/reservations-actions'
import type { ReservationsView } from '@/server/settings/reservations-view'

import { ClosedDatesCard } from './reservations-closed-dates'
import { SpotSeatsCard } from './reservations-seats'
import { ReadOnlyLine } from './section-notices'
import { SettingRow, SettingValue } from './settings-row'
import { useSettingsRun } from './use-settings-run'

/** A turn time is a whole number of minutes up to a day (the command's own bounds). */
const MIN_HOLD = 1
const MAX_HOLD = 1440

/** The three switches of the rules card, by the key the command takes. */
type Rule = 'phoneRequired' | 'editPastNights' | 'privateNotesOn'

export function ReservationsPanel({ view }: { view: ReservationsView }) {
  const t = useTranslations('ownerSettings')
  const runner = useSettingsRun(view.email)
  const { pending, run } = runner
  const settings = view.settings
  const can = view.canChange
  // Nothing on the settings row can be written before the turn time exists (D135: no invented
  // default), so until the venue sets it the other rules say so instead of failing when touched.
  const rulesOpen = can && settings.saved

  // What the controls show: the choice at once, before the server answers. It follows the saved
  // value when that changes (this save, an Undo, another owner) and returns to it if a save fails.
  const savedRules: Record<Rule, boolean> = {
    phoneRequired: settings.phoneRequired,
    editPastNights: settings.editPastNights,
    privateNotesOn: settings.privateNotesOn,
  }
  const [shown, setShown] = useState<Record<Rule, boolean>>(savedRules)
  useEffect(() => {
    setShown({
      phoneRequired: settings.phoneRequired,
      editPastNights: settings.editPastNights,
      privateNotesOn: settings.privateNotesOn,
    })
  }, [settings.phoneRequired, settings.editPastNights, settings.privateNotesOn])

  function setRule(rule: Rule, next: boolean) {
    const previous = settings[rule]
    setShown((now) => ({ ...now, [rule]: next }))
    run(() => saveReservationRulesAction({ venueId: view.venueId, [rule]: next }), {
      done: t('st_saved'),
      onFail: () => setShown(savedRules),
      undo: () => saveReservationRulesAction({ venueId: view.venueId, [rule]: previous }),
    })
  }

  // The hold time: a number typed in place, saved on Enter or when the field is left; Escape puts
  // the saved value back. A number that is no minutes stays there with its problem shown.
  const saved = settings.turnMinutes === null ? '' : String(settings.turnMinutes)
  const [holdText, setHoldText] = useState(saved)
  const [holdProblem, setHoldProblem] = useState(false)
  useEffect(() => {
    setHoldText(saved)
    setHoldProblem(false)
  }, [saved])

  function saveHold() {
    const text = holdText.trim()
    if (text === saved) {
      setHoldProblem(false)
      return
    }
    const minutes = Number(text)
    if (text === '' || !Number.isInteger(minutes) || minutes < MIN_HOLD || minutes > MAX_HOLD) {
      setHoldProblem(true)
      return
    }
    setHoldProblem(false)
    const previous = settings.turnMinutes
    run(() => saveReservationRulesAction({ venueId: view.venueId, turnMinutes: minutes }), {
      done: t('st_saved'),
      onFail: () => setHoldText(saved),
      // The first time there is nothing to go back to: the settings row did not exist.
      ...(previous === null
        ? {}
        : {
            undo: () =>
              saveReservationRulesAction({ venueId: view.venueId, turnMinutes: previous }),
          }),
    })
  }

  return (
    <div className="grid grid-cols-1 gap-4" data-testid="reservations-panel" aria-busy={pending}>
      <div>
        <h2 className="text-xl font-semibold tracking-tight">{t('rs_title')}</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {t.rich('rs_hours', {
            hours: (chunks) => (
              <Link
                href={`/venues/${view.venueId}?tab=settings&section=hours`}
                className="underline underline-offset-2"
                data-testid="rs-hours-link"
              >
                {chunks}
              </Link>
            ),
          })}
        </p>
      </div>
      {can ? null : <ReadOnlyLine />}
      {can && !settings.saved ? (
        <p className="text-sm text-muted-foreground" data-testid="rs-hold-first">
          {t('rs_hold_first')}
        </p>
      ) : null}

      <div className="grid grid-cols-1 divide-y rounded-lg border bg-card">
        <SettingRow label={t('rs_phone')} htmlFor="rs-phone">
          {rulesOpen ? (
            <Switch
              id="rs-phone"
              checked={shown.phoneRequired}
              disabled={pending}
              onCheckedChange={(on) => setRule('phoneRequired', on)}
              data-testid="rs-phone"
            />
          ) : (
            <SettingValue testId="rs-phone-value">
              {settings.phoneRequired ? t('rs_on') : t('rs_off')}
            </SettingValue>
          )}
        </SettingRow>

        <SettingRow label={t('rs_hold')} htmlFor="rs-hold" description={t('rs_hold_d')}>
          {can ? (
            <div className="grid grid-cols-1 gap-1">
              <div className="flex items-center gap-2">
                <Input
                  id="rs-hold"
                  inputMode="numeric"
                  className="w-24 max-w-full"
                  value={holdText}
                  placeholder={t('rs_hold_unset')}
                  aria-invalid={holdProblem ? true : undefined}
                  aria-describedby={holdProblem ? 'rs-hold-problem' : undefined}
                  data-testid="rs-hold"
                  onChange={(event) => {
                    setHoldText(event.target.value)
                    setHoldProblem(false)
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') saveHold()
                    if (event.key === 'Escape') {
                      setHoldText(saved)
                      setHoldProblem(false)
                    }
                  }}
                  onBlur={saveHold}
                />
                <span className="text-sm text-muted-foreground">{t('rs_min')}</span>
              </div>
              {holdProblem ? (
                <p id="rs-hold-problem" className="text-sm text-destructive" role="alert">
                  {t('rs_hold_bad', { min: MIN_HOLD, max: MAX_HOLD })}
                </p>
              ) : null}
            </div>
          ) : (
            <SettingValue testId="rs-hold-value">
              {settings.turnMinutes === null
                ? t('rs_hold_unset')
                : t('st_min', { n: settings.turnMinutes })}
            </SettingValue>
          )}
        </SettingRow>

        <SettingRow label={t('rs_past')} htmlFor="rs-past" description={t('rs_past_d')}>
          {rulesOpen ? (
            <Switch
              id="rs-past"
              checked={shown.editPastNights}
              disabled={pending}
              onCheckedChange={(on) => setRule('editPastNights', on)}
              data-testid="rs-past"
            />
          ) : (
            <SettingValue testId="rs-past-value">
              {settings.editPastNights ? t('rs_on') : t('rs_off')}
            </SettingValue>
          )}
        </SettingRow>

        <SettingRow label={t('rs_private')} htmlFor="rs-private" description={t('rs_private_d')}>
          {rulesOpen ? (
            <Switch
              id="rs-private"
              checked={shown.privateNotesOn}
              disabled={pending}
              onCheckedChange={(on) => setRule('privateNotesOn', on)}
              data-testid="rs-private"
            />
          ) : (
            <SettingValue testId="rs-private-value">
              {settings.privateNotesOn ? t('rs_on') : t('rs_off')}
            </SettingValue>
          )}
        </SettingRow>
      </div>

      <ClosedDatesCard view={view} runner={runner} enabled={rulesOpen} />
      <SpotSeatsCard view={view} runner={runner} />
      {runner.dialog}
    </div>
  )
}
