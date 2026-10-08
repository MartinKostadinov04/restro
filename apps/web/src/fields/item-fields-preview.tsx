'use client'

import { useTranslations } from 'next-intl'

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

import { EditableFieldRow } from './editable-field-row'
import { FieldEnvironmentProvider } from './environment'
import { FieldGroupDivider } from './field-row'
import {
  EXTRA_TYPE_SAMPLES,
  ITEM_GROUPS,
  ITEM_SAMPLE_PROVENANCE,
  ITEM_SAMPLE_VALUES,
  itemDefinitions,
} from './samples'

const ENABLED_LOCALES = ['bg_BG', 'en_US'] as const

/**
 * Every field of the default template's Item node as a FieldRow with a sample value, laid out
 * like the item sheet the composer will open in Stage 2, plus one row for each field type the
 * Item does not use. Click a pencil to open the editor; saving only changes this page's state.
 */
export function ItemFieldsPreview() {
  const t = useTranslations('devFields')
  const definitions = itemDefinitions()
  const byKey = new Map(definitions.map((definition) => [definition.key, definition]))

  return (
    <FieldEnvironmentProvider enabledLocales={ENABLED_LOCALES}>
      <div className="mx-auto grid max-w-3xl gap-8">
        <Card className="gap-0 py-0" data-testid="item-sheet-preview">
          <CardHeader className="border-b py-4">
            <CardTitle>{t('item.title')}</CardTitle>
            <CardDescription>{t('item.description')}</CardDescription>
          </CardHeader>
          <CardContent className="px-0 py-2">
            <dl>
              {ITEM_GROUPS.map((group) => (
                <div key={group.id}>
                  <FieldGroupDivider>{t(`groups.${group.id}`)}</FieldGroupDivider>
                  {group.keys.map((key) => {
                    const definition = byKey.get(key)
                    if (!definition) return null
                    return (
                      <EditableFieldRow
                        key={key}
                        definition={definition}
                        initialValue={ITEM_SAMPLE_VALUES[key]}
                        provenance={ITEM_SAMPLE_PROVENANCE[key]}
                      />
                    )
                  })}
                </div>
              ))}
            </dl>
          </CardContent>
        </Card>
        <Card className="h-fit gap-0 py-0" data-testid="extra-types-preview">
          <CardHeader className="border-b py-4">
            <CardTitle>{t('extra.title')}</CardTitle>
            <CardDescription>{t('extra.description')}</CardDescription>
          </CardHeader>
          <CardContent className="px-0 py-2">
            <dl>
              {EXTRA_TYPE_SAMPLES.map(({ definition, value }) => (
                <EditableFieldRow
                  key={definition.key}
                  definition={definition}
                  initialValue={value}
                  provenance="owned"
                />
              ))}
            </dl>
          </CardContent>
        </Card>
      </div>
    </FieldEnvironmentProvider>
  )
}
