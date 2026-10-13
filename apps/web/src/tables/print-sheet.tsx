// The print sheet of the table codes (briefs S3-07, S5): A4 pages, 2 columns by 3 rows = 6 cards per
// page, the cards in the order of the venue's areas and tables (hidden ones are left out by the
// page). Each card has the venue's logo (else its name), the table's name and its area, the code,
// the address as text and "Сканирайте за менюто / Scan for the menu". No PDF library: the page is plain HTML with a
// print stylesheet (`@page` A4, a page break after every sheet), and the browser's "Print / Save as
// PDF" turns it into the file. The cards are always black on white (a code must scan whatever the
// admin's theme is) and always in both languages (it is printed matter, not interface).
import bg from '../../messages/bg.json'
import en from '../../messages/en.json'

import { QrPicture } from './qr-picture'

/** Cards on one A4 page. */
export const CARDS_PER_SHEET = 6

/** One card. */
export interface PrintCard {
  readonly id: string
  /** What the table is called. */
  readonly label: string
  /** The area the table is in. */
  readonly area: string
  /** The address in the code. */
  readonly address: string
  readonly qrSvg: string
}

/** The cards split into pages of `CARDS_PER_SHEET` (the last page may have fewer). */
export function chunkCards<T>(cards: readonly T[], size: number = CARDS_PER_SHEET): T[][] {
  const sheets: T[][] = []
  for (let index = 0; index < cards.length; index += size) {
    sheets.push(cards.slice(index, index + size))
  }
  return sheets
}

/** The address as printed under the code: without `https://`, so it fits and reads easily. */
export function printedAddress(address: string): string {
  return address.replace(/^https?:\/\//i, '')
}

/** A smaller type for a longer name, so it stays on the card. */
function labelSize(label: string): string {
  if (label.length <= 6) return '30pt'
  if (label.length <= 12) return '22pt'
  return '15pt'
}

/** The stylesheet of the sheet. Static text: nothing from the venue is ever put in it. */
export const PRINT_CSS = `
@page { size: A4; margin: 0; }
body { background: #fff; color: #000; }
.pc-root { background: #fff; color: #000; color-scheme: light; min-height: 100vh; padding: 0 0 16px; }
.pc-toolbar { display: flex; flex-wrap: wrap; gap: 12px; align-items: center; justify-content: space-between; box-sizing: border-box; width: 210mm; max-width: 100%; margin: 0 auto; padding: 16px; }
.pc-sheet { box-sizing: border-box; width: 210mm; height: 296mm; padding: 10mm; margin: 0 auto 12px; display: grid; grid-template-columns: 1fr 1fr; grid-template-rows: repeat(3, 1fr); background: #fff; break-after: page; break-inside: avoid; overflow: hidden; box-shadow: 0 0 0 1px #d4d4d8, 0 6px 16px rgba(0, 0, 0, 0.08); }
.pc-card { box-sizing: border-box; min-width: 0; min-height: 0; border: 0.25mm dashed #9ca3af; padding: 4mm; display: flex; flex-direction: column; align-items: center; justify-content: space-between; gap: 1.5mm; text-align: center; break-inside: avoid; overflow: hidden; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
.pc-venue { display: flex; align-items: center; justify-content: center; height: 8mm; max-width: 100%; font: 700 13pt/1.1 system-ui, sans-serif; overflow: hidden; }
.pc-venue img { max-height: 8mm; max-width: 70mm; object-fit: contain; }
.pc-table { display: grid; gap: 0.5mm; justify-items: center; max-width: 100%; }
.pc-caption { font: 600 8pt/1 system-ui, sans-serif; letter-spacing: 0.08em; text-transform: uppercase; color: #52525b; }
.pc-label { font: 800 30pt/1.05 system-ui, sans-serif; overflow-wrap: anywhere; max-width: 85mm; }
.pc-area { font: 600 9pt/1.1 system-ui, sans-serif; color: #52525b; overflow-wrap: anywhere; max-width: 85mm; }
.pc-qr { width: 42mm; height: 42mm; display: block; background: #fff; }
.pc-address { font: 6.5pt/1.25 ui-monospace, Consolas, monospace; color: #3f3f46; overflow-wrap: anywhere; max-width: 86mm; max-height: 9mm; overflow: hidden; }
.pc-scan { margin: 0; font: 600 10pt/1.15 system-ui, sans-serif; }
@media print {
  .pc-toolbar { display: none; }
  .pc-root { padding: 0; min-height: 0; }
  .pc-sheet { margin: 0; box-shadow: none; }
  .pc-sheet:last-child { break-after: auto; }
}
`

/** The pages of cards. A server component: no state, no script. */
export function PrintSheets({
  venueName,
  logoUrl,
  cards,
}: {
  venueName: string
  logoUrl: string | null
  cards: readonly PrintCard[]
}) {
  const sheets = chunkCards(cards)
  const tableWord = `${bg.tables.card.table} / ${en.tables.card.table}`
  const scanText = `${bg.tables.card.scan} / ${en.tables.card.scan}`
  return (
    <div data-testid="print-sheets">
      {sheets.map((sheet, index) => (
        <section
          key={sheet[0]?.id ?? index}
          className="pc-sheet"
          data-testid="print-sheet"
          data-cards={sheet.length}
        >
          {sheet.map((card) => (
            <article key={card.id} className="pc-card" data-testid="print-card">
              <div className="pc-venue">
                {logoUrl ? (
                  // biome-ignore lint/performance/noImgElement: a signed link to the venue's own logo
                  <img src={logoUrl} alt={venueName} />
                ) : (
                  venueName
                )}
              </div>
              <div className="pc-table">
                <span className="pc-caption">{tableWord}</span>
                <strong
                  className="pc-label"
                  style={{ fontSize: labelSize(card.label) }}
                  data-testid="print-label"
                >
                  {card.label}
                </strong>
                <span className="pc-area" data-testid="print-area">
                  {card.area}
                </span>
              </div>
              <QrPicture
                svg={card.qrSvg}
                alt={`${tableWord} ${card.label}`}
                className="pc-qr"
                testId="print-qr"
              />
              <code className="pc-address" data-testid="print-address">
                {printedAddress(card.address)}
              </code>
              <p className="pc-scan">{scanText}</p>
            </article>
          ))}
        </section>
      ))}
    </div>
  )
}
