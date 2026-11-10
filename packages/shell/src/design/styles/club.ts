import type { StyleFile } from '../style'

// Club (D128, closes T87): the dark club night. The screen is forced dark whatever the phone says,
// Unbounded carries the venue title, the section titles and the item names (the renderer draws a
// name in the Heading font) at the Heavy weight, in capitals; the density is tight and a line shows
// one line of description, so a long drinks list fits a standing guest's screen. Section headers run
// as full-width bands, the strip cards are the large size, the section marks are pills on the
// header's band, the bill alternates its rows and keeps its lines compact, and the order bar is
// docked at the bottom of the screen.
//
// The header stays on `panel`, never `ink`: on a dark screen the ink band is the light one, which
// would put a white bar across the top of a dark menu (D130 and the options spec, "Notes on the
// columns"). Navigation on the header's band takes the band's own pair, so the current pill is drawn
// in the band's two colours and not in the accent.
//
// Its brief is docs/deliverables/2026-10-31-soft-classic-club-briefs.md, whose values are the
// options spec's section 4 Club column (docs/deliverables/2026-10-27-menu-design-options-spec.md)
// with the review's defaults (2026-10-27-menu-design-options-review.md, "Net effect": Club takes a
// list of methods, the total at the bottom and the detailed receipt). `departures` lists every value
// that stands off that column, with why.

export const clubStyle = {
  id: 'club',
  departures: [
    'Pay Methods, the bill’s Total place and the Receipt layout are not options any more (the options review ditched all three), so Club gets their fixed defaults: a list of methods instead of its tiles, the total at the bottom of the bill instead of the top, and the detailed receipt instead of a compact one. Nothing about them is Club-only, and every one of the three is a look the whole set lost, not a look the renderer cannot draw.',
    'The pay scope, the promo field and the status panel went the same way: stacked rows, folded and centred for every Style.',
  ],
  values: {
    general: {
      screen: 'dark',
      heading_font: 'unbounded',
      heading_weight: 'heavy',
      corners: 'soft',
      depth: 'low',
      density: 'compact',
      text_size: 'standard',
      buttons: 'accent',
    },
    header: { band: 'panel', arrangement: 'compact', title_size: 'm', logo_size: 'l' },
    navigation: { marker: 'pills', band: 'header' },
    sections: { header: 'band', title_size: 'l', title_case: 'capitals', strip_card_size: 'l' },
    items: {
      frame: 'rows',
      name_size: 'l',
      name_weight: 'heavy',
      name_case: 'capitals',
      price_place: 'end',
      portion_place: 'beside',
      description_lines: '1',
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
    bill: { rows: 'zebra', lines: 'compact' },
    order: { add_control: 'plus', order_bar: 'docked', line_photos: 'hidden' },
    pay: { tip: 'chips' },
    receipt: { venue_block: 'logo' },
  },
} as const satisfies StyleFile
