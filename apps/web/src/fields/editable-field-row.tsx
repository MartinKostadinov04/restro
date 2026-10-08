'use client'

import type { FieldDefinition } from '@restro/core'
import { useTranslations } from 'next-intl'
import { useState } from 'react'
import { toast } from 'sonner'

import { FieldEditorSheet } from './field-editor-sheet'
import { FieldRow } from './field-row'
import type { Provenance } from './types'

interface EditableFieldRowProps {
  definition: FieldDefinition
  initialValue: unknown
  provenance?: Provenance
}

/**
 * A FieldRow that opens a FieldEditorSheet and keeps the saved value in local state. This is all
 * Stage 1 does with a save: no database write (writes arrive with `apply()` in Stage 2, which
 * will replace the local state with a server action). Editing a barsy-owned value is shown as an
 * override, anything else as owned here, which is what the layers will say.
 */
export function EditableFieldRow({ definition, initialValue, provenance }: EditableFieldRowProps) {
  const t = useTranslations('fields.editor')
  const [value, setValue] = useState<unknown>(initialValue)
  const [saved, setSaved] = useState(false)
  const [open, setOpen] = useState(false)

  const shown: Provenance | undefined = saved
    ? definition.owner === 'barsy'
      ? 'overridden'
      : 'owned'
    : provenance

  return (
    <>
      <FieldRow
        definition={definition}
        value={value}
        provenance={shown}
        onEdit={() => setOpen(true)}
      />
      <FieldEditorSheet
        definition={definition}
        value={value}
        open={open}
        onOpenChange={setOpen}
        onSave={(next) => {
          setValue(next)
          setSaved(true)
          setOpen(false)
          toast.success(t('savedLocally'))
        }}
      />
    </>
  )
}
