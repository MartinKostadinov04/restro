'use client'

// The Details tab of the item sheet: one FieldRow for every Item field of the template, in
// template order, grouped under dividers (the Platform's category pills), each with the
// resolver's provenance, and an editor that saves through a server action and `apply()`.
// Ported from the Platform's ValueField / DrawerInput (see fields/field-row.tsx and
// fields/field-editor-sheet.tsx); the rows here add what the Platform could not show: where a
// value comes from, the till's value beside an override, Revert, and "keep mine / take the till's".
import { LockIcon, TriangleAlertIcon } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useState } from 'react'

import { Button } from '@/components/ui/button'
import { FieldEditorSheet } from '@/fields/field-editor-sheet'
import { FieldGroupDivider, FieldRow, useFieldLabel } from '@/fields/field-row'
import { ITEM_GROUPS } from '@/fields/item-groups'
import { localeChip } from '@/fields/localized'
import { ProvenanceBadge } from '@/fields/provenance-badge'
import { FieldValueView } from '@/fields/registry'
import { useTillLabel } from '@/fields/till-label'
import type { ItemSheetData, SheetField } from '@/server/item-sheet/types'

import { NameFromTillNotice } from './badges'
import { ItemSheetIssues } from './item-sheet-issues'
import { type ItemPaymentChoice, ItemPaymentModeRow } from './item-sheet-payment-mode'
import { ItemSheetSale } from './item-sheet-sale'
import { badgeProvenance } from './item-sheet-support'

export interface ItemSheetDetailsTabProps {
  data: ItemSheetData
  /** True while a save is under way. */
  busy: boolean
  /** Saves a field's whole value (`null` = cleared); resolves true when it was saved. */
  onSave: (fieldKey: string, value: unknown | null) => Promise<boolean>
  /** Removes our override (revert, or take the till's value); resolves true when done. */
  onRevert: (fieldKey: string) => Promise<boolean>
  /** Keeps a stale override; resolves true when done. */
  onKeep: (fieldKey: string) => Promise<boolean>
  /** The image is edited on the Media tab. */
  onOpenMedia: () => void
  /** Marks the item sold out tonight (`true`) or takes our mark off (`false`, D46). */
  onSoldOut: (soldOut: boolean) => Promise<boolean>
  /** Saves the item's payment mode (`null` = same as the venue); resolves true when saved (#218). */
  onPaymentMode: (mode: ItemPaymentChoice) => Promise<boolean>
}

/** Languages whose text comes from different places: shown one by one under the badge. */
function LocaleProvenance({ field }: { field: SheetField }) {
  const provenances = Object.entries(field.localeProvenance ?? {})
  if (new Set(provenances.map(([, provenance]) => provenance)).size < 2) return null
  return (
    <ul className="flex flex-wrap gap-x-3 gap-y-1" data-testid="locale-provenance">
      {provenances.map(([locale, provenance]) => (
        <li key={locale} className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <span className="font-mono">{localeChip(locale)}</span>
          {provenance === 'none' ? null : <ProvenanceBadge provenance={provenance} />}
        </li>
      ))}
    </ul>
  )
}

interface RowExtrasProps {
  field: SheetField
  busy: boolean
  onRevert: () => void
  onKeep: () => void
}

