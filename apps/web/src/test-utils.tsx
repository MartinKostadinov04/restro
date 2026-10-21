// Helpers for the web app's component tests (jsdom). Not part of the app.
import { type RenderOptions, render } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'
import type { ReactElement, ReactNode } from 'react'

import bg from '../messages/bg.json'
import en from '../messages/en.json'
import { SAMPLE_TILL_LABEL } from './fields/samples'
import { TillLabelProvider } from './fields/till-label'
import type { AdminLocale } from './i18n/locales'

export const MESSAGES = { bg, en } as const

/**
 * Renders with the real messages of one interface language, English unless told otherwise, and a
 * till name for "From {source}" and the like (the first connector kind's, unless told otherwise).
 */
export function renderWithIntl(
  ui: ReactElement,
  {
    locale = 'en',
    tillLabel = SAMPLE_TILL_LABEL,
    ...options
  }: { locale?: AdminLocale; tillLabel?: string } & Omit<RenderOptions, 'wrapper'> = {},
) {
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <NextIntlClientProvider locale={locale} messages={MESSAGES[locale]}>
        <TillLabelProvider label={tillLabel}>{children}</TillLabelProvider>
      </NextIntlClientProvider>
    )
  }
  return render(ui, { wrapper: Wrapper, ...options })
}
