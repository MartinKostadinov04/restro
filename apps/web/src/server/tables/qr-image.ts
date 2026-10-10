// The QR images (brief S3-07), made with the `qrcode` library the same way everywhere: error
// correction M, a quiet zone of 2 modules, black on white and nothing else. A code must scan
// whatever the admin's theme is (dark mode, a coloured page), so the colours are fixed here and
// the SVG paints its own white background.
//
// Server side only: the tab and the print sheet draw the SVG that comes from here, and the
// download route sends the PNG or SVG file from here. Nothing is fetched: the text to encode is the
// address built from the token (core/qr.ts).
import QRCode from 'qrcode'

const OPTIONS = {
  errorCorrectionLevel: 'M',
  margin: 2,
  color: { dark: '#000000', light: '#ffffff' },
} as const

/** The width in pixels of a downloaded PNG or SVG file. */
export const DOWNLOAD_WIDTH = 1024

/** The code as SVG markup, scaling to whatever box it is put in (it has a `viewBox`, no size). */
export function qrSvg(text: string): Promise<string> {
  return QRCode.toString(text, { ...OPTIONS, type: 'svg' })
}

/** The code as a standalone SVG file's text, `DOWNLOAD_WIDTH` pixels wide. */
export function qrSvgFile(text: string): Promise<string> {
  return QRCode.toString(text, { ...OPTIONS, type: 'svg', width: DOWNLOAD_WIDTH })
}

/** The code as PNG bytes, `DOWNLOAD_WIDTH` pixels wide. */
export function qrPng(text: string): Promise<Buffer> {
  return QRCode.toBuffer(text, { ...OPTIONS, type: 'png', width: DOWNLOAD_WIDTH })
}
