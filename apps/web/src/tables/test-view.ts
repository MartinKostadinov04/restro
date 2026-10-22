// Fixtures for the Tables & QR component tests: a venue with a till and three areas (a coded table,
// a plain one, a hidden one and one with neither number nor name), two menus, and the menu each
// area and table shows. Not part of the app.
import { SAMPLE_TILL_LABEL } from '@/fields/samples'
import type { HallView, MenuShown, TableRowView, TablesView } from '@/server/tables/view'

export const VENUE_ID = 'vn_0123456789ABCDEFGHIJKL'
export const TOKEN_A = 'Ab3dEfGh1jKlMnOpQrStUv'
export const SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 3 3"><path d="M0 0h1v1H0z"/></svg>'

export const MAIN_MENU = 'nd_0000000000000000000001'
export const COCKTAILS = 'nd_0000000000000000000002'

export const MENUS = [
  { id: MAIN_MENU, name: 'Main menu', live: true },
  { id: COCKTAILS, name: 'Cocktails', live: false },
] as const

/** The venue's live menu: what an area or a table shows when nobody chose another. */
export const VENUE_MENU: MenuShown<'venue'> = { id: MAIN_MENU, name: 'Main menu', level: 'venue' }

export function row(overrides: Partial<TableRowView> & { id: string }): TableRowView {
  return {
    number: null,
    label: null,
    shownAs: null,
    isPublic: true,
    hasCode: false,
    codeKey: null,
    address: null,
    qrSvg: null,
    menu: VENUE_MENU,
    routeMenuId: null,
    ...overrides,
  }
}

export function hall(overrides: Partial<HallView> & { id: string; name: string }): HallView {
  return {
    isPublic: true,
    menu: VENUE_MENU,
    routeMenuId: null,
    tables: [],
    ...overrides,
  }
}

/** Table 2 has a code, 10 has none, VIP is hidden, and one table has neither number nor name. */
export function view(overrides: Partial<TablesView> = {}): TablesView {
  const coded = row({
    id: 'tb_0000000000000000000002',
    number: '2',
    shownAs: '2',
    hasCode: true,
    address: `http://localhost:3000/t/${TOKEN_A}`,
    qrSvg: SVG,
  })
  return {
    venueId: VENUE_ID,
    venueName: 'Demo Club',
    canManage: true,
    fromTill: true,
    sourceLabel: SAMPLE_TILL_LABEL,
    baseUrl: 'http://localhost:3000',
    menus: MENUS,
    halls: [
      hall({
        id: 'ar_0000000000000000000001',
        name: 'Main hall',
        tables: [
          row({ id: 'tb_0000000000000000000004', number: 'VIP', shownAs: 'VIP', isPublic: false }),
          row({ id: 'tb_0000000000000000000009' }),
        ],
      }),
      hall({
        id: 'ar_0000000000000000000002',
        name: 'Terrace',
        tables: [coded, row({ id: 'tb_0000000000000000000010', number: '10', shownAs: '10' })],
      }),
      hall({
        id: 'ar_0000000000000000000003',
        name: 'Tables',
        tables: [row({ id: 'tb_0000000000000000000001', number: '1', shownAs: '1' })],
      }),
    ],
    total: 5,
    coded: 1,
    sample: { token: TOKEN_A, shownAs: '2' },
    ...overrides,
  }
}
