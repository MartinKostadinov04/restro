// The third input of the shell (R14: snapshot, overlay, context, and nothing else). The caller
// builds it (language from URL, then browser, then the snapshot default; the venue's local time;
// the channel; the table token) and the shell only validates and reads it. It carries the clock
// as a value (`now`), so no rule ever asks for the time.

import { LocaleSchema } from '@restro/core'
import { z } from 'zod'

/** Where the menu is shown. Only `qr` is built in Stage 3 (D38). */
export const CHANNELS = ['qr', 'kiosk', 'print', 'tv'] as const

/** A channel. */
export type Channel = (typeof CHANNELS)[number]

/** Channels a guest can touch: they scroll, expand text and (later) order (R9, R11). */
export const INTERACTIVE_CHANNELS: readonly Channel[] = ['qr', 'kiosk']

/** The menu setting `sold_out_display` (R5). */
export const SOLD_OUT_DISPLAYS = ['show', 'hide'] as const

/** The three image sizes a snapshot carries per asset. */
export const IMAGE_VARIANTS = ['thumb', 'card', 'full'] as const

/** One image size. */
export type ImageVariant = (typeof IMAGE_VARIANTS)[number]

/** The venue time zone until a venue sets its own. */
export const DEFAULT_TIME_ZONE = 'Europe/Sofia'

function isTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value })
    return true
  } catch {
    return false
  }
}

/**
 * What a face declares for one image slot (R10): the variant it is designed for and the pixel
 * density of the screen. `density` 2 or more picks the next larger variant.
 */
export const ImageRequestSchema = z.strictObject({
  variant: z.enum(IMAGE_VARIANTS),
  density: z.number().min(1).max(4),
})

/** An image slot request. */
export type ImageRequest = z.output<typeof ImageRequestSchema>

const ImageSlotsSchema = z.strictObject({
  item: ImageRequestSchema.default({ variant: 'card', density: 1 }),
  section: ImageRequestSchema.default({ variant: 'card', density: 1 }),
  logo: ImageRequestSchema.default({ variant: 'thumb', density: 1 }),
})

/** The context of one view model. */
export const ShellContextSchema = z.strictObject({
  /** The requested language (R3); the menu default and any available follow. */
  locale: LocaleSchema,
  /** The current instant, ISO 8601 with an offset (R1 schedules). */
  now: z.iso.datetime({ offset: true }),
  /** The venue's time zone (Europe/Sofia unless the venue says otherwise). */
  timeZone: z.string().refine(isTimeZone, 'expected an IANA time zone').default(DEFAULT_TIME_ZONE),
  channel: z.enum(CHANNELS).default('qr'),
  /** The opaque table token from `/t/<token>`, or null. */
  tableToken: z.string().min(1).max(128).nullable().default(null),
  /** Whether ordering is switched on for the venue (false in Stage 3). */
  orderingEnabled: z.boolean().default(false),
  /** The menu setting `sold_out_display`, applied in R5. */
  soldOutDisplay: z.enum(SOLD_OUT_DISPLAYS).default('show'),
  /** The face's declared image slots (R10). */
  images: ImageSlotsSchema.prefault({}),
})

/** A validated context. */
export type ShellContext = z.output<typeof ShellContextSchema>

/** What callers pass: everything but `locale` and `now` has a default. */
export type ShellContextInput = z.input<typeof ShellContextSchema>

/** Validates and completes a context; throws a `ZodError` on a malformed one. */
export function parseContext(input: ShellContextInput): ShellContext {
  return ShellContextSchema.parse(input)
}
