// The booking page of the Editorial Market face (#577; spec #322 stories 1–9): a guest asks for a
// table for one night. It draws the host's booking view in the venue's Style (the menu's theme and
// design, the same root as the menu) and nothing else: the nights come from the published booking
// file, whether a night can be booked from the host's one narrow ask, and the answer screen only
// once the host says the club took the request (D72: no local success).
//
// A closed night stays in the list, marked, and is refused in words that name another way; nights
// outside the hours or in the past are not in the list at all. With the page off it says the club
// takes no online bookings, and links nowhere.
//
// Where the venue offers it (#580), the guest also chooses one of its Areas, or picks his own spots
// on the plan (`booking-plan.tsx`), free or taken for the chosen night. A spot somebody took
// meanwhile is refused at the write; the host reads the night again, and the plan shows it taken.
// A booking that confirmed itself (his own spot, the venue's switch on) gets its own answer screen.

import {
  BOOKING_LIMITS,
  type BookingForm,
  BookingFormSchema,
  type BookingHostProps,
  bookingNightText,
  stringsFor,
} from '@restro/shell'
import {
  type CSSProperties,
  type FormEvent,
  type ReactNode,
  useEffect,
  useId,
  useRef,
  useState,
} from 'react'

import { BOOKING_CSS } from './booking-css'
import { BookingPlanPicker } from './booking-plan'
import { EDITORIAL_CSS } from './css'
import { bcp47, designAttributes, designVariables, themeVariables } from './model'

/** What the host gives the booking screen: the same props for every face that has one. */
export type EditorialMarketBookingProps = BookingHostProps

/** The party size the form starts at. */
const FIRST_PARTY_SIZE = 2

