'use client'

// Venue › Reservations › Guests (#333; D140, D141): the venue's list of guests, the third view
// after List and Plan. Every guest a booking with a phone brought in is here, and the regulars a
// hostess keeps on purpose; the filters are one tap each (Regulars, the person's own list,
// Archived), and the search finds a name or a number. A row opens the guest's card.
//
// "Add a regular" is the one filled button (Patterns: "Add a thing" with up to three fields: a
// dialog). A number already on the list is refused by the write path with the guest who has it,
// and the dialog names him and offers to put him on the regulars instead — she is never stopped
// without a way on. Archive is one tap with Undo on the toast; a row's Restore brings him back.
// Nothing here is ever wiped on a timer: a guest leaves the list only by an erasure.
//
// Working the list is "working tonight's reservations" (`reservations.tonight`), so a shared
// device asks for a PIN: it touches a guest's details, and the Log names who did (D141).
import { UserPlusIcon } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useCallback, useEffect, useId, useMemo, useState } from 'react'
import { toast } from 'sonner'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { WRAPS } from '@/lib/wrapping'
import { guestCardAction, guestListAction, saveGuestAction } from '@/server/reservations/actions'
import type { RvFrame, RvGuestListView, RvGuestRowView } from '@/server/reservations/view'
import { FailedBlock, NothingHere, RowsSkeleton } from '@/tonight/tab-parts'

import { BookingForm, type BookingMode } from './booking-form'
import { GuestCard } from './guest-card'
import { type RvRunSpec, useReservationRun } from './use-reservation-run'

/** The view's filters, in the order of the bar. */
const GUEST_FILTERS = ['all', 'regulars', 'mine', 'archived'] as const
type GuestFilter = (typeof GUEST_FILTERS)[number]

/** Rows a filter keeps: the archived are only under Archived. */
export function guestRowsOf(
  rows: readonly RvGuestRowView[],
  filter: GuestFilter,
  search: string,
): readonly RvGuestRowView[] {
  const words = search.trim().toLowerCase()
  const digits = search.replace(/[^0-9]/g, '')
  return rows.filter((row) => {
    if (filter === 'archived' ? !row.archived : row.archived) return false
    if (filter === 'regulars' && !row.regular) return false
    if (filter === 'mine' && !row.mine) return false
    if (words === '') return true
    if ((row.name ?? '').toLowerCase().includes(words)) return true
    return digits.length >= 3 && (row.phone ?? '').replace(/[^0-9]/g, '').includes(digits)
  })
}

