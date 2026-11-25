import type { StyleFile } from '../style'

// Soft (D128): the app look. A column of rounded cards, each a row with a square thumbnail, a panel
// band over the header, pill section marks, soft labels, the logo on the receipt and photos on the
// order lines. Nothing on the page has an edge: General's Corners is `round` (16 px) and the `low`
// depth lifts each card off the page, as a phone app does.
//
// Its brief is docs/deliverables/2026-10-31-soft-classic-club-briefs.md, whose values are the
// options spec's section 4 Soft column (docs/deliverables/2026-10-27-menu-design-options-spec.md)
// with the review's defaults (2026-10-27-menu-design-options-review.md, "Net effect": Soft takes
// ruled rows and no card). `departures` lists every value that stands off that column, with why.
//
// The options the review ditched are not a Style's to set any more, so Soft takes their fixed
// defaults: the bill flat with its total at the bottom, the pay scope in stacked rows with a list of
// methods and a folded promo field, the detailed receipt, the centred status panel.

export const softStyle = {
  id: 'soft',
  departures: [
    'Items Layout is `list`, not the brief’s `two`: in two columns the renderer keeps the price at 15 px while the name drops to 13.5 px (the price never reads under the description, css.ts "A name’s size is one option and five places"), which turns the hierarchy an app look needs upside down, and two columns is already Editorial’s layout. A column of carded rows keeps the name over its price and puts a long drinks list in fewer screens.',
    'Bill Rows is `ruled`: the brief’s `open` is one of the four values the options review removed.',
  ],
  values: {
    general: {
      screen: 'auto',
      heading_font: 'same',
      heading_weight: 'bold',
      corners: 'round',
      depth: 'low',
      density: 'comfortable',
      text_size: 'standard',
      buttons: 'accent',
    },
    header: { band: 'panel', arrangement: 'centred', title_size: 'm', logo_size: 'm' },
    navigation: { marker: 'pills', band: 'page' },
    sections: { header: 'plain', title_size: 'm', title_case: 'written', strip_card_size: 'm' },
    items: {
      frame: 'cards',
      name_size: 'm',
      name_weight: 'bold',
      name_case: 'written',
      price_place: 'end',
      portion_place: 'beside',
      description_lines: '2',
      layout: 'list',
      guest_switch: 'on',
    },
    photos: {
      shape: 'square',
      fit: 'cover',
      backdrop: 'panel',
      frame: 'bleed',
      corners: 'general',
    },
    labels: { labels: 'soft', allergens: 'numbers' },
    dish: { kind: 'sheet', photo: 'hero' },
    sheets: { sheets: 'panel' },
    call: { kinds: 'tiles' },
    bill: { rows: 'ruled', lines: 'detailed' },
    order: { add_control: 'plus', order_bar: 'floating', line_photos: 'shown' },
    pay: { tip: 'chips' },
    receipt: { venue_block: 'logo' },
  },
} as const satisfies StyleFile
