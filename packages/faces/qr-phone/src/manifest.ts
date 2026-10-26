// The manifest of the QR phone face (doc "The face contract"). It is validated when the module
// loads: a face that breaks R6, R7 or R9 cannot even be imported, let alone installed.
//
// It draws the table's shared order (#75) with the minimum controls the Playwright specs need: an
// "Add" on each orderable item and the order panel (`menu.bag`), with Send and the sent orders'
// states (#77).

import { type FaceManifest, validateManifest } from '@restro/shell'

const CANDIDATE = {
  face: 'qr-phone',
  version: '1.0.0',
  channels: ['qr'],
  slots: {
    'item.name': 'required',
    'item.price': 'required',
    'item.allergens': 'required',
    'item.state': 'required',
    // Three lines, then "More": the guest can read the rest (R9).
    'item.description': { optional: true, lines: 3, overflow: 'expand' },
    // The card photo, cropped 4:3 around its focal point (R10).
    'item.image': { optional: true, variant: 'card', aspect: '4:3' },
    'item.badges': 'optional',
    'item.portion': 'optional',
    'item.dietary': 'optional',
    'item.tags': 'optional',
    'item.extra_fields': 'optional',
    'item.modifiers': 'optional',
  },
  // The number of the allergen on each item; a tap opens the sheet that names it (R6).
  allergen_mode: 'inline_codes',
  // An item without a photo is a text card: no placeholder picture (R8, R10).
  no_image_layout: 'text_only',
  ordering: true,
  // The phone scrolls.
  paging: null,
  // The guest controls this face draws (R15): the filter chips and the shared order. It has no
  // options of its own.
  features: ['filters', 'ordering'],
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
  throw new Error(`the qr-phone manifest is not valid: ${issues}`)
}

/** The validated manifest of the face. */
export const QR_PHONE_MANIFEST: FaceManifest = result.manifest
