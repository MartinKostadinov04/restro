// Write-level validation (doc "Validation and quality gates": V1, V2) plus the ownership rules a
// single write can be checked against without the database. `apply()` (Stage 2) runs this on
// every field write; a rejected write is stored with its reason and never replaces a good value.

import { type FieldWrite, isEditionLayer, type Layer } from './change-set'
import type { FieldDefinition } from './field-definition'
import { FIELD_TYPES } from './field-types/specs'
import type { NodeType } from './node-types'
import { OK, reject, type Verdict } from './result'
import { findField, type Template } from './template'

/**
 * Whether `layer` may hold a value for this field, from the definition alone (ownership matrix):
 * - a `locked` field (price) accepts only the `barsy` layer;
 * - the `override` layer needs a barsy-owned field with `overridable: 'always'` (a
 *   `never_when_orderable` field is treated as `never`: orderability is unknown at write time);
 * - edition layers (venue, service period) only carry `all_true` flags (hidden here, sold out).
 * Value-dependent caution (an `all_true` flag from a builder layer may only be `false`) is
 * checked by `validateWrite`.
 */
export function layerAllowed(definition: FieldDefinition, layer: Layer): Verdict {
  if (definition.combinator === 'locked' && layer !== 'barsy') {
    return reject(
      'layer_not_allowed',
      `${definition.key} is locked to barsy: change this in barsy (the ${layer} layer is refused)`,
    )
  }
  if (layer === 'override') {
    if (definition.owner !== 'barsy') {
      return reject(
        'layer_not_allowed',
        `${definition.key} is builder-owned: write the manual layer`,
      )
    }
    if (definition.overridable !== 'always') {
      return reject('layer_not_allowed', `${definition.key} cannot be overridden`)
    }
  }
  if (isEditionLayer(layer) && definition.combinator !== 'all_true') {
    return reject(
      'layer_not_allowed',
      `editions may only hide or mark sold out; ${definition.key} is not an edition field`,
    )
  }
  return OK
}

/**
 * Validates one field write against the template: the node type and field exist, the layer is
 * allowed (`layerAllowed`), the value passes V1 (V2 for money), an override's basis is a valid
 * value too, and a builder layer never makes an `all_true` flag less cautious (rule 5: no
 * un-hiding, no putting back on sale).
 */
export function validateWrite(template: Template, nodeType: NodeType, write: FieldWrite): Verdict {
  if (template.nodeTypes[nodeType] === undefined) {
    return reject('unknown_node_type', `the template has no ${nodeType} node type`)
  }
  const definition = findField(template, nodeType, write.fieldKey)
  if (definition === undefined) {
    return reject('unknown_field', `${nodeType} has no field ${write.fieldKey}`)
  }
  const layer = layerAllowed(definition, write.layer)
  if (!layer.ok) return layer

  const spec = FIELD_TYPES[definition.type]
  const value = spec.validate(write.value, definition)
  if (!value.ok) return value

  if (write.layer === 'override') {
    const basis = spec.validate(write.basis, definition)
    if (!basis.ok) return reject(basis.code, `override basis: ${basis.reason}`)
  }
  if (definition.combinator === 'all_true' && write.layer !== 'barsy' && write.value !== false) {
    return reject(
      'less_cautious',
      `${definition.key} can only be set to false outside barsy (hide or take off sale, never undo barsy)`,
    )
  }
  return OK
}
