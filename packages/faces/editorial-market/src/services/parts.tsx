// The small parts the service sheets share: the "Preview" marker, a panel for a state (waiting,
// done, failed) and the stepper.

import { SERVICE_LIMITS, type ServiceStrings } from '@restro/shell'
import type { ReactNode } from 'react'

/** The marker on every service sheet while the host's state is demo data (the admin's preview). */
export function PreviewMarker({
  show,
  words,
}: {
  readonly show: boolean
  readonly words: ServiceStrings
}) {
  return show ? (
    <p className="ro-preview" data-preview="true">
      {words.preview}
    </p>
  ) : null
}

/** How a state panel looks: waiting (a spinner), a pulse, done (a tick), failed (a mark) or plain (no mark). */
export type PanelTone = 'wait' | 'pulse' | 'ok' | 'bad' | 'plain'

/** A state of a service: a mark, a title, a hint and what the guest can do next. */
export function StatePanel({
  tone,
  title,
  hint,
  children,
}: {
  readonly tone: PanelTone
  readonly title: string
  readonly hint?: ReactNode
  readonly children?: ReactNode
}) {
  return (
    <div
      className="ro-state"
      role={tone === 'bad' ? 'alert' : 'status'}
      data-tone={tone}
      data-design-part="status"
    >
      {tone === 'wait' ? <span className="ro-spinner" aria-hidden="true" /> : null}
      {tone === 'pulse' ? <span className="ro-pulse" aria-hidden="true" /> : null}
      {tone === 'ok' ? (
        <span className="ro-check" aria-hidden="true">
          ✓
        </span>
      ) : null}
      {tone === 'bad' ? (
        <span className="ro-check is-bad" aria-hidden="true">
          !
        </span>
      ) : null}
      <h3>{title}</h3>
      {hint === undefined ? null : <p>{hint}</p>}
      {children}
    </div>
  )
}

/** A quantity stepper: "−", the number, "+". */
export function Stepper({
  value,
  onChange,
  label,
  words,
  min = 0,
  max = SERVICE_LIMITS.quantity,
  size = 'md',
  disabled = false,
}: {
  readonly value: number
  readonly onChange: (value: number) => void
  /** What is being counted, for a screen reader ("Hummus"). */
  readonly label: string
  readonly words: ServiceStrings
  readonly min?: number
  readonly max?: number
  readonly size?: 'sm' | 'md'
  /** Both buttons are off (the bag is with the host). */
  readonly disabled?: boolean
}) {
  return (
    <div className={`ro-stepper is-${size}`}>
      <button
        type="button"
        onClick={() => onChange(value - 1)}
        disabled={disabled || value <= min}
        aria-label={`${words.decrease}: ${label}`}
      >
        −
      </button>
      <output key={value} aria-live="polite">
        {value}
      </output>
      <button
        type="button"
        onClick={() => onChange(value + 1)}
        disabled={disabled || value >= max}
        aria-label={`${words.increase}: ${label}`}
      >
        +
      </button>
    </div>
  )
}
