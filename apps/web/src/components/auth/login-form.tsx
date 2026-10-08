'use client'

import { zodResolver } from '@hookform/resolvers/zod'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { z } from 'zod'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { authClient } from '@/lib/auth-client'

const LoginSchema = z.object({
  email: z.email(),
  password: z.string().min(1),
})

type LoginValues = z.infer<typeof LoginSchema>

type LoginError = 'invalid' | 'tooMany' | 'unknown'

/** Email + password sign-in against Better Auth's HTTP API. There is no sign-up link: invite-only. */
export function LoginForm({ next }: { next: string }) {
  const t = useTranslations('auth')
  const router = useRouter()
  const [error, setError] = useState<LoginError | null>(null)
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginValues>({
    resolver: zodResolver(LoginSchema),
    defaultValues: { email: '', password: '' },
  })

  async function onSubmit(values: LoginValues) {
    setError(null)
    const { error: failure } = await authClient.signIn.email({
      email: values.email,
      password: values.password,
    })
    if (failure) {
      setError(failure.status === 429 ? 'tooMany' : failure.status === 401 ? 'invalid' : 'unknown')
      return
    }
    router.replace(next)
    router.refresh()
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="grid gap-4" noValidate>
      <div className="grid gap-2">
        <Label htmlFor="email">{t('email')}</Label>
        <Input
          id="email"
          type="email"
          autoComplete="username"
          autoFocus
          aria-invalid={errors.email ? true : undefined}
          {...register('email')}
        />
        {errors.email ? (
          <p className="text-sm text-destructive" role="alert">
            {t('emailInvalid')}
          </p>
        ) : null}
      </div>
      <div className="grid gap-2">
        <Label htmlFor="password">{t('password')}</Label>
        <Input
          id="password"
          type="password"
          autoComplete="current-password"
          aria-invalid={errors.password ? true : undefined}
          {...register('password')}
        />
        {errors.password ? (
          <p className="text-sm text-destructive" role="alert">
            {t('passwordRequired')}
          </p>
        ) : null}
      </div>
      {error ? (
        <p className="text-sm text-destructive" role="alert" data-testid="login-error">
          {t(`error.${error}`)}
        </p>
      ) : null}
      <Button type="submit" disabled={isSubmitting}>
        {isSubmitting ? t('signingIn') : t('signIn')}
      </Button>
    </form>
  )
}
