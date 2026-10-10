'use client'

// The small status badges on every composer row: where it comes from (From barsy / Owned here),
// why it is hidden (Hidden by barsy / Hidden), and how many problems the resolver found.
import type { Locale } from '@restro/core'
import { useLocale, useTranslations } from 'next-intl'

import { Badge } from '@/components/ui/badge'
import { HoverCard, HoverCardContent, HoverCardTrigger } from '@/components/ui/hover-card'

import type { ComposerIssue, ComposerOrigin, ItemHiddenBy } from './view-model'

/** From barsy (mirrors a barsy article or category) or Owned here (made in the composer). */
export function OriginBadge({ origin }: { origin: ComposerOrigin }) {
  const t = useTranslations('composer.badges')
  return origin === 'barsy' ? (
    <Badge variant="info" data-testid="origin-badge" data-origin="barsy">
      {t('barsy')}
    </Badge>
  ) : (
    <Badge variant="success" data-testid="origin-badge" data-origin="owned">
      {t('owned')}
    </Badge>
  )
}

/** Why something is hidden: barsy hides it (not ours to change) or we do. */
export function HiddenBadge({ hiddenBy }: { hiddenBy: ItemHiddenBy | 'section' }) {
  const t = useTranslations('composer.badges')
  if (hiddenBy === 'barsy') {
    return (
      <Badge variant="warning" data-testid="hidden-badge" data-hidden-by="barsy">
        {t('hiddenByBarsy')}
      </Badge>
    )
  }
  if (hiddenBy === 'new_from_barsy') {
    return (
      <Badge variant="warning" data-testid="hidden-badge" data-hidden-by="new_from_barsy">
        {t('newFromBarsy')}
      </Badge>
    )
  }
  return (
    <Badge variant="secondary" data-testid="hidden-badge" data-hidden-by={hiddenBy}>
      {hiddenBy === 'other' ? t('hiddenOther') : t('hidden')}
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
  const uiLocale = useLocale()
  const names = new Intl.DisplayNames([uiLocale], { type: 'language' })
  const languageName = (locale: Locale | undefined) =>
    locale === undefined ? '' : (names.of(locale.split('_')[0] ?? locale) ?? locale)
  return (issue) =>
    KNOWN_ISSUES.has(issue.code)
      ? t(issue.code, { language: languageName(issue.locale) })
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
