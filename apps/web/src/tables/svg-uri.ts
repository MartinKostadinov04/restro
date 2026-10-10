// An `<img src>` for SVG markup, so the tab and the print sheet draw a QR code as a picture and
// never put markup into the page. Client-safe: no import.

/** `data:image/svg+xml,…` for `svg`. */
export function svgDataUri(svg: string): string {
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`
}

/** The SVG markup back out of `svgDataUri` (the end-to-end test decodes what the page shows). */
export function svgFromDataUri(uri: string): string | null {
  const prefix = 'data:image/svg+xml;utf8,'
  return uri.startsWith(prefix) ? decodeURIComponent(uri.slice(prefix.length)) : null
}
