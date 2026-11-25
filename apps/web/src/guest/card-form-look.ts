// The venue's General look for the provider's card form (D130, "Stripe's Payment Element"): read
// from the published snapshot's view model on the guest page, never from the database (rule 4). A
// pure function, so a plain unit test shows what reaches the form. Each provider maps the look to
// its own options in `connectors/<kind>/appearance.ts`; this file names none.

import type { ViewModel } from '@restro/shell'

import type { CardFormLook } from '../connectors/card-form-types'

/**
 * The look of the view's General (colours of both screens, the screen policy, the body font, the
 * corners, the density, the text size) and Sheets (the colour of the sheet the form sits on).
 * `fontStack` turns the body font's family into a stack the provider's frame can read (no CSS
 * variables).
 */
export function cardFormLookOf(
  view: Pick<ViewModel, 'theme' | 'design'>,
  fontStack: (family: string) => string,
): CardFormLook {
  const { theme, design } = view
  return {
    colors: theme.colors,
    colorsDark: theme.colorsDark,
    scheme: theme.scheme,
    fontFamily: fontStack(theme.font),
    radius: theme.radius,
    density: design.general.density,
    textSize: design.general.text_size,
    sheet: design.sheets.sheets,
  }
}
