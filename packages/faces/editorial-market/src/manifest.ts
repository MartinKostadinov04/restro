// The manifest of the Editorial Market face (doc "The face contract"). It is validated when the
// module loads: a face that breaks R6, R7 or R9 cannot even be imported, let alone installed.
//
// Browsing only (D38, D69): `ordering` is false until the service screens are ported (brief
// SH-06), which also adds the service features (call a waiter, bill, bag, pay) to `features`.
// The manifest is also where the face's options are declared, with their defaults: the face reads
// them through `resolveOptions(EDITORIAL_MARKET_MANIFEST, props.options)` and keeps no defaults of
// its own, and the admin builds its form from the same declaration (brief SH-05b).

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
  ordering: false,
  // The phone scrolls.
  paging: null,
  // The guest controls this face draws (R15): the filter button. SH-06 adds the services.
  features: ['filters'],
  options: {
    // How the items of a section are laid out when the guest has not chosen another.
    layout: {
      type: 'enum',
      values: ['list', 'one', 'two'],
      default: 'two',
      group: 'look',
      label: { bg: 'Подредба на менюто', en: 'Menu layout' },
    },
    // The first section as a photo-led strip.
    featureFirstSection: {
      type: 'boolean',
      default: true,
      group: 'look',
      label: {
        bg: 'Първата секция като лента със снимки',
        en: 'Photo strip for the first section',
      },
    },
    // The three-button layout switch the guest sees under a section title.
    layoutSwitch: {
      type: 'boolean',
      default: true,
      group: 'feature',
      label: { bg: 'Гостите могат да сменят подредбата', en: 'Guests can change the layout' },
    },
  },
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
