// The manifest of the Editorial Market face (doc "The face contract"). It is validated when the
// module loads: a face that breaks R6, R7 or R9 cannot even be imported, let alone installed.
//
// The face draws the service screens (brief SH-06, D71): the bag, the table bill, calling a waiter,
// paying and the receipt. It declares `ordering: true` and the five guest features it has controls
// for; a control is still drawn only when the venue switched the feature on, the platform supports
// it and the host bound its services (R15, D72).
// The face declares no options of its own any more (brief S6, D92): the menu's layout, whether
// guests may switch it and which sections are drawn as the photo-led strip are menu settings in the
// composer, published in the snapshot and read from the view model (`view.layout`, a section's
// `hints.layout`). They were the options `layout`, `layoutSwitch` and `featureFirstSection`.

import { type FaceManifest, validateManifest } from '@restro/shell'

const CANDIDATE = {
  face: 'editorial-market',
  version: '1.0.0',
  channels: ['qr'],
  slots: {
    'item.name': 'required',
    'item.price': 'required',
    'item.allergens': 'required',
    'item.state': 'required',
    // Cut to two or three lines on a card, and the guest can read the rest on the dish page (R9).
    'item.description': { optional: true, lines: 3, overflow: 'expand' },
    // The card photo on its stage panel, cropped 4:3 around its focal point (R10).
    'item.image': { optional: true, variant: 'card', aspect: '4:3' },
    'item.badges': 'optional',
    'item.portion': 'optional',
    'item.dietary': 'optional',
    'item.tags': 'optional',
    'item.extra_fields': 'optional',
    'item.modifiers': 'optional',
  },
  // The number of each allergen on its item; a tap opens the sheet that names them (R6).
  allergen_mode: 'inline_codes',
  // An item without a photo is a clean text row: no placeholder picture (R8, R10).
  no_image_layout: 'text_only',
  ordering: true,
  // The phone scrolls.
  paging: null,
  // The guest controls this face draws (R15): the filter button, and the services: the waiter, the
  // bill, the bag (ordering) and the pay entry.
  features: ['filters', 'call_waiter', 'bill', 'ordering', 'pay'],
  // What this face puts on what (D93; checked by the contract test in both schemes): body and
  // secondary text on the page and the panels, the accent as text, text on the accent fill, and
  // the venue bar, which is the page's colour on the ink.
  colour_pairs: [
    { fg: 'text', bg: 'background' },
    { fg: 'text', bg: 'surface' },
    { fg: 'muted', bg: 'background' },
    { fg: 'muted', bg: 'surface' },
    { fg: 'accent_text', bg: 'background' },
    { fg: 'accent_text', bg: 'surface' },
    { fg: 'on_accent', bg: 'accent' },
    { fg: 'background', bg: 'text' },
  ],
  options: {},
  tokens: [
    'color.background',
    'color.surface',
    'color.accent',
    'color.on_accent',
    'color.text',
    'color.muted',
    'color.accent_text',
    'color.border',
    'font',
    'radius',
    'shadow',
    'logo',
  ],
}

const result = validateManifest(CANDIDATE)
if (!result.ok) {
  const issues = result.issues.map((issue) => `${issue.path}: ${issue.message}`).join('; ')
  throw new Error(`the editorial-market manifest is not valid: ${issues}`)
}

/** The validated manifest of the face. */
export const EDITORIAL_MARKET_MANIFEST: FaceManifest = result.manifest
