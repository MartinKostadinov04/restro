import { redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'

import { LoginForm } from '@/components/auth/login-form'
import { LocaleToggle } from '@/components/locale-toggle'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { safeNextPath } from '@/lib/safe-next'
import { getAccess } from '@/server/session'

export async function generateMetadata() {
  const t = await getTranslations('auth')
  return { title: t('title') }
}

export default async function LoginPage({ searchParams }: PageProps<'/login'>) {
  const next = safeNextPath((await searchParams).next)
  // Already signed in (a real check, not just a cookie): nothing to do here.
  if (await getAccess()) redirect(next)

  const t = await getTranslations('auth')
  return (
    <main className="flex min-h-svh flex-col items-center justify-center gap-6 p-6">
      <div className="absolute top-4 right-4">
        <LocaleToggle />
      </div>
      <div className="flex flex-col items-center gap-2 text-center">
        <div className="flex size-10 items-center justify-center rounded-lg bg-primary text-lg font-semibold text-primary-foreground">
          R
        </div>
        <p className="text-xl font-semibold tracking-tight">Restro</p>
      </div>
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>
            <h1>{t('title')}</h1>
          </CardTitle>
          <CardDescription>{t('description')}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          <LoginForm next={next} />
          <p className="text-center text-sm text-muted-foreground">{t('inviteOnly')}</p>
        </CardContent>
      </Card>
    </main>
  )
}
