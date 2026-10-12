// The face manifest (doc "The face contract"): what a face declares about itself, and
// `validateManifest()`, which a face must pass before it can be installed. It enforces
//   R6  allergens are always reachable: the slot is required and the face names how it shows them;
//   R7  the required slots (name, price, allergens, state) are declared required, never optional;
//   R9  names are never cut, and a description may be cut only where the reader can expand it;
//   R15 the guest features a face has controls for (`features`) and the options a venue may set
//       (`options`), each with a type, a default and a label, so the admin can build a form from it.
// A face that declares an optional required slot, or none at all, cannot be installed.

import { EXTENDED_ROLE_NAMES, MAX_PRESENTATION_OPTIONS, ROLE_NAMES } from '@restro/core'
import { z } from 'zod'

import { CHANNELS, IMAGE_VARIANTS, type ImageVariant, INTERACTIVE_CHANNELS } from './context'
import { PALETTE_STEPS } from './palette'

/** R7: slots every item must carry. A face cannot make them optional. */
export const REQUIRED_SLOTS = ['item.name', 'item.price', 'item.allergens', 'item.state'] as const

/** Slots a face may declare optional; an empty one collapses (R8). */
export const OPTIONAL_SLOTS = [
  'item.description',
  'item.image',
  'item.badges',
  'item.portion',
  'item.dietary',
  'item.tags',
  'item.extra_fields',
  'item.modifiers',
] as const

/** Every slot name a manifest may use. */
export const SLOT_NAMES = [...REQUIRED_SLOTS, ...OPTIONAL_SLOTS] as const

/** How a face makes allergens reachable (R6). */
export const ALLERGEN_MODES = [
  'inline_icons',
  'inline_codes',
  'numbered_legend',
  'info_link',
  'info_qr',
] as const

/** What a face does for an item without an image (R10). */
export const NO_IMAGE_LAYOUTS = ['text_only', 'placeholder', 'section_hint'] as const

/** Theme tokens a face may ask for (R13): palette steps, semantic colours and the rest. */
export const COLOUR_NAMES = [
  'background',
  'surface',
  'accent',
  'on_accent',
  'text',
  'muted',
  'accent_text',
  'border',
] as const

/** Every token name a manifest may list; the extended colours (D93) are tokens too. */
export const TOKEN_NAMES: readonly string[] = [
  ...PALETTE_STEPS.map((step) => `palette.${step}`),
  ...COLOUR_NAMES.map((name) => `color.${name}`),
  ...EXTENDED_ROLE_NAMES.map((name) => `color.${name}`),
  'font',
  'radius',
  'shadow',
  'logo',
]

/** Any colour role a face may name in a pair: the eight base roles and the ten of D93. */
export const PAIR_ROLE_NAMES = [...ROLE_NAMES, ...EXTENDED_ROLE_NAMES] as const

/**
 * One text-on-colour (or control-on-colour) pair a face draws (D93): `fg` sits on `bg`. The
 * contract test checks the pair in both schemes of every fixture's theme, at `min` (4.5:1 by
 * default: text; a face says 3 for a control's border or ring). A pair on an extended role is
 * skipped for a theme that has none (a snapshot from before D93).
 */
const ColourPairSchema = z.strictObject({
  fg: z.enum(PAIR_ROLE_NAMES),
  bg: z.enum(PAIR_ROLE_NAMES),
  min: z.number().min(1).max(21).optional(),
})

/** One pair a face declares. */
export type ColourPair = z.output<typeof ColourPairSchema>

/** The guest features a face can draw controls for (R15, D71). */
export const FEATURE_NAMES = ['filters', 'call_waiter', 'bill', 'ordering', 'pay'] as const

/** One guest feature. */
export type FeatureName = (typeof FEATURE_NAMES)[number]

/**
 * Where the admin lists an option: with the guest features (`feature`: a switch for something the
 * guest can use) or with the template's look (`look`: how the menu is laid out and dressed).
 */
export const OPTION_GROUPS = ['feature', 'look'] as const

/** An option key: camelCase, the same pattern core accepts in a published presentation. */
const OPTION_KEY = /^[a-z][A-Za-z0-9]{0,31}$/

/** An enum option's value: a short lower-case token, the same pattern core accepts. */
const OPTION_VALUE = /^[a-z0-9_-]{1,32}$/

const OptionLabelSchema = z.strictObject({
  bg: z.string().min(1).max(80),
  en: z.string().min(1).max(80),
})

const EnumOptionSchema = z.strictObject({
  type: z.literal('enum'),
  values: z
    .array(z.string().regex(OPTION_VALUE))
    .min(1)
    .max(8)
    .refine((values) => new Set(values).size === values.length, 'values must not repeat'),
  default: z.string(),
  group: z.enum(OPTION_GROUPS),
  label: OptionLabelSchema,
})

