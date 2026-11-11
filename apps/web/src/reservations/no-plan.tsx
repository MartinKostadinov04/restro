'use client'

// "No floor plan yet" (#397): what every reservation screen that offers the plan shows when the
// venue has none, or has one with no spots on it. It never says someone else will draw it: the
// person who may draw it gets one button to Settings › Reservations, everyone else is told plainly
// who does. A booking can still be taken without a spot; this block only replaces the plan.
import Link from 'next/link'
import { useTranslations } from 'next-intl'

import { Button } from '@/components/ui/button'
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from '@/components/ui/empty'
import { WRAPS } from '@/lib/wrapping'
import type { RvFrame } from '@/server/reservations/view'

/** Where the plan is drawn. */
export const planEditorHref = (venueId: string) =>
  `/venues/${venueId}?tab=settings&section=reservations`

export function NoPlanYet({
  frame,
  noSpots = false,
  testId = 'rv-no-plan',
}: {
  frame: RvFrame
  /** The venue has a plan, but nothing on it yet. */
  noSpots?: boolean
  testId?: string
}) {
  const t = useTranslations('reservations')
  return (
    <Empty className="border p-6 md:p-6" data-testid={testId}>
      <EmptyHeader>
        <EmptyTitle>{noSpots ? t('np_spots_t') : t('np_t')}</EmptyTitle>
        <EmptyDescription>{frame.can.plan ? t('np_owner') : t('np_staff')}</EmptyDescription>
      </EmptyHeader>
      {frame.can.plan ? (
        <EmptyContent>
          <Button asChild className={WRAPS}>
            <Link href={planEditorHref(frame.venueId)} data-testid={`${testId}-go`}>
              {t('np_go')}
            </Link>
          </Button>
        </EmptyContent>
      ) : null}
    </Empty>
  )
}
