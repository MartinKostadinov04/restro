// The type vocabulary (doc "Type vocabulary and canonical value shapes"): one Zod schema per
// field type for its canonical value, and one for the constraints a field definition may set.
// Every collection path outputs exactly these shapes; adapters convert, the store never guesses.
// Shapes are strict: unknown keys are rejected, and optional parts are explicit (`null`, `{}`,
// `[]`) so that every value has exactly one representation and one hash.

import { z } from 'zod'

import { idSchema } from '../ids'
import { LocalizedTextSchema } from '../locales'
import { MoneySchema } from '../money'
import { NodeTypeSchema } from '../node-types'

/** The 17 field types, exactly the doc's type vocabulary. */
export const FIELD_TYPE_NAMES = [
  'short_text',
  'long_text',
  'localized_text',
  'number',
  'boolean',
  'date',
  'datetime',
  'money',
  'measurement',
  'range',
  'tags',
  'enum',
  'enum_set',
  'image',
  'file',
  'availability',
  'reference',
] as const

/** One of the 17 field types. */
export type FieldType = (typeof FIELD_TYPE_NAMES)[number]

/** Zod schema for a `FieldType`. */
export const FieldTypeSchema = z.enum(FIELD_TYPE_NAMES)

/** Units a `measurement` (and a `range`) may carry: a fixed list. */
export const MEASUREMENT_UNITS = ['g', 'kg', 'ml', 'l', 'cl', 'pcs'] as const

/** One of the measurement units. */
export type MeasurementUnit = (typeof MEASUREMENT_UNITS)[number]

const MeasurementUnitSchema = z.enum(MEASUREMENT_UNITS)

function hasNoDuplicates(values: readonly unknown[]): boolean {
  return new Set(values).size === values.length
}

function isTimeZone(value: string): boolean {
  if (!/^[A-Za-z][A-Za-z0-9_+-]*(?:\/[A-Za-z0-9_+-]+)*$/.test(value)) return false
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value })
    return true
  } catch {
    return false
  }
}

/** Wall-clock time `HH:MM`, 00:00–23:59. */
const ClockTimeSchema = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/, 'expected HH:MM')

/** One weekly window: ISO weekdays (1 = Monday … 7 = Sunday), `from`, `to`. */
const AvailabilityRuleSchema = z
  .strictObject({
    days: z.array(z.int().min(1).max(7)).min(1).refine(hasNoDuplicates, 'days must not repeat'),
    from: ClockTimeSchema,
    // `24:00` is allowed as an end only (end of day); `to` earlier than `from` = past midnight.
    to: z.union([ClockTimeSchema, z.literal('24:00')]),
  })
  .refine((rule) => rule.from !== rule.to, 'from and to must differ')

const ShortTextValue = z
  .string()
  .refine((text) => !/[\r\n]/.test(text), 'short text has no line breaks')

const RangeValue = z
  .strictObject({
    start: z.number(),
    end: z.number(),
    unit: MeasurementUnitSchema.nullable(),
    stops: z.array(z.number()),
  })
  .superRefine((range, ctx) => {
    if (range.start > range.end) {
      ctx.addIssue({ code: 'custom', message: 'start must not be after end', path: ['end'] })
    }
    range.stops.forEach((stop, index) => {
      const previous = index === 0 ? undefined : range.stops[index - 1]
      if (stop < range.start || stop > range.end) {
        ctx.addIssue({ code: 'custom', message: 'stop outside start..end', path: ['stops', index] })
      } else if (previous !== undefined && stop <= previous) {
        ctx.addIssue({ code: 'custom', message: 'stops must ascend', path: ['stops', index] })
      }
    })
  })

