// The incremental sync's cursor. barsy's `last_update` filter takes a time without an offset
// ("2012-09-27 17:12:29", the official guide, integrations/20-articles.html, example 1); we assume
// the venue's local time (Q60, still open). The cursor we keep is an instant, the start of the
// last successful run; the filter is that instant minus 65 minutes, written in the venue's time
// zone. The overlap covers clock skew between our servers and barsy's and the hour of a daylight
// saving change; unchanged content hashes make a re-read free.

/** How far before the previous successful run's start the next one looks. */
export const CURSOR_OVERLAP_MINUTES = 65

/** The venue's wall-clock time of `instant` as `YYYY-MM-DD HH:mm:ss`. */
export function localTimeText(instant: Date, timeZone: string): string {
  if (Number.isNaN(instant.getTime())) throw new RangeError('not a valid time')
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(instant)
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((candidate) => candidate.type === type)?.value ?? ''
  return `${part('year')}-${part('month')}-${part('day')} ${part('hour')}:${part('minute')}:${part('second')}`
}

/** The value for `lastUpdateAfter`: the previous successful run's start, minus the overlap, as venue-local text. */
export function lastUpdateFilter(previousRunStart: Date, timeZone: string): string {
  const from = new Date(previousRunStart.getTime() - CURSOR_OVERLAP_MINUTES * 60_000)
  return localTimeText(from, timeZone)
}
