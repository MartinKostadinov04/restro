// The Tonight tab, a server component (U4): it reads the open view through the service read side
// as the signed-in account (a shared device's account sees what Staff see, a person's session what
// their role holds) and hands the screens plain data. Nothing here writes; the writes are the
// server actions in server/tonight/actions.ts, which the service write path checks again.
//
// The views (#85, #86): Actions and tables (screen 1), Sent orders (2), the Log (3, for
// `log.view`) and End of night (4, for `night.view` or `night.view_full`). A view the role may not
// open is not listed and its link opens the first view.
import type { Venue } from '@restro/db'
import { getLocale, getTranslations } from 'next-intl/server'

import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@/components/ui/empty'
import { webPushPublicKey } from '@/server/env'
import { rememberedAtSharedDevice } from '@/server/staff/service'
import { loadTonightView } from '@/server/tonight/load'
import {
  loadLog,
  loadNight,
  loadNightAccess,
  loadSentOrders,
  type NightScope,
} from '@/server/tonight/night-load'

import { LogTab } from './log-tab'
import { NightFailed, NightPage } from './night-page'
import { nightSlots } from './night-slots-part2'
import { SentOrdersTab } from './sent-orders-tab'
import { FailedBlock } from './tab-parts'
import { TonightPanel } from './tonight-panel'
import { TonightTabs } from './tonight-tabs'
import { isTonightView, TONIGHT_VIEW_NAMES, type TonightViewName } from './tonight-views'

export async function TonightTab({
  tenantId,
  venue,
  userId,
  email,
  sessionId,
  view,
  day,
}: {
  tenantId: string
  venue: Venue
  userId: string
  /** The account's, for the password asked again when it makes this browser the bar tablet. */
  email: string
  sessionId: string
  /** `?view=`: which of Tonight's screens is open. */
  view?: string | undefined
  /** `?day=`: the night of the Log and the end of the night. */
  day?: string | undefined
}) {
  const t = await getTranslations('tonight')
  // On a shared device, whether the person who typed a PIN a moment ago is still on it: the
  // screens then ask for no PIN before a write, because that PIN started their own short session
  // (D141 12.11, #324). The device's account still reads the screens.
  const remembered = await rememberedAtSharedDevice({ tenantId, venueId: venue.id, sessionId })
  const scope: NightScope = {
    tenantId,
    venue,
    actor: { kind: 'user', userId, sessionId },
    remembered,
    // A venue with no POS still reads right where a sentence names its system.
    sourceNone: t('source_none'),
  }
  const access = await loadNightAccess(scope)
  if (!access.ok) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyTitle>{t('title')}</EmptyTitle>
          <EmptyDescription>{t('noAccess')}</EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  }
  const held = new Set<string>(access.access.permissions)
  const views = TONIGHT_VIEW_NAMES.filter(
    (name) =>
      name === 'actions' ||
      name === 'sent' ||
      (name === 'log' && held.has('log.view')) ||
      (name === 'night' && (held.has('night.view') || held.has('night.view_full'))),
  )
  const open: TonightViewName = isTonightView(view) && views.includes(view) ? view : 'actions'

  let content: React.ReactNode
  if (open === 'actions') {
    const result = await loadTonightView({ tenantId, venue, userId, sessionId, remembered })
    content = result.ok ? (
      <TonightPanel
        view={result.view}
        pushKey={result.view.can.answer ? webPushPublicKey() : undefined}
        tablet={result.view.barTablet ? { email } : undefined}
      />
    ) : (
      <Empty>
        <EmptyHeader>
          <EmptyTitle>{t('title')}</EmptyTitle>
          <EmptyDescription>{t('noAccess')}</EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  } else if (open === 'sent') {
    const result = await loadSentOrders(scope, {})
    content = result.ok ? (
      <SentOrdersTab initial={result.list} frame={result.frame} />
    ) : (
      <FailedBlock text={t('so_fail')} />
    )
  } else if (open === 'log') {
    const result = await loadLog(scope, {
      locale: (await getLocale()) === 'en' ? 'en' : 'bg',
      ...(day === undefined ? {} : { day }),
    })
    content = result.ok ? (
      <LogTab key={result.log.day} initial={result.log} frame={result.frame} />
    ) : (
      <FailedBlock text={t('lg_fail')} />
    )
  } else {
    const result = await loadNight(scope, day === undefined ? {} : { day })
    content = result.ok ? (
      <NightPage
        key={result.night.day}
        view={result.night}
        frame={result.frame}
        slots={await nightSlots(scope, result.night, result.frame)}
      />
    ) : (
      <NightFailed />
    )
  }

  return <TonightTabs views={views} contents={{ [open]: content }} />
}
