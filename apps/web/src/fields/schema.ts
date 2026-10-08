import { FIELD_TYPES, type FieldDefinition } from '@restro/core'
import { z } from 'zod'

/** The two reasons the editor reports; the sheet turns them into interface text. */
export type EditorIssue = 'required' | 'invalid'

/**
 * The Zod schema of the editor sheet's form for one field: `{ value }`, where `value` is checked
 * by core's own validation for the field type (`FIELD_TYPES[type].validate`: the canonical value
 * schema, then the definition's constraints and options). No value is fine unless the field is
 * `required: true`; a value that counts as empty (blank text, no tags) does not satisfy it.
 * The Platform checked nothing before saving.
 */
export function buildEditorSchema(definition: FieldDefinition) {
  const spec = FIELD_TYPES[definition.type]
  return z.object({ value: z.unknown() }).superRefine((data, ctx) => {
    const issue = (message: EditorIssue) =>
      ctx.addIssue({ code: 'custom', path: ['value'], message })
    const { value } = data
    if (value === undefined) {
      if (definition.required === true) issue('required')
      return
    }
    if (!spec.validate(value, definition).ok) return issue('invalid')
    // `isEmpty` takes a value of the field's own type; validate() has just proved it is one.
    if (definition.required === true && (spec.isEmpty as (value: unknown) => boolean)(value)) {
      issue('required')
    }
  })
}

/** The form values of the editor sheet. */
export interface EditorFormValues {
  value: unknown
}
