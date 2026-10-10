import { redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'

import { SignOutButton } from '@/components/auth/sign-out-button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { requireAccess } from '@/server/session'

export async function generateMetadata() {
  const t = await getTranslations('noOrganization')
  return { title: t('title') }
}

// A signed-in person who belongs to no organisation has nothing to see: the admin is invite-only.
export default async function NoOrganizationPage() {
  const access = await requireAccess()
  if (access.organization) redirect('/venues')

  const t = await getTranslations('noOrganization')
  return (
    <main className="flex min-h-svh items-center justify-center p-6">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>
            <h1>{t('title')}</h1>
          </CardTitle>
          <CardDescription>{t('description', { email: access.user.email })}</CardDescription>
        </CardHeader>
        <CardContent>
          <SignOutButton />
        </CardContent>
      </Card>
    </main>
  )
}
