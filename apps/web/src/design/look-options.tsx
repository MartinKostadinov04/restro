'use client'

// The template's look options, drawn from its manifest (brief SH-05a): an enum is a segmented
// control, a boolean a switch, the label comes from the manifest's `label.bg` / `label.en`. Only
// the options with `group: 'look'` are here; the `feature` options belong to the composer's
// "Guest features" panel. Nothing here knows a template by name: a new template with other
// options gets its form from its manifest.
import type { FaceManifest } from '@restro/shell'
import { useLocale, useTranslations } from 'next-intl'

import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { resolveAdminLocale } from '@/i18n/locales'

import { Segmented } from './segmented'
import { type OptionValues, optionKeys } from './template-options'

export function LookOptions({
  manifest,
  values,
  disabled,
  onChange,
}: {
  manifest: FaceManifest
  /** The current value of every look option (defaults filled in). */
  values: OptionValues
  disabled: boolean
  onChange: (next: OptionValues) => void
}) {
  const t = useTranslations('design.lookOptions')
  const locale = resolveAdminLocale(useLocale())
  const keys = optionKeys(manifest, 'look')
  if (keys.length === 0) return null

  // The manifest names an enum's values but not their words: the interface says them, and a value
  // it has no words for is shown as it is.
  const valueLabel = (value: string) => (t.has(`values.${value}`) ? t(`values.${value}`) : value)

  return (
    <div className="grid gap-4" data-testid="design-look-options">
      <div>
        <h4 className="text-sm font-medium">{t('title')}</h4>
        <p className="text-xs text-muted-foreground">{t('help')}</p>
      </div>
      {keys.map((key) => {
        const option = manifest.options[key]
        if (option === undefined) return null
        const label = option.label[locale]
        const value = values[key]
        if (option.type === 'enum') {
          return (
            <div key={key} className="grid gap-2" data-option={key}>
              <p className="text-sm">{label}</p>
              <Segmented
                label={label}
                value={typeof value === 'string' ? value : option.default}
                options={option.values.map((entry) => ({ value: entry, label: valueLabel(entry) }))}
                disabled={disabled}
                onChange={(next) => onChange({ ...values, [key]: next })}
              />
            </div>
          )
        }
        return (
          <div key={key} className="flex items-center justify-between gap-4" data-option={key}>
            <Label htmlFor={`look-option-${key}`} className="font-normal">
              {label}
            </Label>
            <Switch
              id={`look-option-${key}`}
              checked={typeof value === 'boolean' ? value : option.default}
              disabled={disabled}
              onCheckedChange={(next) => onChange({ ...values, [key]: next })}
            />
          </div>
        )
      })}
    </div>
  )
}
