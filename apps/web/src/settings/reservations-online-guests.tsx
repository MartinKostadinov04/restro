'use client'

// What guests may do on the booking page, and bookings that confirm themselves (#580; spec #322
// stories 26, 27): two rows of Settings › Reservations › Online booking, each "a single
// reversible write" saved at once with Undo (the previous value sent again).
//
//   - "What guests may do": ask for a night, choose an Area, or pick their own spot. Without a plan
//     drawn the Area and spot choices are off, with "Draw your plan first" taking the owner to the
//     editor below; with spots but no visible Area holding one, the Area choice says that instead.
//   - "Confirm bookings by themselves": only where the guest picked his own spot (D136), so the
//     spot itself stops the next booking. The switch is off, with the one line saying why, while
//     the choice is anything else; changing the choice away from spots turns it off (the command).
//
// A role without `settings.reservations` sees both values as text.
import type { GuestMay } from '@restro/core/service'
import { useTranslations } from 'next-intl'
import { useEffect, useState } from 'react'

import { Switch } from '@/components/ui/switch'
import { saveOnlineGuestsAction } from '@/server/settings/reservations-actions'
import type { ReservationsView } from '@/server/settings/reservations-view'

import { SettingRow, SettingValue } from './settings-row'
import type { useSettingsRun } from './use-settings-run'

/** The three choices, in the order the screen offers them (the command's own values). */
const CHOICES: readonly GuestMay[] = ['night', 'area', 'spot']

/** The anchor of the plan editor on the same page. */
export const PLAN_EDITOR_ANCHOR = 'rs-plan'

const LABEL = {
  night: 'rs_guests_night',
  area: 'rs_guests_area',
  spot: 'rs_guests_spot',
} as const

const DONE = {
  night: 'rs_done_guests_night',
  area: 'rs_done_guests_area',
  spot: 'rs_done_guests_spot',
} as const

/** The refusals of the command, in the screen's words. */
const REFUSALS = {
  plan_missing: 'rs_guests_no_plan',
  areas_missing: 'rs_guests_no_areas',
  auto_confirm_needs_spot: 'rs_auto_why',
} as const

export function OnlineGuestsRows({
  view,
  runner,
  enabled,
}: {
  view: ReservationsView
  runner: ReturnType<typeof useSettingsRun>
  /** The person may change it and the venue's settings row exists. */
  enabled: boolean
}) {
  const t = useTranslations('ownerSettings')
  const { pending, run } = runner
  const savedMay = view.settings.guestMay
  const savedAuto = view.settings.autoConfirm
  const offer = view.settings.bookingOffer
  // The choice shows at once; it follows the saved value and returns to it if a save fails.
  const [may, setMay] = useState(savedMay)
  const [auto, setAuto] = useState(savedAuto)
  useEffect(() => setMay(savedMay), [savedMay])
  useEffect(() => setAuto(savedAuto), [savedAuto])

  const words = (error: string) =>
    error in REFUSALS ? t(REFUSALS[error as keyof typeof REFUSALS]) : undefined

  /** Why a choice cannot be offered yet, or null when it can. */
  function blockedBy(choice: GuestMay): 'rs_guests_no_plan' | 'rs_guests_no_areas' | null {
    if (choice === 'night') return null
    if (!offer.spots) return 'rs_guests_no_plan'
    if (choice === 'area' && !offer.areas) return 'rs_guests_no_areas'
    return null
  }

  function choose(next: GuestMay) {
    if (next === may) return
    const previous = { guestMay: savedMay, autoConfirm: savedAuto }
    setMay(next)
    if (next !== 'spot') setAuto(false)
    run(() => saveOnlineGuestsAction({ venueId: view.venueId, guestMay: next }), {
      done: t(DONE[next]),
      words,
      onFail: () => {
        setMay(savedMay)
        setAuto(savedAuto)
      },
      // Leaving spots turned the switch off: Undo puts both back as they were.
      undo: () => saveOnlineGuestsAction({ venueId: view.venueId, ...previous }),
    })
  }

  function setAutoConfirm(next: boolean) {
    setAuto(next)
    run(() => saveOnlineGuestsAction({ venueId: view.venueId, autoConfirm: next }), {
      done: t(next ? 'rs_done_auto_on' : 'rs_done_auto_off'),
      words,
      onFail: () => setAuto(savedAuto),
      undo: () => saveOnlineGuestsAction({ venueId: view.venueId, autoConfirm: savedAuto }),
    })
  }

  const autoOpen = enabled && may === 'spot'

  return (
    <>
      <div className="grid grid-cols-1 gap-2 p-3" data-testid="rs-guests">
        {enabled ? (
          <fieldset className="grid grid-cols-1 gap-2" disabled={pending}>
            <legend className="mb-1 text-sm">{t('rs_guests')}</legend>
            {CHOICES.map((choice) => {
              const blocked = blockedBy(choice)
              return (
                <label
                  key={choice}
                  className="flex items-start gap-3 rounded-md border p-3 text-sm has-[:checked]:border-primary has-[:checked]:bg-accent has-[:disabled]:opacity-70"
                >
                  <input
                    type="radio"
                    name="rs-guests"
                    value={choice}
                    className="mt-0.5 size-4 accent-primary"
                    checked={may === choice}
                    // The saved choice stays selectable even if its plan went away meanwhile.
                    disabled={blocked !== null && may !== choice}
                    onChange={() => choose(choice)}
                    data-testid={`rs-guests-${choice}`}
                  />
                  <span className="grid min-w-0 gap-0.5">
                    <span className="break-words font-medium">{t(LABEL[choice])}</span>
                    {blocked === null ? null : (
                      <span className="break-words text-xs text-muted-foreground">
                        {blocked === 'rs_guests_no_plan' ? (
                          <a
                            href={`#${PLAN_EDITOR_ANCHOR}`}
                            className="tap-area underline underline-offset-2"
                            data-testid={`rs-guests-${choice}-plan`}
                          >
                            {t(blocked)}
                          </a>
                        ) : (
                          t(blocked)
                        )}
                      </span>
                    )}
                  </span>
                </label>
              )
            })}
          </fieldset>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
            <span className="text-sm">{t('rs_guests')}</span>
            <SettingValue testId="rs-guests-value">{t(LABEL[savedMay])}</SettingValue>
          </div>
        )}
      </div>
      {/* The switch and its reason are one row of the group. */}
      <div className="grid grid-cols-1">
        <SettingRow label={t('rs_auto')} htmlFor="rs-auto" description={t('rs_auto_d')}>
          {enabled ? (
            <Switch
              id="rs-auto"
              checked={auto && may === 'spot'}
              disabled={pending || !autoOpen}
              onCheckedChange={setAutoConfirm}
              aria-describedby={autoOpen ? undefined : 'rs-auto-why'}
              data-testid="rs-auto"
            />
          ) : (
            <SettingValue testId="rs-auto-value">
              {savedAuto ? t('rs_on') : t('rs_off')}
            </SettingValue>
          )}
        </SettingRow>
        {enabled && !autoOpen ? (
          <p
            id="rs-auto-why"
            className="-mt-1 break-words px-3 pb-3 text-sm text-muted-foreground"
            data-testid="rs-auto-why"
          >
            {t('rs_auto_why')}
          </p>
        ) : null}
      </div>
    </>
  )
}
