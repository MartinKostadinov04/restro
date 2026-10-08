// The UI side of the field-type registry (CLAUDE.md "One field-type registry"). core owns the
// part without UI (`FIELD_TYPES`: value and constraint schemas, emptiness, hashing, validation);
// this folder adds what a screen needs, once per field type: how to show a value (`Display`) and
// how to edit it (`Editor`). A `DefinitionEditor` (editing the field's *definition*) joins them
// in Stage 2 with the template editor.
//
// The Platform copied a `switch (type)` into four components (Render.jsx, ValueField.jsx,
// DrawerInput.jsx, View.jsx). Here there is no such switch anywhere: components look the type up
// in the registry, and a type without an entry is a compile error (registry.tsx).
import type { FieldDefinition, FieldType, FieldValueOf } from '@restro/core'
import type { ComponentType } from 'react'

/** Props of a `Display`: a value that already passed the type's schema. */
export interface DisplayProps<K extends FieldType> {
  readonly definition: FieldDefinition
  readonly value: FieldValueOf<K>
}

/** Props of an `Editor`: a controlled input for one value. */
export interface EditorProps<K extends FieldType> {
  readonly definition: FieldDefinition
  /** `undefined` = no value set. */
  readonly value: FieldValueOf<K> | undefined
  /** Called with the new value, or `undefined` when the person emptied the field. */
  readonly onChange: (value: FieldValueOf<K> | undefined) => void
  /** Id for the main control, so the sheet's label points at it. */
  readonly inputId: string
  readonly invalid?: boolean
}

/** What every field type registers for the UI. */
export interface FieldUi<K extends FieldType> {
  readonly Display: ComponentType<DisplayProps<K>>
  readonly Editor: ComponentType<EditorProps<K>>
}

/** One entry per field type; `satisfies FieldRegistry` makes a missing one a compile error. */
export type FieldRegistry = { readonly [K in FieldType]: FieldUi<K> }

/** Where a value came from, shown on every row (CLAUDE.md, Platform reference "provenance"). */
export const PROVENANCES = ['barsy', 'owned', 'overridden', 'stale'] as const

/** `barsy` = From barsy, `owned` = Owned here, `overridden` = Overridden, `stale` = Stale. */
export type Provenance = (typeof PROVENANCES)[number]
