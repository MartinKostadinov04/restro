'use client'

import { zodResolver } from '@hookform/resolvers/zod'
// The editor for one field: a side Sheet on large screens, a bottom Drawer on phones. Ported from
// the Platform's DrawerInput.jsx (108-305), which was always a bottom drawer. Changed: the input
// comes from the registry (no type switch), the value is checked with react-hook-form + Zod
// against core's own validation before it can be saved, Cmd/Ctrl+Enter saves through a key
// handler scoped to this form (the Platform listened on the window), and Esc cancels.
//
// In Stage 1 saving only hands the value to `onSave`; nothing is written to the database
// (writes arrive with `apply()` in Stage 2).
import type { FieldDefinition } from '@restro/core'
import { useTranslations } from 'next-intl'
import { useId, useMemo } from 'react'
import { Controller, useForm } from 'react-hook-form'

import { Button } from '@/components/ui/button'
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
} from '@/components/ui/drawer'
import { Label } from '@/components/ui/label'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { useIsMobile } from '@/hooks/use-mobile'

import { useFieldLabel } from './field-row'
import { FieldEditor, isFieldEditable } from './registry'
import { buildEditorSchema, type EditorFormValues, type EditorIssue } from './schema'

export interface FieldEditorSheetProps {
  definition: FieldDefinition
  /** The current value; `undefined` = none. */
  value: unknown
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Called with the new value (`undefined` = cleared) once it is valid. */
  onSave: (value: unknown) => void
  /** What the sheet says about saving; the default is the Stage 1 preview's "saved locally". */
  description?: string
  /** True while a save is under way: the buttons wait, so a value is not saved twice. */
  saving?: boolean
}

interface EditorFormProps {
  definition: FieldDefinition
  value: unknown
  onSave: (value: unknown) => void
  onCancel: () => void
  saving: boolean
}

/** The form inside the sheet. It exists only while the sheet is open, so every opening starts from the stored value. */
function EditorForm({ definition, value, onSave, onCancel, saving }: EditorFormProps) {
  const t = useTranslations('fields.editor')
  const label = useFieldLabel(definition)
  const inputId = useId()
  const schema = useMemo(() => buildEditorSchema(definition), [definition])
  const {
    control,
    handleSubmit,
    formState: { errors },
  } = useForm<EditorFormValues>({
    resolver: zodResolver(schema),
    defaultValues: { value },
  })
  // Placeholder editors (Stage 2 types) must never save: the unchanged value would still mark a
  // barsy value as overridden.
  const editable = isFieldEditable(definition.type)
  const save = handleSubmit((data) => {
    if (editable && !saving) onSave(data.value)
  })
  const issue = errors.value?.message as EditorIssue | undefined

  return (
    <form
      onSubmit={save}
      // Scoped to this form: Cmd/Ctrl+Enter saves while focus is inside it. No window listener.
      onKeyDown={(event) => {
        if (editable && event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
          event.preventDefault()
          void save()
        }
      }}
      className="flex flex-1 flex-col gap-4 overflow-y-auto px-4 pb-4"
      noValidate
    >
      <div className="grid gap-2">
        <Label htmlFor={inputId}>{label}</Label>
        <Controller
          control={control}
          name="value"
          render={({ field }) => (
            <FieldEditor
              definition={definition}
              value={field.value}
              onChange={field.onChange}
              inputId={inputId}
              invalid={issue !== undefined}
            />
          )}
        />
        {issue ? (
          <p role="alert" className="text-sm text-destructive">
            {t(`errors.${issue}`)}
          </p>
        ) : null}
      </div>
      <div className="mt-auto grid gap-3">
        {editable ? <p className="text-xs text-muted-foreground">{t('shortcutHint')}</p> : null}
        <div className="flex flex-wrap justify-end gap-2">
          {editable && value !== undefined && definition.required !== true ? (
            <Button
              type="button"
              variant="ghost"
              className="mr-auto"
              disabled={saving}
              onClick={() => onSave(undefined)}
            >
              {t('clear')}
            </Button>
          ) : null}
          <Button type="button" variant="outline" onClick={onCancel}>
            {t('cancel')}
          </Button>
          {editable ? (
            <Button type="submit" disabled={saving}>
              {t('save')}
            </Button>
          ) : null}
        </div>
      </div>
    </form>
  )
}

export function FieldEditorSheet({
  definition,
  value,
  open,
  onOpenChange,
  onSave,
  description,
  saving = false,
}: FieldEditorSheetProps) {
  const t = useTranslations('fields.editor')
  const label = useFieldLabel(definition)
  const isMobile = useIsMobile()
  const form = (
    <EditorForm
      definition={definition}
      value={value}
      onSave={onSave}
      onCancel={() => onOpenChange(false)}
      saving={saving}
    />
  )

  if (isMobile) {
    return (
      <Drawer open={open} onOpenChange={onOpenChange}>
        <DrawerContent className="max-h-[85svh]">
          <DrawerHeader className="text-left">
            <DrawerTitle>{t('title', { field: label })}</DrawerTitle>
            <DrawerDescription>{description ?? t('description')}</DrawerDescription>
          </DrawerHeader>
          {form}
        </DrawerContent>
      </Drawer>
    )
  }
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="w-full gap-0 sm:max-w-md"
        data-testid="field-editor-sheet"
      >
        <SheetHeader>
          <SheetTitle>{t('title', { field: label })}</SheetTitle>
          <SheetDescription>{description ?? t('description')}</SheetDescription>
        </SheetHeader>
        {form}
      </SheetContent>
    </Sheet>
  )
}
