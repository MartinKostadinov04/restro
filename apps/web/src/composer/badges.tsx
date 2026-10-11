'use client'

// The small status badges on every composer row: where it comes from (From {source} / Owned
// here), why it is hidden (Hidden by {source} / Hidden), and how many problems the resolver found.
// `{source}` is the name of the till the menu comes from (`useTillLabel`, brief CF-03).
import type { Locale } from '@restro/core'
import { useLocale, useTranslations } from 'next-intl'

import { Badge } from '@/components/ui/badge'
import { HoverCard, HoverCardContent, HoverCardTrigger } from '@/components/ui/hover-card'
import { useTillLabel } from '@/fields/till-label'

import type { ComposerIssue, ComposerOrigin, ItemHiddenBy, ItemOffSale } from './view-model'

/** From {source} (mirrors an object of the till) or Owned here (made in the composer). */
export function OriginBadge({ origin }: { origin: ComposerOrigin }) {
  const t = useTranslations('composer.badges')
  const source = useTillLabel()
  return origin === 'till' ? (
    <Badge variant="info" data-testid="origin-badge" data-origin="till">
      {t('fromTill', { source })}
    </Badge>
  ) : (
    <Badge variant="success" data-testid="origin-badge" data-origin="owned">
      {t('owned')}
    </Badge>
  )
}

/** Why something is hidden: the till hides it (not ours to change) or we do. */
export function HiddenBadge({ hiddenBy }: { hiddenBy: ItemHiddenBy | 'section' }) {
  const t = useTranslations('composer.badges')
  const source = useTillLabel()
  if (hiddenBy === 'till') {
    return (
      <Badge variant="warning" data-testid="hidden-badge" data-hidden-by="till">
        {t('hiddenByTill', { source })}
      </Badge>
    )
  }
  if (hiddenBy === 'new_from_till') {
    return (
      <Badge variant="warning" data-testid="hidden-badge" data-hidden-by="new_from_till">
        {t('newFromTill', { source })}
      </Badge>
    )
  }
  return (
    <Badge variant="secondary" data-testid="hidden-badge" data-hidden-by={hiddenBy}>
      {hiddenBy === 'other' ? t('hiddenOther') : t('hidden')}
    </Badge>
  )
}

/**
 * Where an item stands on sale (brief S3-08, D46): "Sold out tonight" for a manager's mark, "Not
 * on sale in {source}" when the till has it off sale (ours cannot undo that, rule 5). Renders
 * nothing for an item that is on sale.
 */
export function SaleBadge({
  soldOutTonight,
  offSale,
}: {
  soldOutTonight: boolean
  offSale: ItemOffSale | null
}) {
  const t = useTranslations('composer.badges')
  const source = useTillLabel()
  if (offSale !== null) {
    return (
      <Badge variant="warning" data-testid="off-sale-badge" data-off-sale={offSale}>
        {offSale === 'till' ? t('offSaleTill', { source }) : t('offSaleOther')}
      </Badge>
    )
  }
  if (!soldOutTonight) return null
  return (
    <Badge variant="danger" data-testid="sold-out-badge">
      {t('soldOutTonight')}
    </Badge>
  )
}

/** Issue codes that have their own message; any other code gets the general one. */
const KNOWN_ISSUES = new Set([
  'V3',
  'V4',
  'V5',
  'V6',
  'V7',
  'V9',
  'stale_override',
  'link_missing',
  'link_deleted',
  'invalid_value',
  'ignored_value',
  'required_missing',
  'group_min_max',
  'required_group_unsatisfiable',
  'translation_review',
  'price_not_venue_scoped',
  'unplaced_item',
  'orphan_node',
])

/** The sentence for one issue, in the interface language. */
export function useIssueText(): (issue: ComposerIssue) => string {
  const t = useTranslations('composer.issues')
  const source = useTillLabel()
  const uiLocale = useLocale()
  const names = new Intl.DisplayNames([uiLocale], { type: 'language' })
  const languageName = (locale: Locale | undefined) =>
    locale === undefined ? '' : (names.of(locale.split('_')[0] ?? locale) ?? locale)
  return (issue) =>
    KNOWN_ISSUES.has(issue.code)
      ? t(issue.code, { language: languageName(issue.locale), source })
      : t('fallback')
}

/**
 * The number of problems on a row; hover or focus lists them. Warnings are amber, a problem that
 * keeps the item off the guest menu is red. Renders nothing when there are none.
 */
export function IssuesBadge({ issues }: { issues: readonly ComposerIssue[] }) {
  const t = useTranslations('composer.badges')
  const issueText = useIssueText()
  if (issues.length === 0) return null
  const blocking = issues.some((issue) => issue.severity === 'block_node')
  return (
    <HoverCard openDelay={150}>
      <HoverCardTrigger asChild>
        <button
          type="button"
          className="rounded-full focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
          data-testid="issues-badge"
          data-count={issues.length}
        >
          <Badge variant={blocking ? 'danger' : 'warning'}>
            {t('issues', { count: issues.length })}
          </Badge>
        </button>
      </HoverCardTrigger>
      <HoverCardContent className="grid w-72 gap-1.5 text-sm">
        {issues.map((issue) => (
          <p key={`${issue.code}:${issue.fieldKey ?? ''}:${issue.locale ?? ''}`}>
            {issueText(issue)}
          </p>
        ))}
      </HoverCardContent>
    </HoverCard>
  )
}
