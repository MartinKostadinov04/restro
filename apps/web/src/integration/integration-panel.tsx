// The cards of Settings -> Integrations in the order a manager works through them (D73): connect,
// see the status and warnings, set up the installation's venues, say how its data is read, sync
// (by itself and now), follow the runs of every venue. Plain data in (see
// server/integration/view.ts); no secret is ever in it.
import { useTranslations } from 'next-intl'

import type { IntegrationView } from '@/server/integration/view'

import { ConnectCard } from './connect-card'
import { LiveRefresh } from './live-refresh'
import { MappingCard } from './mapping-card'
import { RunHistoryCard } from './run-history-card'
import { StatusCard } from './status-card'
import { SyncCard } from './sync-card'
import { TillVenuesCard } from './till-venues-card'

export function IntegrationPanel({ view }: { view: IntegrationView }) {
  const t = useTranslations('integration')
  return (
    <div className="grid gap-8 pt-2" data-testid="integration-panel">
      <LiveRefresh active={view.activeJob !== null} />
      {view.canManage ? null : (
        <p
          className="rounded-md border bg-muted/40 p-3 text-sm text-muted-foreground"
          data-testid="read-only"
        >
          {t('readOnly')}
        </p>
      )}
      <ConnectCard view={view} />
      <StatusCard view={view} />
      <TillVenuesCard view={view} />
      <MappingCard view={view} />
      <SyncCard view={view} />
      <RunHistoryCard view={view} />
    </div>
  )
}
