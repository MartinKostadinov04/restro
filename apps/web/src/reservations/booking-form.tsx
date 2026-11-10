'use client'

// The booking form (#328; D134, D135, D137, D141): the one form a hostess fills when a guest
// calls — from the list's "New reservation", from a spot on the plan ("Book this spot"), and for a
// booking that is changed. A sheet over Venue › Reservations (a bottom drawer on a phone), never
// a route of its own (Patterns: "Add a thing" with more than three fields; "Edits that are not
// saved yet").
//
// **Warnings sit under the field they belong to and never block.** More guests than seats, the
// same name or phone twice that night, an hour outside the venue's hours: each is one calm line
// and Save stays what it was, because a club books a table for ten on eight seats on purpose and
// one contact organises separate groups (D134, D135). The one thing that does stop a save is a
// spot somebody else holds, and it says who and from when, while she is still choosing.
//
// **Nothing typed is ever lost by a tap that was not Save.** Spots are chosen inside the form
// (the list, or the plan), so going to the plan and back keeps everything; a failed save keeps
// every value and names the fix; leaving with changes asks first, and the browser's own leave-page
// warning covers a closed tab (T88).
//
// A booking changed over somebody else's change is refused and says whose: the form is opened on
// a version and watches for another while it is open; Save sends the version home, and the write
// path refuses a stale one (`reservation_stale`) before it writes anything.
//
// Guests (#333): on a new booking three letters of the name suggest the venue's regulars and a
// tap fills the phone; a phone already on the list names the guest it belongs to (the booking
// becomes his, and nothing stops her); and "Save to the regulars" puts the guest on the list.
import { InfoIcon, XIcon } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from '@/components/ui/drawer'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { Textarea } from '@/components/ui/textarea'
import { useIsMobile } from '@/hooks/use-mobile'
import { cn } from '@/lib/utils'
import { WRAPS } from '@/lib/wrapping'
import { reservationDetailAction, saveBookingAction } from '@/server/reservations/actions'
import type { RvChecksView, RvDetailView, RvFrame } from '@/server/reservations/view'
import { useDateText } from '@/tonight/day-picker'
import { FEED_POLL_MS } from '@/tonight/live-feed'
import { useWho } from '@/tonight/who'
import { BOOKING_REASONS } from './booking-reasons'
import {
  type BookingValues,
  blankValues,
  EVENING_HOUR,
  type FieldError,
  fieldErrors,
  isDirty,
  nextQuarter,
  valuesOf,
} from './booking-values'
import { GuestNameField } from './guest-suggest'
import { PickWait, SpotList, SpotPlan, usePickPlan } from './spot-picker'
import { useBookingChecks } from './use-booking-checks'
import type { RvRunSpec } from './use-reservation-run'

/** What the form is opened for. */
export type BookingMode =
  | {
      readonly kind: 'new'
      readonly day: string
      /** A spot chosen on the plan before the form opened ("Book this spot"). */
      readonly spotIds?: readonly string[]
      /** The guest a card's "Book a table" opened the form for (#333). */
      readonly guest?: { readonly name: string; readonly phone: string }
    }
  | { readonly kind: 'edit'; readonly detail: RvDetailView }

/** One calm line under a field. A refusal is the same line in the destructive colour. */
function Hint({
  tone = 'note',
  testId,
  children,
}: {
  tone?: 'note' | 'refusal'
  testId: string
  children: React.ReactNode
}) {
  return (
    <p
      role={tone === 'refusal' ? 'alert' : 'status'}
      data-testid={testId}
      className={cn(
        'flex items-start gap-2 text-sm',
        tone === 'refusal' ? 'text-destructive' : 'text-muted-foreground',
      )}
    >
      <InfoIcon aria-hidden className="mt-0.5 size-4 shrink-0" />
      <span className="[overflow-wrap:anywhere]">{children}</span>
    </p>
  )
}

/** A field's own error, under it (3.3.1: it names the field and what is wrong). */
function FieldProblem({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <p id={id} role="alert" className="text-sm text-destructive [overflow-wrap:anywhere]">
      {children}
    </p>
  )
}

