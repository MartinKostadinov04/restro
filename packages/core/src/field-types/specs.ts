// The field-type registry contract without UI: one spec per field type. The web app adds
// `{ Display, Editor, DefinitionEditor }` keyed by the same `FieldType` union, so there is never a
// `switch (type)` over field types anywhere (CLAUDE.md "One field-type registry").

import { z } from 'zod'

import { canonicalJson, sha256Hex } from '../hash'
import { OK, reject, type Verdict } from '../result'
import {
  type ConstraintsOf,
  FIELD_CONSTRAINT_SCHEMAS,
  FIELD_VALUE_SCHEMAS,
  type FieldType,
  type FieldValueOf,
} from './catalog'

/**
 * The parts of a field definition a value check needs. Every `FieldDefinition` satisfies it;
 * kept structural so this module does not depend on the definition schema.
 */
export interface FieldRules {
  readonly type: FieldType
  readonly constraints: unknown
  readonly options?: readonly string[] | undefined
}

/** What every field type provides: value and constraint schemas, emptiness, hash, validation. */
export interface FieldTypeSpec<K extends FieldType = FieldType> {
  readonly type: K
  /** Zod schema of the canonical value. */
  readonly valueSchema: (typeof FIELD_VALUE_SCHEMAS)[K]
  /** Zod schema of the definition's `constraints` object for this type. */
  readonly constraintsSchema: (typeof FIELD_CONSTRAINT_SCHEMAS)[K]
  /** True if a (valid) value counts as "no value" for combinators and `required`. */
  isEmpty(value: FieldValueOf<K>): boolean
  /** Stable SHA-256 hex of a (valid) value; order-insensitive for sets. */
  hash(value: FieldValueOf<K>): string
  /** Check V1 (V2 for money): canonical shape, then the definition's constraints and options. */
  validate(value: unknown, definition: FieldRules): Verdict
}

interface SpecBehaviour<K extends FieldType> {
  /** Check code for a shape failure: V2 for money, V1 otherwise. */
  readonly shapeCode?: 'V1' | 'V2'
  readonly isEmpty?: (value: FieldValueOf<K>) => boolean
  /** Normal form before hashing (sets sorted); the identity when absent. */
  readonly normalize?: (value: FieldValueOf<K>) => unknown
  /** Constraint and option checks on a value of the right shape; returns a reason or null. */
  readonly check?: (
    value: FieldValueOf<K>,
    constraints: ConstraintsOf<K>,
    definition: FieldRules,
  ) => string | null
}

function codePoints(text: string): number {
  return [...text].length
}

function isBlank(text: string): boolean {
  return text.trim().length === 0
}

function sortedCopy<T extends string | number>(values: readonly T[]): T[] {
  return [...values].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
}

function issuesOf(error: z.ZodError): string {
  return z.prettifyError(error).replace(/\s*\n\s*/g, '; ')
}

function textTooLong(text: string, maxLength: number | undefined): string | null {
  if (maxLength !== undefined && codePoints(text) > maxLength) {
    return `longer than ${maxLength} characters`
  }
  return null
}

function notInOptions(values: readonly string[], definition: FieldRules): string | null {
  const options = definition.options
  if (options === undefined || options.length === 0) return 'the definition lists no options'
  const unknown = values.filter((value) => !options.includes(value))
  return unknown.length === 0 ? null : `not in the field's options: ${unknown.join(', ')}`
}

function defineSpec<K extends FieldType>(type: K, behaviour: SpecBehaviour<K>): FieldTypeSpec<K> {
  const valueSchema = FIELD_VALUE_SCHEMAS[type]
  const constraintsSchema = FIELD_CONSTRAINT_SCHEMAS[type]
  // TypeScript cannot narrow an indexed access on a generic key; these are the same schemas,
  // typed by their output for use inside this function.
  const parseValue = valueSchema as unknown as z.ZodType<FieldValueOf<K>>
  const parseConstraints = constraintsSchema as unknown as z.ZodType<ConstraintsOf<K>>
  const normalize = behaviour.normalize ?? ((value: FieldValueOf<K>) => value)
  return {
    type,
    valueSchema,
    constraintsSchema,
    isEmpty: behaviour.isEmpty ?? (() => false),
    hash: (value) => sha256Hex(canonicalJson(normalize(value))),
    validate(value, definition) {
      if (definition.type !== type) {
        return reject('V1', `a ${type} check was given a ${definition.type} definition`)
      }
      const constraints = parseConstraints.safeParse(definition.constraints)
      if (!constraints.success) {
        return reject('V1', `invalid ${type} constraints: ${issuesOf(constraints.error)}`)
      }
      const parsed = parseValue.safeParse(value)
      if (!parsed.success) {
        return reject(behaviour.shapeCode ?? 'V1', `not a valid ${type}: ${issuesOf(parsed.error)}`)
      }
      const problem = behaviour.check?.(parsed.data, constraints.data, definition) ?? null
      return problem === null ? OK : reject('V1', `${type} ${problem}`)
    },
  }
}

