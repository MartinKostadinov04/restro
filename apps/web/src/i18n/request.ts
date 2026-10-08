import { cookies } from 'next/headers'
import { getRequestConfig } from 'next-intl/server'

import { LOCALE_COOKIE, resolveAdminLocale } from './locales'

// next-intl without routing: the locale of every request is the cookie, Bulgarian by default.
export default getRequestConfig(async () => {
  const locale = resolveAdminLocale((await cookies()).get(LOCALE_COOKIE)?.value)
  return {
    locale,
    messages: (await import(`../../messages/${locale}.json`)).default,
  }
})
