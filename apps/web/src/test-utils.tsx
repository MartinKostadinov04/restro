// Helpers for the web app's component tests (jsdom). Not part of the app.
import { type RenderOptions, render } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'
import type { ReactElement, ReactNode } from 'react'

import bg from '../messages/bg.json'
import en from '../messages/en.json'
import type { AdminLocale } from './i18n/locales'

export const MESSAGES = { bg, en } as const

/** Renders with the real messages of one interface language, English unless told otherwise. */
export function renderWithIntl(
  ui: ReactElement,
  { locale = 'en', ...options }: { locale?: AdminLocale } & Omit<RenderOptions, 'wrapper'> = {},
) {
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <NextIntlClientProvider locale={locale} messages={MESSAGES[locale]}>
        {children}
      </NextIntlClientProvider>
    )
  }
  return render(ui, { wrapper: Wrapper, ...options })
}
