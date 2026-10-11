import type { Metadata } from 'next'
import { NextIntlClientProvider } from 'next-intl'
import { getLocale, getTranslations } from 'next-intl/server'
import type { ReactNode } from 'react'

import { Toaster } from '@/components/ui/sonner'
import { FONT_VARIABLES } from '@/fonts'
import { THEME_INIT_SCRIPT } from '@/lib/theme'

import './globals.css'

// The six fonts of the venues' look (src/fonts.ts) are defined once, here, as `--font-<id>`
// variables: the admin uses Inter (it has Cyrillic, the Platform's Instrument Sans does not), and
// the guest page and the previews use whichever font the venue chose. `next/font` serves the files
// from this app; the browser never calls Google.

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('meta')
  return {
    title: { default: 'Restro', template: '%s · Restro' },
    description: t('description'),
  }
}

export default async function RootLayout({ children }: { children: ReactNode }) {
  const locale = await getLocale()
  return (
    // suppressHydrationWarning: the inline script below sets the `dark` class before React runs.
    <html lang={locale} className={FONT_VARIABLES} suppressHydrationWarning>
      <head>
        {/* biome-ignore lint/security/noDangerouslySetInnerHtml: a constant script from lib/theme.ts, no user input */}
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body className="min-h-svh bg-background font-sans text-foreground antialiased">
        <NextIntlClientProvider>{children}</NextIntlClientProvider>
        {/* The one Toaster of the admin: pages never mount their own. */}
        <Toaster position="top-right" richColors />
      </body>
    </html>
  )
}