/** Canonical value schema per field type. */
export const FIELD_VALUE_SCHEMAS = {
  /** `"Negroni"`: one line of plain text. */
  short_text: ShortTextValue,
  /** `"Gin, Campari, vermouth"`: plain text, line breaks allowed. */
  long_text: z.string(),
  /** `{ bg_BG: "Негрони", en_US: "Negroni" }`: keys are barsy language keys. */
  localized_text: LocalizedTextSchema,
  /** `12.5`: a finite number; an optional unit label lives in the definition. */
  number: z.number(),
  /** `true` */
  boolean: z.boolean(),
  /** `"2026-12-31"`: a real calendar date. */
  date: z.iso.date(),
  /** `"2026-12-31T23:00:00+02:00"`: always with an offset (or `Z`), seconds required. */
  datetime: z.iso.datetime({ offset: true }),
  /** `{ amount_minor: 1250, currency: "EUR" }`: integer minor units, never a float (V2). */
  money: MoneySchema,
  /** `{ value: 250, unit: "ml" }`: a positive quantity in a unit from the fixed list. */
  measurement: z.strictObject({ value: z.number().positive(), unit: MeasurementUnitSchema }),
  /** `{ start: 0, end: 3, unit: null, stops: [1, 2] }`: start ≤ end, stops ascending inside. */
  range: RangeValue,
  /** `["signature", "new"]`: free, non-empty, distinct strings; order carries no meaning. */
  tags: z.array(z.string().min(1)).refine(hasNoDuplicates, 'tags must not repeat'),
  /** `"vegetarian"`: one value from the definition's `options`. */
  enum: z.string().min(1),
  /** `["gluten", "milk"]`: distinct values from the definition's `options`; `[]` is a value. */
  enum_set: z.array(z.string().min(1)).refine(hasNoDuplicates, 'values must not repeat'),
  /** `{ asset_id: "as_…", alt: {…}, focal: { x: 0.5, y: 0.4 } | null }`: never a URL. */
  image: z.strictObject({
    asset_id: idSchema('as'),
    alt: LocalizedTextSchema,
    focal: z.strictObject({ x: z.number().min(0).max(1), y: z.number().min(0).max(1) }).nullable(),
  }),
  /** `{ asset_id: "as_…", filename: "allergens.pdf", size: 182044 }`: size in bytes. */
  file: z.strictObject({
    asset_id: idSchema('as'),
    filename: z
      .string()
      .min(1)
      .max(255)
      .refine((name) => !/[/\\\p{Cc}]/u.test(name), 'filename must not contain paths'),
    size: z.int().nonnegative(),
  }),
  /** `{ timezone: "Europe/Sofia", rules: [{ days: [5, 6], from: "22:00", to: "04:00" }] }`. */
  availability: z.strictObject({
    timezone: z.string().refine(isTimeZone, 'expected an IANA time zone'),
    rules: z.array(AvailabilityRuleSchema),
  }),
  /** `{ node_id: "nd_…" }`: points at another node (Specials). */
  reference: z.strictObject({ node_id: idSchema('nd') }),
} as const satisfies { readonly [K in FieldType]: z.ZodType }

/** The canonical value of field type `K`. */
export type FieldValueOf<K extends FieldType> = z.output<(typeof FIELD_VALUE_SCHEMAS)[K]>

/** The canonical value of any field type. */
export type FieldValue = { [K in FieldType]: FieldValueOf<K> }[FieldType]

const NoConstraints = z.strictObject({})

const TextConstraints = z.strictObject({
  /** Maximum length in Unicode code points (per locale for `localized_text`). */
  max_length: z.int().positive().optional(),
})

const NumberConstraints = z
  .strictObject({
    min: z.number().optional(),
    max: z.number().optional(),
    integer: z.boolean().optional(),
  })
  .refine((c) => c.min === undefined || c.max === undefined || c.min <= c.max, 'min > max')

const MoneyConstraints = z
  .strictObject({
    min_minor: z.int().nonnegative().optional(),
    max_minor: z.int().nonnegative().optional(),
  })
  .refine(
    (c) => c.min_minor === undefined || c.max_minor === undefined || c.min_minor <= c.max_minor,
    'min_minor > max_minor',
  )

const DateConstraints = z
  .strictObject({ min: z.iso.date().optional(), max: z.iso.date().optional() })
  .refine((c) => c.min === undefined || c.max === undefined || c.min <= c.max, 'min > max')

const MeasurementConstraints = z.strictObject({
  /** The subset of units this field accepts. */
  units: z.array(MeasurementUnitSchema).min(1).refine(hasNoDuplicates).optional(),
})

const TagsConstraints = z.strictObject({ max_items: z.int().positive().optional() })

const ReferenceConstraints = z.strictObject({
  /** Node types the reference may point at (checked by `apply()`, which can see the target). */
  node_types: z.array(NodeTypeSchema).min(1).refine(hasNoDuplicates).optional(),
})

/** Schema of the `constraints` object a field definition of each type may carry. */
export const FIELD_CONSTRAINT_SCHEMAS = {
  short_text: TextConstraints,
  long_text: TextConstraints,
  localized_text: TextConstraints,
  number: NumberConstraints,
  boolean: NoConstraints,
  date: DateConstraints,
  datetime: NoConstraints,
  money: MoneyConstraints,
  measurement: MeasurementConstraints,
  range: NoConstraints,
  tags: TagsConstraints,
  enum: NoConstraints,
  enum_set: NoConstraints,
  image: NoConstraints,
  file: NoConstraints,
  availability: NoConstraints,
  reference: ReferenceConstraints,
} as const satisfies { readonly [K in FieldType]: z.ZodType }

/** The constraints object of field type `K`. */
export type ConstraintsOf<K extends FieldType> = z.output<(typeof FIELD_CONSTRAINT_SCHEMAS)[K]>
