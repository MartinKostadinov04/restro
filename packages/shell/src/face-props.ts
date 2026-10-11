// What every face receives from its host besides the view model (doc "The visualization shell",
// section 9: the host props of the reference face). One type for all faces, so the guest page can
// hand the same props to whichever face the venue picked.

import type { Locale } from '@restro/core'

import type { ServiceBinding } from './services'
import type { ViewModel } from './view-model'

/** What every face receives from its host besides the view model. */
export interface FaceHostProps {
  readonly view: ViewModel
  /** Where `/a/…` image paths live. */
  readonly assetBase?: string
  /** The menu's languages for the switch; fewer than two hides it. */
  readonly languages?: readonly Locale[]
  readonly onLanguageChange?: (locale: Locale) => void
  /** The confirmed table's label ("12"), or null. */
  readonly tableLabel?: string | null
  /** Font family name → self-hosted font stack. */
  readonly fontStacks?: Readonly<Record<string, string>>
  /** Forced colour scheme; `auto` follows the guest's screen. */
  readonly scheme?: 'auto' | 'light' | 'dark'
  /** The face's own presentation options as published (unvalidated; the face falls back to its defaults). */
  readonly options?: Readonly<Record<string, string | boolean>>
  /**
   * The services of the page (bag, bill, waiter, pay, receipt): the host's state to draw and the
   * way to send a command (D72). A face draws a service control only when this is bound and the
   * view model's `features` has the service on (R15). Not bound in Stage 3.
   */
  readonly services?: ServiceBinding
}
