// Field definitions (doc "Field definition"): a typed slot on a node type. A definition is data,
// so tenants can extend their copy of a template. `owner`, `overridable`, `combinator` and
// `critical` drive resolution (doc "Layers, ownership and resolution").

import { z } from 'zod'

import {
  type ConstraintsOf,
  FIELD_CONSTRAINT_SCHEMAS,
  type FieldType,
  FieldTypeSchema,
} from './field-types/catalog'
import { FIELD_TYPES } from './field-types/specs'
import { LocalizedTextSchema } from './locales'

/** Who owns a field: barsy (the till) or the builder (the venue, in our editor). */
export const OWNERS = ['barsy', 'builder'] as const
/** Owner of a field. */
export type Owner = (typeof OWNERS)[number]

/**
 * Whether an `override` may replace the source value. `never_when_orderable` allows overrides
 * only on display-only nodes (not orderable); write validation cannot see orderability yet and
 * so treats it as `never`.
 */
export const OVERRIDABLE = ['never', 'never_when_orderable', 'always'] as const
/** Overridability of a field. */
export type Overridable = (typeof OVERRIDABLE)[number]

/**
 * How layers combine (doc "Combinators"): `source_first` override → barsy → manual → import →
 * default; `builder_first` manual → import → barsy → default; `locked` barsy only (on an orderable
 * item); `all_true` every layer with a value must say true; `union` the set of all values;
 * `must_agree` disagreeing layers are a conflict a person resolves.
 */
export const COMBINATORS = [
  'source_first',
  'builder_first',
  'locked',
  'all_true',
  'union',
  'must_agree',
] as const
/** Combinator of a field. */
export type Combinator = (typeof COMBINATORS)[number]

/** `internal` keeps a field out of every snapshot. */
export const VISIBILITIES = ['public', 'internal'] as const
/** Visibility of a field. */
export type Visibility = (typeof VISIBILITIES)[number]

/** What happens when barsy changes after an override: open a review, keep it, or drop it. */
export const STALE_POLICIES = ['review', 'keep', 'drop'] as const
/** Stale-override policy of a field. */
export type StalePolicy = (typeof STALE_POLICIES)[number]

/** Field keys are snake_case, start with a letter, at most 64 characters. */
export const FIELD_KEY_PATTERN = /^[a-z][a-z0-9_]{0,63}$/

/** Enum option codes are snake_case like the allergen codes. */
const OPTION_PATTERN = /^[a-z][a-z0-9_]{0,63}$/

const FieldDefinitionShape = z.strictObject({
  key: z.string().regex(FIELD_KEY_PATTERN, 'field keys are snake_case'),
  type: FieldTypeSchema,
  label: LocalizedTextSchema.refine(
    (label) => Object.keys(label).length > 0,
    'a label needs at least one language',
  ),
  /** `true`, `false`, or required only while the item is orderable (price). */
  required: z.union([z.boolean(), z.literal('when_orderable')]),
  /** True exactly for `localized_text` fields (one value per locale). */
  localizable: z.boolean(),
  /** Per-type constraints, checked against the type's constraints schema. */
  constraints: z.record(z.string(), z.json()),
  owner: z.enum(OWNERS),
  overridable: z.enum(OVERRIDABLE),
  combinator: z.enum(COMBINATORS),
  visibility: z.enum(VISIBILITIES),
  /** True if a failing value leaves the node out of the snapshot; false = warning only. */
  critical: z.boolean(),
  stalePolicy: z.enum(STALE_POLICIES),
  /** The allowed codes, for `enum` and `enum_set` only. */
  options: z.array(z.string().regex(OPTION_PATTERN, 'option codes are snake_case')).optional(),
  /** Display unit label for `number` only, e.g. `%`. */
  unit: z.string().min(1).max(16).optional(),
  /** The schema-default value (lowest layer of the stack); must be a valid value of the type. */
  default: z.json().optional(),
})

type FieldDefinitionShape = z.output<typeof FieldDefinitionShape>

const SET_TYPES: readonly FieldType[] = ['tags', 'enum_set']

/** Every way a parsed definition breaks the cross-field rules; empty when it is consistent. */
function definitionIssues(def: FieldDefinitionShape): { path: string; message: string }[] {
  const issues: { path: string; message: string }[] = []
  const add = (path: string, message: string) => issues.push({ path, message })

  const constraints = FIELD_CONSTRAINT_SCHEMAS[def.type].safeParse(def.constraints)
  if (!constraints.success) {
    add('constraints', `invalid ${def.type} constraints: ${z.prettifyError(constraints.error)}`)
  }

  const takesOptions = def.type === 'enum' || def.type === 'enum_set'
  if (takesOptions && (def.options === undefined || def.options.length === 0)) {
    add('options', `${def.type} fields need a non-empty options list`)
  }
  if (!takesOptions && def.options !== undefined) add('options', 'only enum fields take options')
  if (def.options !== undefined && new Set(def.options).size !== def.options.length) {
    add('options', 'options must not repeat')
  }
  if (def.unit !== undefined && def.type !== 'number') add('unit', 'only number fields take a unit')
  if (def.localizable !== (def.type === 'localized_text')) {
    add('localizable', 'localizable is true exactly for localized_text fields')
  }

  if (def.combinator === 'all_true' && def.type !== 'boolean') {
    add('combinator', 'all_true combines boolean fields only')
  }
  if (def.combinator === 'union' && !SET_TYPES.includes(def.type)) {
    add('combinator', 'union combines tags and enum_set fields only')
  }
  if (def.combinator === 'locked' && def.owner !== 'barsy') {
    add('combinator', 'a locked field is owned by barsy')
  }
  if (def.combinator === 'locked' && def.overridable === 'always') {
    add('overridable', 'a locked field refuses overrides on orderable items')
  }
  if (def.combinator === 'source_first' && def.owner !== 'barsy') {
    add('combinator', 'source_first is for barsy-owned fields')
  }
  if (def.combinator === 'builder_first' && def.owner !== 'builder') {
    add('combinator', 'builder_first is for builder-owned fields')
  }
  if (def.owner === 'builder' && def.overridable !== 'never') {
    add('overridable', 'overrides replace source-owned values; builder-owned fields use never')
  }

  if (def.default !== undefined && constraints.success) {
    const verdict = FIELD_TYPES[def.type].validate(def.default, def)
    if (!verdict.ok) add('default', `invalid default: ${verdict.reason}`)
  }
  return issues
}

/** Zod schema of a field definition, including the cross-field consistency rules. */
export const FieldDefinitionSchema = FieldDefinitionShape.superRefine((def, ctx) => {
  for (const issue of definitionIssues(def)) {
    ctx.addIssue({ code: 'custom', message: issue.message, path: [issue.path] })
  }
})

/** A field definition. */
export type FieldDefinition = z.output<typeof FieldDefinitionSchema>

/** A field definition narrowed to field type `K`, with that type's constraints. */
export type FieldDefinitionOf<K extends FieldType> = Omit<
  FieldDefinition,
  'type' | 'constraints'
> & {
  readonly type: K
  readonly constraints: ConstraintsOf<K>
}
