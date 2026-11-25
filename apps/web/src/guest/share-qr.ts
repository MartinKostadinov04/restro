// The share's QR code on a guest's phone (#544, D160 §3): the table's own address as a PNG data
// URL, which the face draws in an `<img>` so another phone at the table can open the same share.
// Made with the `qrcode` library the same way as every other code of ours (error correction M, a
// quiet zone, black on white, so it scans whatever the template's colours are), loaded only when a
// share is on so the menu's bundle never carries it. Nothing is fetched: the address is the page's
// own, built by the caller.

/** The code as a PNG data URL, or null when the library could not be loaded or the text is too big. */
export async function shareQrImage(text: string): Promise<string | null> {
  try {
    const { default: QRCode } = await import('qrcode')
    return await QRCode.toDataURL(text, {
      errorCorrectionLevel: 'M',
      margin: 2,
      color: { dark: '#000000', light: '#ffffff' },
      width: 512,
    })
  } catch {
    return null
  }
}
