'use client'

import { LogOutIcon } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'

import { Button } from '@/components/ui/button'
import { authClient } from '@/lib/auth-client'

/** A plain sign-out button for pages outside the admin frame. */
export function SignOutButton() {
  const t = useTranslations('user')
  const router = useRouter()

  async function signOut() {
    await authClient.signOut()
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
