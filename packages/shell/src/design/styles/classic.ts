import type { StyleFile } from '../style'

// Classic (D128): a printed menu read on a phone. A text list with no frames and no shadow, square
// corners, a centred serif title, section headers centred in capitals, the whole description on
// every line, labels as plain words and the allergens by name. Playfair Display carries the venue
// title, the section titles and the item names (the renderer draws a name in the Heading font);
// the body stays the venue's own font, which no Style sets.
//
// The heading weight is `regular`, the weight a book sets, so the Heavy fallback does not apply
// here. It would not fire anyway: Playfair Display serves 900 (packages/core/src/theme/fonts.ts).
// Of the six fonts only Lora (700) and Manrope (800) fall back, and only at Heavy; a venue that
// moves Classic's Heading weight to Heavy on Lora gets bold.
//
// Its brief is docs/deliverables/2026-10-31-soft-classic-club-briefs.md, whose values are the
// options spec's section 4 Classic column (docs/deliverables/2026-10-27-menu-design-options-spec.md)
// with the review's defaults (2026-10-27-menu-design-options-review.md, "Net effect": Classic takes
// list kinds, the centred status, ruled rows, no card and the detailed receipt). `departures` lists
// every value that stands off that column, with why.
//
// The options the review ditched are not a Style's to set any more, so Classic takes their fixed
// defaults: the bill flat (the brief asked for a card slip) with its total at the bottom, the pay
// scope in stacked rows with a list of methods and a folded promo field, the detailed receipt, the
// centred status panel (the brief asked for a quiet inline line).

export const classicStyle = {
  id: 'classic',
  departures: [
    'Call a waiter Kinds is `list`, not the brief’s `words`: `words` is one of the four values the options review removed, and `list` is the kind nearest to it (an icon beside a word, one per line).',
    'Bill Rows is `ruled`: the brief’s `open` is one of those four values too, and a ruled row is what a printed bill has.',
  ],
  values: {
    general: {
      screen: 'auto',
      heading_font: 'playfair-display',
      heading_weight: 'regular',
      corners: 'square',
      depth: 'none',
      density: 'comfortable',
      text_size: 'standard',
      buttons: 'ink',
    },
    header: { band: 'page', arrangement: 'centred', title_size: 'l', logo_size: 'm' },
    navigation: { marker: 'underline', band: 'page' },
    sections: { header: 'centred', title_size: 'm', title_case: 'capitals', strip_card_size: 'm' },
    items: {
      frame: 'open',
      name_size: 'm',
      name_weight: 'regular',
      name_case: 'written',
      price_place: 'end',
      portion_place: 'beside',
      description_lines: 'all',
      layout: 'list',
      guest_switch: 'off',
    },
    photos: {
      shape: 'landscape',
      fit: 'cover',
      backdrop: 'panel',
      frame: 'bleed',
      corners: 'general',
    },
    labels: { labels: 'text', allergens: 'names' },
    dish: { kind: 'page', photo: 'hero' },
    sheets: { sheets: 'page' },
    call: { kinds: 'list' },
    bill: { rows: 'ruled', lines: 'detailed' },
    order: { add_control: 'add', order_bar: 'docked', line_photos: 'hidden' },
    pay: { tip: 'rows' },
    receipt: { venue_block: 'name' },
  },
} as const satisfies StyleFile
