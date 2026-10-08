// Templates as data (doc "Schema layer"): a versioned, JSON-serialisable tree of node types and
// their ordered field definitions. Layout is not part of the template: section membership and
// order are placements with sort keys. Template versions are immutable; a menu pins one.

import { z } from 'zod'

import { ALLERGENS, DIETARY_LABELS } from './allergens'
import { type FieldDefinition, FieldDefinitionSchema } from './field-definition'
import { LocalizedTextSchema } from './locales'
import { canNest, NODE_TYPE_SPECS, type NodeType, NodeTypeSchema } from './node-types'
import { type Parsed, reject } from './result'

/**
 * Field keys a template may not define: the resolver's computed fields (`orderable`, `price_from`,
 * `badges`, `conflicts`, `warnings` — never stored) and the snapshot's structural keys (`id`,
 * `sections`, `items`, `modifier_groups`, `options`, `fields`), which a field would collide with.
 */
export const RESERVED_FIELD_KEYS = [
  'orderable',
  'price_from',
  'badges',
  'conflicts',
  'warnings',
  'id',
  'sections',
  'items',
  'modifier_groups',
  'options',
  'fields',
] as const

/** Template keys are kebab-case, e.g. `venue-menu`. */
export const TEMPLATE_KEY_PATTERN = /^[a-z][a-z0-9-]{0,63}$/

/** Node types whose fields may use `required: 'when_orderable'` (only these can be ordered). */
const ORDERABLE_NODE_TYPES: readonly NodeType[] = ['item', 'option']

/** Fields whose codes must come from a fixed list, wherever a template defines them. */
const FIXED_OPTION_LISTS: Readonly<Record<string, readonly string[]>> = {
  allergens: ALLERGENS,
  dietary: DIETARY_LABELS,
}

const NodeTypeFieldsSchema = z.strictObject({ fields: z.array(FieldDefinitionSchema) })

const TemplateShape = z.strictObject({
  key: z.string().regex(TEMPLATE_KEY_PATTERN, 'template keys are kebab-case'),
  version: z.int().positive(),
  name: LocalizedTextSchema.refine(
    (name) => Object.keys(name).length > 0,
    'a name needs at least one language',
  ),
  nodeTypes: z.partialRecord(NodeTypeSchema, NodeTypeFieldsSchema),
})

/** True if some allowed parent of `child` is in the template and may hold it. */
function hasParentIn(nodeTypes: readonly NodeType[], child: NodeType): boolean {
  return NODE_TYPE_SPECS[child].allowedParents.some(
    (parent) => nodeTypes.includes(parent) && canNest(parent, child, parent === 'section' ? 2 : 1),
  )
}

/** Zod schema of a template, including uniqueness, reserved keys and structural coherence. */
export const TemplateSchema = TemplateShape.superRefine((template, ctx) => {
  const present = Object.keys(template.nodeTypes) as NodeType[]
  if (!present.includes('menu')) {
    ctx.addIssue({
      code: 'custom',
      message: 'a template needs the menu node type',
      path: ['nodeTypes'],
    })
  }
  for (const nodeType of present) {
    const path = ['nodeTypes', nodeType]
    if (nodeType !== 'menu' && nodeType !== 'item' && !hasParentIn(present, nodeType)) {
      ctx.addIssue({ code: 'custom', message: `${nodeType} has no possible parent`, path })
    }
    const fields = template.nodeTypes[nodeType]?.fields ?? []
    const seen = new Set<string>()
    fields.forEach((field, index) => {
      const fieldPath = [...path, 'fields', index]
      if (seen.has(field.key)) {
        ctx.addIssue({
          code: 'custom',
          message: `duplicate field key ${field.key}`,
          path: fieldPath,
        })
      }
      seen.add(field.key)
      if ((RESERVED_FIELD_KEYS as readonly string[]).includes(field.key)) {
        ctx.addIssue({ code: 'custom', message: `${field.key} is reserved`, path: fieldPath })
      }
      if (field.required === 'when_orderable' && !ORDERABLE_NODE_TYPES.includes(nodeType)) {
        ctx.addIssue({
          code: 'custom',
          message: `when_orderable applies to items and options only`,
          path: fieldPath,
        })
      }
      const fixed = FIXED_OPTION_LISTS[field.key]
      if (fixed !== undefined) {
        const outside = (field.options ?? []).filter((option) => !fixed.includes(option))
        if (field.type !== 'enum_set' || outside.length > 0) {
          ctx.addIssue({
            code: 'custom',
            message: `${field.key} must be an enum_set over the fixed list`,
            path: fieldPath,
          })
        }
      }
    })
  }
})

/** A parsed template. */
export type Template = z.output<typeof TemplateSchema>

/** Parses and validates a template from JSON data. */
export function parseTemplate(json: unknown): Parsed<Template> {
  const parsed = TemplateSchema.safeParse(json)
  if (parsed.success) return { ok: true, value: parsed.data }
  return reject('invalid_template', z.prettifyError(parsed.error))
}

/** The `key@version` reference of a template, e.g. `venue-menu@1`. */
export function templateRef(template: Pick<Template, 'key' | 'version'>): string {
  return `${template.key}@${template.version}`
}

/** The definition of `fieldKey` on `nodeType`, or undefined if the template has none. */
export function findField(
  template: Template,
  nodeType: NodeType,
  fieldKey: string,
): FieldDefinition | undefined {
  return template.nodeTypes[nodeType]?.fields.find((field) => field.key === fieldKey)
}