const BooleanOptionSchema = z.strictObject({
  type: z.literal('boolean'),
  default: z.boolean(),
  group: z.enum(OPTION_GROUPS),
  label: OptionLabelSchema,
})

/** One option a face lets the venue set. */
export const FaceOptionSchema = z.discriminatedUnion('type', [
  EnumOptionSchema,
  BooleanOptionSchema,
])

/** One option a face lets the venue set. */
export type FaceOption = z.output<typeof FaceOptionSchema>

const SlotOptionsSchema = z.strictObject({
  optional: z.literal(true),
  /** Lines shown before the text is cut (description). */
  lines: z.int().positive().optional(),
  /** `expand`: cut, and the guest can read the rest. `reflow`: never cut, the layout grows. */
  overflow: z.enum(['expand', 'reflow']).optional(),
  /** The image variant the slot is sized for (R10). */
  variant: z.enum(IMAGE_VARIANTS).optional(),
  /** Crop proportions, "4:3". */
  aspect: z
    .string()
    .regex(/^[1-9]\d{0,2}:[1-9]\d{0,2}$/)
    .optional(),
})

const PagingSchema = z.strictObject({
  mode: z.enum(['fixed_pages', 'rotating_pages']),
  /** Seconds a rotating page stays up. */
  interval_seconds: z.int().positive().optional(),
})

/** The shape of a face manifest. `validateManifest` adds the rules a shape cannot express. */
export const FaceManifestSchema = z.strictObject({
  face: z.string().regex(/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/, 'a kebab-case face name'),
  version: z.string().regex(/^\d+\.\d+\.\d+$/, 'a version like 1.3.0'),
  channels: z.array(z.enum(CHANNELS)).min(1),
  slots: z.partialRecord(
    z.enum(SLOT_NAMES),
    z.union([z.literal('required'), z.literal('optional'), SlotOptionsSchema]),
  ),
  allergen_mode: z.enum(ALLERGEN_MODES),
  no_image_layout: z.enum(NO_IMAGE_LAYOUTS),
  ordering: z.boolean(),
  /** Null = the face scrolls. */
  paging: PagingSchema.nullable(),
  tokens: z.array(z.enum(TOKEN_NAMES as [string, ...string[]])),
  /**
   * Every pair of colours the face puts one on the other (D93): the contract test holds each to
   * its contrast in both schemes of every fixture. A face that lists none is checked on the base
   * pairs the engine guarantees anyway, and the test says so.
   */
  colour_pairs: z.array(ColourPairSchema).default([]),
  /** The guest features this face has controls for (R15). A feature the face does not list is never offered. */
  features: z.array(z.enum(FEATURE_NAMES)).default([]),
  /** The options a venue may set, by key (camelCase). Core's presentation allows as many. */
  options: z
    .record(z.string().regex(OPTION_KEY), FaceOptionSchema)
    .refine(
      (options) => Object.keys(options).length <= MAX_PRESENTATION_OPTIONS,
      `at most ${MAX_PRESENTATION_OPTIONS} options`,
    )
    .default({}),
})

/** A face manifest. */
export type FaceManifest = z.output<typeof FaceManifestSchema>

/** One thing wrong with a manifest. */
export interface ManifestIssue {
  readonly code:
    | 'invalid_shape'
    | 'required_slot_missing'
    | 'required_slot_optional'
    | 'required_slot_has_options'
    | 'description_cut_without_expand'
    | 'ordering_without_interactive_channel'
    | 'paging_required'
    | 'paging_on_scrolling_channel'
    | 'duplicate_channel'
    | 'duplicate_token'
    | 'duplicate_feature'
    | 'ordering_feature_without_ordering'
    | 'option_default_not_allowed'
  readonly path: string
  readonly message: string
}

/** The outcome of validating a manifest. */
export type ManifestResult =
  | { readonly ok: true; readonly manifest: FaceManifest }
  | { readonly ok: false; readonly issues: readonly ManifestIssue[] }

function pathOf(path: readonly PropertyKey[]): string {
  return path.map(String).join('.') || '(manifest)'
}

/**
 * Checks a manifest against its shape, R6, R7 and R9. Never throws on bad data: the issues say
 * what to fix. A manifest with any issue cannot be installed.
 */
