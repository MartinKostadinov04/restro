// The booking page fixture's reservation rules (#577): the venue's turn time, the online booking
// switch and its closed dates, and what guests may choose with the self-confirm switch (#580),
// written as the database owner like the night's book (reservations-night.ts). A fixture stands in for the owner's Settings › Reservations here; the
// app itself writes these only through core/service.
import type pg from 'pg'

const SEED = ['restro', 'system', 'e2e-seed'] as const

export async function seedBookingSettings(
  owner: pg.Pool,
  scope: { readonly tenantId: string; readonly venueId: string },
  settings: {
    readonly bookingPage: boolean
    readonly closedDates: readonly string[]
    /** What guests may choose (#580); a night only when not named. */
    readonly guestMay?: 'night' | 'area' | 'spot'
    readonly autoConfirm?: boolean
  },
): Promise<void> {
  await owner.query(
    `insert into restro.reservation_settings
       (tenant_id, venue_id, turn_minutes, online, closed_dates, source, actor, job_id)
     values ($1, $2, 120, $3::jsonb, $4::jsonb, $5, $6, $7)
     on conflict (tenant_id, venue_id) do update
       set online = excluded.online, closed_dates = excluded.closed_dates, updated_at = now()`,
    [
      scope.tenantId,
      scope.venueId,
      JSON.stringify({
        bookingPage: settings.bookingPage,
        ...(settings.guestMay === undefined ? {} : { guestMay: settings.guestMay }),
        ...(settings.autoConfirm === undefined ? {} : { autoConfirm: settings.autoConfirm }),
      }),
      JSON.stringify(settings.closedDates),
      ...SEED,
    ],
  )
}
