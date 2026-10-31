// What a provider's card form on the guest page is (#114, D127): the one shape every provider's
// `<kind>/card-form.ts` exports as `cardForm`, found by `card-forms.ts` with a glob so that no
// shared file names a provider (the vendor-word wall). The page asks the registry by the provider's
// kind, which the server sends as a public word.

import type { PayFormHandle, PayFormProps, SemanticColours, ViewTheme } from '@restro/shell'

/**
 * The venue's General look as a provider's form needs it (D130, "the provider's card form"): the
 * colours of both screens, the body font as a plain stack (no CSS variables: the provider's frame
 * cannot read the page's), the corners in pixels, the density, the text size and the sheet colour.
 * The page makes it from the published snapshot's view (rule 4), never from the database; each
 * provider maps it to its own options (`<kind>/appearance.ts`).
 */
export interface CardFormLook {
  readonly colors: SemanticColours
  readonly colorsDark: SemanticColours
  /** The venue's light/dark policy: `auto` follows the phone at the moment the form opens. */
  readonly scheme: ViewTheme['scheme']
  readonly fontFamily: string
  readonly radius: number
  readonly density: 'compact' | 'comfortable' | 'spacious'
  readonly textSize: 'standard' | 'large'
  readonly sheet: 'ink' | 'panel' | 'page'
}

/** What the page gives a card form besides the element. */
export interface CardFormContext {
  /**
   * The venue's General look, or null/absent where the page has none (a demo, a test): the form
   * then draws with the provider's own default.
   */
  readonly look?: CardFormLook | null
  /** The provider's form values from `GET /api/guest/payment`. */
  readonly values: Readonly<Record<string, string>>
  /** Where the provider sends the guest back after a redirect (this page, with no query). */
  readonly returnUrl: string
  /** The card was confirmed with no redirect: the page sends `pay.returned`. */
  readonly onReturned: () => void
  /** Set just before confirming, cleared after it answers without a redirect. */
  readonly markRedirect: (on: boolean) => void
}

/** One provider's card form. */
export interface CardFormConnector {
  /** The provider's kind: the folder it is in. */
  readonly kind: string
  /** How the guest is told who processes the payment ("Payment processed by … for …"). */
  readonly processor: string
  /**
   * The query keys the provider adds to the return address after a redirect. The page takes them
   * out of the address before it asks for anything (return-address.ts).
   */
  readonly returnKeys: readonly string[]
  /** Mounts the form into `target`. */
  readonly mount: (
    target: HTMLElement,
    props: PayFormProps,
    context: CardFormContext,
  ) => PayFormHandle
}
