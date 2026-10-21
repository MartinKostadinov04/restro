'use client'

import { useTranslations } from 'next-intl'

import type { IntegrationErrorCode } from '@/server/integration/view'

/**
 * The words for a refused action (messages `integration.errors`), as an alert under the field.
 * `source` is the system's name for the messages that name it (`{source}`).
 */
export function ErrorNote({
  code,
  source = '',
}: {
  code: IntegrationErrorCode | null
  source?: string
}) {
  const t = useTranslations('integration.errors')
  if (code === null) return null
  return (
    <p role="alert" className="text-sm text-destructive" data-testid="integration-error">
      {t(code, { source })}
    </p>
  )
}

/** A confirmation under a card's buttons (`role="status"`, read out politely). */
export function Notice({ children }: { children: React.ReactNode }) {
  return (
    <p role="status" className="text-sm text-muted-foreground" data-testid="integration-notice">
      {children}
    </p>
  )
}