export function validateManifest(input: unknown): ManifestResult {
  const parsed = FaceManifestSchema.safeParse(input)
  if (!parsed.success) {
    return {
      ok: false,
      issues: parsed.error.issues.map((issue) => ({
        code: 'invalid_shape' as const,
        path: pathOf(issue.path),
        message: issue.message,
      })),
    }
  }
  const manifest = parsed.data
  const issues: ManifestIssue[] = []
  const add = (code: ManifestIssue['code'], path: string, message: string) =>
    issues.push({ code, path, message })

  // R7 (and R6 through `item.allergens`): the required slots are declared, and required.
  for (const slot of REQUIRED_SLOTS) {
    const declared = manifest.slots[slot]
    if (declared === undefined) {
      add('required_slot_missing', `slots.${slot}`, `${slot} is required (R6, R7): declare it`)
    } else if (declared !== 'required') {
      add(
        typeof declared === 'string' ? 'required_slot_optional' : 'required_slot_has_options',
        `slots.${slot}`,
        `${slot} must be exactly "required" (R7): a face that cannot render it cannot be installed`,
      )
    }
  }

  // R9: a description is cut only where the guest can expand it (qr, kiosk).
  const description = manifest.slots['item.description']
  const cutsDescription = typeof description === 'object' && description.overflow === 'expand'
  const onlyInteractive = manifest.channels.every((channel) =>
    INTERACTIVE_CHANNELS.includes(channel),
  )
  if (cutsDescription && !onlyInteractive) {
    add(
      'description_cut_without_expand',
      'slots.item.description.overflow',
      'a description may be cut only on qr and kiosk, where the guest can expand it (R9); use "reflow" for print and tv',
    )
  }

  // R11: ordering needs a channel a guest can touch.
  if (manifest.ordering && !manifest.channels.some((c) => INTERACTIVE_CHANNELS.includes(c))) {
    add(
      'ordering_without_interactive_channel',
      'ordering',
      'ordering needs qr or kiosk among the channels (R11)',
    )
  }

  // R9: print and tv reflow or paginate instead of cutting; qr and kiosk scroll.
  const fixedPages = manifest.channels.some((c) => !INTERACTIVE_CHANNELS.includes(c))
  if (fixedPages && manifest.paging === null) {
    add('paging_required', 'paging', 'print and tv faces page the menu: declare paging (R9)')
  }
  if (onlyInteractive && manifest.paging !== null) {
    add('paging_on_scrolling_channel', 'paging', 'qr and kiosk faces scroll: paging must be null')
  }

  if (new Set(manifest.channels).size !== manifest.channels.length) {
    add('duplicate_channel', 'channels', 'channels must not repeat')
  }
  if (new Set(manifest.tokens).size !== manifest.tokens.length) {
    add('duplicate_token', 'tokens', 'tokens must not repeat')
  }

  // R15: features are listed once, and a face that offers ordering controls orders.
  if (new Set(manifest.features).size !== manifest.features.length) {
    add('duplicate_feature', 'features', 'features must not repeat')
  }
  if (manifest.features.includes('ordering') && !manifest.ordering) {
    add(
      'ordering_feature_without_ordering',
      'features',
      'a face with the "ordering" feature must declare ordering: true (R11, R15)',
    )
  }

  // An enum option's default is one of its values, or resolveOptions could hand out a value the
  // admin never offers.
  for (const [key, option] of Object.entries(manifest.options)) {
    if (option.type === 'enum' && !option.values.includes(option.default)) {
      add(
        'option_default_not_allowed',
        `options.${key}.default`,
        `the default "${option.default}" is not one of the values of option ${key}`,
      )
    }
  }

  return issues.length === 0 ? { ok: true, manifest } : { ok: false, issues }
}

/**
 * The `images` part of a context for this face (R10): the item image at the variant its slot
 * declares (card unless it says otherwise) and the screen's pixel density.
 */
export function imageSlotsFor(
  manifest: FaceManifest,
  density: number,
): { item: { variant: ImageVariant; density: number } } {
  const slot = manifest.slots['item.image']
  const variant = typeof slot === 'object' && slot.variant !== undefined ? slot.variant : 'card'
  return { item: { variant, density } }
}

/**
 * The face's options with defaults: what the venue published, kept only where it is right. A key
 * the manifest does not declare is dropped; a value of the wrong type, or an enum value the
 * manifest does not list, is replaced by the option's default; a missing one is the default.
 * `raw` may be anything (it comes from a published file): it never throws.
 */
export function resolveOptions(
  manifest: FaceManifest,
  raw: unknown,
): Readonly<Record<string, string | boolean>> {
  const given =
    typeof raw === 'object' && raw !== null && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : {}
  const out: Record<string, string | boolean> = {}
  for (const [key, option] of Object.entries(manifest.options)) {
    const value = Object.hasOwn(given, key) ? given[key] : undefined
    if (option.type === 'enum') {
      out[key] = typeof value === 'string' && option.values.includes(value) ? value : option.default
    } else {
      out[key] = typeof value === 'boolean' ? value : option.default
    }
  }
  return out
}
