'use client'

// A colour box: the browser's colour picker beside a text box for the hex code. The text is what
// the person typed (`#3366cc`, `3366CC` and `#36c` all work), so half a colour stays on screen
// and is marked, rather than snapping back. Used for the three colours, the brand colour and the
// roles set by hand.
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

import { normaliseHex } from './hex'

export function HexField({
  id,
  value,
  onChange,
  pickerLabel,
  fallback,
  disabled = false,
  invalid = false,
  describedBy,
  label,
  className,
  placeholder,
}: {
  id: string
  /** The text in the box. */
  value: string
  onChange: (text: string) => void
  /** The accessible name of the colour picker. */
  pickerLabel: string
  /** What the picker shows while the text is not a colour. */
  fallback: string
  disabled?: boolean
  invalid?: boolean
  describedBy?: string
  /** The accessible name of the text box, when no visible label points at it. */
  label?: string
  className?: string
  placeholder?: string
}) {
  return (
    <div className={cn('flex items-center gap-2', className)}>
      <input
        type="color"
        aria-label={pickerLabel}
        className="h-10 w-12 shrink-0 cursor-pointer rounded-md border bg-transparent p-1 disabled:cursor-not-allowed disabled:opacity-50"
        value={normaliseHex(value) ?? fallback}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
      />
      <Input
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        disabled={disabled}
        inputMode="text"
        autoComplete="off"
        spellCheck={false}
        maxLength={16}
        placeholder={placeholder}
        className="max-w-36 font-mono"
        aria-invalid={invalid}
        aria-label={label}
        aria-describedby={describedBy}
      />
    </div>
  )
}
