import type { StyleFile } from '../style'

// Basic (D128): the base. A plain, well-working menu any venue can use, and the Style every venue
// starts on. Its value for each option is the first value of that option's row in the contract
// (D130: "Basic's values are the first value of each row"); scripts/design-contract.test.ts holds
// the two equal. It reproduces no earlier look, so it departs from none.

export const basicStyle = {
  id: 'basic',
  departures: [],
  values: {
    general: {
      screen: 'auto',
      heading_font: 'same',
      heading_weight: 'bold',
      corners: 'soft',
      depth: 'low',
      density: 'comfortable',
      text_size: 'standard',
      buttons: 'accent',
    },
    header: { band: 'page', arrangement: 'stacked', title_size: 'm', logo_size: 'm' },
    navigation: { marker: 'underline', band: 'page' },
    sections: { header: 'ruled', title_size: 'm', title_case: 'written', strip_card_size: 'm' },
    items: {
      frame: 'rows',
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
      shape: 'landscape',
      fit: 'cover',
      backdrop: 'panel',
      frame: 'bleed',
      corners: 'general',
    },
    labels: { labels: 'outline', allergens: 'numbers' },
    dish: { kind: 'sheet', photo: 'hero' },
    sheets: { sheets: 'panel' },
    call: { kinds: 'tiles' },
    bill: { rows: 'ruled', lines: 'detailed' },
    order: { add_control: 'plus', order_bar: 'floating', line_photos: 'hidden' },
    pay: { tip: 'chips' },
    receipt: { venue_block: 'name' },
  },
} as const satisfies StyleFile