/** The Editorial Market booking page. */
export function EditorialMarketBooking(props: EditorialMarketBookingProps) {
  const { view, booking, binding, fontStacks, scheme = 'auto' } = props
  const words = stringsFor(booking.locale).booking
  const id = useId()
  const firstOpen = booking.nights.find((night) => night.open) ?? booking.nights[0]
  const [night, setNight] = useState(firstOpen?.date ?? '')
  const [partySize, setPartySize] = useState(String(FIRST_PARTY_SIZE))
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [note, setNote] = useState('')
  const [areaId, setAreaId] = useState('')
  const [picked, setPicked] = useState<readonly string[]>([])
  // The form did not pass the shell's own check (the browser's already passed): said, not sent.
  const [invalid, setInvalid] = useState(false)
  const answer = useRef<HTMLHeadingElement>(null)
  const stage = binding?.stage
  const checkNight = binding?.checkNight
  const firstDate = firstOpen?.date ?? null

  // The night the form starts on is asked about once, as a chosen one is.
  useEffect(() => {
    if (firstDate !== null) checkNight?.(firstDate)
  }, [checkNight, firstDate])

  // The form gives way to the answer: the focus moves to its heading, so it is read and not lost.
  useEffect(() => {
    if (stage === 'sent' || stage === 'confirmed') answer.current?.focus()
  }, [stage])

  const chosen = booking.nights.find((entry) => entry.date === night) ?? null
  // What is known about the chosen night: the file says a closed one at once, and the server's
  // answer for it (when it is the one it was asked about) has the last word.
  const asked = binding?.night?.night === night ? binding.night.answer : null
  const nightAnswer = asked ?? (chosen !== null && !chosen.open ? 'closed_date' : null)
  const nightRefusal = nightAnswer === null ? null : bookingNightText(nightAnswer, words)
  const refusal =
    nightRefusal ??
    (invalid
      ? words.refusals.invalid_request
      : binding?.refusal == null
        ? null
        : words.refusals[binding.refusal])
  const sending = binding?.stage === 'sending'
  const canSend = binding !== undefined && !sending && nightRefusal === null && chosen !== null
  // What the guest may choose beyond the night (#580): an Area, or his own spots.
  const offersAreas = booking.guestMay === 'area' && booking.areas.length > 0
  const offersSpots = booking.guestMay === 'spot' && booking.plans.length > 0
  const spotStates = binding?.night?.night === night ? binding.night.spots : undefined
  // A spot the night's answer now says is taken is no longer picked.
  const pickedNow = picked.filter((spotId) => spotStates?.[spotId] !== 'taken')
  const toggleSpot = (spotId: string) =>
    setPicked((now) =>
      now.includes(spotId) ? now.filter((one) => one !== spotId) : [...now, spotId],
    )

  const chooseNight = (date: string) => {
    setNight(date)
    // Spots are free or taken per night: a pick never carries over to another one.
    setPicked([])
    binding?.checkNight(date)
  }

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!canSend || binding === undefined) return
    const parsed = BookingFormSchema.safeParse({
      night,
      partySize: Number(partySize),
      name,
      phone,
      email: email.trim(),
      note: note.trim() === '' ? null : note,
      areaId: offersAreas && areaId !== '' ? areaId : null,
      spotIds: offersSpots ? pickedNow : [],
    } satisfies Record<keyof BookingForm, unknown>)
    setInvalid(!parsed.success)
    if (parsed.success) binding.send(parsed.data)
  }

  let body: ReactNode
  if (!booking.on) {
    body = (
      <section className="bk-answer" aria-labelledby={`${id}-off`}>
        <h2 id={`${id}-off`}>{words.offTitle}</h2>
        <p>{words.offText}</p>
      </section>
    )
  } else if (binding?.stage === 'confirmed') {
    body = (
      <section className="bk-answer" role="status" aria-labelledby={`${id}-confirmed`}>
        <h2 id={`${id}-confirmed`} ref={answer} tabIndex={-1}>
          {words.confirmedTitle}
        </h2>
        <p>{words.confirmedText}</p>
      </section>
    )
  } else if (binding?.stage === 'sent') {
    body = (
      <section className="bk-answer" role="status" aria-labelledby={`${id}-sent`}>
        <h2 id={`${id}-sent`} ref={answer} tabIndex={-1}>
          {words.sentTitle}
        </h2>
        <p>{words.sentText}</p>
      </section>
    )
  } else if (booking.nights.length === 0) {
    body = (
      <section className="bk-answer">
        <p>{words.noNights}</p>
      </section>
    )
  } else {
    body = (
      <>
        <p className="bk-intro">{words.intro}</p>
        <form className="bk-form" onSubmit={submit}>
          <div className="bk-field">
            <label className="bk-label" htmlFor={`${id}-night`}>
              {words.night}
            </label>
            <select
              id={`${id}-night`}
              className="bk-input"
              value={night}
              onChange={(event) => chooseNight(event.target.value)}
              required
            >
              {booking.nights.map((entry) => (
                <option key={entry.date} value={entry.date}>
                  {entry.open ? entry.label : words.closedMark(entry.label)}
                </option>
              ))}
            </select>
          </div>
          {offersAreas ? (
            <div className="bk-field">
              <label className="bk-label" htmlFor={`${id}-area`}>
                {words.area}
              </label>
              <select
                id={`${id}-area`}
                className="bk-input"
                value={areaId}
                onChange={(event) => setAreaId(event.target.value)}
                required
              >
                <option value="">{words.areaPick}</option>
                {booking.areas.map((area) => (
                  <option key={area.id} value={area.id}>
                    {area.name}
                  </option>
                ))}
              </select>
            </div>
          ) : null}
          {offersSpots && nightRefusal === null ? (
            <BookingPlanPicker
              id={`${id}-plan`}
              plans={booking.plans}
              states={spotStates}
              picked={pickedNow}
              onToggle={toggleSpot}
              words={words}
              enabled={binding !== undefined && !sending}
            />
          ) : null}
          <div className="bk-field">
            <label className="bk-label" htmlFor={`${id}-size`}>
              {words.partySize}
            </label>
            <input
              id={`${id}-size`}
              className="bk-input"
              type="number"
              inputMode="numeric"
              min={1}
              max={BOOKING_LIMITS.partySize}
              value={partySize}
              onChange={(event) => setPartySize(event.target.value)}
              required
            />
          </div>
          <div className="bk-field">
            <label className="bk-label" htmlFor={`${id}-name`}>
              {words.name}
            </label>
            <input
              id={`${id}-name`}
              className="bk-input"
              autoComplete="name"
              maxLength={BOOKING_LIMITS.name}
              value={name}
              onChange={(event) => setName(event.target.value)}
              required
            />
          </div>
          <div className="bk-field">
            <label className="bk-label" htmlFor={`${id}-phone`}>
              {words.phone}
            </label>
            <input
              id={`${id}-phone`}
              className="bk-input"
              type="tel"
              autoComplete="tel"
              minLength={BOOKING_LIMITS.phoneMin}
              maxLength={BOOKING_LIMITS.phone}
              value={phone}
              onChange={(event) => setPhone(event.target.value)}
              required
            />
          </div>
          <div className="bk-field">
            <label className="bk-label" htmlFor={`${id}-email`}>
              {words.email}
            </label>
            <input
              id={`${id}-email`}
              className="bk-input"
              type="email"
              autoComplete="email"
              maxLength={BOOKING_LIMITS.email}
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
            />
          </div>
          <div className="bk-field">
            <label className="bk-label" htmlFor={`${id}-note`}>
              {words.note}
            </label>
            <textarea
              id={`${id}-note`}
              className="bk-input bk-note"
              maxLength={BOOKING_LIMITS.note}
              value={note}
              onChange={(event) => setNote(event.target.value)}
            />
          </div>
          {refusal === null ? null : (
            <p className="bk-refusal" role="alert">
              {refusal}
            </p>
          )}
          <button className="bk-send" type="submit" disabled={!canSend}>
            {sending ? words.sending : words.send}
          </button>
        </form>
      </>
    )
  }

  return (
    <div
      className="rm"
      data-face="editorial-market"
      data-page="booking"
      data-scheme={scheme}
      {...designAttributes(view.design)}
      lang={bcp47(booking.locale)}
      style={
        {
          ...themeVariables(view.theme, fontStacks),
          ...designVariables(view.design, fontStacks),
        } as CSSProperties
      }
    >
      {/* biome-ignore lint/security/noDangerouslySetInnerHtml: constant stylesheets from css.ts and booking-css.ts, no user input; React would escape `>` and quotes in them */}
      <style dangerouslySetInnerHTML={{ __html: EDITORIAL_CSS + BOOKING_CSS }} />
      <main className="bk-page">
        <p className="bk-venue">{booking.venueName}</p>
        <h1 className="bk-title">{words.title}</h1>
        {body}
      </main>
    </div>
  )
}
