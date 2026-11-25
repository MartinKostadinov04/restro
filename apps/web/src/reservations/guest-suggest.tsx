'use client'

// The booking form's name field, with the venue's regulars suggested under it (#333, D140;
// Patterns: "Suggest an existing record while typing"). Three letters list the regulars whose name
// or number holds them; a tap — or the arrow keys and Enter — fills the name and the phone, and
// both stay editable. Nothing is chosen for her: typing on simply keeps what she typed.
//
// It is the WAI-ARIA combobox with a list under the field (1.2 pattern): the field keeps the
// focus, the arrow keys move the highlighted option (`aria-activedescendant`), Enter takes it and
// Escape closes the list (WCAG 2.1.1). The list sits in the form's flow rather than floating, so a
// sheet that scrolls never clips it.
import { useTranslations } from 'next-intl'
import { useEffect, useId, useRef, useState } from 'react'

import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { guestSuggestAction } from '@/server/reservations/actions'

/** One regular the typed letters match. */
export interface GuestPick {
  readonly id: string
  readonly name: string | null
  readonly phone: string | null
}

/** How many characters before the list is asked for (the ticket: three letters). */
const SUGGEST_AFTER = 3
/** How long typing must pause before the list is read. */
const PAUSE_MS = 250

export function GuestNameField({
  id,
  venueId,
  value,
  invalid,
  describedBy,
  suggest,
  onChange,
  onPick,
}: {
  id: string
  venueId: string
  value: string
  invalid: boolean
  describedBy: string
  /** Suggest regulars at all (a new booking); off, it is a plain field. */
  suggest: boolean
  onChange: (value: string) => void
  onPick: (guest: GuestPick) => void
}) {
  const t = useTranslations('reservations')
  const listId = useId()
  const [options, setOptions] = useState<readonly GuestPick[]>([])
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(-1)
  // The name a pick filled in: it is not asked about again until she types something else.
  const picked = useRef<string | null>(null)
  // Only the newest question's answer is shown.
  const asked = useRef(0)

  const query = value.trim()
  useEffect(() => {
    if (!suggest || query.length < SUGGEST_AFTER || query === picked.current) {
      setOptions([])
      setOpen(false)
      return
    }
    const ask = ++asked.current
    const timer = window.setTimeout(() => {
      void guestSuggestAction({ venueId, query })
        .then((answer) => {
          if (ask !== asked.current) return
          const found = answer.ok ? answer.suggestions : []
          setOptions(found)
          setActive(-1)
          setOpen(found.length > 0)
        })
        .catch(() => undefined)
    }, PAUSE_MS)
    return () => window.clearTimeout(timer)
  }, [query, suggest, venueId])

  const take = (guest: GuestPick) => {
    picked.current = (guest.name ?? '').trim()
    setOpen(false)
    setOptions([])
    setActive(-1)
    onPick(guest)
  }

  const shown = open && options.length > 0
  const optionId = (index: number) => `${listId}-${index}`

  return (
    <div className="space-y-1">
      <Input
        id={id}
        value={value}
        autoComplete="off"
        maxLength={80}
        role={suggest ? 'combobox' : undefined}
        aria-autocomplete={suggest ? 'list' : undefined}
        aria-expanded={suggest ? shown : undefined}
        aria-controls={suggest ? listId : undefined}
        aria-activedescendant={shown && active >= 0 ? optionId(active) : undefined}
        aria-invalid={invalid}
        aria-describedby={describedBy}
        data-testid="rv-f-name"
        onChange={(event) => {
          picked.current = null
          onChange(event.target.value)
        }}
        onBlur={() => setOpen(false)}
        onKeyDown={(event) => {
          if (!shown) {
            if (event.key === 'ArrowDown' && options.length > 0) {
              event.preventDefault()
              setOpen(true)
              setActive(0)
            }
            return
          }
          if (event.key === 'ArrowDown') {
            event.preventDefault()
            setActive((at) => (at + 1) % options.length)
          } else if (event.key === 'ArrowUp') {
            event.preventDefault()
            setActive((at) => (at <= 0 ? options.length - 1 : at - 1))
          } else if (event.key === 'Enter' && active >= 0) {
            event.preventDefault()
            const guest = options[active]
            if (guest !== undefined) take(guest)
          } else if (event.key === 'Escape') {
            event.preventDefault()
            event.stopPropagation()
            setOpen(false)
          }
        }}
      />
      {suggest ? (
        <div
          id={listId}
          role="listbox"
          aria-label={t('g_suggest')}
          hidden={!shown}
          className="divide-y rounded-md border"
          data-testid="rv-f-suggest"
        >
          {options.map((guest, index) => (
            <div
              key={guest.id}
              id={optionId(index)}
              role="option"
              tabIndex={-1}
              aria-selected={index === active}
              className={cn(
                'flex min-h-11 cursor-pointer flex-wrap items-center gap-x-2 px-3 py-2',
                index === active && 'bg-accent text-accent-foreground',
              )}
              data-testid="rv-f-suggest-option"
              // The field keeps the focus: a tap picks without blurring it first.
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => take(guest)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault()
                  take(guest)
                }
              }}
            >
              <span className="font-medium [overflow-wrap:anywhere]">
                {guest.name ?? t('no_name')}
              </span>
              {guest.phone === null ? null : (
                <span className="text-muted-foreground tabular-nums">{guest.phone}</span>
              )}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  )
}
