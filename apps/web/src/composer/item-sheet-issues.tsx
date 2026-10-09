'use client'

// The resolver's findings about the item, as sentences at the top of the Details tab: what keeps
// it off the guest menu (blocking) and what only deserves a look (warnings). The code decides the
// sentence; the field's label and the language come from the data, never from the code.
import type { Locale } from '@restro/core'
import { AlertTriangleIcon, OctagonAlertIcon } from 'lucide-react'
import { useLocale, useTranslations } from 'next-intl'
import { useState } from 'react'

import { Button } from '@/components/ui/button'
import { pickLocalized } from '@/fields/localized'
import { isAdminLocale, toDataLocale } from '@/i18n/locales'
import type { ItemSheetData, SheetIssue } from '@/server/item-sheet/types'

import { languageName } from './item-sheet-support'

/** How many findings show before "Show more". */
const VISIBLE_AT_FIRST = 4

/** The issue codes that have a sentence of their own; any other gets the generic one. */
const KNOWN_CODES = new Set([
  'V3',
  'V4',
  'V5',
  'V6',
  'V7',
  'stale_override',
  'link_missing',
  'link_deleted',
  'invalid_value',
  'ignored_value',
  'required_missing',
  'translation_review',
  'price_not_venue_scoped',
  'unplaced_item',
  'required_group_unsatisfiable',
])

export function ItemSheetIssues({ data }: { data: ItemSheetData }) {
  const t = useTranslations('itemSheet.issues')
  const uiLanguage = useLocale()
  const [expanded, setExpanded] = useState(false)
  const dataLocale: Locale = toDataLocale(isAdminLocale(uiLanguage) ? uiLanguage : 'bg')

  if (data.issues.length === 0) return null
  const ordered = [...data.issues].sort(
    (a, b) => Number(b.severity === 'block_node') - Number(a.severity === 'block_node'),
  )
  const shown = expanded ? ordered : ordered.slice(0, VISIBLE_AT_FIRST)

  function sentence(issue: SheetIssue): string {
    const definition = data.fields.find((field) => field.key === issue.fieldKey)?.definition
    const field = definition ? (pickLocalized(definition.label, dataLocale) ?? definition.key) : ''
    const language = issue.locale ? languageName(issue.locale, uiLanguage) : ''
    return KNOWN_CODES.has(issue.code)
      ? t(issue.code, { field, language })
      : t('unknown', { code: issue.code })
  }

  return (
    <section
      aria-label={t('title')}
      data-testid="item-sheet-issues"
      className="grid gap-2 rounded-lg border bg-muted/30 p-3"
    >
      <h3 className="text-sm font-semibold">{t('title')}</h3>
      <ul className="grid gap-1.5">
        {shown.map((issue) => {
          const blocking = issue.severity === 'block_node'
          const Icon = blocking ? OctagonAlertIcon : AlertTriangleIcon
          return (
            <li
              key={`${issue.code}:${issue.fieldKey ?? ''}:${issue.locale ?? ''}`}
              data-severity={issue.severity}
              className="flex items-start gap-2 text-sm"
            >
              <Icon
                className={
                  blocking ? 'mt-0.5 size-4 text-destructive' : 'mt-0.5 size-4 text-warning'
                }
                aria-hidden
              />
              <span>
                {blocking ? <span className="sr-only">{t('blocking')}: </span> : null}
                {sentence(issue)}
              </span>
            </li>
          )
        })}
      </ul>
      {ordered.length > VISIBLE_AT_FIRST ? (
        <Button
          type="button"
          variant="link"
          size="sm"
          className="h-auto justify-self-start p-0"
          onClick={() => setExpanded((value) => !value)}
        >
          {expanded ? t('showLess') : t('showMore', { count: ordered.length - VISIBLE_AT_FIRST })}
        </Button>
      ) : null}
    </section>
  )
}
