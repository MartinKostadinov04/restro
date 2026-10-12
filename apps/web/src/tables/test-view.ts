// Fixtures for the Tables & QR component tests: a view with three halls, a coded table and a plain
// one. Not part of the app.
import type { TableRowView, TablesView } from '@/server/tables/view'

export const VENUE_ID = 'vn_0123456789ABCDEFGHIJKL'
export const TOKEN_A = 'Ab3dEfGh1jKlMnOpQrStUv'
export const SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 3 3"><path d="M0 0h1v1H0z"/></svg>'

export function row(overrides: Partial<TableRowView> & { id: string }): TableRowView {
  return {
    number: null,
    label: null,
    shownAs: null,
    isPublic: true,
    token: null,
    address: null,
    qrSvg: null,
    ...overrides,
  }
}

/** Table 2 has a code, 10 has none, VIP is hidden, and one table has neither number nor name. */
export function view(overrides: Partial<TablesView> = {}): TablesView {
  const coded = row({
    id: 'tb_0000000000000000000002',
    number: '2',
    shownAs: '2',
    token: TOKEN_A,
    address: `http://localhost:3000/t/${TOKEN_A}`,
    qrSvg: SVG,
  })
  return {
    venueId: VENUE_ID,
    venueName: 'Demo Club',
    canManage: true,
    qr: {
      mode: 'ours',
      baseUrl: 'http://localhost:3000',
      baseIsDefault: true,
      defaultBaseUrl: 'http://localhost:3000',
      ownPattern: null,
    },
    halls: [
      {
        id: 'ar_0000000000000000000001',
        name: 'Main hall',
        isPublic: true,
        tables: [
          row({ id: 'tb_0000000000000000000004', number: 'VIP', shownAs: 'VIP', isPublic: false }),
          row({ id: 'tb_0000000000000000000009' }),
        ],
      },
      {
        id: 'ar_0000000000000000000002',
        name: 'Terrace',
        isPublic: true,
        tables: [coded, row({ id: 'tb_0000000000000000000010', number: '10', shownAs: '10' })],
      },
      {
        id: 'ar_0000000000000000000003',
        name: 'Tables',
        isPublic: true,
        tables: [row({ id: 'tb_0000000000000000000001', number: '1', shownAs: '1' })],
      },
    ],
    total: 5,
    coded: 1,
    sample: { token: TOKEN_A, shownAs: '2' },
    ...overrides,
  }
}
