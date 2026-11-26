// Helpers for the web app's component tests (jsdom). Not part of the app.
import { type RenderOptions, render, waitFor } from '@testing-library/react'
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

/**
 * Waits until `user-event` would accept a pointer on `element`.
 *
 * Radix turns pointer events off on `document.body` while a modal is open and turns them back on
 * for the topmost layer a render later. A `findBy…` on the dialog's own text resolves as soon as
 * that text is in the DOM, which can be before that second render has committed, so a click or a
 * type sent at once fails outright with "the element has `pointer-events: none`" — on a loaded CI
 * runner more often than here. Waiting for the gap to close is the fix; forcing
 * `document.body.style.pointerEvents` would paper over the real state instead of waiting for it.
 *
 * The walk mirrors user-event's own: the nearest ancestor that declares `pointer-events` decides,
 * and an element no ancestor speaks for is interactive.
 */
export async function waitUntilClickable(
  element: Element,
  options?: { timeout?: number },
): Promise<void> {
  await waitFor(() => {
    for (let node: Element | null = element; node !== null; node = node.parentElement) {
      const declared = node.ownerDocument.defaultView?.getComputedStyle(node).pointerEvents
      if (declared === 'none') throw new Error('pointer events are still off for this element')
      if (declared === 'auto') return
    }
  }, options)
}
