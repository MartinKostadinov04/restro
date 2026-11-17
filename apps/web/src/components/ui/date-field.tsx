'use client'

import { CalendarDays } from 'lucide-react'
import { useTranslations } from 'next-intl'
import * as React from 'react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { formatDateText, parseDateText, stepDate } from '@/lib/clock-date-text'
import { cn } from '@/lib/utils'

type DateFieldProps = Omit<
  React.ComponentProps<'input'>,
  'value' | 'onChange' | 'type' | 'step' | 'min' | 'max'
> & {
  /** `yyyy-MM-dd`, or '' while empty. */
  value: string
  /** Called with `yyyy-MM-dd` when the text is a real date, and with '' when it is cleared. */
  onChange: (value: string) => void
  /** Earliest / latest day the calendar button offers (`yyyy-MM-dd`). */
  min?: string
  max?: string
}

/**
 * The one date field: shows "10.11.2026" whatever the machine's locale. Type "10.11.2026" or
 * "10112026"; the arrow keys move by a day; the calendar button opens the browser's own picker.
 * `className` goes on the wrapper.
 */
export function DateField({
  value,
  onChange,
  min,
  max,
  className,
  id,
  disabled,
  onBlur,
  onKeyDown,
  'aria-describedby': describedBy,
  'aria-invalid': ariaInvalid,
  ...props
}: DateFieldProps) {
  const t = useTranslations('ui')
  const autoId = React.useId()
  const fieldId = id ?? autoId
  const errorId = `${fieldId}-date-error`
  const picker = React.useRef<HTMLInputElement>(null)
  const [draft, setDraft] = React.useState<string | null>(null)
  const [blurredInvalid, setBlurredInvalid] = React.useState(false)
  const lastValue = React.useRef(value)

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

  const shown = draft ?? formatDateText(value)
  const invalid = blurredInvalid || ariaInvalid === true || ariaInvalid === 'true'

  return (
    <div className={cn('relative min-w-0', className)}>
      <div className="flex items-center gap-1">
        <Input
          {...props}
          id={fieldId}
          type="text"
          inputMode="numeric"
          autoComplete="off"
          maxLength={10}
          placeholder={t('dateHint')}
          disabled={disabled}
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
              const parsed = parseDateText(text)
              if (parsed !== null && parsed !== value) emit(parsed)
            }
          }}
          onBlur={(event) => {
            if (draft !== null && draft.trim() !== '') {
              const parsed = parseDateText(draft)
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
            const base = parseDateText(shown) ?? (value === '' ? (min ?? max ?? '') : value)
            if (base === '') return
            emit(parseDateText(shown) === null && value === '' ? base : stepDate(base, event.key === 'ArrowUp' ? 1 : -1))
            setDraft(null)
            setBlurredInvalid(false)
          }}
        />
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="size-9 shrink-0 phone:size-11"
          aria-label={t('pickDate')}
          disabled={disabled}
          onClick={() => picker.current?.showPicker?.()}
        >
          <CalendarDays aria-hidden />
        </Button>
      </div>
      <input
        ref={picker}
        type="date"
        tabIndex={-1}
        aria-hidden
        value={value}
        min={min}
        max={max}
        className="pointer-events-none absolute right-0 bottom-0 size-px opacity-0"
        onChange={(event) => {
          if (event.target.value !== '') {
            setDraft(null)
            setBlurredInvalid(false)
            emit(event.target.value)
          }
        }}
      />
      {blurredInvalid ? (
        <p id={errorId} role="alert" className="mt-1 text-sm text-destructive">
          {t('dateInvalid')}
        </p>
      ) : null}
    </div>
  )
}
