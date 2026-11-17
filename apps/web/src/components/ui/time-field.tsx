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
  /** What the arrow keys move by, in minutes. */
  stepMinutes?: number
}

/**
 * The one time field: always 24-hour, whatever the machine's locale. Type "22:00", "2230" or
 * "530" (= 05:30); the arrow keys step. The text is normalised to `HH:mm` when the field is left.
 * `className` goes on the wrapper (so a width such as `w-32` sizes the whole field).
 */
export function TimeField({
  value,
  onChange,
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
    }
  }, [value])

  const emit = (next: string) => {
    lastValue.current = next
    onChange(next)
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
          if (text.trim() === '') emit('')
          else {
            const parsed = parseTimeText(text, false)
            if (parsed !== null) emit(parsed)
          }
        }}
        onBlur={(event) => {
          if (draft !== null && draft.trim() !== '') {
            const parsed = parseTimeText(draft, true)
            if (parsed === null) setBlurredInvalid(true)
            else {
              if (parsed !== value) emit(parsed)
              setDraft(null)
            }
          } else setDraft(null)
          onBlur?.(event)
        }}
        onKeyDown={(event) => {
          onKeyDown?.(event)
          if (event.defaultPrevented) return
          if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return
          event.preventDefault()
          const base = parseTimeText(shown, true) ?? value
          emit(stepTime(base, event.key === 'ArrowUp' ? stepMinutes : -stepMinutes))
          setDraft(null)
          setBlurredInvalid(false)
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
