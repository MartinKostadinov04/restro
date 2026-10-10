'use client'

// date, datetime and availability: shown here, edited in Stage 2.
import { useTranslations } from 'next-intl'

import { Badge } from '@/components/ui/badge'

import { ComingSoonEditor } from '../coming-soon'
import { bcp47, useFieldEnvironment } from '../environment'
import type { DisplayProps, FieldUi } from '../types'

// --- date -----------------------------------------------------------------------------------

function DateDisplay({ value }: DisplayProps<'date'>) {
  const environment = useFieldEnvironment()
  // `YYYY-MM-DD` is a calendar day, not an instant: format it as UTC so no time zone shifts it.
  const text = new Intl.DateTimeFormat(bcp47(environment), {
    dateStyle: 'long',
    timeZone: 'UTC',
  }).format(new Date(`${value}T00:00:00Z`))
  return (
    <time dateTime={value} className="text-foreground">
      {text}
    </time>
  )
}

export const date = { Display: DateDisplay, Editor: ComingSoonEditor } satisfies FieldUi<'date'>

// --- datetime -------------------------------------------------------------------------------

function DatetimeDisplay({ value }: DisplayProps<'datetime'>) {
  const environment = useFieldEnvironment()
  // Always the venue's time zone (CLAUDE.md "Time"), never the browser's.
  const text = new Intl.DateTimeFormat(bcp47(environment), {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: environment.timezone,
  }).format(new Date(value))
  return (
    <time dateTime={value} className="text-foreground">
      {text}
    </time>
  )
}

export const datetime = {
  Display: DatetimeDisplay,
  Editor: ComingSoonEditor,
} satisfies FieldUi<'datetime'>

// --- availability ---------------------------------------------------------------------------

function AvailabilityDisplay({ value }: DisplayProps<'availability'>) {
  const t = useTranslations('fields.availability')
  const environment = useFieldEnvironment()
  const weekday = new Intl.DateTimeFormat(bcp47(environment), { weekday: 'short', timeZone: 'UTC' })
  // 2024-01-01 was a Monday, so ISO weekday n (1 = Monday) is January n.
  const dayName = (day: number) => weekday.format(new Date(Date.UTC(2024, 0, day)))

  if (value.rules.length === 0) return <span className="text-muted-foreground">{t('always')}</span>
  return (
    <div className="grid gap-1.5">
      <ul className="grid gap-1">
        {value.rules.map((rule) => (
          <li
            key={`${rule.days.join('')}-${rule.from}-${rule.to}`}
            className="flex flex-wrap items-center gap-x-2 gap-y-1"
          >
            <span className="text-foreground">{rule.days.map(dayName).join(', ')}</span>
            <span className="text-foreground tabular-nums">
              {rule.from}–{rule.to}
            </span>
            {rule.to < rule.from ? <Badge variant="outline">{t('nextDay')}</Badge> : null}
          </li>
        ))}
      </ul>
      <p className="text-xs text-muted-foreground">{value.timezone}</p>
    </div>
  )
}

export const availability = {
  Display: AvailabilityDisplay,
  Editor: ComingSoonEditor,
} satisfies FieldUi<'availability'>
