'use client'

import type { Locale } from '@restro/core'
// The Translations tab: the item's localized fields (name, description) as a grid of the venue's
// languages. A language the till holds is shown read-only; one it lacks is ours to write, saved per
// language to the manual layer (D24: a translation, not an override). Cells with no text are
// highlighted, and a translation whose till text changed after it was written carries the review
// flag (our text stays live meanwhile).
import { LockIcon } from 'lucide-react'
import { useLocale, useTranslations } from 'next-intl'
import { useId, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { useFieldLabel } from '@/fields/field-row'
import { localeChip } from '@/fields/localized'
import { ProvenanceBadge } from '@/fields/provenance-badge'
import { useTillLabel } from '@/fields/till-label'
import { cn } from '@/lib/utils'
import type { ItemSheetData, TranslationCell, TranslationRow } from '@/server/item-sheet/types'

import { badgeProvenance, languageName } from './item-sheet-support'

export interface ItemSheetTranslationsTabProps {
  data: ItemSheetData
  /** True while a save is under way. */
  busy: boolean
  /** Saves one language of a field (`null` = removed); resolves true when it was saved. */
  onSave: (fieldKey: string, locale: Locale, text: string | null) => Promise<boolean>
}

interface CellProps {
  fieldKey: string
  locale: Locale
  cell: TranslationCell
  busy: boolean
  onSave: ItemSheetTranslationsTabProps['onSave']
}

function TranslationCellEditor({ fieldKey, locale, cell, busy, onSave }: CellProps) {
  const t = useTranslations('itemSheet.translations')
  const source = useTillLabel()
  const uiLanguage = useLocale()
  const id = useId()
  const [draft, setDraft] = useState(cell.ourText ?? '')
  const dirty = draft !== (cell.ourText ?? '')
  const language = languageName(locale, uiLanguage)
  const langTag = locale.split('_')[0]

  function save() {
    if (!dirty || busy) return
    void onSave(fieldKey, locale, draft.trim() === '' ? null : draft)
  }

  return (
    <div
      data-testid="translation-cell"
      data-field={fieldKey}
      data-locale={locale}
      data-missing={cell.missing}
      data-editable={cell.editable}
      className={cn(
        'grid content-start gap-2 rounded-lg border p-3',
        cell.missing && 'border-warning/60 bg-warning/5',
      )}
    >
      <div className="flex flex-wrap items-center gap-2">
        <Label htmlFor={id} className="font-medium">
          {language}
        </Label>
        <span className="font-mono text-xs text-muted-foreground">{localeChip(locale)}</span>
        {cell.missing ? <Badge variant="warning">{t('missing')}</Badge> : null}
        {cell.review ? <Badge variant="warning">{t('review')}</Badge> : null}
      </div>
      {cell.editable ? (
        <>
          <Textarea
            id={id}
            rows={3}
            lang={langTag}
            value={draft}
            // Where the till's text is only the fallback, it shows greyed until ours replaces it.
            placeholder={cell.ourText === null && cell.text ? cell.text : t('placeholder')}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
                event.preventDefault()
                save()
              }
            }}
          />
          <div className="flex items-start justify-between gap-3">
            <div className="grid gap-1">
              {cell.provenance !== 'none' ? (
                <ProvenanceBadge provenance={badgeProvenance(cell.provenance) ?? 'owned'} />
              ) : null}
              {cell.review ? (
                <p className="text-xs text-muted-foreground">{t('reviewHint', { source })}</p>
              ) : null}
            </div>
            <Button type="button" size="sm" disabled={!dirty || busy} onClick={save}>
              {t('save')}
            </Button>
          </div>
        </>
      ) : (
        <>
          <p
            id={id}
            lang={langTag}
            className="rounded-md bg-muted/50 px-3 py-2 text-sm whitespace-pre-line"
          >
            {cell.text}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            {cell.provenance !== 'none' ? (
              <ProvenanceBadge provenance={badgeProvenance(cell.provenance) ?? 'till'} />
            ) : null}
            <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <LockIcon className="size-3" aria-hidden />
              {t('heldByTill', { source })}
            </span>
          </div>
        </>
      )}
    </div>
  )
}

function TranslationFieldCard({
  row,
  data,
  busy,
  onSave,
}: {
  row: TranslationRow
  data: ItemSheetData
  busy: boolean
  onSave: ItemSheetTranslationsTabProps['onSave']
}) {
  const label = useFieldLabel(row.definition)
  return (
    <section
      aria-label={label}
      data-testid="translation-row"
      data-field={row.fieldKey}
      className="grid gap-3 rounded-lg border bg-card p-4"
    >
      <h3 className="text-sm font-semibold">{label}</h3>
      <div className="grid gap-3 sm:grid-cols-2">
        {data.enabledLocales.map((locale) => {
          const cell = row.cells[locale]
          if (!cell) return null
          return (
            // The key includes our saved text, so a cell starts from it again after a save.
            <TranslationCellEditor
              key={`${locale}:${cell.ourText ?? ''}`}
              fieldKey={row.fieldKey}
              locale={locale}
              cell={cell}
              busy={busy}
              onSave={onSave}
            />
          )
        })}
      </div>
    </section>
  )
}

export function ItemSheetTranslationsTab({ data, busy, onSave }: ItemSheetTranslationsTabProps) {
  const t = useTranslations('itemSheet.translations')
  const source = useTillLabel()
  return (
    <div className="grid gap-4" data-testid="item-sheet-translations">
      <p className="text-sm text-muted-foreground">{t('intro', { source })}</p>
      {data.translations.map((row) => (
        <TranslationFieldCard
          key={row.fieldKey}
          row={row}
          data={data}
          busy={busy}
          onSave={onSave}
        />
      ))}
    </div>
  )
}
