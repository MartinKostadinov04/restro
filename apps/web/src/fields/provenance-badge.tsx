'use client'

import { LockIcon } from 'lucide-react'
import { useTranslations } from 'next-intl'

import { Badge } from '@/components/ui/badge'

import type { Provenance } from './types'

const VARIANT = {
  barsy: 'info',
  owned: 'success',
  overridden: 'warning',
  stale: 'danger',
  locked: 'secondary',
} as const satisfies Record<Provenance, 'info' | 'success' | 'warning' | 'danger' | 'secondary'>

/**
 * Where a value comes from: From barsy / Owned here / Overridden / Stale / Locked. The slot of
 * every FieldRow; the item sheet fills it from the resolver's layers (CLAUDE.md rule 2), the
 * preview passes it by hand.
 */
export function ProvenanceBadge({ provenance }: { provenance: Provenance }) {
  const t = useTranslations('fields.provenance')
  return (
    <Badge variant={VARIANT[provenance]} data-provenance={provenance}>
      {provenance === 'locked' ? <LockIcon aria-hidden /> : null}
      {t(provenance)}
    </Badge>
  )
}
