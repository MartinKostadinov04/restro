'use client'

import type { FieldDefinition } from '@restro/core'
// One field of a node as a row: label with a hover card (the field key), the value drawn by the
// field type's Display, a provenance badge and an edit button. Ported from the Platform's
// ValueField.jsx (43-165), whose 5-column layout and hover card it keeps. Changed: the value is
// rendered by the registry instead of a type switch, the row has a provenance slot, and the
// divider pill is its own component (FieldGroupDivider).
import { InfoIcon, PencilIcon, PlusIcon } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { HoverCard, HoverCardContent, HoverCardTrigger } from '@/components/ui/hover-card'
import { cn } from '@/lib/utils'

import { useFieldEnvironment } from './environment'
import { pickLocalized } from './localized'
import { ProvenanceBadge } from './provenance-badge'
import { FieldValueView } from './registry'
import type { Provenance } from './types'

interface FieldRowProps {
  definition: FieldDefinition
  /** The stored value; `undefined` means none. */
  value: unknown
  /** Where the value comes from; omit when unknown (no badge). */
  provenance?: Provenance
  /** Called by the edit button; without it the row is read-only (no button). */
  onEdit?: () => void
  className?: string
}

/** The label of a field in the interface language (from the definition, not messages/*.json). */
export function useFieldLabel(definition: FieldDefinition): string {
  const environment = useFieldEnvironment()
  return pickLocalized(definition.label, environment.locale) ?? definition.key
}

export function FieldRow({ definition, value, provenance, onEdit, className }: FieldRowProps) {
  const t = useTranslations('fields')
  const label = useFieldLabel(definition)
  const hasValue = value !== undefined

  return (
    <div
      data-testid="field-row"
      data-field-key={definition.key}
      className={cn('grid gap-2 border-t px-4 py-4 first:border-t-0 sm:grid-cols-5', className)}
    >
      <dt className="flex items-start gap-1 text-sm/6 font-medium text-foreground sm:col-span-2">
        <span>{label}</span>
        {definition.required === true ? (
          <span className="text-destructive" aria-hidden>
            *
          </span>
        ) : null}
        <HoverCard>
          <HoverCardTrigger asChild>
            <button
              type="button"
              className="mt-1 rounded-full text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
              aria-label={t('about', { field: label })}
            >
              <InfoIcon className="size-4" aria-hidden />
            </button>
          </HoverCardTrigger>
          <HoverCardContent className="grid w-64 gap-1 text-sm">
            <span className="text-xs text-muted-foreground">{t('keyLabel')}</span>
            <code className="font-mono">{definition.key}</code>
            <span className="mt-1 text-xs text-muted-foreground">{t('typeLabel')}</span>
            <span>{t(`types.${definition.type}`)}</span>
          </HoverCardContent>
        </HoverCard>
      </dt>
      <dd className="flex items-start justify-between gap-3 text-sm sm:col-span-3">
        <div className="grid min-w-0 flex-1 justify-items-start gap-2">
          {hasValue ? (
            <FieldValueView definition={definition} value={value} />
          ) : (
            <span className="text-muted-foreground italic">{t('noValue')}</span>
          )}
          {provenance ? <ProvenanceBadge provenance={provenance} /> : null}
        </div>
        {onEdit ? (
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="size-8 shrink-0"
            onClick={onEdit}
            aria-label={hasValue ? t('edit', { field: label }) : t('set', { field: label })}
          >
            {hasValue ? <PencilIcon aria-hidden /> : <PlusIcon aria-hidden />}
          </Button>
        ) : null}
      </dd>
    </div>
  )
}

/**
 * The pill that divides groups of rows (the Platform's `category` property): a centred label on a
 * hairline. Pure layout, it holds no value.
 */
export function FieldGroupDivider({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative px-4 py-3">
      <div aria-hidden className="absolute inset-0 flex items-center px-4">
        <div className="w-full border-t" />
      </div>
      <div className="relative flex justify-center">
        <span className="inline-flex items-center rounded-full bg-card px-3 py-1 text-sm font-semibold text-foreground ring-1 ring-border ring-inset">
          {children}
        </span>
      </div>
    </div>
  )
}