/** "Add a regular": name, phone and email, the three things a hostess has on the phone. */
function AddRegular({
  frame,
  run,
  busy,
  onClose,
  onAdded,
}: {
  frame: RvFrame
  run: (spec: RvRunSpec) => void
  busy: boolean
  onClose: () => void
  onAdded: (guestId: string | null) => void
}) {
  const t = useTranslations('reservations')
  const ids = useId()
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [tried, setTried] = useState(false)
  // The guest the number already belongs to, once the write path said so.
  const [existing, setExisting] = useState<{ id: string; name: string } | null>(null)
  const nameMissing = name.trim() === ''
  const phoneMissing = phone.replace(/[^0-9]/g, '').length < 6
  const pin = { title: t('g_add'), body: t('g_pin_b') }

  const save = () => {
    setTried(true)
    if (nameMissing || phoneMissing) {
      document.getElementById(`${ids}-${nameMissing ? 'name' : 'phone'}`)?.focus()
      return
    }
    setExisting(null)
    run({
      id: 'rv-guest:new',
      done: t('g_added', { name: name.trim() }),
      pin,
      act: (typed) =>
        saveGuestAction({
          venueId: frame.venueId,
          name: name.trim(),
          phone: phone.trim(),
          email: email.trim() === '' ? null : email.trim(),
          regular: true,
          ...(typed === undefined ? {} : { pin: typed }),
        }),
      refusal: async (error, details) => {
        if (error !== 'guest_exists' || typeof details?.guestId !== 'string') return null
        const guestId = details.guestId
        const other = await guestCardAction({ venueId: frame.venueId, guestId }).catch(() => null)
        const otherName = other?.ok && other.card !== null ? other.card.name : null
        setExisting({ id: guestId, name: otherName ?? t('no_name') })
        return t('g_listed', { name: otherName ?? t('no_name') })
      },
      onDone: (details) => onAdded(typeof details.guestId === 'string' ? details.guestId : null),
    })
  }

  /** The guest already there goes on the regulars (and out of the archive), as he is. */
  const takeExisting = (guest: { id: string; name: string }) =>
    run({
      id: `rv-guest:${guest.id}`,
      done: t('g_added', { name: guest.name }),
      pin,
      act: (typed) =>
        saveGuestAction({
          venueId: frame.venueId,
          guestId: guest.id,
          regular: true,
          archived: false,
          ...(typed === undefined ? {} : { pin: typed }),
        }),
      onDone: () => onAdded(guest.id),
    })

  const field = (
    key: 'name' | 'phone' | 'email',
    label: string,
    value: string,
    set: (value: string) => void,
    problem: string | null,
    input: Partial<React.ComponentProps<'input'>>,
  ) => (
    <div className="space-y-1.5">
      <Label htmlFor={`${ids}-${key}`}>{label}</Label>
      <Input
        id={`${ids}-${key}`}
        value={value}
        autoComplete="off"
        aria-invalid={problem !== null}
        aria-describedby={`${ids}-${key}-e`}
        data-testid={`rv-g-add-${key}`}
        onChange={(event) => set(event.target.value)}
        {...input}
      />
      {problem === null ? null : (
        <p id={`${ids}-${key}-e`} role="alert" className="text-sm text-destructive">
          {problem}
        </p>
      )}
    </div>
  )

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-md" data-testid="rv-g-add-dialog">
        <DialogHeader>
          <DialogTitle>{t('g_add')}</DialogTitle>
          <DialogDescription>{t('g_add_b')}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3 text-sm">
          {field(
            'name',
            t('bk_name'),
            name,
            setName,
            tried && nameMissing ? t('bk_e_name') : null,
            {
              maxLength: 80,
            },
          )}
          {field(
            'phone',
            t('bk_phone'),
            phone,
            (value) => {
              setPhone(value)
              setExisting(null)
            },
            tried && phoneMissing ? t('errors.invalid_phone') : null,
            { type: 'tel', inputMode: 'tel', maxLength: 40 },
          )}
          {existing === null ? null : (
            <div
              role="status"
              className="space-y-2 rounded-md border bg-info/10 p-3"
              data-testid="rv-g-add-exists"
            >
              <p className="[overflow-wrap:anywhere]">{t('g_listed', { name: existing.name })}</p>
              <Button
                type="button"
                variant="outline"
                className={WRAPS}
                disabled={busy}
                data-testid="rv-g-add-use"
                onClick={() => takeExisting(existing)}
              >
                {t('g_use_listed', { name: existing.name })}
              </Button>
            </div>
          )}
          {field('email', t('g_email_opt'), email, setEmail, null, {
            type: 'email',
            maxLength: 200,
          })}
        </div>
        <DialogFooter>
          <Button
            type="button"
            className={WRAPS}
            disabled={busy}
            data-testid="rv-g-add-save"
            onClick={save}
          >
            {t('g_add_do')}
          </Button>
          <Button type="button" variant="outline" className={WRAPS} onClick={onClose}>
            {t('close')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function GuestRow({
  row,
  mayWork,
  onOpen,
  onArchive,
}: {
  row: RvGuestRowView
  mayWork: boolean
  onOpen: () => void
  onArchive: (archived: boolean) => void
}) {
  const t = useTranslations('reservations')
  return (
    <li className="flex items-center gap-2 p-2" data-testid="rv-g-row" data-guest={row.id}>
      <button
        type="button"
        className="min-h-11 min-w-0 flex-1 rounded-md px-2 py-1 text-left hover:bg-accent focus-visible:outline-2"
        data-testid="rv-g-open"
        onClick={onOpen}
      >
        <span className="flex flex-wrap items-center gap-2">
          <span className="font-medium [overflow-wrap:anywhere]">{row.name ?? t('no_name')}</span>
          {row.regular ? <Badge variant="outline">{t('g_regular')}</Badge> : null}
          {row.mine ? <Badge variant="secondary">{t('g_mine_badge')}</Badge> : null}
        </span>
        {row.phone === null ? null : (
          <span className="block text-sm text-muted-foreground tabular-nums">{row.phone}</span>
        )}
      </button>
      {mayWork ? (
        <Button
          type="button"
          variant="outline"
          className="shrink-0"
          data-testid={row.archived ? 'rv-g-row-restore' : 'rv-g-row-archive'}
          onClick={() => onArchive(!row.archived)}
        >
          {row.archived ? t('g_restore') : t('g_archive')}
        </Button>
      ) : null}
    </li>
  )
}

export function GuestsView({
  initial,
  frame,
  email,
  openGuest,
}: {
  initial: RvGuestListView
  frame: RvFrame
  /** The signed-in person's, for the password asked again before an erasure. */
  email: string
  /** `?guest=`: the card to open first (a reservation's sheet links here). */
  openGuest?: string | undefined
}) {
  const t = useTranslations('reservations')
  const [list, setList] = useState(initial)
  const [loading, setLoading] = useState(false)
  const [failed, setFailed] = useState(false)
  const [filter, setFilter] = useState<GuestFilter>('all')
  const [search, setSearch] = useState('')
  const [open, setOpen] = useState<string | null>(openGuest ?? null)
  const [adding, setAdding] = useState(false)
  const [form, setForm] = useState<BookingMode | null>(null)
  const { run, busy, pinSheet } = useReservationRun({ device: frame.device })
  const searchId = useId()

  const reload = useCallback(() => {
    setLoading(true)
    void guestListAction({ venueId: frame.venueId })
      .then((answer) => {
        if (answer.ok) {
          setList(answer.guests)
          setFailed(false)
        } else setFailed(true)
      })
      .catch(() => setFailed(true))
      .finally(() => setLoading(false))
  }, [frame.venueId])

  // A read that did not get through keeps the list on screen and says so until one does.
  const failedWithRows = failed && list.rows.length > 0
  useEffect(() => {
    if (!failedWithRows) return
    const id = toast.error(t('g_fail'), { duration: Number.POSITIVE_INFINITY, closeButton: true })
    return () => {
      toast.dismiss(id)
    }
  }, [failedWithRows, t])

  const mayWork = frame.can.tonight || frame.device
  const filters = GUEST_FILTERS.filter((one) => one !== 'mine' || list.privateList)
  const count = (one: GuestFilter) => guestRowsOf(list.rows, one, '').length
  const rows = useMemo(() => guestRowsOf(list.rows, filter, search), [list.rows, filter, search])
  const filterWord: Record<GuestFilter, string> = {
    all: t('f_all'),
    regulars: t('g_regulars'),
    mine: t('g_mine'),
    archived: t('g_archived_f'),
  }

  const archive = (row: RvGuestRowView, archived: boolean) => {
    const name = row.name ?? t('no_name')
    const act = (value: boolean) => (typed?: string) =>
      saveGuestAction({
        venueId: frame.venueId,
        guestId: row.id,
        archived: value,
        ...(typed === undefined ? {} : { pin: typed }),
      })
    run({
      id: `rv-guest-archive:${row.id}`,
      done: archived ? t('g_archived_done', { name }) : t('g_restored_done', { name }),
      pin: { title: t('g_pin'), body: t('g_pin_b') },
      act: act(archived),
      again: {
        label: t('p_undo'),
        done: archived ? t('g_restored_done', { name }) : t('g_archived_done', { name }),
        act: act(!archived),
      },
      after: reload,
    })
  }

  const addButton = mayWork ? (
    <Button type="button" className={WRAPS} data-testid="rv-g-add" onClick={() => setAdding(true)}>
      <UserPlusIcon aria-hidden />
      {t('g_add')}
    </Button>
  ) : null

  const body = (() => {
    if (list.rows.length === 0 && loading) return <RowsSkeleton />
    if (failed && list.rows.length === 0) return <FailedBlock text={t('g_fail')} onRetry={reload} />
    if (list.rows.length === 0)
      return <NothingHere text={t('g_empty')} action={addButton ?? undefined} />
    if (rows.length === 0) return <NothingHere text={t('g_empty_filter')} />
    return (
      <ul className="divide-y rounded-lg border" data-testid="rv-g-list">
        {rows.map((row) => (
          <GuestRow
            key={row.id}
            row={row}
            mayWork={mayWork}
            onOpen={() => setOpen(row.id)}
            onArchive={(archived) => archive(row, archived)}
          />
        ))}
      </ul>
    )
  })()

  return (
    <div className="space-y-4" data-testid="reservations-guests">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h2 className="text-xl font-semibold tracking-tight">{t('tab_guests')}</h2>
        {addButton}
      </div>
      {list.rows.length === 0 ? null : (
        <>
          <div className="space-y-1.5">
            <Label htmlFor={searchId} className="sr-only">
              {t('g_search')}
            </Label>
            <Input
              id={searchId}
              type="search"
              value={search}
              placeholder={t('g_search')}
              autoComplete="off"
              data-testid="rv-g-search"
              onChange={(event) => setSearch(event.target.value)}
            />
          </div>
          <fieldset className="flex min-w-0 flex-wrap gap-2">
            <legend className="sr-only">{t('filters')}</legend>
            {filters.map((value) => (
              <Button
                key={value}
                type="button"
                size="sm"
                variant={filter === value ? 'default' : 'outline'}
                aria-pressed={filter === value}
                className="min-h-11"
                data-testid={`rv-g-filter-${value}`}
                onClick={() => setFilter(value)}
              >
                {filterWord[value]}
                <span className="tabular-nums">{count(value)}</span>
              </Button>
            ))}
          </fieldset>
        </>
      )}
      <div aria-busy={loading} className="space-y-2">
        {body}
        {list.hasMore ? (
          <p className="text-sm text-muted-foreground" data-testid="rv-g-more-rows">
            {t('g_more', { k: list.rows.length })}
          </p>
        ) : null}
      </div>
      {open === null || form !== null ? null : (
        <GuestCard
          key={open}
          frame={frame}
          guestId={open}
          email={email}
          run={run}
          busy={busy}
          onBook={(guest) => setForm({ kind: 'new', day: frame.today, guest })}
          onChanged={reload}
          onClose={() => setOpen(null)}
        />
      )}
      {adding ? (
        <AddRegular
          frame={frame}
          run={run}
          busy={busy}
          onClose={() => setAdding(false)}
          onAdded={(guestId) => {
            setAdding(false)
            reload()
            if (guestId !== null) setOpen(guestId)
          }}
        />
      ) : null}
      {form === null ? null : (
        <BookingForm
          frame={frame}
          mode={form}
          run={run}
          busy={busy}
          onClose={() => setForm(null)}
          onSaved={() => {
            setForm(null)
            reload()
          }}
        />
      )}
      {pinSheet}
    </div>
  )
}
