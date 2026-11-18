'use client'

import { useTranslations } from 'next-intl'
import * as React from 'react'

import { Input } from '@/components/ui/input'
import { parseTimeText, stepTime } from '@/lib/clock-date-text'
import { cn } from '@/lib/utils'

type TimeFieldProps = Omit<
  React.ComponentProps<'input'>,
  'value' | 'onChange' | 'type' | 'min' | 'max' | 'step'
> & {
  /** `HH:mm` (24-hour), or '' while empty. */
  value: string
  /** Called with `HH:mm` when the text is a valid time, and with '' when it is cleared. */
  onChange: (value: string) => void
  /**
   * Called whenever the field starts or stops holding text that is not a valid time, with the
   * field's id. While it is invalid `onChange` is not called, so the parent still holds the last
   * valid value: a form must refuse to submit (see `useFieldValidity`).
   */
  onValidityChange?: (invalid: boolean, id: string) => void
  /** What the arrow keys move by, in minutes. */
  stepMinutes?: number
}

/**
 * The one time field: always 24-hour, whatever the machine's locale. Type "22:00", "2230" or
 * "530" (= 05:30); the arrow keys step. Typed text is committed, and
 * normalised to `HH:mm`, only when the field is left or Enter is pressed; the arrow keys commit at once.
 * `className` goes on the wrapper (so a width such as `w-32` sizes the whole field).
 */
export function TimeField({
  value,
  onChange,
  onValidityChange,
  stepMinutes = 5,
  className,
  id,
  onBlur,
  onKeyDown,
  'aria-describedby': describedBy,
  'aria-invalid': ariaInvalid,
  ...props
}: TimeFieldProps) {
  const t = useTranslations('ui')
  const autoId = React.useId()
  const fieldId = id ?? autoId
  const errorId = `${fieldId}-time-error`
  const [draft, setDraft] = React.useState<string | null>(null)
  const [blurredInvalid, setBlurredInvalid] = React.useState(false)
  const lastValue = React.useRef(value)

  // A value changed from outside (a reset, another control) replaces whatever was being typed.
  React.useEffect(() => {
    if (value !== lastValue.current) {
      lastValue.current = value
      setDraft(null)
      setBlurredInvalid(false)
      validityRef.current(false)
    }
  }, [value])

  const emit = (next: string) => {
    lastValue.current = next
    onChange(next)
  }
  const reportValidity = (isInvalid: boolean) => onValidityChange?.(isInvalid, fieldId)
  const validityRef = React.useRef(reportValidity)
  validityRef.current = reportValidity

  // A field that goes away stops blocking its form.
  React.useEffect(() => () => validityRef.current(false), [])

  /** Commits the typed text: a valid value goes to the parent, anything else marks the field. */
  const commit = () => {
    if (draft === null) return
    if (draft.trim() === '') {
      if (value !== '') emit('')
      setDraft(null)
      reportValidity(false)
      return
    }
    const parsed = parseTimeText(draft, true)
    if (parsed === null) {
      setBlurredInvalid(true)
      reportValidity(true)
    } else {
      if (parsed !== value) emit(parsed)
      setDraft(null)
      reportValidity(false)
    }
  }

  const shown = draft ?? value
  const invalid = blurredInvalid || ariaInvalid === true || ariaInvalid === 'true'

  return (
    <div className={cn('min-w-0', className)}>
      <Input
        {...props}
        id={fieldId}
        type="text"
        inputMode="numeric"
        autoComplete="off"
        maxLength={5}
        placeholder={t('timeHint')}
        value={shown}
        aria-invalid={invalid ? true : undefined}
        aria-describedby={
          [blurredInvalid ? errorId : null, describedBy].filter(Boolean).join(' ') || undefined
        }
        onChange={(event) => {
          const text = event.target.value
          setDraft(text)
          setBlurredInvalid(false)
          reportValidity(text.trim() !== '' && parseTimeText(text, true) === null)
        }}
        onBlur={(event) => {
          commit()
          onBlur?.(event)
        }}
        onKeyDown={(event) => {
          onKeyDown?.(event)
          if (event.defaultPrevented) return
          if (event.key === 'Enter') {
            commit()
            return
          }
          if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return
          event.preventDefault()
          const base = parseTimeText(shown, true) ?? value
          emit(stepTime(base, event.key === 'ArrowUp' ? stepMinutes : -stepMinutes))
          setDraft(null)
          setBlurredInvalid(false)
          reportValidity(false)
        }}
      />
      {blurredInvalid ? (
        <p id={errorId} role="alert" className="mt-1 text-sm text-destructive">
          {t('timeInvalid')}
        </p>
      ) : null}
    </div>
  )
}
