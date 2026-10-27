// The Tonight tab, a server component (U4): it reads the night through the service read side as the
// signed-in account (a shared device's account sees what Staff see, a person's session what their
// role holds) and hands the panel plain data. Nothing here writes; the writes are the server
// actions in server/tonight/actions.ts, which the service write path checks again.
import type { Venue } from '@restro/db'
import { getTranslations } from 'next-intl/server'

import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@/components/ui/empty'
import { loadTonightView } from '@/server/tonight/load'

import { TonightPanel } from './tonight-panel'

export async function TonightTab({
  tenantId,
  venue,
  userId,
  sessionId,
}: {
  tenantId: string
  venue: Venue
  userId: string
  sessionId: string
}) {
  const result = await loadTonightView({ tenantId, venue, userId, sessionId })
  if (!result.ok) {
    const t = await getTranslations('tonight')
    return (
      <Empty>
        <EmptyHeader>
          <EmptyTitle>{t('title')}</EmptyTitle>
          <EmptyDescription>{t('noAccess')}</EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  }
  return <TonightPanel view={result.view} />
}