/** What goes under a row's value and badge: why it is read-only, the conflict, Revert, keep / take. */
function RowExtras({ field, busy, onRevert, onKeep }: RowExtrasProps) {
  const t = useTranslations('itemSheet.details')
  const source = useTillLabel()
  const label = useFieldLabel(field.definition)
  const stale = field.provenance === 'stale' || field.canKeep
  return (
    <>
      <LocaleProvenance field={field} />
      {field.access.kind === 'readonly' ? (
        <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
          <LockIcon className="mt-0.5 size-3 shrink-0" aria-hidden />
          <span data-testid="read-only-note">
            {t(`readOnly.${field.access.reason}`, { source })}
          </span>
        </p>
      ) : null}
      {field.conflict ? (
        <p className="flex items-start gap-1.5 text-xs text-warning">
          <TriangleAlertIcon className="mt-0.5 size-3 shrink-0" aria-hidden />
          <span>{t('conflict', { source })}</span>
        </p>
      ) : null}
      {field.canRevert ? (
        <div className="grid w-full gap-2 rounded-md border bg-muted/30 p-2.5 text-xs">
          <p className="text-muted-foreground">
            {stale ? t('staleHint', { source }) : t('tillValueHint', { source })}
          </p>
          {field.tillValue !== null ? (
            <div className="text-sm" data-testid="till-value">
              <FieldValueView definition={field.definition} value={field.tillValue} />
            </div>
          ) : null}
          <div className="flex flex-wrap gap-2">
            {stale && field.canKeep ? (
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={busy}
                aria-label={t('keepFor', { field: label })}
                onClick={onKeep}
              >
                {t('keep')}
              </Button>
            ) : null}
            <Button
              type="button"
              size="sm"
              variant={stale ? 'default' : 'outline'}
              disabled={busy}
              aria-label={
                stale
                  ? t('takeTillFor', { field: label, source })
                  : t('revertFor', { field: label, source })
              }
              onClick={onRevert}
            >
              {stale ? t('takeTill', { source }) : t('revert')}
            </Button>
          </div>
        </div>
      ) : null}
    </>
  )
}

export function ItemSheetDetailsTab({
  data,
  busy,
  onSave,
  onRevert,
  onKeep,
  onOpenMedia,
  onSoldOut,
  onPaymentMode,
}: ItemSheetDetailsTabProps) {
  const t = useTranslations('itemSheet.details')
  const [editing, setEditing] = useState<string | null>(null)
  const byKey = new Map(data.fields.map((field) => [field.key, field]))
  const editingField = editing === null ? undefined : byKey.get(editing)

  return (
    <div className="grid gap-4" data-testid="item-sheet-details">
      <ItemSheetIssues data={data} />
      {/* The name is the till's own, for want of a public one (D75): says so, never blocks. */}
      {data.nameFromTill ? <NameFromTillNotice /> : null}
      <ItemSheetSale sale={data.sale} busy={busy} onChange={onSoldOut} />
      {/* One <dl> per group, with the group label outside it, so every dl holds only row
          wrappers around dt/dd pairs. */}
      <div className="rounded-lg border bg-card py-2">
        {ITEM_GROUPS.map((group) => (
          <section key={group.id} aria-label={t(`groups.${group.id}`)}>
            <FieldGroupDivider>{t(`groups.${group.id}`)}</FieldGroupDivider>
            <dl>
              {group.keys.map((key) => {
                const field = byKey.get(key)
                if (!field) return null
                const editable = field.access.kind === 'edit'
                // Radio cards instead of the generic editor: one tap, saved at once (#218).
                if (key === 'payment_mode' && editable && data.payFirstDefault !== null) {
                  return (
                    <ItemPaymentModeRow
                      key={key}
                      field={field}
                      venueMode={data.payFirstDefault}
                      busy={busy}
                      onChange={onPaymentMode}
                    />
                  )
                }
                return (
                  <FieldRow
                    key={key}
                    definition={field.definition}
                    value={field.value ?? undefined}
                    provenance={badgeProvenance(field.provenance)}
                    onEdit={
                      editable
                        ? () => setEditing(key)
                        : field.access.kind === 'media'
                          ? onOpenMedia
                          : undefined
                    }
                    footer={
                      <RowExtras
                        field={field}
                        busy={busy}
                        onRevert={() => void onRevert(key)}
                        onKeep={() => void onKeep(key)}
                      />
                    }
                  />
                )
              })}
            </dl>
          </section>
        ))}
      </div>
      {editingField ? (
        <FieldEditorSheet
          key={editingField.key}
          definition={editingField.definition}
          value={editingField.value ?? undefined}
          open
          saving={busy}
          description={t('editorDescription')}
          onOpenChange={(open) => {
            if (!open) setEditing(null)
          }}
          onSave={async (value) => {
            if (await onSave(editingField.key, value ?? null)) setEditing(null)
          }}
        />
      ) : null}
    </div>
  )
}
