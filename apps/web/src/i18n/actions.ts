'use server'

import { revalidatePath } from 'next/cache'
import { cookies } from 'next/headers'

import { isAdminLocale, LOCALE_COOKIE } from './locales'

const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365

/** Stores the interface language in the cookie and re-renders the current page in it. */
export async function setAdminLocale(locale: string): Promise<void> {
  if (!isAdminLocale(locale)) return
  const store = await cookies()
  store.set(LOCALE_COOKIE, locale, {
    path: '/',
    maxAge: ONE_YEAR_SECONDS,
    sameSite: 'lax',
    httpOnly: false,
  })
  revalidatePath('/', 'layout')
}
