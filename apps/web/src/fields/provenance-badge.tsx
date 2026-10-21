'use client'

import { LockIcon } from 'lucide-react'
import { useTranslations } from 'next-intl'

import { Badge } from '@/components/ui/badge'

import { useTillLabel } from './till-label'
import type { Provenance } from './types'

const VARIANT = {
  till: 'info',
  owned: 'success',
  overridden: 'warning',
  stale: 'danger',
  locked: 'secondary',
} as const satisfies Record<Provenance, 'info' | 'success' | 'warning' | 'danger' | 'secondary'>

/**
 * Where a value comes from: From {source} / Owned here / Overridden / Stale / Locked, where
 * `{source}` is the name of the till (`useTillLabel`). The slot of every FieldRow; the item sheet
 * fills it from the resolver's layers (CLAUDE.md rule 2), the preview passes it by hand.
 */
export function ProvenanceBadge({ provenance }: { provenance: Provenance }) {
  const t = useTranslations('fields.provenance')
  const source = useTillLabel()
  return (
    <Badge variant={VARIANT[provenance]} data-provenance={provenance}>
      {provenance === 'locked' ? <LockIcon aria-hidden /> : null}
      {t(provenance, { source })}
    </Badge>
  )
}