/**
 * The registry of field-type specs, keyed by every `FieldType`: adding a type to the vocabulary
 * without a spec here is a compile error.
 */
export const FIELD_TYPES: { readonly [K in FieldType]: FieldTypeSpec<K> } = {
  short_text: defineSpec('short_text', {
    isEmpty: isBlank,
    check: (value, c) => textTooLong(value, c.max_length),
  }),
  long_text: defineSpec('long_text', {
    isEmpty: isBlank,
    check: (value, c) => textTooLong(value, c.max_length),
  }),
  localized_text: defineSpec('localized_text', {
    isEmpty: (value) => Object.values(value).every((text) => text === undefined || isBlank(text)),
    check: (value, c) => {
      for (const text of Object.values(value)) {
        const problem = text === undefined ? null : textTooLong(text, c.max_length)
        if (problem !== null) return problem
      }
      return null
    },
  }),
  number: defineSpec('number', {
    check: (value, c) => {
      if (c.integer === true && !Number.isInteger(value)) return 'must be a whole number'
      if (c.min !== undefined && value < c.min) return `below the minimum ${c.min}`
      if (c.max !== undefined && value > c.max) return `above the maximum ${c.max}`
      return null
    },
  }),
  boolean: defineSpec('boolean', {}),
  date: defineSpec('date', {
    check: (value, c) => {
      if (c.min !== undefined && value < c.min) return `before ${c.min}`
      if (c.max !== undefined && value > c.max) return `after ${c.max}`
      return null
    },
  }),
  datetime: defineSpec('datetime', {}),
  money: defineSpec('money', {
    shapeCode: 'V2',
    check: (value, c) => {
      if (c.min_minor !== undefined && value.amount_minor < c.min_minor) {
        return `below the minimum ${c.min_minor} minor units`
      }
      if (c.max_minor !== undefined && value.amount_minor > c.max_minor) {
        return `above the maximum ${c.max_minor} minor units`
      }
      return null
    },
  }),
  measurement: defineSpec('measurement', {
    check: (value, c) =>
      c.units === undefined || c.units.includes(value.unit)
        ? null
        : `unit ${value.unit} is not allowed here (allowed: ${c.units.join(', ')})`,
  }),
  range: defineSpec('range', {}),
  tags: defineSpec('tags', {
    isEmpty: (value) => value.length === 0,
    normalize: (value) => sortedCopy(value),
    check: (value, c) =>
      c.max_items !== undefined && value.length > c.max_items
        ? `has more than ${c.max_items} tags`
        : null,
  }),
  enum: defineSpec('enum', {
    check: (value, _c, definition) => notInOptions([value], definition),
  }),
  enum_set: defineSpec('enum_set', {
    // An explicit empty set is a value ("contains none of these"), e.g. allergens (check V4).
    normalize: (value) => sortedCopy(value),
    check: (value, _c, definition) => notInOptions(value, definition),
  }),
  image: defineSpec('image', {}),
  file: defineSpec('file', {}),
  availability: defineSpec('availability', {
    isEmpty: (value) => value.rules.length === 0,
    // Rules form a set and so do their days: sort both so the hash ignores their order.
    normalize: (value) => ({
      timezone: value.timezone,
      rules: value.rules
        .map((rule) => ({ ...rule, days: sortedCopy(rule.days) }))
        .sort((a, b) => {
          const left = canonicalJson(a)
          const right = canonicalJson(b)
          return left < right ? -1 : left > right ? 1 : 0
        }),
    }),
  }),
  reference: defineSpec('reference', {}),
}
