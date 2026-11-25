// The version of a reservation, as an editing screen holds it (ticket #328). A form opened over a
// booking carries the version it read; a save that finds another one was typed over somebody's
// change and is refused `reservation_stale` rather than written (D135: nothing ties a booking to
// the person who entered it, so two hostesses may well have it open at once).
//
// No column of its own: a booking changes when its row is written (`updated_at`) or when the spots
// it holds change (the held rows' own `updated_at`, which a hold, a release and a change of tables
// all write). The newest of those moments is the version. Millisecond precision, because that is
// what a `Date` carries between the database and the browser and back.
//
// Pure: the two moments are inputs.

/** The version of a reservation: the newest moment it, or the spots it holds, was written. */
export function reservationVersion(updatedAt: Date, spotsUpdatedAt: Date | null): string {
  const newest =
    spotsUpdatedAt !== null && spotsUpdatedAt.getTime() > updatedAt.getTime()
      ? spotsUpdatedAt
      : updatedAt
  return new Date(newest.getTime()).toISOString()
}
