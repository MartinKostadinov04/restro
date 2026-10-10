// The face manifest (doc "The face contract"): what a face declares about itself, and
// `validateManifest()`, which a face must pass before it can be installed. It enforces
//   R6  allergens are always reachable: the slot is required and the face names how it shows them;
//   R7  the required slots (name, price, allergens, state) are declared required, never optional;
//   R9  names are never cut, and a description may be cut only where the reader can expand it.
// A face that declares an optional required slot, or none at all, cannot be installed.

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

/** Every token name a manifest may list. */
export const TOKEN_NAMES: readonly string[] = [
  ...PALETTE_STEPS.map((step) => `palette.${step}`),
  ...COLOUR_NAMES.map((name) => `color.${name}`),
  'font',
  'radius',
  'shadow',
  'logo',
]

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
