'use client'

// The search above a list (sent-orders plan §3: "the list's own filter, as the composer's item
// search"): filters as you type, no Search button; takes focus when the tab opens on a tablet (not
// on a phone, where the keyboard would cover the list).
import { SearchIcon } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import { Input } from '@/components/ui/input'

/** The wide screens that keep the keyboard out of the way: tablets and desktops. */
const FOCUS_MIN_WIDTH = 768

/** `value`, but only once it has stood still for `ms`. */
export function useDebounced<T>(value: T, ms: number): T {
  const [settled, setSettled] = useState(value)
  useEffect(() => {
    const timer = window.setTimeout(() => setSettled(value), ms)
    return () => window.clearTimeout(timer)
  }, [value, ms])
  return settled
}

export function SearchField({
  value,
  onChange,
  label,
}: {
  value: string
  onChange: (value: string) => void
  label: string
}) {
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (window.innerWidth >= FOCUS_MIN_WIDTH) ref.current?.focus()
  }, [])
  return (
    <div className="relative min-w-0 flex-1">
      <SearchIcon
        aria-hidden
        className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
      />
      <Input
        ref={ref}
        type="search"
        data-testid="tonight-search"
        className="h-11 pl-9"
        value={value}
        maxLength={60}
        placeholder={label}
        aria-label={label}
        autoComplete="off"
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  )
}
