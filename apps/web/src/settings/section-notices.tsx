'use client'

// The lines every owner-settings section shares (#87, plans' States tables): the section could not
// be read (it asks again by itself), a role that may read but not change, and a shared device,
// where settings never open with a PIN (D122 §7).
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { useEffect } from 'react'

import { Alert, AlertDescription } from '@/components/ui/alert'
import { Empty, EmptyDescription, EmptyHeader } from '@/components/ui/empty'

/** How long a section that failed to load waits before it asks again. */
const RETRY_MS = 10_000

/** "Couldn't load the …. Check the connection; it tries again by itself." */
export function SectionFailed({ what }: { what: 'settings' | 'staff' | 'alerts' }) {
  const t = useTranslations('ownerSettings')
  const router = useRouter()
  useEffect(() => {
    const timer = setInterval(() => router.refresh(), RETRY_MS)
    return () => clearInterval(timer)
  }, [router])
  return (
    <Alert variant="destructive" role="alert" data-testid={`settings-failed-${what}`}>
      <AlertDescription>
        {t(what === 'staff' ? 'sf_fail' : what === 'alerts' ? 'al_fail' : 'st_fail')}
      </AlertDescription>
    </Alert>
  )
}

/** One line at the top of a section a role may read but not change (never disabled controls). */
export function ReadOnlyLine() {
  const t = useTranslations('ownerSettings')
  return (
    <p className="text-sm text-muted-foreground" data-testid="settings-readonly">
      {t('st_readonly')}
    </p>
  )
}

/** The Settings tab on a shared device: nothing else is drawn. */
export function OwnSignInNotice() {
  const t = useTranslations('ownerSettings')
  return (
    <Empty data-testid="settings-own-signin">
      <EmptyHeader>
        <EmptyDescription>{t('st_own_signin')}</EmptyDescription>
      </EmptyHeader>
    </Empty>
  )
}
