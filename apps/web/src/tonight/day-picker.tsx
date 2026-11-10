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

/**
 * The nights the button offers: today first, then the nights ahead (bookings are taken for them,
 * so they lead), then back from today, and every night that holds something whenever it falls.
 * `ahead` is 0 for the Log and the end of the night, which only ever look back.
 */
export function listedNights(today: string, days: readonly string[], ahead: number): string[] {
  const back = Array.from({ length: LISTED_NIGHTS }, (_, n) => shift(today, n + 1))
  const forward = Array.from({ length: ahead }, (_, n) => shift(today, -(n + 1)))
  const held = ahead === 0 ? days.filter((day) => day <= today) : days
  const past = [...new Set([...back, ...held.filter((day) => day < today)])].sort((a, b) =>
    a < b ? 1 : a > b ? -1 : 0,
  )
  const next = [...new Set([...forward, ...held.filter((day) => day > today)])].sort((a, b) =>
    a < b ? -1 : a > b ? 1 : 0,
  )
  return [today, ...next, ...past]
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
  ahead = 0,
  label,
  anyDate = false,
  onPick,
}: {
  /** The night shown. */
  day: string
  /** The venue's current service day. */
  today: string
  /** Nights with something in them. */
  days: readonly string[]
  /**
   * How many nights ahead to offer (#326): the Log and the end of the night look back only, so
   * nothing changes for them; the reservations list takes bookings for the nights to come.
   */
  ahead?: number
  /** The button's own word for today, for a screen whose "tonight" is not the Log's. */
  label?: string
  /**
   * A date field beside the button (#326): a night ahead has no limit, and a club takes a booking
   * for New Year in October. Off for the Log and the end of the night, which only look back.
   */
  anyDate?: boolean
  /**
   * Where the chosen night goes. By default into the page's `day` parameter, so a link and a
   * reload keep it; a screen that must open on today every time (#326) keeps it itself instead.
   */
  onPick?: (day: string) => void
}) {
  const t = useTranslations('tonight')
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()
  const text = useDayText()
  const has = new Set(days)
  const listed = listedNights(today, days, ahead)
  const todayText = label ?? t('lg_tonight')
  // A night with nothing in it is greyed, because there is nothing to read there. A night still to
  // come is not: that is where a booking is taken, so it opens whether it holds anything or not.
  const pickable = (night: string) =>
    night === today || has.has(night) || (ahead > 0 && night > today)

  function pick(next: string) {
    if (onPick !== undefined) {
      onPick(next)
      return
    }
    const query = new URLSearchParams(params.toString())
    if (next === today) query.delete('day')
    else query.set('day', next)
    router.replace(`${pathname}?${query.toString()}`, { scroll: false })
  }

  const button = (
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
          {day === today ? todayText : text(day)}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="max-h-80 overflow-y-auto">
        {listed.map((night) => (
          <DropdownMenuItem
            key={night}
            className="min-h-11"
            disabled={!pickable(night)}
            data-testid={`day-${night}`}
            onSelect={() => pick(night)}
          >
            {night === today ? todayText : text(night)}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
  // The list covers the nights around today; the field reaches any other one, keyboard and all.
  if (!anyDate) return button
  return (
    <div className="flex flex-wrap items-center gap-2">
      {button}
      <input
        type="date"
        className="h-11 min-w-0 rounded-md border bg-background px-3 text-base"
        value={day}
        aria-label={t('day_any')}
        data-testid="day-any"
        onChange={(event) => {
          if (event.target.value !== '') pick(event.target.value)
        }}
      />
    </div>
  )
}
