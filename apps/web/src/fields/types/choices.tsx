'use client'

// boolean, enum and enum_set (the tags field type has a file of its own: ./tags.tsx).
import { useTranslations } from 'next-intl'

import { Badge } from '@/components/ui/badge'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { cn } from '@/lib/utils'

import { useOptionLabel } from '../option-label'
import type { DisplayProps, EditorProps, FieldUi } from '../types'

function optionsOf(definition: { options?: readonly string[] | undefined }): readonly string[] {
  return definition.options ?? []
}

// --- boolean --------------------------------------------------------------------------------

function BooleanDisplay({ value }: DisplayProps<'boolean'>) {
  const t = useTranslations('common')
  return <Badge variant={value ? 'success' : 'secondary'}>{value ? t('yes') : t('no')}</Badge>
}

function BooleanEditor({ value, onChange, inputId }: EditorProps<'boolean'>) {
  const t = useTranslations('common')
  return (
    <div className="flex items-center gap-3">
      <Switch
        id={inputId}
        checked={value === true}
        onCheckedChange={(checked) => onChange(checked)}
      />
      <span className="text-sm text-muted-foreground">{value === true ? t('yes') : t('no')}</span>
    </div>
  )
}

export const boolean = {
  Display: BooleanDisplay,
  Editor: BooleanEditor,
} satisfies FieldUi<'boolean'>

// --- enum -----------------------------------------------------------------------------------

function EnumDisplay({ definition, value }: DisplayProps<'enum'>) {
  const label = useOptionLabel(definition)
  return <Badge variant="secondary">{label(value)}</Badge>
}

function EnumEditor({ definition, value, onChange, inputId, invalid }: EditorProps<'enum'>) {
  const t = useTranslations('fields.editor')
  const label = useOptionLabel(definition)
  return (
    <Select value={value ?? ''} onValueChange={(next) => onChange(next === '' ? undefined : next)}>
      <SelectTrigger id={inputId} className="w-full" aria-invalid={invalid || undefined}>
        <SelectValue placeholder={t('choose')} />
      </SelectTrigger>
      <SelectContent>
        {optionsOf(definition).map((option) => (
          <SelectItem key={option} value={option}>
            {label(option)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

export const enumType = { Display: EnumDisplay, Editor: EnumEditor } satisfies FieldUi<'enum'>

// --- enum_set -------------------------------------------------------------------------------

function EnumSetDisplay({ definition, value }: DisplayProps<'enum_set'>) {
  const t = useTranslations('common')
  const label = useOptionLabel(definition)
  // An explicit empty set is a value ("none of these"), shown differently from "no value".
  if (value.length === 0) return <span className="text-muted-foreground">{t('none')}</span>
  return (
    <ul className="flex flex-wrap gap-1.5">
      {value.map((code) => (
        <li key={code}>
          <Badge variant="secondary">{label(code)}</Badge>
        </li>
      ))}
    </ul>
  )
}

/** Chips: each option is a toggle button. The allergens show the 14 EU labels in BG and EN. */
function EnumSetEditor({ definition, value, onChange, inputId }: EditorProps<'enum_set'>) {
  const t = useTranslations('fields.editor')
  const label = useOptionLabel(definition)
  const selected = value ?? []

  function toggle(option: string) {
    const next = selected.includes(option)
      ? selected.filter((code) => code !== option)
      : [...selected, option]
    onChange(next)
  }

  return (
    <div className="grid gap-2">
      <fieldset id={inputId} className="m-0 flex min-w-0 flex-wrap gap-2 border-0 p-0">
        <legend className="sr-only">{t('chooseMany')}</legend>
        {optionsOf(definition).map((option) => {
          const pressed = selected.includes(option)
          return (
            <button
              key={option}
              type="button"
              aria-pressed={pressed}
              onClick={() => toggle(option)}
              className={cn(
                'rounded-full border px-3 py-1 text-sm transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none',
                pressed
                  ? 'border-primary bg-primary text-primary-foreground'
                  : 'border-input bg-background text-foreground hover:bg-accent',
              )}
            >
              {label(option)}
            </button>
          )
        })}
      </fieldset>
      <p className="text-xs text-muted-foreground">
        {value === undefined
          ? t('setNotSet')
          : value.length === 0
            ? t('setNone')
            : t('setCount', { count: value.length })}
      </p>
    </div>
  )
}

export const enumSet = {
  Display: EnumSetDisplay,
  Editor: EnumSetEditor,
} satisfies FieldUi<'enum_set'>
