// A guest's own link to his booking, as the Editorial Market's booking screen draws it (#579; spec
// #322 stories 8 and 34): the night, the hour, the party, the spots and how it stands, and a Cancel
// while the night is still to come. Nothing about anyone else, no phone, no note.
//
// Cancel asks once, saying the club will be told and that the link cannot undo it. The booking
// shows cancelled only once the host says the server did it (D72: no local success). Once the night
// has started, a change is a call to the club. A link that opens nothing gets one plain page,
// whatever the reason.

import {
  bookingNightLabel,
  type GuestLinkBinding,
  type GuestLinkBooking,
  type Locale,
  stringsFor,
} from '@restro/shell'
import { useEffect, useId, useRef, useState } from 'react'

/** The body of the booking screen for a guest's own link. */
export function GuestLinkBody({
  link,
  locale,
}: {
  readonly link: GuestLinkBinding
  readonly locale: Locale
}) {
  const words = stringsFor(locale).bookingLink
  const id = useId()
  // The one question before a cancel is open.
  const [asking, setAsking] = useState(false)
  // This page sent the cancel: once the server says the booking is cancelled, the page says so.
  const [sent, setSent] = useState(false)
  const done = useRef<HTMLParagraphElement>(null)
  const booking = link.stage === 'shown' ? link.booking : null
  const cancelledHere = sent && booking?.state === 'cancelled'

  useEffect(() => {
    if (cancelledHere) done.current?.focus()
  }, [cancelledHere])

  if (link.stage === 'loading') {
    return (
      <p className="bk-intro" role="status">
        {stringsFor(locale).guest.loading}
      </p>
    )
  }
  if (link.stage === 'failed') {
    return (
      <section className="bk-answer">
        <p>{words.loadFailedText}</p>
        <div className="bk-link-actions">
          <button className="bk-quiet" type="button" onClick={link.retry}>
            {words.retry}
          </button>
        </div>
      </section>
    )
  }
  if (booking === null) {
    return (
      <section className="bk-answer" aria-labelledby={`${id}-gone`}>
        <h2 id={`${id}-gone`}>{words.goneTitle}</h2>
        <p>{words.goneText}</p>
      </section>
    )
  }

  const refusal = link.refusal === null ? null : words.refusals[link.refusal]
  const open = booking.state === 'requested' || booking.state === 'confirmed'
  return (
    <>
      <dl className="bk-facts">
        {facts(booking, locale, words).map(([label, value]) => (
          <div className="bk-fact" key={label}>
            <dt className="bk-fact-label">{label}</dt>
            <dd className="bk-fact-value">{value}</dd>
          </div>
        ))}
      </dl>
      {cancelledHere ? (
        <p className="bk-link-note" role="status" ref={done} tabIndex={-1}>
          {words.cancelledText}
        </p>
      ) : null}
      {open && booking.nightStarted ? <p className="bk-link-note">{words.nightStarted}</p> : null}
      {refusal === null ? null : (
        <p className="bk-refusal bk-link-note" role="alert">
          {refusal}
        </p>
      )}
      {booking.canCancel ? (
        <div className="bk-link-actions">
          {asking ? (
            <>
              <p className="bk-ask" id={`${id}-ask`}>
                {words.confirmText}
              </p>
              <button
                className="bk-send"
                type="button"
                aria-describedby={`${id}-ask`}
                disabled={link.cancelling}
                onClick={() => {
                  setSent(true)
                  link.cancel()
                }}
              >
                {link.cancelling ? words.cancelling : words.confirm}
              </button>
              <button
                className="bk-quiet"
                type="button"
                disabled={link.cancelling}
                onClick={() => setAsking(false)}
              >
                {words.keep}
              </button>
            </>
          ) : (
            <button className="bk-quiet" type="button" onClick={() => setAsking(true)}>
              {words.cancel}
            </button>
          )}
        </div>
      ) : null}
    </>
  )
}

/** The lines the link shows, in order: the night, the hour, the party, the spots, the state. */
function facts(
  booking: GuestLinkBooking,
  locale: Locale,
  words: ReturnType<typeof stringsFor>['bookingLink'],
): ReadonlyArray<readonly [string, string]> {
  return [
    [words.night, bookingNightLabel(booking.night, locale)],
    [words.time, booking.time],
    ...(booking.partySize === null ? [] : [[words.partySize, String(booking.partySize)] as const]),
    ...(booking.spots.length === 0 ? [] : [[words.spots, booking.spots.join(', ')] as const]),
    [words.state, words.states[booking.state]],
  ]
}
