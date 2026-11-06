'use client'

// The line under a switch that waits for the venue's privacy notice link (RR-O15, RR-O44; Martin
// 11-06): the location check and ordering from the phone turn on only once the venue has one, since
// the guest's consent ends with it (D121). `need`: the switch is off and stays off until then.
// `missing` and `ordering`: it is already on (a live venue is never switched off), and guests are
// shown no link. The link is set with the venue's legal details on Settings › Ordering (#288).
import Link from 'next/link'
import { useTranslations } from 'next-intl'
import type { ReactNode } from 'react'

export function PrivacyLine({
  state,
  href,
  testId,
}: {
  state: 'need' | 'missing' | 'ordering'
  /** The legal details' form on Settings › Ordering. */
  href: string
  testId: string
}) {
  const t = useTranslations('ownerSettings')
  const link = (chunks: ReactNode) => (
    <Link href={href} className="underline underline-offset-2">
      {chunks}
    </Link>
  )
  const key =
    state === 'need'
      ? 'st_privacy_need'
      : state === 'missing'
        ? 'st_privacy_missing'
        : 'st_privacy_ordering'
  return (
    <p className="text-sm text-muted-foreground" data-testid={testId}>
      {t.rich(key, { link })}
    </p>
  )
}
