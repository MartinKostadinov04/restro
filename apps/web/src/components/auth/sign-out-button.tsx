'use client'

import { LogOutIcon } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { stopPushOnThisBrowser } from '@/tonight/push-device'

import { endSession } from './sign-out'

/** A plain sign-out button for pages outside the admin frame. */
export function SignOutButton() {
  const t = useTranslations('user')
  const router = useRouter()

  async function signOut() {
    await stopPushOnThisBrowser()
    if (!(await endSession())) {
      toast.error(t('signOutFailed'))
      return
    }
    router.replace('/login')
    router.refresh()
  }

  return (
    <Button type="button" variant="outline" onClick={signOut}>
      <LogOutIcon aria-hidden />
      {t('signOut')}
    </Button>
  )
}
