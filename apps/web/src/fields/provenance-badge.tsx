'use client'

import { useTranslations } from 'next-intl'

import { Badge } from '@/components/ui/badge'

import type { Provenance } from './types'

const VARIANT = {
  barsy: 'info',
  owned: 'success',
  overridden: 'warning',
  stale: 'danger',
} as const satisfies Record<Provenance, 'info' | 'success' | 'warning' | 'danger'>

/**
 * Where a value comes from: From barsy / Owned here / Overridden / Stale. The slot of every
 * FieldRow; Stage 2 fills it from the layers (CLAUDE.md rule 2), the preview passes it by hand.
 */
export function ProvenanceBadge({ provenance }: { provenance: Provenance }) {
  const t = useTranslations('fields.provenance')
  return (
    <Badge variant={VARIANT[provenance]} data-provenance={provenance}>
      {t(provenance)}
    </Badge>
  )
}
