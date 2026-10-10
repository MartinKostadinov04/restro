'use client'

// What the last press came to, in words: "Version 3 is live", why a publish was refused, or why an
// action was not done. A refusal is an answer, not a fault, so it is worded calmly; "nothing was
// published" is said whenever it is true.
import { CheckCircle2Icon, InfoIcon, XIcon } from 'lucide-react'
import { useTranslations } from 'next-intl'

import { Button } from '@/components/ui/button'
import type { Outcome } from './use-publisher'

export function OutcomeNote({
  outcome,
  slow,
  onDismiss,
}: {
  outcome: Outcome | null
  /** A queued publish has had no answer for a long time. */
  slow: boolean
  onDismiss: () => void
}) {
  const t = useTranslations('publish')
  if (outcome === null) {
    return slow ? (
      <p role="status" className="text-sm text-muted-foreground" data-testid="publish-slow">
        {t('outcome.slow')}
      </p>
    ) : null
  }

  const good = outcome.kind === 'published' || outcome.kind === 'returned'
  const Icon = good ? CheckCircle2Icon : InfoIcon
  let title: string
  let text: string | null = null
  switch (outcome.kind) {
    case 'published':
      title =
        outcome.version === null
          ? t('outcome.publishedText')
          : t('outcome.published', { version: outcome.version })
      text = outcome.version === null ? null : t('outcome.publishedText')
      break
    case 'unchanged':
      title =
        outcome.version === null
          ? t('outcome.failed')
          : t('outcome.unchanged', { version: outcome.version })
      break
    case 'refused':
      title = t(`outcome.${outcome.refusal}`)
      break
    case 'failed':
      title = t('outcome.failed')
      break
    case 'returned':
      title = t('returned', { version: outcome.version })
      break
    case 'error':
      title = t(`errors.${outcome.error}`)
      break
  }

  return (
    <div
      role={good ? 'status' : 'alert'}
      data-testid="publish-outcome"
      data-kind={outcome.kind}
      className={`flex items-start gap-3 rounded-lg border p-4 text-sm ${
        good ? 'border-success/30 bg-success/10' : 'border-border bg-muted/40'
      }`}
    >
      <Icon aria-hidden className={`mt-0.5 size-4 shrink-0 ${good ? 'text-success' : ''}`} />
      <div className="grid flex-1 gap-1">
        <p className="font-medium" data-testid="publish-outcome-title">
          {title}
        </p>
        {text !== null ? <p className="text-muted-foreground">{text}</p> : null}
      </div>
      <Button type="button" variant="ghost" size="icon-xs" onClick={onDismiss}>
        <XIcon aria-hidden />
        <span className="sr-only">{t('dismiss')}</span>
      </Button>
    </div>
  )
}
