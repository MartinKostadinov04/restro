import type { StyleFile } from '../style'

// Editorial (D127): Editorial Market as drawn today, as a preset over Basic. Its values are the
// options spec's section 4 column (docs/deliverables/2026-10-27-menu-design-options-spec.md) with
// the review's defaults for the options it ditched and the spec's four corrections (D129, first
// bullet), so that it draws Editorial Market as the guest sees it now:
//   - the call kinds are icon beside word in a two-column grid: the `list` value, not `tiles`;
//   - Send and Pay are accent today while the "+" and the order bar are ink, which one Buttons
//     value cannot reproduce, so Buttons is `ink` and Send and Pay follow it;
//   - the receipt's dashed rules are ruled rows;
//   - two-column cards draw the choices summary and the extra fields (a renderer rule).
// The photo's "stage" is the Photos page's panel backdrop with an inset frame, cropped to fill.
//
// Departures from today's look, each forced by a floor or a renderer rule (listed in `departures`
// below; the lead checks the list against the rendering).

export const editorialStyle = {
  id: 'editorial',
  departures: [
    'The 9–11 px marks, chips, allergen numbers and table label rise to the 12 px floor.',
    'Strip crops and the dish photo are 4:3 (today the strip is 1.22:1).',
    'A card shows three description lines beside a photo too (today two).',
    'The fixed small shadows of sheets, strip cards and the "+" become the `low` depth step.',
    'Buttons is `ink` and Send and Pay follow it (today they are accent); on an ink sheet they invert (ink on ink).',
    'The receipt’s dashed rules are ruled rows (a dashed edge would dress the confirmation as a fiscal document, D122).',
    'Two-column cards draw the choices summary and the extra fields, which today’s layout hides.',
  ],
  values: {
    general: {
      screen: 'auto',
      heading_font: 'same',
      heading_weight: 'heavy',
      corners: 'soft',
      depth: 'low',
      density: 'spacious',
      text_size: 'standard',
      buttons: 'ink',
    },
    header: { band: 'ink', arrangement: 'stacked', title_size: 'xl', logo_size: 'm' },
    navigation: { marker: 'underline', band: 'page' },
    sections: { header: 'plain', title_size: 'l', title_case: 'written', strip_card_size: 'l' },
    items: {
      frame: 'rows',
      name_size: 'l',
      name_weight: 'heavy',
      name_case: 'capitals',
      price_place: 'under',
      portion_place: 'own',
      description_lines: '3',
      layout: 'two',
      guest_switch: 'on',
    },
    photos: {
      shape: 'landscape',
      fit: 'cover',
      backdrop: 'panel',
      frame: 'inset',
      corners: 'general',
    },
    labels: { labels: 'outline', allergens: 'numbers' },
    dish: { kind: 'page', photo: 'hero' },
    sheets: { sheets: 'ink' },
    call: { kinds: 'list' },
    bill: { rows: 'ruled', lines: 'detailed' },
    order: { add_control: 'plus', order_bar: 'floating', line_photos: 'hidden' },
    pay: { tip: 'chips' },
    receipt: { venue_block: 'name' },
  },
} as const satisfies StyleFile