export function BookingForm({
  frame,
  mode,
  run,
  busy,
  onClose,
  onSaved,
}: {
  frame: RvFrame
  mode: BookingMode
  run: (spec: RvRunSpec) => void
  busy: boolean
  /** The form is left (after the leave question, if there was anything to lose). */
  onClose: () => void
  /** The booking was saved: the screen behind reads again. */
  onSaved: () => void
}) {
  const t = useTranslations('reservations')
  const isMobile = useIsMobile()
  const who = useWho()
  const dateText = useDateText()
  const ids = useId()
  const editing = mode.kind === 'edit' ? mode.detail : null

  const [start] = useState<BookingValues>(() =>
    mode.kind === 'edit'
      ? valuesOf(mode.detail)
      : blankValues({
          day: mode.day,
          time: mode.day === frame.today ? nextQuarter(new Date(), frame.timezone) : EVENING_HOUR,
          ...(mode.spotIds === undefined ? {} : { spotIds: mode.spotIds }),
          ...(mode.guest === undefined ? {} : mode.guest),
        }),
  )
  const [baseline, setBaseline] = useState(start)
  const [values, setValues] = useState(start)
  const [version, setVersion] = useState(editing?.version)
  const [tried, setTried] = useState(false)
  const [leaving, setLeaving] = useState(false)
  const [picker, setPicker] = useState<'closed' | 'list' | 'plan'>('closed')
  // Who changed the booking while the form was open, once somebody has.
  const [staleBy, setStaleBy] = useState<string | null>(null)
  const fresh = useRef<RvDetailView | null>(null)
  // "Save to the regulars" (#333): a new booking only, and it needs a phone, the record's key.
  const [regular, setRegular] = useState(false)
  // The regular a suggestion filled in, while the phone is still the one it filled.
  const [picked, setPicked] = useState<{ id: string; phone: string } | null>(null)
  const pickedNow = picked !== null && picked.phone === values.phone ? picked.id : null

  const set = <K extends keyof BookingValues>(key: K, value: BookingValues[K]) =>
    setValues((before) => ({ ...before, [key]: value }))

  const dirty = isDirty(values, baseline)
  const errors = fieldErrors(values, { phoneRequired: frame.phoneRequired })
  const problem = (field: keyof typeof errors, text: Record<FieldError, string>) =>
    tried && errors[field] !== undefined ? text[errors[field]] : null

  // Leaving a tab with changes in it asks first (T88).
  useEffect(() => {
    if (!dirty) return
    const warn = (event: BeforeUnloadEvent) => event.preventDefault()
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])

  const partySize = Number.isInteger(Number(values.partySize)) ? Number(values.partySize) : null
  const checks = useBookingChecks({
    venueId: frame.venueId,
    day: values.day,
    time: values.time,
    until: values.until,
    partySize: partySize !== null && partySize > 0 ? partySize : null,
    name: values.name,
    phone: values.phone,
    spotIds: values.spotIds,
    ...(editing === null ? {} : { reservationId: editing.row.id }),
  })

  const pick = usePickPlan(frame, values.day)
  const spotNames = useMemo(() => {
    const names = new Map<string, string>()
    editing?.spotIds.forEach((id, index) => {
      const name = editing.row.spots[index]
      if (name !== undefined) names.set(id, name)
    })
    for (const spot of pick.plan?.spots ?? []) names.set(spot.id, spot.name)
    return names
  }, [editing, pick.plan])

  // The booking behind the form is watched while it is open: when somebody else writes it, the
  // form says whose work it would save over, before she presses Save.
  const noticeOf = useCallback(
    (detail: RvDetailView | null | undefined) => {
      if (editing === null || version === undefined || detail === null || detail === undefined) {
        return
      }
      fresh.current = detail
      if (detail.version === version) return
      const newest = detail.history.at(-1)
      setStaleBy(newest === undefined ? t('bk_someone') : who(newest.by))
    },
    [editing, t, version, who],
  )
  useEffect(() => {
    if (editing === null) return
    const timer = window.setInterval(() => {
      if (document.visibilityState !== 'visible') return
      void reservationDetailAction({ venueId: frame.venueId, reservationId: editing.row.id })
        .then((answer) => noticeOf(answer.ok ? answer.detail : undefined))
        .catch(() => undefined)
    }, FEED_POLL_MS)
    return () => window.clearInterval(timer)
  }, [editing, frame.venueId, noticeOf])

  /** "Open it again": the booking as it is now, in the form, and nothing of hers kept. */
  const openAgain = () => {
    const latest = fresh.current
    if (latest === null) return
    const next = valuesOf(latest)
    setBaseline(next)
    setValues(next)
    setVersion(latest.version)
    setStaleBy(null)
    setTried(false)
  }

  /** The sentence for a refusal this form can say more about than the general wording does. */
  const refusalText = useCallback(
    async (
      error: string,
      details: Readonly<Record<string, unknown>> | undefined,
    ): Promise<string | null> => {
      if (error === 'spot_taken' && details !== undefined) {
        const spot = pick.plan?.spots.find((one) => one.id === details.spotId)
        const hold = spot?.holds.find((one) => one.reservationId === details.reservationId)
        if (spot === undefined || hold === undefined) return null
        return hold.kind === 'block'
          ? t('bk_taken_block', { spot: spot.name, time: hold.time })
          : t('bk_taken', { party: hold.name ?? t('no_name'), spot: spot.name, time: hold.time })
      }
      if (error === 'reservation_stale' && editing !== null) {
        const answer = await reservationDetailAction({
          venueId: frame.venueId,
          reservationId: editing.row.id,
        }).catch(() => null)
        const detail = answer?.ok ? answer.detail : null
        noticeOf(detail)
        const newest = detail?.history.at(-1)
        return newest === undefined ? null : t('bk_stale', { name: who(newest.by) })
      }
      return null
    },
    [editing, frame.venueId, noticeOf, pick.plan, t, who],
  )

  const regularWithoutPhone = regular && editing === null && values.phone.trim() === ''
  const save = () => {
    setTried(true)
    if (Object.keys(errors).length > 0) {
      document.getElementById(`${ids}-${Object.keys(errors)[0]}`)?.focus()
      return
    }
    if (regularWithoutPhone) {
      document.getElementById(`${ids}-phone`)?.focus()
      return
    }
    const name = values.name.trim()
    run({
      id: `rv-save:${editing?.row.id ?? 'new'}`,
      done: t('bk_saved'),
      pin: {
        title: editing === null ? t('bk_pin_new') : t('bk_pin_edit'),
        body: t('bk_pin_b'),
      },
      act: (pin) =>
        saveBookingAction({
          venueId: frame.venueId,
          day: values.day,
          time: values.time,
          until: values.until === '' ? null : values.until,
          name,
          phone: values.phone.trim() === '' ? null : values.phone.trim(),
          partySize: Number(values.partySize),
          spotIds: values.spotIds,
          note: values.note.trim() === '' ? null : values.note.trim(),
          ...(editing === null
            ? { reason: values.reason, ...(regular ? { saveAsRegular: true } : {}) }
            : {
                reservationId: editing.row.id,
                ...(version === undefined ? {} : { version }),
                // A reason we do not offer, left alone, stays what it was.
                ...(values.reason === baseline.reason ? {} : { reason: values.reason }),
                changed: {
                  name: name !== baseline.name.trim(),
                  phone: values.phone.trim() !== baseline.phone.trim(),
                },
              }),
          ...(pin === undefined ? {} : { pin }),
        }),
      refusal: refusalText,
      onDone: onSaved,
    })
  }

  const requestClose = () => {
    if (dirty) setLeaving(true)
    else onClose()
  }

  const refusedNight =
    checks?.night == null
      ? null
      : checks.night === 'night_passed'
        ? t('b_passed')
        : checks.night === 'settings_missing'
          ? t('b_settings')
          : t('errors.past_night_denied')

  const errorText: Record<FieldError, string> = {
    name: t('bk_e_name'),
    phone_needed: t('bk_e_phone_needed'),
    phone_digits: t('bk_e_phone_digits'),
    guests: t('bk_e_guests'),
    end_hour: t('bk_e_end'),
  }

  const title = editing === null ? t('bk_new_t') : t('bk_edit_t')
  const sub = editing === null ? null : dateText(editing.day)

  const body = (
    <div className="space-y-4 overflow-y-auto px-4 pb-2 text-sm" data-testid="rv-form">
      {staleBy === null ? null : (
        <div
          role="alert"
          className="space-y-2 rounded-md border bg-info/10 p-3"
          data-testid="rv-form-stale"
        >
          <p className="[overflow-wrap:anywhere]">{t('bk_stale', { name: staleBy })}</p>
          <Button
            type="button"
            variant="outline"
            className={WRAPS}
            data-testid="rv-form-reopen"
            onClick={openAgain}
          >
            {t('bk_reopen')}
          </Button>
        </div>
      )}
      {refusedNight === null ? null : (
        <Hint tone="refusal" testId="rv-form-night">
          {refusedNight}
        </Hint>
      )}

      <div className="space-y-1.5">
        <Label htmlFor={`${ids}-name`}>{t('bk_name')}</Label>
        <GuestNameField
          id={`${ids}-name`}
          venueId={frame.venueId}
          value={values.name}
          suggest={editing === null}
          invalid={problem('name', errorText) !== null}
          describedBy={`${ids}-name-e`}
          onChange={(name) => set('name', name)}
          onPick={(guest) => {
            const phone = guest.phone ?? ''
            setValues((before) => ({ ...before, name: guest.name ?? before.name, phone }))
            setPicked({ id: guest.id, phone })
          }}
        />
        {problem('name', errorText) === null ? null : (
          <FieldProblem id={`${ids}-name-e`}>{problem('name', errorText)}</FieldProblem>
        )}
      </div>

      <div className="space-y-1.5">
        <Label htmlFor={`${ids}-phone`}>
          {frame.phoneRequired ? t('bk_phone') : t('bk_phone_opt')}
        </Label>
        <Input
          id={`${ids}-phone`}
          type="tel"
          inputMode="tel"
          value={values.phone}
          autoComplete="off"
          maxLength={40}
          aria-invalid={problem('phone', errorText) !== null}
          aria-describedby={`${ids}-phone-e`}
          data-testid="rv-f-phone"
          onChange={(event) => set('phone', event.target.value)}
        />
        {problem('phone', errorText) === null ? null : (
          <FieldProblem id={`${ids}-phone-e`}>{problem('phone', errorText)}</FieldProblem>
        )}
        {tried && regularWithoutPhone && problem('phone', errorText) === null ? (
          <FieldProblem id={`${ids}-phone-e`}>{t('g_e_regular_phone')}</FieldProblem>
        ) : null}
        {checks?.listed == null || checks.listed.guestId === pickedNow ? null : (
          <Hint testId="rv-w-listed">
            {t('g_listed', { name: checks.listed.name ?? t('no_name') })}
          </Hint>
        )}
        {checks?.sameContact == null ? null : (
          <Hint testId="rv-w-same">
            {t(values.day === frame.today ? 'bk_w_same' : 'bk_w_same_other', {
              name: checks.sameContact.name ?? t('no_name'),
              time: checks.sameContact.time,
            })}
          </Hint>
        )}
      </div>

      {editing === null && pickedNow === null ? (
        <div className="flex min-h-11 items-center gap-3">
          <Checkbox
            id={`${ids}-regular`}
            checked={regular}
            data-testid="rv-f-regular"
            onCheckedChange={(checked) => setRegular(checked === true)}
          />
          <Label htmlFor={`${ids}-regular`} className="font-normal">
            {t('g_save_regular')}
          </Label>
        </div>
      ) : null}

      <div className="space-y-1.5">
        <Label htmlFor={`${ids}-partySize`}>{t('bk_guests')}</Label>
        <Input
          id={`${ids}-partySize`}
          type="number"
          inputMode="numeric"
          min={1}
          max={500}
          value={values.partySize}
          aria-invalid={problem('partySize', errorText) !== null}
          aria-describedby={`${ids}-partySize-e`}
          data-testid="rv-f-guests"
          onChange={(event) => set('partySize', event.target.value)}
        />
        {problem('partySize', errorText) === null ? null : (
          <FieldProblem id={`${ids}-partySize-e`}>{problem('partySize', errorText)}</FieldProblem>
        )}
        {checks?.seats == null ? null : (
          <Hint testId="rv-w-seats">
            {t('bk_w_seats', { guests: checks.seats.guests, seats: checks.seats.seats })}
          </Hint>
        )}
      </div>

      {editing === null ? (
        <div className="space-y-1.5">
          <Label htmlFor={`${ids}-day`}>{t('bk_night')}</Label>
          <Input
            id={`${ids}-day`}
            type="date"
            value={values.day}
            min={frame.editPastNights ? undefined : frame.today}
            data-testid="rv-f-day"
            onChange={(event) => event.target.value !== '' && set('day', event.target.value)}
          />
        </div>
      ) : null}

      <div className="grid grid-cols-2 gap-3">
        <div className="min-w-0 space-y-1.5">
          <Label htmlFor={`${ids}-time`}>{t('bk_from')}</Label>
          <Input
            id={`${ids}-time`}
            type="time"
            value={values.time}
            data-testid="rv-f-time"
            onChange={(event) => event.target.value !== '' && set('time', event.target.value)}
          />
        </div>
        <div className="min-w-0 space-y-1.5">
          <Label htmlFor={`${ids}-until`}>{t('bk_until')}</Label>
          <div className="flex items-center gap-1">
            <Input
              id={`${ids}-until`}
              type="time"
              value={values.until}
              aria-invalid={problem('until', errorText) !== null}
              aria-describedby={`${ids}-until-e`}
              data-testid="rv-f-until"
              onChange={(event) => set('until', event.target.value)}
            />
            {values.until === '' ? null : (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-11 shrink-0"
                aria-label={t('bk_until_clear')}
                data-testid="rv-f-until-clear"
                onClick={() => set('until', '')}
              >
                <XIcon aria-hidden />
              </Button>
            )}
          </div>
        </div>
      </div>
      {problem('until', errorText) === null ? null : (
        <FieldProblem id={`${ids}-until-e`}>{problem('until', errorText)}</FieldProblem>
      )}
      {checks === null ? null : <HoursHints checks={checks} />}

      <fieldset className="space-y-2">
        <legend className="mb-1.5 font-medium">{t('bk_spots')}</legend>
        {values.spotIds.length === 0 ? (
          <p className="text-muted-foreground" data-testid="rv-f-nospots">
            {t('bk_spots_none')}
          </p>
        ) : (
          <ul className="flex flex-wrap gap-2" data-testid="rv-f-spots">
            {values.spotIds.map((id) => (
              <li key={id}>
                <Badge variant="outline" className="min-h-8 gap-1 pr-1 text-sm">
                  <span className="[overflow-wrap:anywhere]">{spotNames.get(id) ?? '…'}</span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-8"
                    aria-label={t('bk_spot_remove', { spot: spotNames.get(id) ?? '' })}
                    onClick={() =>
                      set(
                        'spotIds',
                        values.spotIds.filter((one) => one !== id),
                      )
                    }
                  >
                    <XIcon aria-hidden />
                  </Button>
                </Badge>
              </li>
            ))}
          </ul>
        )}
        {checks?.taken == null ? null : (
          <Hint tone="refusal" testId="rv-w-taken">
            {checks.taken.kind === 'block'
              ? t('bk_taken_block', { spot: checks.taken.spotName, time: checks.taken.time })
              : t('bk_taken', {
                  party: checks.taken.name ?? t('no_name'),
                  spot: checks.taken.spotName,
                  time: checks.taken.time,
                })}
          </Hint>
        )}
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant={picker === 'list' ? 'default' : 'outline'}
            aria-pressed={picker === 'list'}
            className={WRAPS}
            data-testid="rv-f-pick-list"
            onClick={() => setPicker(picker === 'list' ? 'closed' : 'list')}
          >
            {t('bk_spots_pick')}
          </Button>
          <Button
            type="button"
            variant={picker === 'plan' ? 'default' : 'outline'}
            aria-pressed={picker === 'plan'}
            className={WRAPS}
            data-testid="rv-f-pick-plan"
            onClick={() => setPicker(picker === 'plan' ? 'closed' : 'plan')}
          >
            {t('bk_spots_plan')}
          </Button>
        </div>
        {picker === 'closed' ? null : pick.plan === null ? (
          pick.failed ? (
            <p className="text-muted-foreground" role="alert">
              {t('p_fail')}
            </p>
          ) : (
            <PickWait />
          )
        ) : pick.plan.planId === null ? (
          <p className="text-muted-foreground">{t('p_empty')}</p>
        ) : (
          <div className="space-y-2">
            {pick.plan.plans.length < 2 ? null : (
              <fieldset className="flex min-w-0 flex-wrap gap-2">
                <legend className="sr-only">{t('p_which_plan')}</legend>
                {pick.plan.plans.map((one) => (
                  <Button
                    key={one.id}
                    type="button"
                    size="sm"
                    variant={one.id === pick.plan?.planId ? 'default' : 'outline'}
                    aria-pressed={one.id === pick.plan?.planId}
                    className="min-h-11"
                    onClick={() => pick.setPlanId(one.id)}
                  >
                    {one.name}
                  </Button>
                ))}
              </fieldset>
            )}
            {picker === 'list' ? (
              <SpotList
                plan={pick.plan}
                selected={values.spotIds}
                onChange={(next) => set('spotIds', next)}
              />
            ) : (
              <SpotPlan
                plan={pick.plan}
                selected={values.spotIds}
                onChange={(next) => set('spotIds', next)}
              />
            )}
            <Button
              type="button"
              variant="outline"
              className={WRAPS}
              data-testid="rv-f-pick-done"
              onClick={() => setPicker('closed')}
            >
              {t('bk_spots_done')}
            </Button>
          </div>
        )}
      </fieldset>

      <div className="space-y-1.5">
        <Label htmlFor={`${ids}-note`}>{t('bk_note')}</Label>
        <Textarea
          id={`${ids}-note`}
          value={values.note}
          maxLength={500}
          rows={2}
          data-testid="rv-f-note"
          onChange={(event) => set('note', event.target.value)}
        />
      </div>

      <fieldset className="space-y-1.5">
        <legend className="mb-1.5 font-medium">{t('bk_reason')}</legend>
        <div className="flex min-w-0 flex-wrap gap-2">
          {BOOKING_REASONS.map((value) => (
            <Button
              key={value}
              type="button"
              size="sm"
              variant={values.reason === value ? 'default' : 'outline'}
              aria-pressed={values.reason === value}
              className="min-h-11"
              data-testid={`rv-f-reason-${value}`}
              // A second tap takes the reason away again: most bookings have none.
              onClick={() => set('reason', values.reason === value ? null : value)}
            >
              {t(`bk_reason_${value}`)}
            </Button>
          ))}
        </div>
      </fieldset>
    </div>
  )

  const buttons = (
    <>
      <Button
        type="button"
        className={WRAPS}
        disabled={busy || (!dirty && editing !== null)}
        data-testid="rv-f-save"
        onClick={save}
      >
        {t('bk_save')}
      </Button>
      <Button
        type="button"
        variant="outline"
        className="h-12"
        data-testid="rv-f-close"
        onClick={requestClose}
      >
        {t('close')}
      </Button>
    </>
  )

  const heading = (
    <span className="flex flex-wrap items-center gap-2">
      <span className="[overflow-wrap:anywhere]">{title}</span>
      {dirty ? (
        <Badge variant="secondary" data-testid="rv-f-unsaved">
          {t('bk_unsaved')}
        </Badge>
      ) : null}
    </span>
  )

  return (
    <>
      {isMobile ? (
        <Drawer open dismissible={false} onOpenChange={(open) => !open && requestClose()}>
          <DrawerContent data-testid="rv-form-sheet">
            <DrawerHeader>
              <DrawerTitle>{heading}</DrawerTitle>
              <DrawerDescription className={sub === null ? 'sr-only' : undefined}>
                {sub ?? title}
              </DrawerDescription>
            </DrawerHeader>
            {body}
            <DrawerFooter>{buttons}</DrawerFooter>
          </DrawerContent>
        </Drawer>
      ) : (
        <Sheet open onOpenChange={(open) => !open && requestClose()}>
          <SheetContent className="sm:max-w-md" data-testid="rv-form-sheet">
            <SheetHeader>
              <SheetTitle>{heading}</SheetTitle>
              <SheetDescription className={sub === null ? 'sr-only' : undefined}>
                {sub ?? title}
              </SheetDescription>
            </SheetHeader>
            {body}
            <SheetFooter>{buttons}</SheetFooter>
          </SheetContent>
        </Sheet>
      )}
      {leaving ? (
        <Dialog open onOpenChange={(open) => !open && setLeaving(false)}>
          <DialogContent className="max-w-md" data-testid="rv-leave">
            <DialogHeader>
              <DialogTitle>{t('bk_leave_t')}</DialogTitle>
              <DialogDescription>{t('bk_leave_b')}</DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                className={WRAPS}
                data-testid="rv-leave-do"
                onClick={onClose}
              >
                {t('bk_leave_do')}
              </Button>
              <Button
                type="button"
                variant="outline"
                className={WRAPS}
                onClick={() => setLeaving(false)}
              >
                {t('bk_leave_keep')}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}
    </>
  )
}

/** The hours' advice, under the hour fields: one line, whichever it is. */
export function HoursHints({ checks }: { checks: RvChecksView }) {
  const t = useTranslations('reservations')
  // The night has ended (#332): the booking is taken, and she is told it lands on a closed night.
  if (checks.nightEnded) {
    return <Hint testId="rv-w-ended">{t('bk_w_ended')}</Hint>
  }
  if (checks.closedNight) {
    return <Hint testId="rv-w-closed">{t('bk_w_closed')}</Hint>
  }
  if (checks.beforeOpening !== null) {
    return (
      <Hint testId="rv-w-before">
        {t('bk_w_before', {
          opens: checks.beforeOpening.opens,
          closes: checks.beforeOpening.closes,
        })}
      </Hint>
    )
  }
  if (checks.afterClosing) return <Hint testId="rv-w-after">{t('bk_w_after')}</Hint>
  return null
}
