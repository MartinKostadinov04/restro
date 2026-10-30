// Two shapes the snapshot carries beside the theme (brief SH-01 §8):
// - `presentation` (D69): which template (face) the venue chose and the face's options. Retired
//   by the design record (D129, migration 0044): no longer stored or published, kept so that a
//   snapshot published before it still parses;
// - `guest_features` (D71): which guest services the venue switched on, in `venues.settings`,
//   published as the snapshot's `features`.
//
// Core does not know which faces exist or which options each declares: the admin checks the face
// and its options against the template registry before it saves (SH-05a/b). Core only fixes the
// shapes, so nothing but short, plain tokens can reach a snapshot through them.
//
// A separate file from `settings.ts` because the snapshot schema imports these shapes and
// `settings.ts` imports the snapshot schema (the logo's asset id): one file would be a cycle.

import { z } from 'zod'

/** A face (template) name: kebab-case, the same pattern as the face manifest's `face`. */
export const FaceNameSchema = z
  .string()
  .max(64)
  .regex(/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/, 'a kebab-case face name')

/** An option key: camelCase, as a face manifest declares its options. */
const OptionKeySchema = z.string().regex(/^[a-z][A-Za-z0-9]{0,31}$/, 'a camelCase option key')

/** Shaped like one of our ids (`xx_` + 22 base62 characters); never an option value. */
const ID_SHAPED = /^[a-z]{2}_[0-9A-Za-z]{22}$/

/** An option value: a short lower-case token (never shaped like an id), or a switch. */
const OptionValueSchema = z.union([
  z
    .string()
    .regex(/^[a-z0-9_-]{1,32}$/, 'a short lower-case option value')
    .refine((value) => !ID_SHAPED.test(value), 'an option value must not look like an id'),
  z.boolean(),
])

/** The most options one presentation carries. */
export const MAX_PRESENTATION_OPTIONS = 16

/** The venue's template and its options (D69), as stored and as published. */
export const PresentationSchema = z.strictObject({
  face: FaceNameSchema,
  options: z
    .record(OptionKeySchema, OptionValueSchema)
    .refine(
      (options) => Object.keys(options).length <= MAX_PRESENTATION_OPTIONS,
      `at most ${MAX_PRESENTATION_OPTIONS} options`,
    ),
})

/** The venue's template and its options. */
export type Presentation = z.output<typeof PresentationSchema>

/**
 * What a guest can ask staff for (#180): a fixed list the venue ticks from. A venue's own list is
 * kept in this order; `waiter` is always in it while the feature is on.
 */
export const CALL_WAITER_KINDS = [
  'waiter',
  'bill',
  'ice',
  'water',
  'glasses',
  'clean_table',
  'terminal',
] as const

/** Kinds an earlier list had (the designer's six, #71): read and dropped, never a failed parse. */
const RETIRED_CALL_WAITER_KINDS = ['cutlery', 'other'] as const

/** What "Call a waiter" offers when a venue switches it on: every kind but the card terminal. */
export const DEFAULT_CALL_WAITER_KINDS: readonly CallWaiterKind[] = CALL_WAITER_KINDS.filter(
  (kind) => kind !== 'terminal',
)

/** A list without the kinds an earlier list had; anything that is not a list is left to the schema. */
function dropRetiredKinds(value: unknown): unknown {
  return Array.isArray(value)
    ? value.filter((kind) => !(RETIRED_CALL_WAITER_KINDS as readonly unknown[]).includes(kind))
    : value
}

/** One request kind. */
export type CallWaiterKind = (typeof CALL_WAITER_KINDS)[number]

/** True for a kind of the current list (not a dropped one). */
export function isCallWaiterKind(value: string): value is CallWaiterKind {
  return (CALL_WAITER_KINDS as readonly string[]).includes(value)
}

/** The guest services a venue can switch on (D71), as stored and as published. */
export const GuestFeaturesSchema = z.strictObject({
  /** The dietary and tag filters of the menu. */
  filters: z.boolean(),
  /** Calling staff to the table, with the request kinds offered. */
  call_waiter: z.strictObject({
    enabled: z.boolean(),
    // A stored or published list that still holds a dropped kind reads without it (#180). The
    // preprocess keeps the JSON Schema for faces (its output side) the plain list of kinds.
    kinds: z.preprocess(
      dropRetiredKinds,
      z
        .array(z.enum(CALL_WAITER_KINDS))
        .max(CALL_WAITER_KINDS.length)
        .refine((kinds) => new Set(kinds).size === kinds.length, 'request kinds must not repeat'),
    ),
  }),
  /** The table's running bill. */
  bill: z.boolean(),
  /** Ordering from the phone. */
  ordering: z.boolean(),
  /** Paying from the phone. */
  pay: z.boolean(),
})

/** The guest services a venue switched on. */
export type GuestFeatures = z.output<typeof GuestFeaturesSchema>

/** What a venue has until it chooses: filters on, every service off. */
export const DEFAULT_GUEST_FEATURES: GuestFeatures = Object.freeze({
  filters: true,
  call_waiter: Object.freeze({
    enabled: false,
    kinds: Object.freeze([]) as readonly CallWaiterKind[] as CallWaiterKind[],
  }),
  bill: false,
  ordering: false,
  pay: false,
})

/** The value of one key of `venues.settings`, or undefined. */
function settingOf(settings: unknown, key: string): unknown {
  if (typeof settings !== 'object' || settings === null || Array.isArray(settings)) return undefined
  return Object.hasOwn(settings, key) ? (settings as Record<string, unknown>)[key] : undefined
}

/**
 * The guest services of a venue (`venues.settings.guest_features`): the defaults when it has none
 * or the stored value is not valid (fail closed: every service off).
 */
export function readGuestFeatures(settings: unknown): GuestFeatures {
  const parsed = GuestFeaturesSchema.safeParse(settingOf(settings, 'guest_features'))
  return parsed.success ? canonicalFeatures(parsed.data) : DEFAULT_GUEST_FEATURES
}

/**
 * The features with the request kinds in the vocabulary's order (a set: order carries nothing),
 * and `waiter` among them while Call a waiter is on.
 */
export function canonicalFeatures(features: GuestFeatures): GuestFeatures {
  const present = new Set<CallWaiterKind>(features.call_waiter.kinds)
  if (features.call_waiter.enabled) present.add('waiter')
  return {
    ...features,
    call_waiter: {
      enabled: features.call_waiter.enabled,
      kinds: CALL_WAITER_KINDS.filter((kind) => present.has(kind)),
    },
  }
}
