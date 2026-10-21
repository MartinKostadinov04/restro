// @vitest-environment jsdom
import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import {
  CARDS_PER_SHEET,
  chunkCards,
  PRINT_CSS,
  type PrintCard,
  PrintSheets,
  printedAddress,
} from './print-sheet'
import { SVG } from './test-view'

const card = (index: number, label = String(index)): PrintCard => ({
  id: `tb_${String(index).padStart(22, '0')}`,
  label,
  area: 'Terrace',
  address: `http://192.168.1.20:3000/t/Ab3dEfGh1jKlMnOpQrSt${String(index).padStart(2, '0')}`,
  qrSvg: SVG,
})

describe('the print sheet', () => {
  it('puts six cards on a page, two across and three down', () => {
    expect(CARDS_PER_SHEET).toBe(6)
    expect(chunkCards([]).length).toBe(0)
    expect(chunkCards([1, 2, 3]).map((sheet) => sheet.length)).toEqual([3])
    expect(chunkCards([1, 2, 3, 4, 5, 6]).map((sheet) => sheet.length)).toEqual([6])
    expect(chunkCards([1, 2, 3, 4, 5, 6, 7]).map((sheet) => sheet.length)).toEqual([6, 1])
    expect(chunkCards(Array.from({ length: 13 }, (_, i) => i)).map((s) => s.length)).toEqual([
      6, 6, 1,
    ])
    expect(PRINT_CSS).toContain('grid-template-columns: 1fr 1fr')
    expect(PRINT_CSS).toContain('grid-template-rows: repeat(3, 1fr)')
  })

  it('is a page of its own in print: A4, no margin, a break after every sheet but the last', () => {
    expect(PRINT_CSS).toContain('@page { size: A4; margin: 0; }')
    expect(PRINT_CSS).toContain('break-after: page')
    expect(PRINT_CSS).toContain('.pc-sheet:last-child { break-after: auto; }')
    expect(PRINT_CSS).toContain('width: 210mm')
    expect(PRINT_CSS).toContain('height: 296mm')
    // The toolbar is for the screen only.
    expect(PRINT_CSS).toMatch(/@media print \{[^}]*\.pc-toolbar \{ display: none; \}/)
  })

  it('draws one card per code, at most six to a sheet', () => {
    const cards = Array.from({ length: 8 }, (_, i) => card(i + 1))
    render(<PrintSheets venueName="Demo Club" logoUrl={null} cards={cards} />)
    const sheets = screen.getAllByTestId('print-sheet')
    expect(sheets.map((sheet) => within(sheet).getAllByTestId('print-card').length)).toEqual([6, 2])
    expect(sheets.map((sheet) => sheet.getAttribute('data-cards'))).toEqual(['6', '2'])
    expect(screen.getAllByTestId('print-card')).toHaveLength(8)
  })

  it('each card has the venue name, the table, the code, the address as text and the scan line in both languages', () => {
    render(<PrintSheets venueName="Demo Club" logoUrl={null} cards={[card(12, 'VIP 3')]} />)
    const only = screen.getByTestId('print-card')
    expect(within(only).getByText('Demo Club')).toBeTruthy()
    expect(within(only).getByText('Маса / Table')).toBeTruthy()
    expect(within(only).getByTestId('print-label').textContent).toBe('VIP 3')
    expect(within(only).getByTestId('print-area').textContent).toBe('Terrace')
    expect(within(only).getByTestId('print-qr').tagName).toBe('IMG')
    expect(within(only).getByTestId('print-address').textContent).toBe(
      '192.168.1.20:3000/t/Ab3dEfGh1jKlMnOpQrSt12',
    )
    expect(within(only).getByText('Сканирайте за менюто / Scan for the menu')).toBeTruthy()
  })

  it('shows the logo instead of the name when the venue has one', () => {
    render(
      <PrintSheets venueName="Demo Club" logoUrl="/api/assets/file/logo.png" cards={[card(1)]} />,
    )
    const logo = screen.getByRole('img', { name: 'Demo Club' }) as HTMLImageElement
    expect(logo.getAttribute('src')).toBe('/api/assets/file/logo.png')
    expect(screen.queryByText('Demo Club')).toBeNull()
  })

  it('prints the address without the scheme, and gives a longer name a smaller type', () => {
    expect(printedAddress('https://menu.club.bg/t/abc')).toBe('menu.club.bg/t/abc')
    expect(printedAddress('http://localhost:3000/t/abc')).toBe('localhost:3000/t/abc')
    render(
      <PrintSheets
        venueName="V"
        logoUrl={null}
        cards={[card(1, '12'), card(2, 'VIP 12 B'), card(3, 'Terrace corner 3')]}
      />,
    )
    const sizes = screen.getAllByTestId('print-label').map((label) => label.style.fontSize)
    expect(sizes).toEqual(['30pt', '22pt', '15pt'])
  })
})
