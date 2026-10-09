// The Integration tab's cards in the order a manager works through them: connect, see the status,
// choose the barsy venue and the catalogue, set the mapping, sync, follow the runs. Plain data in
// (see server/integration/view.ts); no secret is ever in it.
import { useTranslations } from 'next-intl'

import type { IntegrationView } from '@/server/integration/view'

import { BarsyVenueCard } from './barsy-venue-card'
import { CatalogueRootCard } from './catalogue-root-card'
import { ConnectCard } from './connect-card'
import { LiveRefresh } from './live-refresh'
import { MappingCard } from './mapping-card'
import { RunHistoryCard } from './run-history-card'
import { StatusCard } from './status-card'
import { SyncCard } from './sync-card'

export function IntegrationPanel({ venueId, view }: { venueId: string; view: IntegrationView }) {
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
      <ConnectCard venueId={venueId} view={view} />
      <StatusCard venueId={venueId} view={view} />
      <BarsyVenueCard venueId={venueId} view={view} />
      <CatalogueRootCard venueId={venueId} view={view} />
      <MappingCard venueId={venueId} view={view} />
      <SyncCard venueId={venueId} view={view} />
      <RunHistoryCard view={view} />
    </div>
  )
}
