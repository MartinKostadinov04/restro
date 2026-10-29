// The location check (D118, D119, D121, D122 §4; ticket #76): is the phone at the venue? The phone
// reports a spot and a circle of doubt; the check passes when that circle touches the venue's
// circle (its spot and radius), so it fails only guests who are clearly elsewhere. A circle wider
// than about 1 km proves nothing (approximate location gives 3–5 km): it counts as "can't check",
// and so does a venue with no spot yet. Both fail closed.
//
// The position is checked in memory and dropped: nothing here keeps, logs or returns it. A Zod
// error about it is reported by path only (`issuePaths`), never with the values it held.
//
// Pure data and pure functions: no I/O, safe in the browser.

import { z } from 'zod'

import { serviceDate } from './service-day'

/**
 * The consent text's version (D119, D122 §4). Raise it whenever the shell's consent words change:
 * a phone that consented to an older text is asked again, and each sent order records the version
 * its location pass carries.
 */
export const LOCATION_CONSENT_VERSION = 'v1'

/** A circle of doubt wider than this, in metres, counts as "can't check" (D118). */
export const CANT_CHECK_ACCURACY_M = 1_000

/** How long the phone waits for its own position before the check fails (D118: about 10 s). */
export const LOCATE_TIMEOUT_MS = 10_000

/** A phone's position as the page sends it: degrees, and the circle of doubt in metres. */
export const GuestPositionSchema = z.strictObject({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  accuracyM: z.number().nonnegative().max(1_000_000),
})

/** A phone's position. */
export type GuestPosition = z.infer<typeof GuestPositionSchema>

/** The outcome of one check: at the venue, clearly elsewhere, or unable to tell. */
export type LocationVerdict = 'inside' | 'outside' | 'cant_check'

const EARTH_RADIUS_M = 6_371_008.8

const radians = (degrees: number) => (degrees * Math.PI) / 180

/** The great-circle distance between two points in metres (haversine). */
export function distanceMetres(
  a: { readonly lat: number; readonly lng: number },
  b: { readonly lat: number; readonly lng: number },
): number {
  const dLat = radians(b.lat - a.lat)
  const dLng = radians(b.lng - a.lng)
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(radians(a.lat)) * Math.cos(radians(b.lat)) * Math.sin(dLng / 2) ** 2
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)))
}

/**
 * The circle-touch test: `inside` when the phone's circle (its spot, `accuracyM` wide) touches the
 * venue's (its spot, `radiusMetres` wide), `cant_check` when the phone's circle is wider than
 * `CANT_CHECK_ACCURACY_M` or the venue has no spot, else `outside`.
 */
export function locationVerdict(
  position: GuestPosition,
  spot: { readonly lat: number; readonly lng: number } | null,
  radiusMetres: number,
): LocationVerdict {
  if (spot === null) return 'cant_check'
  if (!Number.isFinite(position.accuracyM) || position.accuracyM > CANT_CHECK_ACCURACY_M) {
    return 'cant_check'
  }
  return distanceMetres(position, spot) <= radiusMetres + position.accuracyM ? 'inside' : 'outside'
}

/** A Zod error as the paths it names (`check.location.lat`), never the values or the messages. */
export function issuePaths(error: z.ZodError): string[] {
  return [...new Set(error.issues.map((issue) => issue.path.map(String).join('.') || '(root)'))]
}

/** A location pass never lasts past the service day it was issued in: the search's precision. */
const DAY_END_PRECISION_MS = 1_000

/**
 * When a location pass issued at `now` expires: `passMinutes` later, cut at the end of the venue's
 * service day (D121). The day's end is found by search, not arithmetic, so a change of the clocks
 * in the night moves it as the venue's own day does.
 */
export function locationPassExpiry(
  now: Date,
  passMinutes: number,
  timeZone: string,
  dayEndsAt: string,
): Date {
  const until = new Date(now.getTime() + passMinutes * 60_000)
  const today = serviceDate(now, timeZone, dayEndsAt)
  if (serviceDate(until, timeZone, dayEndsAt) === today) return until
  // The day ends somewhere in (now, until]: the first instant whose service day is another.
  let low = now.getTime()
  let high = until.getTime()
  while (high - low > DAY_END_PRECISION_MS) {
    const middle = Math.floor((low + high) / 2)
    if (serviceDate(new Date(middle), timeZone, dayEndsAt) === today) low = middle
    else high = middle
  }
  return new Date(low)
}
