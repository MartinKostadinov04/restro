'use client'

// The day button of the Log and the end of the night (Log plan §3): "Tonight" or the chosen date
// on an outline button that opens a list of nights; a night with nothing in it is greyed. The
// choice is the page's `day` parameter, so a link or a reload keeps it.
import { CalendarIcon } from 'lucide-react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useLocale, useTranslations } from 'next-intl'

import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

/** The nights listed even when they hold nothing (they are greyed): a month back from today. */
const LISTED_NIGHTS = 31

function shift(day: string, back: number): string {
  const date = new Date(`${day}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() - back)
  return date.toISOString().slice(0, 10)
}

/** `Mon, 26 October` / `пн, 26 октомври` for a service day. */
export function useDayText() {
  const locale = useLocale()
  const format = new Intl.DateTimeFormat(locale === 'bg' ? 'bg-BG' : 'en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'long',
    timeZone: 'UTC',
  })
  return (day: string) => format.format(new Date(`${day}T00:00:00Z`))
}

/** `26 October` / `26 октомври`, without the weekday. */
export function useDateText() {
  const locale = useLocale()
  const format = new Intl.DateTimeFormat(locale === 'bg' ? 'bg-BG' : 'en-GB', {
    day: 'numeric',
    month: 'long',
    timeZone: 'UTC',
  })
  return (day: string) => format.format(new Date(`${day}T00:00:00Z`))
}

export function DayPicker({
  day,
  today,
  days,
}: {
  /** The night shown. */
  day: string
  /** The venue's current service day. */
  today: string
  /** Nights with something in them. */
  days: readonly string[]
}) {
  const t = useTranslations('tonight')
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()
  const text = useDayText()
  const has = new Set(days)
  const listed = [
    ...new Set([
      ...Array.from({ length: LISTED_NIGHTS }, (_, back) => shift(today, back)),
      ...days.filter((d) => d <= today),
    ]),
  ].sort((a, b) => (a < b ? 1 : a > b ? -1 : 0))

  function pick(next: string) {
    const query = new URLSearchParams(params.toString())
    if (next === today) query.delete('day')
    else query.set('day', next)
    router.replace(`${pathname}?${query.toString()}`, { scroll: false })
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="outline"
          className="h-11"
          aria-label={t('day_pick')}
          data-testid="day-button"
        >
          <CalendarIcon aria-hidden />
          {day === today ? t('lg_tonight') : text(day)}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="max-h-80 overflow-y-auto">
        {listed.map((night) => (
          <DropdownMenuItem
            key={night}
            className="min-h-11"
            disabled={night !== today && !has.has(night)}
            data-testid={`day-${night}`}
            onSelect={() => pick(night)}
          >
            {night === today ? t('lg_tonight') : text(night)}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
