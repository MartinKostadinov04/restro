// Part 2's side of the end of the night (#115): the one place that builds what fills the slots of
// `night-slots.ts` — the money rows of To fix, sections 3–6 and the money totals — from the
// payments' own reads (`payment-load.ts`), each as a server-rendered node of the client parts in
// `night-payments.tsx`. The page already draws, orders and permission-filters them: a section the
// role may not see is not rendered at all.
import { getTranslations } from 'next-intl/server'
import type { NightScope } from '@/server/tonight/night-load'
import type { Frame, NightView } from '@/server/tonight/night-view'
import { loadNightPayments } from '@/server/tonight/payment-load'
import { Section } from './night-page'
import {
  NightDisputes,
  NightMoneyAlerts,
  NightMoneyTotals,
  NightPayFixRows,
  NightPaymentsList,
  NightRefunds,
} from './night-payments'
import { type NightSectionSlot, type NightSlots, NO_SLOTS } from './night-slots'

export async function nightSlots(
  scope: NightScope,
  night: NightView,
  frame: Frame,
): Promise<NightSlots> {
  const read = await loadNightPayments(scope, { day: night.day })
  // A night whose payments cannot be read still draws the rest of the page.
  if (!read.ok) return NO_SLOTS
  const t = await getTranslations('tonight')
  const { payments } = read
  const fixCount =
    payments.fix.length + payments.noReceipt.length + (payments.paying === null ? 0 : 1)

  const sections: NightSectionSlot[] = [
    {
      id: 'payments',
      label: t('nt_pay'),
      node: (
        <Section id="night-payments-body" title={t('nt_pay')} count={payments.counts.all}>
          <NightPaymentsList initial={payments} frame={frame} />
        </Section>
      ),
    },
  ]
  const money = payments.money
  if (payments.counts.all > 0 && money !== null) {
    const add = (
      id: NightSectionSlot['id'],
      title: string,
      count: number,
      node: React.ReactNode,
    ) =>
      count === 0
        ? null
        : sections.push({
            id,
            label: title,
            node: (
              <Section id={`night-${id}-body`} title={title} count={count}>
                {node}
              </Section>
            ),
          })
    add(
      'money_alerts',
      t('nt_malerts'),
      money.alerts.length,
      <NightMoneyAlerts alerts={money.alerts} />,
    )
    add('refunds', t('nt_refunds'), money.refunds.length, <NightRefunds refunds={money.refunds} />)
    add(
      'disputes',
      t('nt_disputes'),
      money.disputes.length,
      <NightDisputes disputes={money.disputes} />,
    )
  }

  return {
    fix:
      fixCount === 0 ? null : (
        <NightPayFixRows payments={payments} frame={frame} today={night.today} />
      ),
    fixCount,
    sections,
    totals:
      night.money === null ? null : (
        <NightMoneyTotals money={night.money} currency={frame.currency} />
      ),
  }
}
