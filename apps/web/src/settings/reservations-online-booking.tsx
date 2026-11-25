'use client'

// "Online booking" on Settings › Reservations (#577): one switch that opens the venue's booking page
// to guests, and the page's address. It saves at once with Undo (the previous value sent again),
// like the rules above it. A role without `settings.reservations` sees the value as text; the
// switch waits for the hold time like the other rules (the command needs the settings row).
import { useTranslations } from 'next-intl'
import { useEffect, useState } from 'react'

import { Switch } from '@/components/ui/switch'
import { saveOnlineBookingAction } from '@/server/settings/reservations-actions'
import type { ReservationsView } from '@/server/settings/reservations-view'

import { SettingRow, SettingValue } from './settings-row'
import type { useSettingsRun } from './use-settings-run'

export function OnlineBookingCard({
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
  const saved = view.settings.bookingPage
  // The choice shows at once; it follows the saved value and returns to it if a save fails.
  const [shown, setShown] = useState(saved)
  useEffect(() => setShown(saved), [saved])

  function setBooking(next: boolean) {
    setShown(next)
    run(() => saveOnlineBookingAction({ venueId: view.venueId, bookingPage: next }), {
      done: t(next ? 'rs_done_booking_on' : 'rs_done_booking_off'),
      onFail: () => setShown(saved),
      undo: () => saveOnlineBookingAction({ venueId: view.venueId, bookingPage: saved }),
    })
  }

  return (
    // One group whose switch row names it: a heading above would say "Online booking" twice.
    <section className="grid grid-cols-1" data-testid="rs-booking-card">
      <div className="grid grid-cols-1 divide-y rounded-lg border bg-card">
        <SettingRow label={t('rs_booking')} htmlFor="rs-booking" description={t('rs_booking_d')}>
          {enabled ? (
            <Switch
              id="rs-booking"
              checked={shown}
              disabled={pending}
              onCheckedChange={setBooking}
              data-testid="rs-booking"
            />
          ) : (
            <SettingValue testId="rs-booking-value">
              {saved ? t('rs_on') : t('rs_off')}
            </SettingValue>
          )}
        </SettingRow>
        {view.bookingPath === null ? null : (
          <div className="grid grid-cols-1 gap-0.5 p-3">
            <span className="text-sm text-muted-foreground">{t('rs_booking_address')}</span>
            <a
              href={view.bookingPath}
              target="_blank"
              rel="noreferrer"
              className="tap-area break-all underline underline-offset-2"
              data-testid="rs-booking-address"
            >
              {view.bookingPath}
            </a>
          </div>
        )}
      </div>
    </section>
  )
}
