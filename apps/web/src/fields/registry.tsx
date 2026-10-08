'use client'

// The one field-type registry of the admin UI: every FieldType of @restro/core maps to
// `{ Display, Editor }`. `satisfies FieldRegistry` makes a missing type a compile error (and
// registry.test.tsx proves it), so adding a type to core's vocabulary cannot ship without its
// screens. Nothing in the app switches on a field's type: FieldRow, FieldEditorSheet and the
// previews all go through `FieldValueView` and `FieldEditor` below.
import { FIELD_TYPES, type FieldDefinition, type FieldType, type FieldValue } from '@restro/core'
import { useTranslations } from 'next-intl'
import type { ComponentType } from 'react'

import { ComingSoonEditor } from './coming-soon'
import type { DisplayProps, EditorProps, FieldRegistry, FieldUi } from './types'
import { boolean, enumSet, enumType, tags } from './types/choices'
import { file, image, reference } from './types/media'
import { measurement, money, number, RangeDisplay } from './types/numbers'
import { localizedText, longText, shortText } from './types/text'
import { availability, date, datetime } from './types/time'

export const FIELD_REGISTRY = {
  short_text: shortText,
  long_text: longText,
  localized_text: localizedText,
  number,
  boolean,
  date,
  datetime,
  money,
  measurement,
  range: { Display: RangeDisplay, Editor: ComingSoonEditor },
  tags,
  enum: enumType,
  enum_set: enumSet,
  image,
  file,
  availability,
  reference,
} satisfies FieldRegistry

/**
 * The UI of one field type. The only place the registry is read with a type that is not known at
 * compile time: the components in it are typed for their own value, and what reaches them has
 * been validated by core's schema first (FieldValueView) or by the editor sheet's form.
 */
function uiFor(type: FieldType): {
  Display: ComponentType<DisplayProps<FieldType>>
  Editor: ComponentType<EditorProps<FieldType>>
} {
  return FIELD_REGISTRY[type] as unknown as FieldUi<FieldType>
}

/**
 * False while a type's Editor is the Stage 2 placeholder (`ComingSoonEditor`). The editor sheet
 * then offers no Save or Clear, so opening it can never change a value or its provenance.
 */
export function isFieldEditable(type: FieldType): boolean {
  return (FIELD_REGISTRY[type].Editor as unknown) !== ComingSoonEditor
}

/**
 * Shows a stored value with its field type's Display. The value is parsed with core's schema for
 * the type first: stale or foreign data shows a notice instead of crashing a screen.
 */
export function FieldValueView({
  definition,
  value,
}: {
  definition: FieldDefinition
  value: unknown
}) {
  const t = useTranslations('fields')
  const parsed = FIELD_TYPES[definition.type].valueSchema.safeParse(value)
  if (!parsed.success) {
    return <span className="text-sm text-destructive">{t('invalidStored')}</span>
  }
  const { Display } = uiFor(definition.type)
  return <Display definition={definition} value={parsed.data as FieldValue} />
}

/** Edits a value with its field type's Editor. `undefined` means no value. */
export function FieldEditor({
  definition,
  value,
  onChange,
  inputId,
  invalid,
}: {
  definition: FieldDefinition
  value: unknown
  onChange: (value: unknown) => void
  inputId: string
  invalid?: boolean
}) {
  const { Editor } = uiFor(definition.type)
  return (
    <Editor
      definition={definition}
      value={value as FieldValue | undefined}
      onChange={onChange}
      inputId={inputId}
      invalid={invalid}
    />
  )
}
