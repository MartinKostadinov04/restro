import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import { NextIntlClientProvider } from 'next-intl'
import { getLocale, getTranslations } from 'next-intl/server'
import type { ReactNode } from 'react'

import { Toaster } from '@/components/ui/sonner'
import { THEME_INIT_SCRIPT } from '@/lib/theme'

import './globals.css'

// Inter has Cyrillic (the Platform's Instrument Sans does not). `next/font` downloads the files
// at build time and serves them from this app: the browser never calls Google. Only the Latin
// and Cyrillic subsets, only the weights the admin uses (regular, medium, semibold).
const inter = Inter({
  subsets: ['latin', 'cyrillic'],
  weight: ['400', '500', '600'],
  variable: '--font-inter',
  display: 'swap',
})

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
    <html lang={locale} className={inter.variable} suppressHydrationWarning>
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
