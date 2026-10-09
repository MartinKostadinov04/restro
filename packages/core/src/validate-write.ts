// Write-level validation (doc "Validation and quality gates": V1, V2) plus the ownership rules a
// single write can be checked against with the node's context (is it linked to barsy?). `apply()`
// runs this on every field write; a rejected write never replaces a good value.

import { type FieldWrite, isEditionLayer, type Layer } from './change-set'
import type { FieldDefinition } from './field-definition'
import { FIELD_TYPES } from './field-types/specs'
import type { NodeType } from './node-types'
import { OK, reject, type Verdict } from './result'
import { findField, type Template } from './template'

/** What a write check needs to know about the node it targets. */
export interface WriteContext {
  /**
   * True if the node has a barsy source link, in any state (active, missing or deleted): a
   * linked node keeps barsy's price, and only a linked node can carry barsy values or overrides.
   */
  readonly linkedToBarsy: boolean
}

/**
 * The context assumed when none is given: linked to barsy, the stricter reading (a manual or
 * import price is refused).
 */
export const LINKED_TO_BARSY: WriteContext = Object.freeze({ linkedToBarsy: true })

/**
 * Whether `layer` may hold a value for this field on a node in `context` (ownership matrix and
 * "What a save writes"):
 * - the `barsy` and `override` layers need a node linked to barsy (a hand-made node has no barsy
 *   value to carry or to override; it is edited in the manual layer);
 * - a `locked` field (price) accepts the `barsy` layer, and on a node **not** linked to barsy the
 *   `manual` and `import` layers too (a hand-made wine list); never an override or an edition;
 * - the `override` layer needs a barsy-owned field with `overridable: 'always'` (a
 *   `never_when_orderable` field is treated as `never`: orderability is unknown at write time);
 * - edition layers (venue, service period) only carry `all_true` flags (hidden here, sold out).
 * Value-dependent caution (an `all_true` flag from a builder layer may only be `false`) is
 * checked by `validateWrite`.
 */
export function layerAllowed(
  definition: FieldDefinition,
  layer: Layer,
  context: WriteContext = LINKED_TO_BARSY,
): Verdict {
  if (!context.linkedToBarsy && (layer === 'barsy' || layer === 'override')) {
    return reject(
      'not_linked',
      `${definition.key}: the node is not linked to barsy, so it takes no ${layer} value ` +
        '(write the manual layer)',
    )
  }
  if (definition.combinator === 'locked' && layer !== 'barsy') {
    const handMade = !context.linkedToBarsy && (layer === 'manual' || layer === 'import')
    if (!handMade) {
      return reject(
        'layer_not_allowed',
        context.linkedToBarsy
          ? `${definition.key} is locked to barsy: change this in barsy (the ${layer} layer is refused)`
          : `${definition.key} of a node without a barsy link is written in the manual or import layer`,
      )
    }
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
 * Validates one field write against the template and the node's context: the node type and field
 * exist, the layer is allowed (`layerAllowed`), the value passes V1 (V2 for money), an override's
 * basis is a valid value too, and a builder layer never makes an `all_true` flag less cautious
 * (rule 5: no un-hiding, no putting back on sale). Without a context the node counts as linked
 * to barsy (`LINKED_TO_BARSY`), so a manual price is refused.
 */
export function validateWrite(
  template: Template,
  nodeType: NodeType,
  write: FieldWrite,
  context: WriteContext = LINKED_TO_BARSY,
): Verdict {
  if (template.nodeTypes[nodeType] === undefined) {
    return reject('unknown_node_type', `the template has no ${nodeType} node type`)
  }
  const definition = findField(template, nodeType, write.fieldKey)
  if (definition === undefined) {
    return reject('unknown_field', `${nodeType} has no field ${write.fieldKey}`)
  }
  const layer = layerAllowed(definition, write.layer, context)
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
