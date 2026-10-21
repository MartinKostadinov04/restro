'use client'

// The address card of the Tables & QR tab (briefs S3-07, S5; D94): where the codes lead, read-only.
// The codes carry this installation's address (`<address>/t/<code>`): a venue no longer types a base
// address or an own-link pattern, and a domain of your own (Organisation › Domains) comes later.
// What stays is the test link, which the manager's own browser opens in a new tab, and the warning
// that stickers already printed keep the address they were printed with.
import { ourAddress } from '@restro/core'
import { ExternalLinkIcon } from 'lucide-react'
import { useTranslations } from 'next-intl'

import { Button } from '@/components/ui/button'
import { FormSection } from '@/components/ui/form-section'
import type { TablesView } from '@/server/tables/view'

export function QrAddressCard({ view }: { view: TablesView }) {
  const t = useTranslations('tables.address')
  const testAddress =
    view.sample === null || view.baseUrl === null
      ? null
      : ourAddress(view.baseUrl, view.sample.token)

  return (
    <FormSection title={t('title')} description={t('description')}>
      <div className="grid gap-4" data-testid="qr-address-card">
        {view.baseUrl === null ? (
          <p className="text-sm text-destructive" role="alert" data-testid="qr-address-none">
            {t('none')}
          </p>
        ) : (
          <div className="grid gap-1">
            <p className="text-xs font-medium text-muted-foreground">{t('leads')}</p>
            <code className="font-mono text-sm break-all" data-testid="qr-address">
              {ourAddress(view.baseUrl, '<code>')}
            </code>
          </div>
        )}
        <p className="text-xs text-muted-foreground" data-testid="qr-address-warning">
          {t('warning')}
        </p>
        <p className="text-xs text-muted-foreground" data-testid="qr-address-domain">
          {t('domainLater')}
        </p>
        <div className="grid gap-2 rounded-md bg-muted/50 p-3">
          <div className="flex flex-wrap items-center gap-3">
            {testAddress === null ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled
                data-testid="open-test-link"
              >
                <ExternalLinkIcon aria-hidden />
                {t('testLink')}
              </Button>
            ) : (
              <Button asChild variant="outline" size="sm">
                <a
                  href={testAddress}
                  target="_blank"
                  rel="noopener noreferrer"
                  data-testid="open-test-link"
                >
                  <ExternalLinkIcon aria-hidden />
                  {t('testLink')}
                </a>
              </Button>
            )}
            <span className="text-xs text-muted-foreground">
              {view.sample === null ? t('testLinkNone') : t('testLinkHint')}
            </span>
          </div>
        </div>
      </div>
    </FormSection>
  )
}
